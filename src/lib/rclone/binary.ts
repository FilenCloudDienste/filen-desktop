import pathModule from "path"
import fs from "fs-extra"
import { execFile } from "child_process"
import { promisify } from "util"
import extract from "extract-zip"
import isDev from "../../isDev"
import { RCLONE_VERSION, rcloneZipName, rcloneBinaryFileName, rcloneBinDir, rcloneBinaryPath } from "./constants"

const execFileAsync = promisify(execFile)

/**
 * In-flight extraction promises keyed by the target binary path, so concurrent ensureRcloneBinary() calls for the same target
 * share a single extraction instead of racing each other (belt-and-suspenders alongside any caller-side memoization).
 *
 * @type {Map<string, Promise<string>>}
 */
const inFlight = new Map<string, Promise<string>>()

/**
 * Absolute path to the directory that holds the bundled rclone release zips.
 *
 * Production: `<process.resourcesPath>/rclone` (placed there by electron-builder `extraResources`, per spec §11).
 * Development: the repo's `bin/rclone`, resolved relative to this compiled file (`dist/lib/rclone/binary.js`, three levels
 * below the repo root). The same `..`-walk also resolves correctly when the un-compiled `src/lib/rclone/binary.ts` is run
 * directly via tsx.
 *
 * @export
 * @returns {string}
 */
export function bundledZipDir(): string {
	if (isDev) {
		return pathModule.resolve(__dirname, "..", "..", "..", "bin", "rclone")
	}

	return pathModule.join(process.resourcesPath, "rclone")
}

/**
 * Recursively search `dir` for the first file named exactly `fileName` and return its absolute path, or null if none.
 *
 * Used as a fallback to locate the rclone executable inside an extracted zip when the expected nested path is not present.
 *
 * @async
 * @param {string} dir
 * @param {string} fileName
 * @returns {Promise<string | null>}
 */
async function findFileRecursive(dir: string, fileName: string): Promise<string | null> {
	const entries = await fs.readdir(dir, {
		withFileTypes: true
	})

	for (const entry of entries) {
		const fullPath = pathModule.join(dir, entry.name)

		if (entry.isDirectory()) {
			const found = await findFileRecursive(fullPath, fileName)

			if (found) {
				return found
			}
		} else if (entry.isFile() && entry.name === fileName) {
			return fullPath
		}
	}

	return null
}

/**
 * Run `<binaryPath> version` and return its first output line, trimmed (e.g. "rclone v1.74.3").
 *
 * A liveness/sanity check that the extracted binary actually executes on this OS/arch (catches the macOS `killed: 9`
 * unsigned-binary case, spec R2). Throws a contextual error on spawn failure, non-zero exit, or empty output.
 *
 * @export
 * @async
 * @param {string} binaryPath
 * @returns {Promise<string>}
 */
export async function rcloneVersionOf(binaryPath: string): Promise<string> {
	let stdout: string

	try {
		const result = await execFileAsync(binaryPath, ["version"], {
			timeout: 60000,
			windowsHide: true
		})

		stdout = result.stdout
	} catch (e) {
		throw new Error(`Failed to run "${binaryPath} version": ${e instanceof Error ? e.message : String(e)}`)
	}

	const firstLine = stdout.split(/\r?\n/)[0]

	if (!firstLine || firstLine.trim().length === 0) {
		throw new Error(`Unexpected empty output from "${binaryPath} version".`)
	}

	return firstLine.trim()
}

/**
 * Remove every extracted rclone version directory under `<userData>/rclone/bin` except `keepVersion`.
 *
 * Best-effort: individual removal failures are swallowed so a locked or in-use directory never blocks startup. Strictly
 * scoped to `<userData>/rclone/bin` - legacy binaries and appData dirs elsewhere are never touched (spec D8).
 *
 * @export
 * @async
 * @param {string} userData
 * @param {string} keepVersion
 * @returns {Promise<void>}
 */
