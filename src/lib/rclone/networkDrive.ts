import pathModule from "path"
import fs from "fs-extra"
import { execFile } from "child_process"
import { promisify } from "util"
import { Semaphore } from "../../semaphore"
import { RcloneProcess } from "./process"
import { ensureDriveDependencies, isMacFUSEInstalled, ensureHostsFilenEntry } from "./dependencies"
import { getAvailableDriveLetters, isUnixMountPointEmpty, isMountActive } from "./mountValidation"
import { validateMountPointFormat } from "./validation"
import { VFS_CACHE_MAX_SIZE_GI, VFS_CACHE_MIN_FREE_SPACE_GI, VFS_CACHE_MAX_AGE, VFS_DIR_CACHE_TIME } from "./constants"

const execFileAsync = promisify(execFile)

/**
 * Resolve after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Construction options for {@link NetworkDrive} and the sole input to {@link buildMountArgs}.
 *
 * Everything the role needs is passed in explicitly (paths, ports, the optional logger) so this module never imports Electron
 * and stays unit-testable. `binaryPath`/`configPath` come from the foundation modules (binary extraction + config write);
 * `cachePath` is the PERSISTENT VFS cache that must never be wiped (spec §12); `scriptDir` is where the crash-safety watchdog
 * script lives; `rcPort` is a free loopback port for this process' `--rc-addr`.
 *
 * @export
 * @interface NetworkDriveOptions
 * @typedef {NetworkDriveOptions}
 */
export interface NetworkDriveOptions {
	binaryPath: string
	configPath: string
	mountPoint: string
	cachePath: string
	rcPort: number
	scriptDir: string
	logFilePath?: string
	readOnly?: boolean
	cacheSizeGi?: number
	userAgent?: string
	tryInstallDependencies?: boolean
	winfspMsiPath?: string
	fuseTPkgPath?: string
	logger?: (level: string, message: string) => void
}

/**
 * Network-drive statistics surfaced over IPC (`networkDriveStats`).
 *
 * EXACT shape preserved from the old worker (`@filen/network-drive` `GetStats`) so the renderer contract is unchanged
 * (spec §4): write-back queue counters plus the list of in-flight transfers.
 *
 * @export
 * @interface NetworkDriveStats
 * @typedef {NetworkDriveStats}
 */
export interface NetworkDriveStats {
	uploadsInProgress: number
	uploadsQueued: number
	erroredFiles: number
	transfers: {
		name: string
		size: number
		speed: number
	}[]
}

/**
 * Build the COMPLETE `rclone mount` argv for the network drive (spec §6.1 global flags + §6.2 mount flags, with the per-OS
 * additions).
 *
 * Returns a real argv array — every `--flag value` pair is two separate elements and every multi-token `-o KEY=VALUE` option
 * is split into `-o` + `KEY=VALUE` — so the caller can spawn with `shell:false` and no string-joining (spec §7.1). The base
 * flags are identical on every OS; the tail differs by platform:
 *
 * - **Windows (WinFSP):** `--network-mode`, a `--volname \\Filen\Filen` override, `-o FileSecurity=D:P(A;;FA;;;WD)`, the
 *   WinFSP-native metadata caches `-o FileInfoTimeout=5000`/`-o DirInfoTimeout=5000` (WinFSP ignores libfuse `attr_timeout`,
 *   so these are what actually cut getattr/readdir round-trips on a high-latency drive) and `--no-console`.
 * - **macOS + macFUSE** (detected via {@link isMacFUSEInstalled}): `-o jail_symlinks` plus `-o noapplexattr` (macFUSE returns
 *   ENOSYS for xattrs anyway, so this only suppresses Finder's futile `com.apple.*` probing over the network).
 * - **macOS + FUSE-T** (macFUSE absent): `-o nomtime`, `-o nonamedattr`, `-o rwsize=1048576` (raise the NFS read/write size
 *   from the 32 KiB default to 1 MiB to cut round-trips; `backend=nfs` is omitted because NFS is FUSE-T's default), and
 *   `-o location=Filen` ONLY when {@link ensureHostsFilenEntry} reports the `/etc/hosts` `Filen` entry exists (omitted
 *   otherwise so the mount still works with an unresolvable name, spec §8.2).
 * - **Linux (FUSE3):** no extra `-o` by default.
 *
 * The macFUSE-before-FUSE-T branch order mirrors rclone/cgofuse's own dlopen selection, so detect() and the actual mount can
 * never disagree (spec §6.2).
 *
 * @export
 * @async
 * @param {NetworkDriveOptions} options
 * @returns {Promise<string[]>}
 */
