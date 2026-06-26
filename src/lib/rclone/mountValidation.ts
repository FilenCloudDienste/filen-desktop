import fs from "fs-extra"

/**
 * Runtime / filesystem mount-point checks for the network drive.
 *
 * This is the *liveness* counterpart to the pure, synchronous *format* validators in
 * `./validation.ts` (spec §10). Where `validation.ts` answers "is this string a well-formed drive
 * letter / home-relative path?", this module answers the filesystem questions that require actually
 * touching the disk (spec §6.2 / §7.4): does the drive letter currently exist, which letters are
 * free, does the mount target exist, is it an empty plain directory we can mount into, and does
 * something already appear to be mounted there.
 *
 * Ported and HARDENED from the old `@filen/network-drive` `utils.ts`:
 * - `isUnixMountPointValid` now uses `fs.lstat` (not `fs.stat`) so a symlink is actually rejected —
 *   the old `fs.stat` follows symlinks, which makes its `isSymbolicLink()` guard a permanent no-op.
 * - `getAvailableDriveLetters` only ever offers `D:`-`Z:` (A/B/C are excluded outright), matching the
 *   Windows drive-letter format validator and never proposing a letter the validator would reject.
 * - `isMountActive` drops the old process-by-name (`isProcessRunning(RCLONE_BINARY_NAME)`) check: the
 *   bundled binary is the generic `rclone`, and callers that own the `RcloneProcess` already know
 *   liveness from its PID / rc interface, so a name match is both wrong and unnecessary here.
 *
 * Every function is defensive: it resolves (never rejects) and falls back to `false` / `[]` on any
 * error, so callers can treat these as plain best-effort booleans.
 */

/**
 * List the Windows drive letters that currently exist, in `A:`-`Z:` form (for example `["C:", "D:"]`).
 *
 * Each candidate letter is probed independently by `fs.access(F_OK)` on its drive root (`C:\`); a
 * letter is reported as existing iff that probe succeeds. The result is returned in alphabetical
 * order. On any non-Windows platform there is no concept of drive letters, so this resolves to `[]`.
 *
 * @export
 * @async
 * @returns {Promise<string[]>}
 */
export async function getExistingDrives(): Promise<string[]> {
	if (process.platform !== "win32") {
		return []
	}

	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
	const probes = await Promise.all(
		letters.map(async letter => {
			try {
				await fs.access(`${letter}:\\`, fs.constants.F_OK)

				return `${letter}:`
			} catch {
				return null
			}
		})
	)

	return probes.filter((drive): drive is string => drive !== null)
}

/**
 * List the Windows drive letters that are free to mount into, in `D:`-`Z:` form.
 *
 * The candidate set is intentionally `D:`-`Z:` only: A, B and C are excluded outright (legacy floppy
 * letters and the system volume), which keeps this in lock-step with the Windows drive-letter format
 * validator (`validation.ts`, `/^[D-Z]:\\?$/`) so a returned letter is always a value the validator
 * would accept. From that set, any letter reported by {@link getExistingDrives} is removed. On any
 * non-Windows platform this resolves to `[]`.
 *
 * @export
 * @async
 * @returns {Promise<string[]>}
 */
export async function getAvailableDriveLetters(): Promise<string[]> {
	if (process.platform !== "win32") {
		return []
	}

	const existing = new Set(await getExistingDrives())

	return "DEFGHIJKLMNOPQRSTUVWXYZ"
		.split("")
		.map(letter => `${letter}:`)
		.filter(drive => !existing.has(drive))
}

/**
 * Best-effort existence probe for a mount point via `fs.access(F_OK)`.
 *
 * On Windows the probe targets the drive root (`mountPoint + "\\"`, e.g. `X:\`) rather than the bare
 * letter, since that is the path that resolves once a WinFSP drive is mounted. On other platforms the
 * path is probed as-is. Never throws — resolves `true` when the probe succeeds and `false` otherwise.
 *
 * @export
 * @async
 * @param {string} mountPoint
 * @returns {Promise<boolean>}
 */
