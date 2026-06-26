import pathModule from "path"
import fs from "fs-extra"
import { type FilenSDKConfig } from "@filen/sdk"
import { Semaphore } from "../../semaphore"
import { type FilenDesktopConfig } from "../../types"
import { getLocalDirectorySize } from "../../utils"
import { rcloneCacheDir, rcloneConfigPath, rcloneLogPath, type RcloneRole } from "./constants"
import { ensureRcloneBinary } from "./binary"
import { writeRcloneConfig } from "./config"
import { POSSIBLE_PORTS, isPortFree } from "./ports"
import { isMountActive } from "./mountValidation"
import { NetworkDrive, type NetworkDriveStats } from "./networkDrive"
import { S3Server } from "./s3"
import { WebdavServer } from "./webdav"

/**
 * Construction options for {@link RcloneManager}.
 *
 * Every filesystem location and external resource arrives explicitly so the manager never imports Electron and stays
 * unit-testable (spec §4): `userDataPath` is the Electron `userData` dir (all rclone state lives under it), `logsPath` is the
 * logs dir (per-role log files), `zipDir` overrides where the bundled rclone release zips are found, and `winfspMsiPath` /
 * `fuseTPkgPath` point at the bundled FUSE-layer installers handed to the network-drive role.
 *
 * @export
 * @interface RcloneManagerOptions
 * @typedef {RcloneManagerOptions}
 */
export interface RcloneManagerOptions {
	userDataPath: string
	logsPath: string
	zipDir?: string
	winfspMsiPath?: string
	fuseTPkgPath?: string
	logger?: (level: string, message: string) => void
}

/**
 * Owns all rclone for the desktop app: the bundled binary, the shared INTERNAL-auth `rclone.conf`, and the three role
 * processes — network drive (`rclone mount`), S3 (`rclone serve s3`) and WebDAV (`rclone serve webdav`).
 *
 * This is the orchestration layer the IPC handlers call (spec §4). It lives in the Electron MAIN process — `worker.terminate()`
 * does not kill child processes, so main owns the PIDs for the app's full life and can tear them down on every exit path
 * (spec D4). Each role runs as its OWN process with a DISTINCT `--cache-dir` and a DISTINCT free loopback `--rc-addr` port
 * (spec §6.5 / D12); a shared VFS cache on the same remote would corrupt. One shared `rclone.conf` is written read-only from
 * `sdkConfig` and regenerated whenever the config changes ({@link setConfig}).
 *
 * Role instances are rebuilt from the CURRENT stored config just before each start, so a config change takes effect on the next
 * start/restart. Each start/stop/restart is idempotent and serialized per feature; the single most important guarantee is
 * {@link killAll}, the idempotent "stop everything" the Electron exit hooks invoke.
 *
 * Pure Node + Electron-free: all paths and the optional logger arrive via {@link RcloneManagerOptions}.
 *
 * @export
 * @class RcloneManager
 * @typedef {RcloneManager}
 */
export class RcloneManager {
	private readonly userDataPath: string
	private readonly logsPath: string
	private readonly zipDir?: string
	private readonly winfspMsiPath?: string
	private readonly fuseTPkgPath?: string
	private readonly logger?: (level: string, message: string) => void

	private readonly configPath: string
	private readonly scriptDir: string
	private readonly s3CertPath: string
	private readonly s3KeyPath: string
	private readonly webdavCertPath: string
	private readonly webdavKeyPath: string

	private readonly driveMutex = new Semaphore(1)
	private readonly s3Mutex = new Semaphore(1)
	private readonly webdavMutex = new Semaphore(1)
	private readonly portMutex = new Semaphore(1)

	private config: FilenDesktopConfig | null = null
	private binaryPromise: Promise<string> | null = null

	private networkDrive: NetworkDrive | null = null
	private s3: S3Server | null = null
	private webdav: WebdavServer | null = null

	private readonly rcPorts: Record<RcloneRole, number | null> = {
		drive: null,
		s3: null,
		webdav: null
	}