export async function buildMountArgs(options: NetworkDriveOptions): Promise<string[]> {
	const { configPath, mountPoint, cachePath, rcPort, logFilePath, readOnly, cacheSizeGi, userAgent } = options

	const args: string[] = ["mount", "Filen:", mountPoint, "--config", configPath, "--vfs-cache-mode", "full"]

	if (readOnly) {
		args.push("--read-only")
	}

	args.push("--cache-dir", cachePath)

	// Default per-role cap; an explicit user-set cacheSizeGi (once wired to the UI) overrides it.
	args.push("--vfs-cache-max-size", `${typeof cacheSizeGi === "number" ? cacheSizeGi : VFS_CACHE_MAX_SIZE_GI}Gi`)

	args.push(
		"--vfs-cache-min-free-space",
		`${VFS_CACHE_MIN_FREE_SPACE_GI}Gi`,
		"--vfs-cache-max-age",
		VFS_CACHE_MAX_AGE,
		"--vfs-write-back",
		"5s",
		// Filen has no ChangeNotify (so --poll-interval 0 is inherent), so dir-cache-time is the only freshness lever.
		// VFS_DIR_CACHE_TIME (uniform across all rclone roles) surfaces external/remote changes quickly; kept well above
		// the old 3s that re-listed on nearly every navigation of a high-latency backend (also rc API / SIGHUP refresh).
		"--dir-cache-time",
		VFS_DIR_CACHE_TIME,
		"--poll-interval",
		"0",
		"--no-gzip-encoding",
		"--use-mmap",
		"--disable-http2",
		"--file-perms",
		"0666",
		"--dir-perms",
		"0777",
		// --no-checksum kept: the Filen SDK re-verifies BLAKE3 over the full stream on download itself, so rclone's VFS-layer
		// hash would be a redundant second pass. (--use-server-modtime and --vfs-fast-fingerprint were removed: both are no-ops
		// for the Filen backend - ModTime always returns the real client mtime, and the backend flags neither SlowHash nor
		// SlowModTime.)
		"--no-checksum",
		// Download throughput: the Filen SDK reads each file as a strictly serial chain of 1-MiB GETs, so per-file download
		// parallelism exists ONLY here. --vfs-read-chunk-streams turns that serial chain into N concurrent range readers (the
		// single biggest download win); a 64Mi chunk lets even ~512Mi files engage all 8 streams. --buffer-size keeps an async
		// prefetch buffer (NEVER 0 - that strands the serial reader); --vfs-read-ahead prefetches ahead (cache-mode full only).
		"--vfs-read-chunk-streams",
		"8",
		"--vfs-read-chunk-size",
		"64Mi",
		"--vfs-read-chunk-size-limit",
		"0",
		"--buffer-size",
		"32Mi",
		"--vfs-read-ahead",
		"128Mi",
		// Upload throughput: large/medium files upload via rclone's multi-thread chunk-writer (Filen's native OpenChunkWriter)
		// with worker count = --filen-upload-concurrency. Lowering --multi-thread-cutoff from the 256Mi default pulls medium
		// files onto that concurrent (and retryable) path; --multi-thread-streams must stay >1. --transfers also enlarges the
		// shared fshttp keep-alive pool (2*(checkers+transfers+1)) so the parallel up/download streams don't churn TLS.
		"--multi-thread-streams",
		"4",
		"--multi-thread-cutoff",
		"64Mi",
		"--filen-upload-concurrency",
		"24",
		"--transfers",
		"8",
		"--rc",
		"--rc-addr",
		`127.0.0.1:${rcPort}`,
		"--rc-no-auth"
	)

	if (logFilePath) {
		args.push("--log-file", logFilePath, "--log-level", "INFO")
	}

	args.push(
		"--user-agent",
		userAgent && userAgent.length > 0 ? userAgent : "FilenDesktop",
		"--low-level-retries",
		"10",
		"--timeout",
		"5m",
		"--contimeout",
		"1m",
		"--devname",
		"Filen",
		"--volname",
		"Filen"
	)

	if (process.platform === "win32") {
		// Network mode mounts to a drive letter; the UNC-style volname overrides the base `--volname Filen`. FileInfoTimeout/
		// DirInfoTimeout are WinFSP's native metadata caches (libfuse `attr_timeout` is not WinFSP's lever), cutting round-trips.
		args.push(
			"--network-mode",
			"--volname",
			"\\\\Filen\\Filen",
			"-o",
			"FileSecurity=D:P(A;;FA;;;WD)",
			"-o",
			"FileInfoTimeout=5000",
			"-o",
			"DirInfoTimeout=5000",
			"--no-console"
		)
	} else if (process.platform === "darwin") {
		if (await isMacFUSEInstalled()) {
			// noapplexattr: macFUSE returns ENOSYS for xattrs anyway, so this only stops Finder's futile com.apple.* probing.
			args.push("-o", "jail_symlinks", "-o", "noapplexattr")
		} else {
			// NFS is FUSE-T's default backend (no need to pass backend=nfs); rwsize lifts the 32 KiB default to 1 MiB.
			args.push("-o", "nomtime", "-o", "nonamedattr", "-o", "rwsize=1048576")

			// Only pass the NFS volume hostname when /etc/hosts resolves it; otherwise omit it (spec §8.2) so the mount
			// still succeeds rather than failing on an unresolvable name.
			if (await ensureHostsFilenEntry()) {
				args.push("-o", "location=Filen")
			}
		}
	}

	// Linux (FUSE3): no extra `-o` by default.

	return args
}

