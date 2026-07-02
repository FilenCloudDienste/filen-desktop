/* eslint-disable @typescript-eslint/no-var-requires */
// Inject `minimumSystemVersion` into the macOS auto-update manifest(s) AFTER electron-builder has written them.
//
// Why a standalone post-build step and not the afterAllArtifactBuild hook: electron-builder writes latest-mac.yml AFTER
// that hook runs (the hook fires inside packager.build().then(); the yml is written later in
// publishManager.awaitTasks() -> writeUpdateInfoFiles), so a hook-based injection scans an empty prod/ and silently does
// nothing. This runs as its own step chained after electron-builder in `build:mac`, when latest-mac.yml exists on disk.
//
// Why it's needed at all: electron-builder does NOT write minimumSystemVersion into the yml. electron-updater checks
// updateInfo.minimumSystemVersion against os.release() (the DARWIN kernel version) and SKIPS the update when the client
// is older. Electron 38+ requires macOS 12 (Chromium dropped macOS 11 / Big Sur), so clients on macOS 11 (Darwin 20) or
// older must not be offered this build. macOS 12 (Monterey) = Darwin 21 -> value "21.0.0" (the DARWIN version, NOT "12.0":
// os.release() returns "20.x" on Big Sur, "21.x" on Monterey).
//
// Fails LOUDLY (exit 1) if no macOS update manifest is found, so a future regression (missing yml, renamed file, wrong
// step order) breaks the build instead of silently shipping an ungated update to Big Sur users.

const fs = require("fs")
const path = require("path")

const MIN_DARWIN_VERSION = "21.0.0" // macOS 12 (Monterey)
const PROD_DIR = path.resolve(__dirname, "..", "prod")

let entries

try {
	entries = fs.readdirSync(PROD_DIR)
} catch (e) {
	console.error(`inject-min-darwin: cannot read ${PROD_DIR}: ${e instanceof Error ? e.message : String(e)}`)

	process.exit(1)
}

const macYmls = entries.filter(entry => /-mac\.yml$/.test(entry))

if (macYmls.length === 0) {
	console.error(
		`inject-min-darwin: no *-mac.yml found in ${PROD_DIR} — expected latest-mac.yml after a macOS build. ` +
			"Refusing to publish an ungated macOS auto-update (Big Sur clients would be offered a build that cannot launch)."
	)

	process.exit(1)
}

for (const name of macYmls) {
	const ymlPath = path.join(PROD_DIR, name)
	const content = fs.readFileSync(ymlPath, "utf8")

	if (/^minimumSystemVersion:/m.test(content)) {
		console.log(`inject-min-darwin: ${name} already has minimumSystemVersion — leaving as-is`)

		continue
	}

	// Top-level key (electron-updater reads updateInfo.minimumSystemVersion at the root). Prepending leaves the per-file
	// sha512 entries the auto-updater verifies untouched.
	fs.writeFileSync(ymlPath, `minimumSystemVersion: ${MIN_DARWIN_VERSION}\n${content}`)

	console.log(`inject-min-darwin: set minimumSystemVersion ${MIN_DARWIN_VERSION} (macOS 12) in ${name}`)
}
