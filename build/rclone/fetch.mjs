// Fetch + SHA256-verify the bundled rclone release zips for the CURRENT build platform.
//
// Runs in CI before electron-builder (and locally for testing) with no dependencies beyond Node
// builtins. It downloads BOTH arches (amd64 + arm64) of the current OS into `<repo>/bin/rclone/`
// so a universal installer can extract the matching one at runtime (spec §11, decision D3).
//
// Usage: node build/rclone/fetch.mjs
//
// Exits 0 on success, non-zero on any download/verification failure so CI fails loudly.

import https from "node:https"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

// KEEP IN SYNC with RCLONE_VERSION in src/lib/rclone/constants.ts.
const RCLONE_VERSION = "1.74.3"

// Both arches ship per build; the installed arch is unknown at build time for a universal installer.
const ARCHES = ["amd64", "arm64"]

const BASE_URL = "https://downloads.rclone.org"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// build/rclone/fetch.mjs -> repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..")
const BIN_DIR = path.join(REPO_ROOT, "bin", "rclone")

/**
 * Map the current Node platform to rclone's OS token used in its official release zip names.
 * Mirrors rcloneOsArch() in src/lib/rclone/constants.ts (win32->windows, darwin->osx, linux->linux).
 *
 * @param {NodeJS.Platform} platform
 * @returns {string}
 */
function rcloneOs(platform) {
	switch (platform) {
		case "win32":
			return "windows"
		case "darwin":
			return "osx"
		case "linux":
			return "linux"
		default:
			throw new Error(`Unsupported platform for rclone bundling: ${platform}`)
	}
}

/**
 * GET a URL and resolve with the 200 response stream, transparently following redirects
 * (downloads.rclone.org may 302 to a mirror/CDN). Rejects on too many redirects, non-200, timeout or socket error.
 *
 * @param {string} url
 * @param {number} [redirectsLeft=5]
 * @returns {Promise<import("node:http").IncomingMessage>}
 */
function httpsGet(url, redirectsLeft = 5) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { "User-Agent": "filen-desktop-rclone-fetch" } }, res => {
			const status = res.statusCode ?? 0

			if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
				res.resume() // Drain so the socket can be reused.

				if (redirectsLeft <= 0) {
					reject(new Error(`Too many redirects fetching ${url}`))

					return
				}

				const next = new URL(res.headers.location, url).toString()

				resolve(httpsGet(next, redirectsLeft - 1))

				return
			}

			if (status !== 200) {
				res.resume()
				reject(new Error(`GET ${url} returned HTTP ${status}`))

				return
			}

			resolve(res)
		})

		req.on("error", reject)
		req.setTimeout(120000, () => {
			req.destroy(new Error(`Timed out fetching ${url}`))
		})
	})
}

/**
 * Fetch a URL fully into a UTF-8 string (used for the small SHA256SUMS manifest).
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
	const res = await httpsGet(url)
	const chunks = []

	for await (const chunk of res) {
		chunks.push(chunk)
	}

	return Buffer.concat(chunks).toString("utf8")
}

/**
 * Stream a URL to `destPath` while computing its SHA256, resolving with the lowercase hex digest.
 *
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<string>}
 */
function downloadToFile(url, destPath) {
	return new Promise((resolve, reject) => {
		httpsGet(url)
			.then(res => {
				const hash = crypto.createHash("sha256")
				const out = fs.createWriteStream(destPath)

				res.on("data", chunk => hash.update(chunk))
				res.on("error", reject)
				out.on("error", reject)
				out.on("finish", () => resolve(hash.digest("hex")))

				res.pipe(out)
			})
			.catch(reject)
	})
}

/**
 * Compute the lowercase hex SHA256 of an existing file.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function sha256File(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256")
		const stream = fs.createReadStream(filePath)

		stream.on("data", chunk => hash.update(chunk))
		stream.on("error", reject)
		stream.on("end", () => resolve(hash.digest("hex")))
	})
}

/**
 * Parse a coreutils-style SHA256SUMS manifest ("<64-hex>  <filename>") into a filename -> hash map.
 * Tolerates the binary-mode "*" filename marker.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseSums(text) {
	const map = new Map()

	for (const line of text.split(/\r?\n/)) {
		const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/)

		if (match) {
			map.set(match[2], match[1].toLowerCase())
		}
	}

	return map
}

async function main() {
	const os = rcloneOs(process.platform)
	const zipNames = ARCHES.map(arch => `rclone-v${RCLONE_VERSION}-${os}-${arch}.zip`)

	console.log(`[rclone-fetch] version v${RCLONE_VERSION}, platform ${process.platform} (os=${os}), arches=${ARCHES.join(", ")}`)
	console.log(`[rclone-fetch] target dir: ${BIN_DIR}`)

	await fs.promises.mkdir(BIN_DIR, { recursive: true })

	const sumsUrl = `${BASE_URL}/v${RCLONE_VERSION}/SHA256SUMS`

	console.log(`[rclone-fetch] fetching checksums: ${sumsUrl}`)

	const sums = parseSums(await fetchText(sumsUrl))

	for (const zipName of zipNames) {
		const expected = sums.get(zipName)

		if (!expected) {
			throw new Error(`No SHA256 entry for ${zipName} in SHA256SUMS (wrong version or filename?)`)
		}

		const destPath = path.join(BIN_DIR, zipName)
		const url = `${BASE_URL}/v${RCLONE_VERSION}/${zipName}`

		// Idempotent: if a matching, intact zip is already present, skip re-downloading.
		if (fs.existsSync(destPath)) {
			const actual = await sha256File(destPath)

			if (actual === expected) {
				console.log(`[rclone-fetch] OK (cached)   ${zipName} sha256=${expected}`)

				continue
			}

			console.log(`[rclone-fetch] stale         ${zipName} (have ${actual}); re-downloading`)
		}

		console.log(`[rclone-fetch] downloading   ${url}`)

		const tmpPath = `${destPath}.part`

		let actual

		try {
			actual = await downloadToFile(url, tmpPath)
		} catch (e) {
			await fs.promises.rm(tmpPath, { force: true })

			throw e
		}

		if (actual !== expected) {
			await fs.promises.rm(tmpPath, { force: true })

			throw new Error(`SHA256 mismatch for ${zipName}: expected ${expected}, got ${actual}. Deleted the bad download.`)
		}

		await fs.promises.rename(tmpPath, destPath)

		console.log(`[rclone-fetch] OK (verified) ${zipName} sha256=${expected}`)
	}

	console.log(`[rclone-fetch] done: ${zipNames.length} zip(s) ready in ${BIN_DIR}`)
}

main().catch(err => {
	console.error(`[rclone-fetch] FAILED: ${err instanceof Error ? err.message : String(err)}`)
	process.exit(1)
})