/**
 * The network-drive role: an `rclone mount Filen:` driven through the lifecycle-managed {@link RcloneProcess}.
 *
 * Ties the foundation modules together — FUSE-layer dependency checks, mount-point validation + stale-mount recovery, the
 * persistent (never-wiped) VFS cache, argv building, the supervised child process and the rc stats client — behind a small
 * `start()` / `stop()` / `getStats()` surface that preserves the existing IPC contract (spec §4). Pure Node + Electron-free:
 * all paths and the logger arrive via {@link NetworkDriveOptions}.
 *
 * @export
 * @class NetworkDrive
 * @typedef {NetworkDrive}
 */
export class NetworkDrive {
	private readonly options: NetworkDriveOptions
	private readonly logger?: (level: string, message: string) => void
	private readonly startMutex = new Semaphore(1)
	private readonly stopMutex = new Semaphore(1)

	private process: RcloneProcess | null = null
	private active: boolean = false

	/**
	 * Creates an instance of NetworkDrive.
	 *
	 * @constructor
	 * @param {NetworkDriveOptions} options
	 */
	public constructor(options: NetworkDriveOptions) {
		this.options = options
		this.logger = options.logger
	}

	/**
	 * Forward a log line to the optional logger hook, if one was supplied.
	 *
	 * @private
	 * @param {string} level
	 * @param {string} message
	 * @returns {void}
	 */
	private log(level: string, message: string): void {
		this.logger?.(level, message)
	}

