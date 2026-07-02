// Verify the native-dependency version strings agree across EVERY file that hard-codes them, so a version bump can't
// silently ship a mismatched binary/installer. build/rclone/fetch.mjs is the source of truth (it downloads the
// artifacts); this asserts that src/lib/rclone/constants.ts, src/index.ts and build/installer.nsh reference the SAME
// versions. Wired into `npm run build`, so it runs on every build (dev + CI, before electron-builder packages).
//
// Fails loudly (exit 1) on any drift, OR if an expected declaration can't be found at all — a moved/renamed declaration
// is itself a drift risk (the check would otherwise pass blind), so a missing match is treated as a failure.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// build/rclone/check-versions.mjs -> repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..")

/** @type {string[]} */
const errors = []

/**
 * @param {string} rel
 * @returns {string}
 */
function read(rel) {
	return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
}

/**
 * Capture group 1 of the FIRST match of `regex` in `text`, or null (recording an error) when it doesn't match.
 *
 * @param {string} text
 * @param {RegExp} regex
 * @param {string} label
 * @returns {string | null}
 */
function extractOne(text, regex, label) {
	const m = text.match(regex)

	if (!m || !m[1]) {
		errors.push(`Could not find ${label} (pattern ${regex}). Did the declaration move or change shape?`)

		return null
	}

	return m[1]
}

/**
 * Capture group 1 of EVERY match of a global `regex` in `text`, or [] (recording an error) when there are none.
 *
 * @param {string} text
 * @param {RegExp} regex
 * @param {string} label
 * @returns {string[]}
 */
function extractAll(text, regex, label) {
	const values = [...text.matchAll(regex)].map(m => m[1])

	if (values.length === 0) {
		errors.push(`Could not find ${label} (pattern ${regex}). Did the declaration move or change shape?`)
	}

	return values
}

/**
 * Assert every value in `actuals` equals `expected`. A null `expected` (source-of-truth extraction failed) is skipped so
 * the same problem isn't reported twice.
 *
 * @param {string} label
 * @param {string[]} actuals
 * @param {string | null} expected
 * @param {string} source
 * @returns {void}
 */
function expectAll(label, actuals, expected, source) {
	if (expected === null) {
		return
	}

	for (const actual of actuals) {
		if (actual !== expected) {
			errors.push(`${label} is "${actual}" but should be "${expected}" (source of truth: ${source}).`)
		}
	}
}

// --- Source of truth: build/rclone/fetch.mjs ---
const fetchSrc = read("build/rclone/fetch.mjs")
const rcloneVersion = extractOne(fetchSrc, /RCLONE_VERSION\s*=\s*"([^"]+)"/, "RCLONE_VERSION in fetch.mjs")
const fuseTVersion = extractOne(fetchSrc, /FUSE_T_VERSION\s*=\s*"([^"]+)"/, "FUSE_T_VERSION in fetch.mjs")
const winfspVersion = extractOne(fetchSrc, /WINFSP_VERSION\s*=\s*"([^"]+)"/, "WINFSP_VERSION in fetch.mjs")

// --- rclone: src/lib/rclone/constants.ts ---
const constantsSrc = read("src/lib/rclone/constants.ts")
expectAll(
	"RCLONE_VERSION in constants.ts",
	extractAll(constantsSrc, /export const RCLONE_VERSION\s*=\s*"([^"]+)"/g, "RCLONE_VERSION in constants.ts"),
	rcloneVersion,
	"fetch.mjs"
)

// --- FUSE-T + WinFSP installer filenames: src/index.ts (each appears twice: dev + prod path segments) ---
const indexSrc = read("src/index.ts")
expectAll(
	"FUSE-T pkg version in index.ts",
	extractAll(indexSrc, /fuse-t-macos-installer-([\d.]+)\.pkg/g, "fuse-t pkg filename in index.ts"),
	fuseTVersion,
	"fetch.mjs"
)
expectAll(
	"WinFSP msi version in index.ts",
	extractAll(indexSrc, /winfsp-([\d.]+)\.msi/g, "winfsp msi filename in index.ts"),
	winfspVersion,
	"fetch.mjs"
)

// --- WinFSP installer filename: build/installer.nsh ---
const nshSrc = read("build/installer.nsh")
expectAll(
	"WINFSP_INSTALLER version in installer.nsh",
	extractAll(nshSrc, /WINFSP_INSTALLER\s+"winfsp-([\d.]+)\.msi"/g, "WINFSP_INSTALLER in installer.nsh"),
	winfspVersion,
	"fetch.mjs"
)

if (errors.length > 0) {
	console.error("[check-versions] native-dependency version drift detected:\n")

	for (const e of errors) {
		console.error(`  ✗ ${e}`)
	}

	console.error(
		"\nEvery native-dependency version must match across:\n" +
			"  - build/rclone/fetch.mjs        (source of truth: RCLONE_VERSION / FUSE_T_VERSION / WINFSP_VERSION)\n" +
			"  - src/lib/rclone/constants.ts   (RCLONE_VERSION)\n" +
			"  - src/index.ts                  (fuse-t-macos-installer-<v>.pkg, winfsp-<v>.msi)\n" +
			"  - build/installer.nsh           (WINFSP_INSTALLER)\n"
	)

	process.exit(1)
}

console.log(
	`[check-versions] OK - rclone ${rcloneVersion}, FUSE-T ${fuseTVersion}, WinFSP ${winfspVersion} consistent across ` +
		"fetch.mjs, constants.ts, index.ts and installer.nsh."
)