export async function pruneOldRcloneVersions(userData: string, keepVersion: string): Promise<void> {
	const binRoot = pathModule.dirname(rcloneBinDir(userData, keepVersion))

	try {
		const entries = await fs.readdir(binRoot, {
			withFileTypes: true
		})

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === keepVersion) {
				continue
			}

			try {
				await fs.rm(pathModule.join(binRoot, entry.name), {
					force: true,
					recursive: true
				})
			} catch {
				// Best-effort: a locked or in-use old version directory must not block startup.
			}
		}
	} catch {
		// Best-effort: the bin directory may not exist yet (first run), which is fine.
	}
}

/**
 * Whether `binaryPath` is a present, executable and genuinely-runnable rclone binary - the core self-healing check.
 *
 * (Re)applies the executable bit on non-Windows first (perms can be lost across copies/restores), then actually runs
 * `<binary> version`. ANY failure - missing, not executable, truncated/partial from a write interrupted mid-run, wrong
 * arch, quarantined/killed, or simply not rclone - resolves `false` so the caller re-extracts a known-good copy. Never
 * throws.
 *
 * @export
 * @async
 * @param {string} binaryPath
 * @returns {Promise<boolean>}
 */
export async function isRcloneBinaryUsable(binaryPath: string): Promise<boolean> {
	try {
		if (!(await fs.pathExists(binaryPath))) {
			return false
		}

		if (process.platform !== "win32") {
			await fs.chmod(binaryPath, 0o755).catch(() => {})
		}

		await execFileAsync(binaryPath, ["version"], {
			timeout: 30000,
			windowsHide: true
		})

		return true
	} catch {
		return false
	}
}

/**
 * Remove leftover `.extract-*` temp directories under `<userData>/rclone` - debris from an extraction interrupted by a
 * crash, a kill, or the user quitting mid-run. Best-effort; a missing rclone dir (first run) is fine.
 *
 * @async
 * @param {string} rcloneDir
 * @returns {Promise<void>}
 */
async function cleanExtractTemps(rcloneDir: string): Promise<void> {
	try {
		const entries = await fs.readdir(rcloneDir)

		await Promise.all(
			entries
				.filter(name => name.startsWith(".extract-"))
				.map(name =>
					fs
						.rm(pathModule.join(rcloneDir, name), {
							force: true,
							recursive: true
						})
						.catch(() => {})
				)
		)
	} catch {
		// The rclone dir may not exist yet on a first run - nothing to clean.
	}
}

/**
 * Resolve the bundled rclone binary for the current platform/arch, extracting it on first use, and return its absolute path.
 *
 * Fully IDEMPOTENT and SELF-HEALING against crashes, restarts and mid-run kills (spec §11): repeated calls are safe, a
 * half-written or otherwise corrupt binary left by an interrupted run is detected and replaced, and concurrent callers for
 * the same target share a single extraction (see {@link inFlight}). The heavy lifting lives in
 * {@link extractRcloneBinary}; this wrapper only deduplicates in-flight work.
 *
 * @export
 * @async
 * @param {string} userData Absolute Electron `userData` directory.
 * @param {{ zipDir?: string; version?: string }} [options]
 * @param {string} [options.zipDir] Override for the bundled-zip directory (defaults to {@link bundledZipDir}).
 * @param {string} [options.version] Override for the rclone version (defaults to {@link RCLONE_VERSION}).
 * @returns {Promise<string>} Absolute path to the ready-to-run rclone binary.
 */
export async function ensureRcloneBinary(userData: string, options?: { zipDir?: string; version?: string }): Promise<string> {
	const version = options?.version ?? RCLONE_VERSION
	const target = rcloneBinaryPath(userData, process.platform, version)

	const existing = inFlight.get(target)

	if (existing) {
		return existing
	}

	const run = extractRcloneBinary(userData, target, version, options?.zipDir).finally(() => {
		inFlight.delete(target)
	})

	inFlight.set(target, run)

	return run
}