	/**
	 * Whether the drive is mounted and its rclone process is currently running.
	 *
	 * @public
	 * @returns {boolean}
	 */
	public isActive(): boolean {
		return this.active && this.process !== null && this.process.isRunning()
	}

	/**
	 * Mount the network drive. Idempotent (serialized by a start mutex; a no-op when already mounted).
	 *
	 * Steps (spec §6.2 / §7.4 / §12):
	 * 1. Ensure the FUSE layer (WinFSP / macFUSE-or-FUSE-T / FUSE3) is present, optionally installing it.
	 * 2. Validate the mount-point format (Windows: a free drive letter; Unix: a home-relative path).
	 * 3. Recover any stale mount left by a previous crash, then require an empty target directory (Unix).
	 * 4. Ensure the PERSISTENT cache dir exists — it is NEVER wiped, which is the upload-loss bug fix (spec §12).
	 * 5. Build the full argv and spawn rclone under {@link RcloneProcess} (own process group, watchdog, kill ladder).
	 * 6. Poll up to ~30s until the mount is actually usable (`isMountActive` or the rc `vfs/list` shows the Filen VFS),
	 *    tearing the process back down and throwing on timeout.
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async start(): Promise<void> {
		await this.startMutex.acquire()

		try {
			if (this.active && this.process && this.process.isRunning()) {
				return
			}

			const {
				binaryPath,
				configPath,
				mountPoint,
				cachePath,
				rcPort,
				scriptDir,
				winfspMsiPath,
				fuseTPkgPath,
				tryInstallDependencies
			} = this.options

			// 1) FUSE layer: detect, optionally install (or upgrade FUSE-T), then require it (throws if still absent).
			await ensureDriveDependencies({
				winfspMsiPath,
				fuseTPkgPath,
				tryInstall: !!tryInstallDependencies,
				logger: this.logger
			})

			// 2) + 3) Validate the mount point and recover any stale mount before mounting.
			await this.prepareMountPoint()

			// 4) Persistent VFS cache: ensure it exists, NEVER delete it (spec §12, the upload-loss bug fix).
			await fs.ensureDir(cachePath)

			// 5) Build the full argv and spawn the supervised rclone process.
			const args = await buildMountArgs(this.options)

			const proc = new RcloneProcess({
				binaryPath,
				args,
				rcPort,
				role: "drive",
				scriptDir,
				mountPoint,
				onUnmount: () => this.osUnmount(),
				logger: this.logger,
				logFilePath: this.options.logFilePath
			})

			this.process = proc

			try {
				await proc.start()

				// 6) Wait until the mount is actually ready before reporting success.
				await this.waitForMountReady(proc, mountPoint)
			} catch (e) {
				await this.stop()

				throw e
			}

			this.active = true

			this.log("info", `Network drive mounted at ${mountPoint} (config ${configPath}).`)
		} finally {
			this.startMutex.release()
		}
	}

	/**
	 * Unmount the network drive and tear down its rclone process. Idempotent (serialized by a stop mutex; a no-op when not
	 * running). The actual unmount is handled by {@link RcloneProcess.stop} — its `core/quit` → SIGTERM → SIGKILL ladder plus
	 * the {@link osUnmount} callback and watchdog reaping.
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async stop(): Promise<void> {
		await this.stopMutex.acquire()

		try {
			const proc = this.process

			this.active = false

			if (!proc) {
				return
			}

			this.process = null

			await proc.stop()

			this.log("info", "Network drive stopped.")
		} finally {
			this.stopMutex.release()
		}
	}

	/**
	 * Read network-drive statistics via the managed process' rc client (spec §4): `core/stats` for the in-flight transfers
	 * and `vfs/stats` for the write-back disk-cache counters. Returns all-zero/empty defaults when the drive is not active or
	 * on any error, and degrades to just the transfer list when `diskCache` is not yet populated — mirroring the old worker's
	 * `getStats` exactly.
	 *
	 * @public
	 * @async
	 * @returns {Promise<NetworkDriveStats>}
	 */
	public async getStats(): Promise<NetworkDriveStats> {
		const empty: NetworkDriveStats = {
			uploadsInProgress: 0,
			uploadsQueued: 0,
			erroredFiles: 0,
			transfers: []
		}

		const proc = this.process

		if (!this.active || !proc) {
			return empty
		}

		try {
			const [core, vfs] = await Promise.all([proc.rc.coreStats(), proc.rc.vfsStats()])

			const transfers = Array.isArray(core.transferring)
				? core.transferring.map(transfer => ({
						name: typeof transfer.name === "string" ? transfer.name : "",
						size: typeof transfer.size === "number" ? transfer.size : 0,
						speed: typeof transfer.speed === "number" ? transfer.speed : 0
					}))
				: []

			const disk = vfs.diskCache

			if (
				!disk ||
				typeof disk.uploadsInProgress !== "number" ||
				typeof disk.uploadsQueued !== "number" ||
				typeof disk.erroredFiles !== "number"
			) {
				return {
					uploadsInProgress: 0,
					uploadsQueued: 0,
					erroredFiles: 0,
					transfers
				}
			}

			return {
				uploadsInProgress: disk.uploadsInProgress,
				uploadsQueued: disk.uploadsQueued,
				erroredFiles: disk.erroredFiles,
				transfers
			}
		} catch {
			return empty
		}
	}

