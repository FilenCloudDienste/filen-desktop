/* eslint-disable @typescript-eslint/no-var-requires */
const { execFileSync } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

/**
 * Apple notarization inspects nested archives, so the rclone Mach-O binaries inside the bundled
 * `Resources/rclone/*.zip` must be signed with our Developer ID + hardened runtime + a secure timestamp, or
 * notarization fails ("binary is not signed / no secure timestamp / no hardened runtime"). electron-builder signs
 * the app's own Mach-O but treats the zips as opaque data, so we sign the rclone binaries here - after the app is
 * packed but BEFORE it is code-signed/sealed - by extract -> codesign -> re-zip (preserving the original layout so
 * the runtime extractor in src/lib/rclone/binary.ts still finds them). No entitlements: rclone is a standalone
 * static Go binary run as a subprocess.
 *
 * macOS-only. A no-op on Windows/Linux and on unsigned local dev builds (no Developer ID identity present).
 *
 * @param {import("electron-builder").AfterPackContext} context
 * @returns {Promise<void>}
 */
exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") {
		return
	}

	const rcloneDir = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources", "rclone")

	if (!fs.existsSync(rcloneDir)) {
		return
	}

	const zips = fs.readdirSync(rcloneDir).filter(name => name.toLowerCase().endsWith(".zip"))

	if (zips.length === 0) {
		return
	}

	// electron-builder imports the CSC cert into a keychain during signing, which runs AFTER afterPack. Force that
	// setup now (accessing `.value`) so the Developer ID identity is resolvable here.
	let keychainFile = null

	try {
		const info = await context.packager.codeSigningInfo.value

		keychainFile = info && info.keychainFile ? info.keychainFile : null
	} catch {
		// No code-signing info (unsigned build) - the identity lookup below finds nothing and we skip.
	}

	const findArgs = ["find-identity", "-v", "-p", "codesigning"]

	if (keychainFile) {
		findArgs.push(keychainFile)
	}

	let identity = null

	try {
		const match = execFileSync("security", findArgs, { encoding: "utf8" }).match(/\b([0-9A-F]{40})\b\s+"Developer ID Application:/)

		identity = match ? match[1] : null
	} catch {
		// `security find-identity` failed - treat as no identity.
	}

	if (!identity) {
		console.log("[afterPack] no Developer ID Application identity found - skipping rclone signing (unsigned build)")

		return
	}

	for (const zip of zips) {
		const zipPath = path.join(rcloneDir, zip)
		const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "filen-rclone-sign-"))

		try {
			execFileSync("ditto", ["-x", "-k", zipPath, workDir], { stdio: "inherit" })

			const binaries = []
			const walk = dir => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					const full = path.join(dir, entry.name)

					if (entry.isDirectory()) {
						walk(full)
					} else if (entry.isFile() && entry.name === "rclone") {
						binaries.push(full)
					}
				}
			}

			walk(workDir)

			if (binaries.length === 0) {
				throw new Error(`no rclone binary found inside ${zip}`)
			}

			for (const binary of binaries) {
				const args = ["--force", "--options", "runtime", "--timestamp", "--sign", identity]

				if (keychainFile) {
					args.push("--keychain", keychainFile)
				}

				args.push(binary)

				execFileSync("codesign", args, { stdio: "inherit" })
				execFileSync("codesign", ["--verify", "--strict", binary], { stdio: "inherit" })
			}

			fs.rmSync(zipPath, { force: true })
			execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", workDir, zipPath], { stdio: "inherit" })

			console.log(`[afterPack] signed rclone inside ${zip} (${binaries.length} binary/binaries)`)
		} finally {
			fs.rmSync(workDir, { recursive: true, force: true })
		}
	}
}
