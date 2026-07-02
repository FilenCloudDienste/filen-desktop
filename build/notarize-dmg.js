/* eslint-disable @typescript-eslint/no-var-requires */
require("dotenv").config()

const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

// Our macOS minimum, expressed as the DARWIN kernel version electron-updater compares against `os.release()`:
// macOS 12 (Monterey) = Darwin 21. Electron 38+ requires macOS 12 (Chromium dropped macOS 11 / Big Sur), so a client on
// macOS 11 (Darwin 20) or older must NOT be offered this update — it would download a build that cannot launch.
// NOTE: this is the Darwin version, NOT "12.0" — os.release() returns "20.x" on Big Sur, "21.x" on Monterey.
const MIN_DARWIN_VERSION = "21.0.0"

/**
 * Inject `minimumSystemVersion` into the macOS auto-update manifest(s) (`latest-mac.yml`, plus any channel `*-mac.yml`).
 *
 * electron-builder writes `minimumSystemVersion` into the app's Info.plist (from `mac.minimumSystemVersion`) but NOT into
 * the update yml, so electron-updater has nothing to gate on and would offer the update to macOS versions that can't run
 * it (they'd download it, install it, and then fail to launch). electron-updater checks `updateInfo.minimumSystemVersion`
 * against `os.release()` and skips the update when the client is older, so we set it here — after the yml is generated.
 * Adds a single top-level key; the per-file `sha512` entries the auto-updater actually verifies are left untouched.
 *
 * @param {string} outDir
 * @returns {void}
 */
function injectMinimumSystemVersion(outDir) {
	let entries

	try {
		entries = fs.readdirSync(outDir)
	} catch {
		return
	}

	for (const name of entries.filter(entry => /-mac\.yml$/.test(entry))) {
		const ymlPath = path.join(outDir, name)
		const content = fs.readFileSync(ymlPath, "utf8")

		if (/^minimumSystemVersion:/m.test(content)) {
			continue
		}

		fs.writeFileSync(ymlPath, `minimumSystemVersion: ${MIN_DARWIN_VERSION}\n${content}`)

		console.log(`afterAllArtifactBuild: set minimumSystemVersion ${MIN_DARWIN_VERSION} (macOS 12) in ${name}`)
	}
}

/**
 * afterAllArtifactBuild hook. Two macOS-only responsibilities (both no-ops on Windows/Linux, whose ymls/artifacts don't
 * match the mac patterns):
 *
 * 1. Gate the macOS auto-update by OS version so clients below our minimum aren't offered a build they can't run — see
 *    {@link injectMinimumSystemVersion}. Runs regardless of Apple creds (it's unrelated to signing).
 * 2. Notarize + staple each .dmg. electron-builder's `mac.notarize` notarizes/staples the .app (covering the .zip
 *    auto-update payload and the .app inside the .dmg) but NOT the .dmg itself, so a freshly downloaded .dmg can trip
 *    Gatekeeper ("cannot be checked for malicious software"). Skipped when Apple creds are absent.
 *
 * Note: stapling mutates the .dmg after latest-mac.yml is generated, so the published .dmg no longer byte-matches its
 * sha512/blockmap in latest-mac.yml — harmless, because macOS auto-update downloads the .zip, never the .dmg.
 *
 * @param {import("electron-builder").BuildResult} buildResult
 * @returns {Promise<string[]>}
 */
exports.default = async function afterAllArtifactBuild(buildResult) {
	const artifactPaths = buildResult.artifactPaths || []
	const outDir = buildResult.outDir || (artifactPaths[0] ? path.dirname(artifactPaths[0]) : null)

	if (outDir) {
		injectMinimumSystemVersion(outDir)
	}

	const dmgs = artifactPaths.filter(artifactPath => artifactPath.endsWith(".dmg"))

	if (dmgs.length === 0) {
		return []
	}

	const appleId = process.env.APPLE_ID
	const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
	const teamId = process.env.APPLE_TEAM_ID

	if (!appleId || !appleIdPassword || !teamId) {
		console.log("notarize-dmg: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set — skipping .dmg notarization")

		return []
	}

	for (const dmg of dmgs) {
		console.log(`notarize-dmg: notarizing ${dmg}`)

		execFileSync("xcrun", ["notarytool", "submit", dmg, "--apple-id", appleId, "--password", appleIdPassword, "--team-id", teamId, "--wait"], {
			stdio: "inherit"
		})

		console.log(`notarize-dmg: stapling ${dmg}`)

		execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" })
	}

	return []
}
