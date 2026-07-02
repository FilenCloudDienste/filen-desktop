/* eslint-disable @typescript-eslint/no-var-requires */
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

/**
 * Runs after electron-builder packs each platform/arch, before signing/sealing. Two responsibilities:
 *
 * 1. PRESENCE (ALL platforms): verify the bundled raw rclone binaries actually landed in `app.asar.unpacked/bin/rclone`.
 *    If the rclone fetch step was skipped/failed (e.g. an aborted download or a hung extraction), the app builds green
 *    but its network drive / S3 / WebDAV never start - the class of prod bug the raw-binary change fixed. Throw instead
 *    of shipping it. This is the cross-platform sanity check (Windows/Linux have no other guard).
 * 2. SIGNING (macOS only): Apple notarization requires every Mach-O to be Developer-ID-signed + hardened-runtime +
 *    secure-timestamp. rclone ships ad-hoc (arm64) / unsigned (x64), so sign the osx binaries here. On Windows,
 *    electron-builder's own `app.asar.unpacked` walk signs rclone-windows-*.exe; Linux needs no signing. Signing is
 *    skipped (with a log) on unsigned local builds with no Developer ID identity - but the presence check still runs.
 *
 * @param {import("electron-builder").AfterPackContext} context
 * @returns {Promise<void>}
 */
exports.default = async function afterPack(context) {
	const platform = context.electronPlatformName // "darwin" | "mas" | "win32" | "linux"
	const isMac = platform === "darwin" || platform === "mas"
	const osToken = isMac ? "osx" : platform === "win32" ? "windows" : "linux"
	const ext = platform === "win32" ? ".exe" : ""

	// fetch.mjs bundles BOTH arches of the current OS (the runtime picks by process.arch), so both must be present.
	const expected = [`rclone-${osToken}-amd64${ext}`, `rclone-${osToken}-arm64${ext}`]

	// The unpacked resources dir differs by platform: inside the .app bundle on macOS, directly under appOutDir elsewhere.
	const resourcesDir = isMac
		? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
		: path.join(context.appOutDir, "resources")
	const rcloneDir = path.join(resourcesDir, "app.asar.unpacked", "bin", "rclone")

	const present = fs.existsSync(rcloneDir) ? fs.readdirSync(rcloneDir) : []
	const missing = expected.filter(name => !present.includes(name))

	if (missing.length > 0) {
		// Diagnostic: dump the real state so we can tell "dir missing" vs "empty" vs "unexpected names" vs "packed but not
		// asar-unpacked" - narrows down whether the fetch didn't produce binaries, they didn't persist, or asarUnpack missed.
		const unpackedBinDir = path.dirname(rcloneDir)

		console.error(`[afterPack] rcloneDir=${rcloneDir}`)
		console.error(`[afterPack]   exists=${fs.existsSync(rcloneDir)} contents=${JSON.stringify(present)}`)
		console.error(
			`[afterPack]   app.asar.unpacked/bin contents=${fs.existsSync(unpackedBinDir) ? JSON.stringify(fs.readdirSync(unpackedBinDir)) : "(dir missing)"}`
		)

		throw new Error(
			`[afterPack] missing bundled rclone binaries for ${platform}: ${missing.join(", ")} (in ${rcloneDir}). ` +
				"The rclone fetch step (build/rclone/fetch.mjs) must run before packaging - refusing to ship a build whose network drive cannot start."
		)
	}

	// Signing is macOS-only from here on.
	if (!isMac) {
		return
	}

	// The macOS icon (mac.icon = build/icons/mac/icon.icon) must compile into BOTH the modern asset catalog (Assets.car,
	// read by macOS 26 via CFBundleIconName) and the legacy icon.icns (read by older macOS via CFBundleIconFile).
	// electron-builder derives both from the .icon using Xcode's icon tooling, so a missing one means that tooling
	// (Xcode 26+) wasn't available and the app would silently ship the default Electron icon - fail loudly instead.
	for (const iconFile of ["Assets.car", "icon.icns"]) {
		if (!fs.existsSync(path.join(resourcesDir, iconFile))) {
			throw new Error(
				`[afterPack] ${iconFile} not found in ${resourcesDir} - the macOS icon (build/icons/mac/icon.icon) did not compile. ` +
					"Install Xcode 26+ on the build machine (electron-builder needs it to process the .icon)."
			)
		}
	}

	// electron-builder imports the CSC cert into a keychain during signing, which runs AFTER afterPack. Force that setup
	// now (accessing `.value`) so the Developer ID identity is resolvable here.
	let keychainFile = null

	try {
		const info = await context.packager.codeSigningInfo.value

		keychainFile = info && info.keychainFile ? info.keychainFile : null
	} catch {
		// No code-signing info (unsigned build) - the identity lookup below finds nothing and we skip signing.
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
		console.log("[afterPack] no Developer ID Application identity found - skipping rclone signing (unsigned/dev build)")

		return
	}

	// Presence already verified above, so every `expected` binary exists.
	for (const binary of expected) {
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