	/**
	 * Validate the configured mount point and recover any stale mount before mounting (spec §7.4 / §10).
	 *
	 * - **Windows:** require a free drive letter (`validateMountPointFormat` + {@link getAvailableDriveLetters}); a crashed
	 *   WinFSP mount auto-reaps on process death, so no explicit unmount is needed.
	 * - **Unix:** require a home-relative path, ensure the parent exists, force-unmount a stale FUSE mount left by a crash
	 *   ({@link isMountActive} → {@link osUnmount}), create the target dir if missing, and require it to be empty
	 *   ({@link isUnixMountPointEmpty}); FUSE refuses to mount over a non-empty directory.
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async prepareMountPoint(): Promise<void> {
		const { mountPoint } = this.options
		const platform = process.platform
		const format = validateMountPointFormat(mountPoint, platform)

		if (!format.valid) {
			throw new Error(format.error)
		}

		if (platform === "win32") {
			const letter = `${mountPoint.charAt(0).toUpperCase()}:`

			if (!(await getAvailableDriveLetters()).includes(letter)) {
				throw new Error(`Mount point ${letter} is not a free drive letter.`)
			}

			return
		}

		await fs.ensureDir(pathModule.dirname(mountPoint))

		// Stale-mount recovery: a crashed rclone leaves a stale FUSE mount here - force-unmount it before re-mounting.
		if (await isMountActive(mountPoint)) {
			this.log("warn", `Found a stale mount at ${mountPoint}, attempting to unmount it.`)

			await this.osUnmount()
		}

		await fs.ensureDir(mountPoint)

		if (!(await isUnixMountPointEmpty(mountPoint))) {
			throw new Error(`Mount point ${mountPoint} must be an empty directory.`)
		}
	}

	/**
	 * Poll up to ~30s for the mount to become usable, throwing if rclone exits early or the timeout elapses (the caller tears
	 * the process down on either).
	 *
	 * Readiness is reported when {@link isMountActive} reports a live mount, OR the rc `vfs/list` endpoint lists the `Filen`
	 * VFS — but the `vfs/list` branch is additionally gated on the OS mount being genuinely attached ({@link isMountAttached},
	 * a `st_dev` change vs the parent). This matters because rclone's rc server answers `vfs/list` BEFORE the FUSE/NFS mount
	 * has attached on a cold start; accepting `vfs/list` alone would report ready too early and route the first reads/writes
	 * to the bare underlying directory (which the mount then shadows). The `vfs/list` path stays as a fallback for backends
	 * whose root inode does not match the `isMountActive` heuristic.
	 *
	 * @private
	 * @async
	 * @param {RcloneProcess} proc
	 * @param {string} mountPoint
	 * @returns {Promise<void>}
	 */
	private async waitForMountReady(proc: RcloneProcess, mountPoint: string): Promise<void> {
		const deadline = Date.now() + 30000

		while (Date.now() < deadline) {
			if (!proc.isRunning()) {
				throw new Error(`could not start network drive (rclone exited before the mount became ready)${await proc.readLogTail()}`)
			}

			if (await isMountActive(mountPoint)) {
				return
			}

			if ((await this.isVfsReady(proc)) && (await this.isMountAttached(mountPoint))) {
				return
			}

			await sleep(500)
		}

		throw new Error(`could not start network drive (timeout)${await proc.readLogTail()}`)
	}

