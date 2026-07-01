/* eslint-disable @typescript-eslint/no-var-requires */
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

/**
 * Apple notarization requires every Mach-O to be Developer-ID-signed + hardened-runtime + secure-timestamp. The bundled
 * rclone binaries (raw, under `app.asar.unpacked/bin/rclone`) are third-party - rclone ships them ad-hoc (arm64) or
 * unsigned (x64) - so we sign them here, after the app is packed but BEFORE it is code-signed/sealed.
 *
 * macOS-only: on Windows electron-builder's own `app.asar.unpacked` signing walk covers rclone.exe, and Linux needs no
 * signing. A no-op on unsigned local dev builds (no Developer ID identity present).
 *
 * @param {import("electron-builder").AfterPackContext} context
 * @returns {Promise<void>}
 */
exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") {
		return
	}

	const rcloneDir = path.join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
		"Contents",
		"Resources",
		"app.asar.unpacked",
		"bin",
		"rclone"
	)

	if (!fs.existsSync(rcloneDir)) {
		return
	}

	const binaries = fs.readdirSync(rcloneDir).filter(name => name.startsWith("rclone-"))

	if (binaries.length === 0) {
		return
	}

	// electron-builder imports the CSC cert into a keychain during signing, which runs AFTER afterPack. Force that setup
	// now (accessing `.value`) so the Developer ID identity is resolvable here.
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

	for (const binary of binaries) {
		const binaryPath = path.join(rcloneDir, binary)
		const args = ["--force", "--options", "runtime", "--timestamp", "--sign", identity]

		if (keychainFile) {
			args.push("--keychain", keychainFile)
		}

		args.push(binaryPath)

		execFileSync("codesign", args, { stdio: "inherit" })
		execFileSync("codesign", ["--verify", "--strict", binaryPath], { stdio: "inherit" })

		console.log(`[afterPack] signed ${binary}`)
	}
}
