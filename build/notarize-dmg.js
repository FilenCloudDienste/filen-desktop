/* eslint-disable @typescript-eslint/no-var-requires */
require("dotenv").config()

const { execFileSync } = require("child_process")

/**
 * afterAllArtifactBuild hook: notarize + staple each .dmg.
 *
 * electron-builder's `mac.notarize` notarizes/staples the .app (which covers the .zip auto-update payload and the .app
 * inside the .dmg) but does NOT notarize the .dmg itself, so a freshly downloaded .dmg can trip Gatekeeper ("cannot be
 * checked for malicious software"). We notarize + staple it here so the website download opens cleanly. Runs once per
 * platform job; a no-op on Windows/Linux (no .dmg artifacts) and when Apple creds are absent.
 *
 * The .dmg's sha512 in latest-mac.yml is computed at artifact-creation (before this hook), so stapling makes it stale —
 * harmless, because macOS auto-update downloads the .zip, never the .dmg (the .dmg is only the manual website download).
 *
 * NOTE: the macOS auto-update OS gate (minimumSystemVersion in latest-mac.yml) is deliberately NOT done here. This hook
 * runs BEFORE electron-builder writes latest-mac.yml — the hook fires inside packager.build().then(), and the yml is
 * written afterwards in publishManager.awaitTasks() -> writeUpdateInfoFiles — so injecting from here is a silent no-op.
 * It lives in a post-electron-builder step instead: build/inject-min-darwin.js, chained after electron-builder in build:mac.
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