	/**
	 * Whether a distinct filesystem is genuinely attached at `mountPoint` — the canonical "is it a mount" test. On Unix the
	 * mount point's device id differs from its parent's once something is mounted over it (the same signal `mountpoint(1)`
	 * uses); on Windows the drive-letter scheme has no such parent, so {@link isMountActive} (the letter resolves) is used.
	 * Best-effort: any error resolves `false`.
	 *
	 * @private
	 * @async
	 * @param {string} mountPoint
	 * @returns {Promise<boolean>}
	 */
	private async isMountAttached(mountPoint: string): Promise<boolean> {
		if (process.platform === "win32") {
			return await isMountActive(mountPoint)
		}

		try {
			const [mountStats, parentStats] = await Promise.all([fs.stat(mountPoint), fs.stat(pathModule.dirname(mountPoint))])

			return mountStats.dev !== parentStats.dev
		} catch {
			return false
		}
	}

	/**
	 * Whether the rc `vfs/list` endpoint reports an active `Filen` VFS. Best-effort: any rc error (the listener is not up
	 * yet) resolves `false`.
	 *
	 * @private
	 * @async
	 * @param {RcloneProcess} proc
	 * @returns {Promise<boolean>}
	 */
	private async isVfsReady(proc: RcloneProcess): Promise<boolean> {
		try {
			const result = await proc.rc.post<{ vfses?: string[] }>("vfs/list")

			return Array.isArray(result.vfses) && result.vfses.some(vfs => typeof vfs === "string" && vfs.includes("Filen"))
		} catch {
			return false
		}
	}

	/**
	 * Best-effort OS-level unmount of the configured mount point. Used both for start-time stale-mount recovery and as the
	 * {@link RcloneProcess} `onUnmount` callback in its kill ladder (spec §7.3). Tries the platform's unmount strategies in
	 * order, returning after the first that succeeds; every error is swallowed.
	 *
	 * - **macOS:** `umount -f`, then `diskutil unmount force`.
	 * - **Linux:** `fusermount3 -uz`, then `fusermount -uz`, then `umount -l`.
	 * - **Windows:** no-op — WinFSP auto-reaps the mount when the process dies.
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async osUnmount(): Promise<void> {
		const { mountPoint } = this.options

		if (process.platform === "win32") {
			return
		}

		const commands: [string, string[]][] =
			process.platform === "darwin"
				? [
						["umount", ["-f", mountPoint]],
						["diskutil", ["unmount", "force", mountPoint]]
					]
				: [
						["fusermount3", ["-uz", mountPoint]],
						["fusermount", ["-uz", mountPoint]],
						["umount", ["-l", mountPoint]]
					]

		for (const [file, args] of commands) {
			try {
				await execFileAsync(file, args, {
					timeout: 15000,
					windowsHide: true
				})

				return
			} catch {
				// Best-effort: try the next fallback unmount strategy.
			}
		}
	}
}

export default NetworkDrive