export async function checkIfMountExists(mountPoint: string): Promise<boolean> {
	try {
		await fs.access(process.platform === "win32" ? `${mountPoint}\\` : mountPoint, fs.constants.F_OK)

		return true
	} catch {
		return false
	}
}

/**
 * Whether `mountPoint` is a usable Unix mount target: it exists, is readable and writable, and is a
 * plain directory.
 *
 * Uses `fs.lstat` (NOT `fs.stat`) on purpose: `lstat` does not follow symlinks, so a symlink — even
 * one pointing at a real directory — is correctly rejected, along with files and block / character /
 * fifo / socket nodes. Read+write access is checked with `fs.access(R_OK | W_OK)`, which also implies
 * existence. Windows mounts to a drive letter rather than a directory, so this resolves `false` on
 * win32. Never throws — any error resolves to `false`.
 *
 * @export
 * @async
 * @param {string} mountPoint
 * @returns {Promise<boolean>}
 */
export async function isUnixMountPointValid(mountPoint: string): Promise<boolean> {
	if (process.platform === "win32") {
		return false
	}

	try {
		await fs.access(mountPoint, fs.constants.R_OK | fs.constants.W_OK)

		const stats = await fs.lstat(mountPoint)

		return (
			stats.isDirectory() &&
			!stats.isSymbolicLink() &&
			!stats.isFile() &&
			!stats.isBlockDevice() &&
			!stats.isCharacterDevice() &&
			!stats.isFIFO() &&
			!stats.isSocket()
		)
	} catch {
		return false
	}
}

/**
 * Whether the Unix `mountPoint` directory is empty (`fs.readdir` returns zero entries).
 *
 * A fresh, mountable target should be empty: FUSE refuses to mount over a non-empty directory, so an
 * empty result here is the green light for mounting. Windows mounts to a drive letter rather than a
 * directory, so this resolves `false` on win32. Never throws — any error (including the path not
 * existing or not being a directory) resolves to `false`.
 *
 * @export
 * @async
 * @param {string} mountPoint
 * @returns {Promise<boolean>}
 */
export async function isUnixMountPointEmpty(mountPoint: string): Promise<boolean> {
	if (process.platform === "win32") {
		return false
	}

	try {
		const dir = await fs.readdir(mountPoint)

		return dir.length === 0
	} catch {
		return false
	}
}

/**
 * Best-effort heuristic for "does something appear to be mounted at `mountPoint`".
 *
 * This is a stale-vs-active probe that deliberately does NOT shell out to a process-by-name check:
 * the bundled binary is the generic `rclone`, so matching on name is unreliable, and the component
 * that owns the `RcloneProcess` already knows authoritative liveness from its PID and the rc
 * `vfs/list` endpoint. Treat this only as a cheap filesystem-level sanity check.
 *
 * Returns `true` iff {@link checkIfMountExists} succeeds AND a `fs.stat` on the mount root succeeds
 * AND, on the FUSE platforms, the root inode looks like a freshly mounted FUSE volume — mirroring the
 * old worker's `isNetworkDriveMounted` heuristic: `ino === 1` on macOS, or `ino === 0` /
 * `birthtimeMs === 0` on Linux. On Windows (and any other platform) existence plus a successful stat
 * is the signal. Never throws — any error resolves to `false`.
 *
 * @export
 * @async
 * @param {string} mountPoint
 * @returns {Promise<boolean>}
 */
export async function isMountActive(mountPoint: string): Promise<boolean> {
	try {
		if (!(await checkIfMountExists(mountPoint))) {
			return false
		}

		const stats = await fs.stat(process.platform === "win32" ? `${mountPoint}\\` : mountPoint)

		if (process.platform === "darwin") {
			return stats.ino === 1
		}

		if (process.platform === "linux") {
			return stats.ino === 0 || stats.birthtimeMs === 0
		}

		return true
	} catch {
		return false
	}
}