/**
 * The extraction / self-heal worker behind {@link ensureRcloneBinary} (kept separate so the in-flight dedup wrapper stays
 * tiny). Single-pass, crash-safe:
 *
 * 1. Fast path - if a binary that genuinely RUNS is already in place, reuse it as-is.
 * 2. Otherwise self-heal: delete the corrupt/partial target and sweep any leftover `.extract-*` temp dirs.
 * 3. Extract the matching official release zip into a per-process temp dir, locate the `rclone`/`rclone.exe` binary, mark it
 *    executable and VERIFY IT RUNS before trusting it.
 * 4. ATOMICALLY publish it onto the target via a same-filesystem rename, so the live target is never half-written.
 * 5. Always clean up the temp dir, verify the published target one final time, and prune older versions.
 *
 * @async
 * @param {string} userData
 * @param {string} target Absolute path the ready-to-run binary must end up at.
 * @param {string} version
 * @param {string} [zipDirOverride]
 * @returns {Promise<string>}
 */
async function extractRcloneBinary(userData: string, target: string, version: string, zipDirOverride?: string): Promise<string> {
	const platform = process.platform
	const rcloneDir = pathModule.join(userData, "rclone")

	// Fast path: a binary that actually RUNS is reused (idempotent). A corrupt/partial one fails this and is replaced.
	if (await isRcloneBinaryUsable(target)) {
		return target
	}

	// Self-heal: drop a corrupt/partial target and any leftover extraction temp dirs from a prior interrupted run.
	await fs.rm(target, { force: true }).catch(() => {})
	await cleanExtractTemps(rcloneDir)

	const zipDir = zipDirOverride ?? bundledZipDir()
	const zipName = rcloneZipName(platform, process.arch, version)
	const zipPath = pathModule.join(zipDir, zipName)

	if (!(await fs.pathExists(zipPath))) {
		throw new Error(`Bundled rclone zip not found: ${zipPath}. The build step must place it there (spec §11).`)
	}

	// Per-process temp dir, cleaned before use so a same-pid leftover can never interfere.
	const tempDir = pathModule.join(rcloneDir, `.extract-${version}-${String(process.pid)}`)

	await fs.rm(tempDir, {
		force: true,
		recursive: true
	}).catch(() => {})

	await fs.ensureDir(tempDir)

	try {
		await extract(zipPath, {
			dir: tempDir
		})

		const binaryFileName = rcloneBinaryFileName(platform)
		// The official zip holds a single top-level folder named exactly like the zip without its extension,
		// e.g. "rclone-v1.74.3-osx-arm64/", containing the binary plus docs.
		const expectedNested = pathModule.join(tempDir, zipName.replace(/\.zip$/i, ""), binaryFileName)
		const binarySource = (await fs.pathExists(expectedNested)) ? expectedNested : await findFileRecursive(tempDir, binaryFileName)

		if (!binarySource) {
			throw new Error(`Could not find "${binaryFileName}" inside the extracted rclone zip: ${zipPath}`)
		}

		if (platform !== "win32") {
			await fs.chmod(binarySource, 0o755)
		}

		// Verify the freshly-extracted binary RUNS before publishing it, so a bad/partial extract never becomes the live target.
		if (!(await isRcloneBinaryUsable(binarySource))) {
			throw new Error(`Extracted rclone binary failed to run: ${binarySource}`)
		}

		await fs.ensureDir(rcloneBinDir(userData, version))

		// Atomic publish: temp and target share one filesystem (both under <userData>/rclone), so fs.move is a rename - the
		// target appears fully-formed or not at all, never half-written.
		await fs.move(binarySource, target, {
			overwrite: true
		})

		if (platform !== "win32") {
			await fs.chmod(target, 0o755)
		}
	} finally {
		await fs.rm(tempDir, {
			force: true,
			recursive: true
		}).catch(() => {})
	}

	// Final guard: the published target must run.
	if (!(await isRcloneBinaryUsable(target))) {
		throw new Error(`rclone binary is not usable after extraction: ${target}`)
	}

	await pruneOldRcloneVersions(userData, version)

	return target
}