	/**
	 * Creates an instance of RcloneManager, resolving every derived path from the supplied `userDataPath` / `logsPath` via the
	 * `constants.ts` helpers (config file, per-role cache dirs, per-role log files) plus the watchdog `scriptDir` and the
	 * per-role TLS cert/key paths. Nothing is created on disk and nothing is started here.
	 *
	 * Per-role TLS material is kept separate (`s3-*.pem` / `webdav-*.pem`) because the S3 and WebDAV servers may bind different
	 * hostnames and therefore need certs with different SANs (spec §9).
	 *
	 * @constructor
	 * @param {RcloneManagerOptions} options
	 */
	public constructor(options: RcloneManagerOptions) {
		this.userDataPath = options.userDataPath
		this.logsPath = options.logsPath
		this.zipDir = options.zipDir
		this.winfspMsiPath = options.winfspMsiPath
		this.fuseTPkgPath = options.fuseTPkgPath
		this.logger = options.logger

		this.configPath = rcloneConfigPath(this.userDataPath)
		this.scriptDir = pathModule.join(this.userDataPath, "rclone")

		const tlsDir = pathModule.join(this.scriptDir, "tls")

		this.s3CertPath = pathModule.join(tlsDir, "s3-cert.pem")
		this.s3KeyPath = pathModule.join(tlsDir, "s3-key.pem")
		this.webdavCertPath = pathModule.join(tlsDir, "webdav-cert.pem")
		this.webdavKeyPath = pathModule.join(tlsDir, "webdav-key.pem")
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
	 * Whether an `sdkConfig` carries enough key material to write a working INTERNAL-mode `rclone.conf`.
	 *
	 * Requires exactly the fields `generateRcloneConfig` consumes (email, api key, master keys, auth version, base folder UUID,
	 * private/public keys) PLUS the codebase's canonical "is this a real session" signal — an `apiKey` longer than 32 chars and
	 * not the `"anonymous"` placeholder (mirrors the worker's `isAuthed`). Used to gate config writing so {@link setConfig}
	 * silently skips an unauthenticated/partial config instead of throwing.
	 *
	 * @private
	 * @static
	 * @param {FilenSDKConfig} sdkConfig
	 * @returns {boolean}
	 */
	private static isSdkConfigAuthed(sdkConfig: FilenSDKConfig): boolean {
		return Boolean(
			sdkConfig &&
			typeof sdkConfig.apiKey === "string" &&
			sdkConfig.apiKey.length > 32 &&
			sdkConfig.apiKey !== "anonymous" &&
			sdkConfig.email &&
			Array.isArray(sdkConfig.masterKeys) &&
			sdkConfig.masterKeys.length > 0 &&
			sdkConfig.authVersion &&
			sdkConfig.baseFolderUUID &&
			sdkConfig.privateKey &&
			sdkConfig.publicKey
		)
	}

	/**
	 * Store the desktop config and, when its `sdkConfig` is authenticated, (re)write the shared INTERNAL-auth `rclone.conf`.
	 *
	 * Regenerating the config is cheap and idempotent, so it is rewritten on every authenticated `setConfig` (the obscured
	 * fields use a random IV anyway, spec §5.1). An unauthenticated or partial config is stored but no file is written. This
	 * NEVER starts, stops or restarts a role — the IPC layer drives lifecycle explicitly; a running role keeps its current
	 * settings until it is restarted.
	 *
	 * @public
	 * @async
	 * @param {FilenDesktopConfig} config
	 * @returns {Promise<void>}
	 */
	public async setConfig(config: FilenDesktopConfig): Promise<void> {
		this.config = config

		if (RcloneManager.isSdkConfigAuthed(config.sdkConfig)) {
			await writeRcloneConfig(this.configPath, config.sdkConfig)

			this.log("info", `Wrote rclone config to ${this.configPath}.`)
		} else {
			this.log("info", "SDK config is not authenticated; skipping rclone config write.")
		}
	}

	/**
	 * Resolve the bundled rclone binary for this platform/arch, extracting it on first use, memoized across calls.
	 *
	 * The in-flight promise is shared so concurrent role starts trigger a single extraction; a failed extraction clears the
	 * memo so a later start can retry.
	 *
	 * @private
	 * @returns {Promise<string>}
	 */
	private ensureBinary(): Promise<string> {
		if (!this.binaryPromise) {
			this.binaryPromise = ensureRcloneBinary(this.userDataPath, {
				zipDir: this.zipDir
			}).catch((e: unknown) => {
				this.binaryPromise = null

				throw e
			})
		}

		return this.binaryPromise
	}

	/**
	 * Return the stored config or throw a clear error when none has been set yet.
	 *
	 * @private
	 * @returns {FilenDesktopConfig}
	 */
	private requireConfig(): FilenDesktopConfig {
		if (!this.config) {
			throw new Error("Cannot start an rclone role: no config has been set. Call setConfig() first.")
		}

		return this.config
	}

	/**
	 * Require an authenticated config and a written `rclone.conf` before a role may start, returning the config.
	 *
	 * Throws a clear error when the account is not authenticated (the role cannot run without INTERNAL-mode key material). When
	 * authenticated but the config file is somehow missing (e.g. it was never written, or was deleted on logout/relogin), it is
	 * regenerated defensively — {@link setConfig} normally writes it.
	 *
	 * @private
	 * @async
	 * @returns {Promise<FilenDesktopConfig>}
	 */
	private async ensureConfigReady(): Promise<FilenDesktopConfig> {
		const config = this.requireConfig()

		if (!RcloneManager.isSdkConfigAuthed(config.sdkConfig)) {
			throw new Error(
				"Cannot start an rclone role: the Filen account is not authenticated (the SDK config is missing its API key / master keys). Log in first."
			)
		}

		if (!(await fs.pathExists(this.configPath))) {
			await writeRcloneConfig(this.configPath, config.sdkConfig)
		}

		return config
	}

	/**
	 * Pick a free loopback port for a role's `--rc-addr`, guaranteeing it differs from the other two roles' currently-assigned
	 * rc ports.
	 *
	 * Serialized by a dedicated mutex and aware of the ports already handed to the other roles: this closes the concurrent
	 * double-pick window that a bare `findFreePort` leaves open (its bind/close liveness probe frees the port immediately, so
	 * two roles starting at once could both pick it and the second rclone would fail to bind its rc listener). The chosen port
	 * is recorded for the role and released by its stop path. An inherent TOCTOU race with EXTERNAL processes remains — the
	 * role's start-up readiness wait surfaces a late bind failure (spec §6.5).
	 *
	 * @private
	 * @async
	 * @param {RcloneRole} role
	 * @returns {Promise<number>}
	 */
	private async pickRcPort(role: RcloneRole): Promise<number> {
		await this.portMutex.acquire()

		try {
			const taken = new Set<number>()

			for (const other of ["drive", "s3", "webdav"] as const) {
				const port = this.rcPorts[other]

				if (other !== role && typeof port === "number") {
					taken.add(port)
				}
			}

			for (const port of POSSIBLE_PORTS) {
				if (taken.has(port)) {
					continue
				}

				if (await isPortFree(port)) {
					this.rcPorts[role] = port

					return port
				}
			}

			throw new Error("Could not find a free loopback port for the rclone rc interface.")
		} finally {
			this.portMutex.release()
		}
	}

	/**
	 * Release a role's recorded rc port so it can be reused by a later start.
	 *
	 * @private
	 * @param {RcloneRole} role
	 * @returns {void}
	 */
	private releaseRcPort(role: RcloneRole): void {
		this.rcPorts[role] = null
	}

	/**
	 * Build a fresh {@link NetworkDrive} from the CURRENT stored config, the resolved paths and a freshly picked rc port.
	 *
	 * Requires the binary and a written config first (throws otherwise). Maps `networkDriveConfig` onto the role options
	 * (`cacheSizeInGi` → `cacheSizeGi`, the drive's OWN persistent cache dir) and passes the bundled FUSE-layer installers with
	 * `tryInstallDependencies: true` so the drive auto-installs WinFSP / FUSE-T when missing (spec §8).
	 *
	 * @private
	 * @async
	 * @returns {Promise<NetworkDrive>}
	 */
	private async buildNetworkDrive(): Promise<NetworkDrive> {
		const config = await this.ensureConfigReady()
		const binaryPath = await this.ensureBinary()
		const rcPort = await this.pickRcPort("drive")
		const nd = config.networkDriveConfig

		return new NetworkDrive({
			binaryPath,
			configPath: this.configPath,
			mountPoint: nd.mountPoint,
			cachePath: rcloneCacheDir(this.userDataPath, "drive"),
			rcPort,
			scriptDir: this.scriptDir,
			logFilePath: rcloneLogPath(this.logsPath, "drive"),
			readOnly: nd.readOnly,
			cacheSizeGi: nd.cacheSizeInGi,
			tryInstallDependencies: true,
			winfspMsiPath: this.winfspMsiPath,
			fuseTPkgPath: this.fuseTPkgPath,
			logger: this.logger
		})
	}

	/**
	 * Build a fresh {@link S3Server} from the CURRENT stored config, the resolved paths and a freshly picked rc port.
	 *
	 * Requires the binary and a written config first (throws otherwise). Maps `s3Config` onto the role options and points it at
	 * the S3-specific cache dir and TLS cert/key (separate from the WebDAV pair so each can bind its own hostname, spec §9).
	 *
	 * @private
	 * @async
	 * @returns {Promise<S3Server>}
	 */
	private async buildS3(): Promise<S3Server> {
		const config = await this.ensureConfigReady()
		const binaryPath = await this.ensureBinary()
		const rcPort = await this.pickRcPort("s3")
		const s3 = config.s3Config

		return new S3Server({
			binaryPath,
			configPath: this.configPath,
			hostname: s3.hostname,
			port: s3.port,
			accessKeyId: s3.accessKeyId,
			secretKeyId: s3.secretKeyId,
			https: s3.https,
			rcPort,
			cachePath: rcloneCacheDir(this.userDataPath, "s3"),
			scriptDir: this.scriptDir,
			certPath: this.s3CertPath,
			keyPath: this.s3KeyPath,
			logFilePath: rcloneLogPath(this.logsPath, "s3"),
			logger: this.logger
		})
	}

	/**
	 * Build a fresh {@link WebdavServer} from the CURRENT stored config, the resolved paths and a freshly picked rc port.
	 *
	 * Requires the binary and a written config first (throws otherwise). Maps `webdavConfig` onto the role options and points it
	 * at the WebDAV-specific cache dir and TLS cert/key. Single account, HTTP Basic only — `proxyMode` / `authMode` are not used
	 * (spec D5).
	 *
	 * @private
	 * @async
	 * @returns {Promise<WebdavServer>}
	 */
	private async buildWebdav(): Promise<WebdavServer> {
		const config = await this.ensureConfigReady()
		const binaryPath = await this.ensureBinary()
		const rcPort = await this.pickRcPort("webdav")
		const webdav = config.webdavConfig

		return new WebdavServer({
			binaryPath,
			configPath: this.configPath,
			hostname: webdav.hostname,
			port: webdav.port,
			username: webdav.username,
			password: webdav.password,
			https: webdav.https,
			rcPort,
			cachePath: rcloneCacheDir(this.userDataPath, "webdav"),
			scriptDir: this.scriptDir,
			certPath: this.webdavCertPath,
			keyPath: this.webdavKeyPath,
			logFilePath: rcloneLogPath(this.logsPath, "webdav"),
			logger: this.logger
		})
	}

	/**
	 * Tear down the network-drive role and free its rc port. MUST be called while holding {@link driveMutex}.
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async stopDriveLocked(): Promise<void> {
		const role = this.networkDrive

		this.networkDrive = null

		this.releaseRcPort("drive")

		if (role) {
			await role.stop()
		}
	}

	/**
	 * Tear down the S3 role and free its rc port. MUST be called while holding {@link s3Mutex}.
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async stopS3Locked(): Promise<void> {
		const role = this.s3

		this.s3 = null

		this.releaseRcPort("s3")

		if (role) {
			await role.stop()
		}
	}

	/**
	 * Tear down the WebDAV role and free its rc port. MUST be called while holding {@link webdavMutex}.
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async stopWebdavLocked(): Promise<void> {
		const role = this.webdav

		this.webdav = null

		this.releaseRcPort("webdav")

		if (role) {
			await role.stop()
		}
	}

	/**
	 * Mount the network drive. Idempotent (serialized per feature; a no-op when already active).
	 *
	 * Cleans up any stale/crashed previous instance, builds a fresh role from the current config and starts it; on failure the
	 * role is torn down and its rc port released before the error propagates.
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async startNetworkDrive(): Promise<void> {
		await this.driveMutex.acquire()

		try {
			if (this.networkDrive && this.networkDrive.isActive()) {
				return
			}

			await this.stopDriveLocked()

			const role = await this.buildNetworkDrive()

			this.networkDrive = role

			try {
				await role.start()
			} catch (e) {
				await this.stopDriveLocked()

				throw e
			}
		} finally {
			this.driveMutex.release()
		}
	}

	/**
	 * Unmount the network drive and tear down its rclone process. Idempotent (serialized per feature; a no-op when not running).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async stopNetworkDrive(): Promise<void> {
		await this.driveMutex.acquire()

		try {
			await this.stopDriveLocked()
		} finally {
			this.driveMutex.release()
		}
	}

	/**
	 * Restart the network drive: stop then start (each step independently serialized).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async restartNetworkDrive(): Promise<void> {
		await this.stopNetworkDrive()
		await this.startNetworkDrive()
	}

	/**
	 * Start the S3 server. Idempotent (serialized per feature; a no-op when already running).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async startS3(): Promise<void> {
		await this.s3Mutex.acquire()

		try {
			if (this.s3 && this.s3.isActive()) {
				return
			}

			await this.stopS3Locked()

			const role = await this.buildS3()

			this.s3 = role

			try {
				await role.start()
			} catch (e) {
				await this.stopS3Locked()

				throw e
			}
		} finally {
			this.s3Mutex.release()
		}
	}

	/**
	 * Stop the S3 server and tear down its rclone process. Idempotent (serialized per feature; a no-op when not running).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async stopS3(): Promise<void> {
		await this.s3Mutex.acquire()

		try {
			await this.stopS3Locked()
		} finally {
			this.s3Mutex.release()
		}
	}

	/**
	 * Restart the S3 server: stop then start (each step independently serialized).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async restartS3(): Promise<void> {
		await this.stopS3()
		await this.startS3()
	}

	/**
	 * Start the WebDAV server. Idempotent (serialized per feature; a no-op when already running).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async startWebDAV(): Promise<void> {
		await this.webdavMutex.acquire()

		try {
			if (this.webdav && this.webdav.isActive()) {
				return
			}

			await this.stopWebdavLocked()

			const role = await this.buildWebdav()

			this.webdav = role

			try {
				await role.start()
			} catch (e) {
				await this.stopWebdavLocked()

				throw e
			}
		} finally {
			this.webdavMutex.release()
		}
	}

	/**
	 * Stop the WebDAV server and tear down its rclone process. Idempotent (serialized per feature; a no-op when not running).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async stopWebDAV(): Promise<void> {
		await this.webdavMutex.acquire()

		try {
			await this.stopWebdavLocked()
		} finally {
			this.webdavMutex.release()
		}
	}

	/**
	 * Restart the WebDAV server: stop then start (each step independently serialized).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async restartWebDAV(): Promise<void> {
		await this.stopWebDAV()
		await this.startWebDAV()
	}

	/**
	 * Whether the network drive is mounted and its rclone process is running.
	 *
	 * @public
	 * @returns {boolean}
	 */
	public isNetworkDriveActive(): boolean {
		return this.networkDrive?.isActive() ?? false
	}

	/**
	 * Whether the S3 server's rclone process is running.
	 *
	 * @public
	 * @returns {boolean}
	 */
	public isS3Active(): boolean {
		return this.s3?.isActive() ?? false
	}

	/**
	 * Whether the WebDAV server's rclone process is running.
	 *
	 * @public
	 * @returns {boolean}
	 */
	public isWebDAVActive(): boolean {
		return this.webdav?.isActive() ?? false
	}

	/**
	 * Whether the S3 server is actually answering on its configured address (`isS3Online` IPC). Resolves `false` when no role
	 * exists; otherwise delegates to the role's port-answers probe.
	 *
	 * @public
	 * @async
	 * @returns {Promise<boolean>}
	 */
	public async isS3Online(): Promise<boolean> {
		const role = this.s3

		if (!role) {
			return false
		}

		return await role.isOnline()
	}

	/**
	 * Whether the WebDAV server is actually answering on its configured address (`isWebDAVOnline` IPC). Resolves `false` when no
	 * role exists; otherwise delegates to the role's port-answers probe.
	 *
	 * @public
	 * @async
	 * @returns {Promise<boolean>}
	 */
	public async isWebDAVOnline(): Promise<boolean> {
		const role = this.webdav

		if (!role) {
			return false
		}

		return await role.isOnline()
	}

	/**
	 * Whether the network drive is genuinely mounted (`isNetworkDriveMounted` IPC): the role is active AND a live mount is
	 * present at the configured mount point (filesystem-level check via {@link isMountActive}).
	 *
	 * @public
	 * @async
	 * @returns {Promise<boolean>}
	 */
	public async isNetworkDriveMounted(): Promise<boolean> {
		const role = this.networkDrive

		if (!role || !role.isActive()) {
			return false
		}

		const mountPoint = this.config?.networkDriveConfig.mountPoint

		if (!mountPoint) {
			return false
		}

		return await isMountActive(mountPoint)
	}

	/**
	 * Read network-drive statistics for the renderer (`networkDriveStats` IPC). Delegates to the role (which already returns the
	 * all-zero shape when inactive); returns the same zero shape when no role exists.
	 *
	 * @public
	 * @async
	 * @returns {Promise<NetworkDriveStats>}
	 */
	public async networkDriveStats(): Promise<NetworkDriveStats> {
		const role = this.networkDrive

		if (!role) {
			return {
				uploadsInProgress: 0,
				uploadsQueued: 0,
				erroredFiles: 0,
				transfers: []
			}
		}

		return await role.getStats()
	}

	/**
	 * Free space (bytes) on the volume backing the network-drive cache (`networkDriveAvailableCache` IPC).
	 *
	 * Ports the old worker's `statfs` logic onto the drive's persistent cache dir (ensured to exist first). On a `statfs` error
	 * it falls back to a conservative 12 GiB so the renderer's cache-size slider still has a bound to work with.
	 *
	 * @public
	 * @async
	 * @returns {Promise<number>}
	 */
	public async networkDriveAvailableCacheSize(): Promise<number> {
		const cachePath = rcloneCacheDir(this.userDataPath, "drive")

		await fs.ensureDir(cachePath)

		return await new Promise<number>(resolve => {
			fs.statfs(cachePath, (err, stats) => {
				if (err) {
					this.log("error", `networkDriveAvailableCacheSize: statfs failed: ${err.message}`)

					// Conservative 12 GiB fallback (matches the old worker) so the renderer still has a usable bound.
					resolve(12884901888)

					return
				}

				resolve(stats.bavail * stats.bsize)
			})
		})
	}

	/**
	 * Total size (bytes) of the network-drive VFS cache on disk (`networkDriveCacheSize` IPC).
	 *
	 * Measures the `vfs` subdirectory of the drive's persistent cache dir — where `--vfs-cache-mode full` stores cached file
	 * data — returning 0 when it does not exist yet.
	 *
	 * @public
	 * @async
	 * @returns {Promise<number>}
	 */
	public async networkDriveCacheSize(): Promise<number> {
		const vfsPath = pathModule.join(rcloneCacheDir(this.userDataPath, "drive"), "vfs")

		if (!(await fs.pathExists(vfsPath))) {
			return 0
		}

		const dir = await getLocalDirectorySize(vfsPath)

		return dir.size
	}

	/**
	 * Wipe the network-drive cache (`networkDriveCleanupCache` IPC) — a USER-INITIATED action only.
	 *
	 * REFUSES while uploads are still pending: the persistent VFS cache holds queued/in-flight write-back data, so deleting it
	 * with pending uploads would lose them (the very bug the persistent cache fixes, spec §12). The guard checks the live
	 * write-back counters first and throws if any upload is queued or in progress; only then is the cache dir removed and
	 * recreated.
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async networkDriveCleanupCache(): Promise<void> {
		const stats = await this.networkDriveStats()

		if (stats.uploadsInProgress > 0 || stats.uploadsQueued > 0) {
			throw new Error(
				"Cannot clean up the network drive cache while uploads are still pending. Wait for all uploads to finish, then try again."
			)
		}

		const cachePath = rcloneCacheDir(this.userDataPath, "drive")

		await fs.rm(cachePath, {
			force: true,
			maxRetries: 60 * 10,
			recursive: true,
			retryDelay: 100
		})

		await fs.ensureDir(cachePath)
	}

	/**
	 * Stop all three roles concurrently — the idempotent "stop everything" wired into every Electron exit path (spec §7.3).
	 *
	 * Uses `Promise.allSettled` so one role's teardown failure never blocks the others, and is safe to call repeatedly (each
	 * stop is a no-op once its role is gone).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async killAll(): Promise<void> {
		await Promise.allSettled([this.stopNetworkDrive(), this.stopS3(), this.stopWebDAV()])
	}
}

export default RcloneManager
