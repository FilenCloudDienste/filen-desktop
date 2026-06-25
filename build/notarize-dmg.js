/* eslint-disable @typescript-eslint/no-var-requires */
require("dotenv").config()

const { execFileSync } = require("child_process")

/**
 * electron-builder's `mac.notarize` notarizes + staples the .app (which covers the .zip auto-update
 * payload and the .app inside the .dmg), but it does NOT notarize the .dmg itself — so a freshly
 * downloaded .dmg can trip Gatekeeper ("cannot be checked for malicious software") on recent macOS.
 * This afterAllArtifactBuild hook notarizes + staples each .dmg so the website download opens cleanly.
 * Runs once per platform job; a no-op on Windows/Linux (no .dmg artifacts) and when creds are absent.
 *
 * Note: stapling mutates the .dmg after latest-mac.yml is generated, so the published .dmg no longer
 * byte-matches its sha512/blockmap in latest-mac.yml. Harmless here — macOS auto-update downloads the
 * .zip, never the .dmg (the .dmg is only the manual website download).
 */
exports.default = async function notarizeDmgs(buildResult) {
	const dmgs = (buildResult.artifactPaths || []).filter(artifactPath => artifactPath.endsWith(".dmg"))

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
