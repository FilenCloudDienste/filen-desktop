import pathModule from "path"
import fs from "fs-extra"
import { execFile } from "child_process"
import { promisify } from "util"
import isDev from "../../isDev"
import { RCLONE_VERSION, rcloneBundledBinaryName, rcloneBinDir, rcloneBinaryPath } from "./constants"

const execFileAsync = promisify(execFile)

/**
 * In-flight install promises keyed by the target binary path, so concurrent ensureRcloneBinary() calls for the same target
 * share a single copy instead of racing each other (belt-and-suspenders alongside any caller-side memoization).
 *
 * @type {Map<string, Promise<string>>}
 */
const inFlight = new Map<string, Promise<string>>()

/**
 * Absolute path to the directory holding the bundled RAW rclone binaries (one per os/arch).
 *
 * Production: `<process.resourcesPath>/app.asar.unpacked/bin/rclone`. The binaries ship inside the asar and are unpacked
 * there (electron-builder `asarUnpack`), which is also where they are code-signed — macOS by build/afterPack.js, Windows by
 * electron-builder's `app.asar.unpacked` signing walk. Development: the repo's `bin/rclone`, resolved relative to this
 * compiled file (`dist/lib/rclone/binary.js`, three levels below the repo root); the same `..`-walk works when the
 * un-compiled `src/lib/rclone/binary.ts` is run directly via tsx.
 *
 * @export
 * @returns {string}
 */
export function bundledBinaryDir(): string {
	if (isDev) {
		return pathModule.resolve(__dirname, "..", "..", "..", "bin", "rclone")
	}

	return pathModule.join(process.resourcesPath, "app.asar.unpacked", "bin", "rclone")
}

/**
 * Run `<binaryPath> version` and return its first output line, trimmed (e.g. "rclone v1.74.3").
 *
 * A liveness/sanity check that the binary actually executes on this OS/arch (catches the macOS `killed: 9` unsigned-binary
 * case, spec R2). Throws a contextual error on spawn failure, non-zero exit, or empty output.
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
 * `<binary> version`. ANY failure - missing, not executable, truncated/partial from a copy interrupted mid-run, wrong
 * arch, quarantined/killed, or simply not rclone - resolves `false` so the caller re-copies a known-good copy. Never throws.
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
 * Remove leftover `.copy-*` temp files under `binDir` - debris from a copy interrupted by a crash, a kill, or the user
 * quitting mid-run. Best-effort; a missing dir (first run) is fine.
 *
 * @async
 * @param {string} binDir
 * @returns {Promise<void>}
 */
async function cleanCopyTemps(binDir: string): Promise<void> {
	try {
		const entries = await fs.readdir(binDir)

		await Promise.all(
			entries
				.filter(name => name.startsWith(".copy-"))
				.map(name => fs.rm(pathModule.join(binDir, name), { force: true }).catch(() => {}))
		)
	} catch {
		// The bin dir may not exist yet on a first run - nothing to clean.
	}
}

/**
 * Resolve the bundled rclone binary for the current platform/arch, copying it into userData on first use, and return its
 * absolute path.
 *
 * Fully IDEMPOTENT and SELF-HEALING against crashes, restarts and mid-run kills (spec §11): repeated calls are safe, a
 * half-written or otherwise corrupt binary left by an interrupted run is detected and replaced, and concurrent callers for
 * the same target share a single copy (see {@link inFlight}). The heavy lifting lives in {@link installRcloneBinary}; this
 * wrapper only deduplicates in-flight work.
 *
 * @export
 * @async
 * @param {string} userData Absolute Electron `userData` directory.
 * @param {{ bundledDir?: string; version?: string }} [options]
 * @param {string} [options.bundledDir] Override for the bundled-binary directory (defaults to {@link bundledBinaryDir}).
 * @param {string} [options.version] Override for the rclone version (defaults to {@link RCLONE_VERSION}).
 * @returns {Promise<string>} Absolute path to the ready-to-run rclone binary.
 */
export async function ensureRcloneBinary(userData: string, options?: { bundledDir?: string; version?: string }): Promise<string> {
	const version = options?.version ?? RCLONE_VERSION
	const target = rcloneBinaryPath(userData, process.platform, version)

	const existing = inFlight.get(target)

	if (existing) {
		return existing
	}

	const run = installRcloneBinary(userData, target, version, options?.bundledDir).finally(() => {
		inFlight.delete(target)
	})

	inFlight.set(target, run)

	return run
}

/**
 * The copy / self-heal worker behind {@link ensureRcloneBinary} (kept separate so the in-flight dedup wrapper stays tiny).
 * Single-pass, crash-safe:
 *
 * 1. Fast path - if a binary that genuinely RUNS is already in place, reuse it as-is.
 * 2. Otherwise self-heal: delete the corrupt/partial target and sweep any leftover `.copy-*` temp files.
 * 3. Copy the bundled raw binary for this platform/arch into a per-process temp in the target dir, mark it executable and
 *    VERIFY IT RUNS before trusting it.
 * 4. ATOMICALLY publish it onto the target via a same-filesystem rename, so the live target is never half-written.
 * 5. Verify the published target one final time and prune older versions.
 *
 * @async
 * @param {string} userData
 * @param {string} target Absolute path the ready-to-run binary must end up at.
 * @param {string} version
 * @param {string} [bundledDirOverride]
 * @returns {Promise<string>}
 */
async function installRcloneBinary(userData: string, target: string, version: string, bundledDirOverride?: string): Promise<string> {
	const platform = process.platform

	// Fast path: a binary that actually RUNS is reused (idempotent). A corrupt/partial one fails this and is replaced.
	if (await isRcloneBinaryUsable(target)) {
		return target
	}

	// Self-heal: drop a corrupt/partial target before re-copying.
	await fs.rm(target, { force: true }).catch(() => {})

	const bundledDir = bundledDirOverride ?? bundledBinaryDir()
	const source = pathModule.join(bundledDir, rcloneBundledBinaryName(platform, process.arch))

	if (!(await fs.pathExists(source))) {
		throw new Error(`Bundled rclone binary not found: ${source}. The build step must place it there (spec §11).`)
	}

	const binDir = rcloneBinDir(userData, version)

	await fs.ensureDir(binDir)
	await cleanCopyTemps(binDir)

	// Per-process temp in the target dir (same filesystem as the target, so the publish below is a rename).
	const temp = pathModule.join(binDir, `.copy-${version}-${String(process.pid)}`)

	await fs.rm(temp, { force: true }).catch(() => {})

	try {
		await fs.copyFile(source, temp)

		if (platform !== "win32") {
			await fs.chmod(temp, 0o755)
		}

		// Verify the copy RUNS before publishing it, so a bad/partial copy never becomes the live target.
		if (!(await isRcloneBinaryUsable(temp))) {
			throw new Error(`Bundled rclone binary failed to run after copy: ${source}`)
		}

		// Atomic publish: temp and target share one filesystem (both under <userData>/rclone/bin/<version>), so fs.move is a
		// rename - the target appears fully-formed or not at all, never half-written.
		await fs.move(temp, target, {
			overwrite: true
		})

		if (platform !== "win32") {
			await fs.chmod(target, 0o755)
		}
	} finally {
		await fs.rm(temp, { force: true }).catch(() => {})
	}

	// Final guard: the published target must run.
	if (!(await isRcloneBinaryUsable(target))) {
		throw new Error(`rclone binary is not usable after install: ${target}`)
	}

	await pruneOldRcloneVersions(userData, version)

	return target
}
