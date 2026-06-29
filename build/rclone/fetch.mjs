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

// FUSE-T is the macOS FUSE layer the network drive auto-installs when NEITHER macFUSE nor FUSE-T is present
// (restoring the old @filen/network-drive behavior of auto-installing FUSE-T on macOS). It is fetched at build
// time into bin/deps/ and bundled into the macOS app via mac.extraResources — NOT committed (the pkg is ~24 MB).
// FUSE-T publishes NO SHA256SUMS manifest, so FUSE_T_SHA256 below is PINNED: computed once from the release asset
// and hardcoded here. Bumping FUSE-T = change BOTH FUSE_T_VERSION and this hash, then re-run this script.
const FUSE_T_VERSION = "1.2.7"
const FUSE_T_SHA256 = "6a29c747e61a86a405a189efc3de42812d73147135f93a1bb0624c1e7b90e654"
const FUSE_T_URL = `https://github.com/macos-fuse-t/fuse-t/releases/download/${FUSE_T_VERSION}/fuse-t-macos-installer-${FUSE_T_VERSION}.pkg`

// WinFSP is the Windows FUSE layer the network drive installs/upgrades (via the NSIS installer at install time, plus a
// runtime install-if-absent fallback). Like FUSE-T it is fetched at build time into bin/deps/ — NOT committed — and
// bundled via win.extraResources plus embedded into the NSIS installer. WinFSP publishes NO SHA256SUMS manifest, so
// WINFSP_SHA256 is PINNED. Bumping WinFSP = change WINFSP_VERSION, WINFSP_TAG and this hash, then re-run this script.
// v2.2B1 (2.2.26112) carries the CVE-2026-3006 fix (no stable release has it yet).
const WINFSP_VERSION = "2.2.26112"
const WINFSP_TAG = "v2.2B1"
const WINFSP_SHA256 = "f9e70ede2344a30d377a38555e2128c0770d64ddc53c0e2af7dfe0c605f422a8"
const WINFSP_URL = `https://github.com/winfsp/winfsp/releases/download/${WINFSP_TAG}/winfsp-${WINFSP_VERSION}.msi`

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// build/rclone/fetch.mjs -> repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..")
const BIN_DIR = path.join(REPO_ROOT, "bin", "rclone")
const DEPS_DIR = path.join(REPO_ROOT, "bin", "deps")

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

/**
 * macOS only: fetch the FUSE-T installer pkg into bin/deps and verify it against the PINNED SHA256
 * (FUSE-T ships no SHA256SUMS manifest, unlike rclone). Idempotent and intact-aware — a present pkg whose
 * hash already matches is left untouched. Uses the same .part -> verify -> rename pattern as the rclone
 * zips; a hash mismatch deletes the bad download and throws so CI fails loudly. No-op on Windows/Linux,
 * whose builds bundle only the rclone zips.
 *
 * @returns {Promise<void>}
 */
async function fetchFuseT() {
	const fileName = `fuse-t-macos-installer-${FUSE_T_VERSION}.pkg`
	const destPath = path.join(DEPS_DIR, fileName)

	await fs.promises.mkdir(DEPS_DIR, { recursive: true })

	console.log(`[rclone-fetch] FUSE-T v${FUSE_T_VERSION}, target dir: ${DEPS_DIR}`)

	// Idempotent: if a matching, intact pkg is already present, skip re-downloading.
	if (fs.existsSync(destPath)) {
		const actual = await sha256File(destPath)

		if (actual === FUSE_T_SHA256) {
			console.log(`[rclone-fetch] OK (cached)   ${fileName} sha256=${FUSE_T_SHA256}`)

			return
		}

		console.log(`[rclone-fetch] stale         ${fileName} (have ${actual}); re-downloading`)
	}

	console.log(`[rclone-fetch] downloading   ${FUSE_T_URL}`)

	const tmpPath = `${destPath}.part`

	let actual

	try {
		actual = await downloadToFile(FUSE_T_URL, tmpPath)
	} catch (e) {
		await fs.promises.rm(tmpPath, { force: true })

		throw e
	}

	if (actual !== FUSE_T_SHA256) {
		await fs.promises.rm(tmpPath, { force: true })

		throw new Error(`SHA256 mismatch for ${fileName}: expected ${FUSE_T_SHA256}, got ${actual}. Deleted the bad download.`)
	}

	await fs.promises.rename(tmpPath, destPath)

	console.log(`[rclone-fetch] OK (verified) ${fileName} sha256=${FUSE_T_SHA256}`)
}

/**
 * Windows only: fetch the WinFSP installer msi into bin/deps and verify it against the PINNED SHA256 (WinFSP ships no
 * SHA256SUMS manifest, like FUSE-T). Same .part -> verify -> rename pattern as the rclone zips; idempotent and
 * intact-aware — a present msi whose hash already matches is left untouched. No-op on macOS/Linux.
 *
 * @returns {Promise<void>}
 */
async function fetchWinFSP() {
	const fileName = `winfsp-${WINFSP_VERSION}.msi`
	const destPath = path.join(DEPS_DIR, fileName)

	await fs.promises.mkdir(DEPS_DIR, { recursive: true })

	console.log(`[rclone-fetch] WinFSP v${WINFSP_VERSION}, target dir: ${DEPS_DIR}`)

	// Idempotent: if a matching, intact msi is already present, skip re-downloading.
	if (fs.existsSync(destPath)) {
		const actual = await sha256File(destPath)

		if (actual === WINFSP_SHA256) {
			console.log(`[rclone-fetch] OK (cached)   ${fileName} sha256=${WINFSP_SHA256}`)

			return
		}

		console.log(`[rclone-fetch] stale         ${fileName} (have ${actual}); re-downloading`)
	}

	console.log(`[rclone-fetch] downloading   ${WINFSP_URL}`)

	const tmpPath = `${destPath}.part`

	let actual

	try {
		actual = await downloadToFile(WINFSP_URL, tmpPath)
	} catch (e) {
		await fs.promises.rm(tmpPath, { force: true })

		throw e
	}

	if (actual !== WINFSP_SHA256) {
		await fs.promises.rm(tmpPath, { force: true })

		throw new Error(`SHA256 mismatch for ${fileName}: expected ${WINFSP_SHA256}, got ${actual}. Deleted the bad download.`)
	}

	await fs.promises.rename(tmpPath, destPath)

	console.log(`[rclone-fetch] OK (verified) ${fileName} sha256=${WINFSP_SHA256}`)
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

	// macOS also bundles the FUSE-T installer so a fresh machine can auto-install the FUSE layer.
	if (process.platform === "darwin") {
		await fetchFuseT()
	}

	// Windows also bundles the WinFSP installer (the Windows FUSE layer) so the NSIS installer / runtime can install it.
	if (process.platform === "win32") {
		await fetchWinFSP()
	}

	console.log(`[rclone-fetch] done: ${zipNames.length} zip(s) ready in ${BIN_DIR}`)
}

main().catch(err => {
	console.error(`[rclone-fetch] FAILED: ${err instanceof Error ? err.message : String(err)}`)
	process.exit(1)
})
