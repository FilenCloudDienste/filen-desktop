import net from "net"
import https from "https"
import axios from "axios"
import fs from "fs-extra"
import { Semaphore } from "../../semaphore"
import { isPortInUse } from "../../utils"
import { RcloneProcess } from "./process"
import { ensureServerCert } from "./tls"
import { validateS3AccessKeyId, validateS3SecretKey, validateHostname, validatePort } from "./validation"
import { VFS_CACHE_MAX_SIZE_GI, VFS_CACHE_MIN_FREE_SPACE_GI, VFS_CACHE_MAX_AGE, VFS_DIR_CACHE_TIME } from "./constants"

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
 * Resolve `true` iff a raw TCP connection to `host:port` succeeds within `timeoutMs`, otherwise `false`.
 *
 * Liveness fallback for {@link S3Server.isOnline} when the HTTP probe itself errors before any status line
 * (e.g. a TLS quirk on a self-signed cert): a successful connect still proves rclone's listener is up on the
 * port. The socket is always destroyed.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<boolean>}
 */
function tcpConnect(host: string, port: number, timeoutMs: number = 5000): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		const socket = new net.Socket()
		let settled = false

		const done = (ok: boolean): void => {
			if (settled) {
				return
			}

			settled = true

			socket.destroy()
			resolve(ok)
		}

		socket.setTimeout(timeoutMs)
		socket.once("connect", () => done(true))
		socket.once("timeout", () => done(false))
		socket.once("error", () => done(false))
		socket.connect(port, host)
	})
}

/**
 * Construction options for {@link S3Server} and the sole input to {@link buildS3Args}.
 *
 * Everything the role needs is passed in explicitly (paths, ports, credentials, the optional logger) so this
 * module never imports Electron and stays unit-testable. `binaryPath`/`configPath` come from the foundation
 * modules (binary extraction + the shared INTERNAL-auth `rclone.conf`); `cachePath` is this role's OWN VFS
 * cache (separate from the drive and webdav caches, spec §6.3/§6.5); `scriptDir` is where the crash-safety
 * watchdog script lives; `rcPort` is a free loopback port for this process' `--rc-addr`. `accessKeyId`/
 * `secretKeyId` are the SigV4 credentials clients sign with. When `https` is set, `certPath`/`keyPath` must be
 * supplied (the pair is generated/renewed by {@link ensureServerCert} on start).
 *
 * @export
 * @interface S3Options
 * @typedef {S3Options}
 */
export interface S3Options {
	binaryPath: string
	configPath: string
	hostname: string
	port: number
	accessKeyId: string
	secretKeyId: string
	https: boolean
	rcPort: number
	cachePath: string
	scriptDir: string
	certPath?: string
	keyPath?: string
	logFilePath?: string
	userAgent?: string
	logger?: (level: string, message: string) => void
}

/**
 * S3-server statistics surfaced for monitoring (spec §6.6: watch `uploadsQueued` so a permanently-failing
 * upload pinning cache space is visible). Write-back queue counters from `vfs/stats` plus the in-flight
 * transfers from `core/stats`.
 *
 * @export
 * @interface S3Stats
 * @typedef {S3Stats}
 */
export interface S3Stats {
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
 * Build the COMPLETE `rclone serve s3` argv (spec §6.3 serve-s3 flags + §6.1 global flags).
 *
 * Returns a real argv array — every `--flag value` pair is two separate elements — so the caller can spawn with
 * `shell:false` and no string-joining (spec §7.1). Several elements are deliberately single, `=`-joined tokens:
 *
 * - `--auth-key <accessKeyId>,<secretKeyId>`: the value is ONE element with the comma inside it. `--auth-key`
 *   must be passed on the CLI — the `RCLONE_AUTH_KEY` env var is broken and fails OPEN, serving anonymously
 *   (rclone#9044), which is why credentials are never sourced from the environment here.
 * - `--force-path-style=true`: a single element; clients must use path-style addressing.
 * - `--etag-hash=`: a single element with an EMPTY value; Filen has no MD5, and the MD5 default would otherwise
 *   yield empty ETags anyway.
 *
 * `--vfs-cache-mode writes` makes `PutObject` durable and retryable; `--server-read/write-timeout 0` disables
 * the default 1h timeouts that abort long transfers; `--max-header-bytes 65536` accommodates SigV4 signed
 * headers (which exceed the 4096-byte default). HTTP Basic (`--user`/`--pass`) is intentionally NEVER set — it
 * would stack in front of SigV4 and make S3 SDK clients get 401 (spec §6.3). When `https` is requested,
 * `--cert`/`--key`/`--min-tls-version tls1.2` are appended (and `certPath`/`keyPath` are required).
 *
 * @export
 * @async
 * @param {S3Options} options
 * @returns {Promise<string[]>}
 */
export async function buildS3Args(options: S3Options): Promise<string[]> {
	const {
		configPath,
		hostname,
		port,
		accessKeyId,
		secretKeyId,
		https: useHttps,
		rcPort,
		cachePath,
		certPath,
		keyPath,
		logFilePath,
		userAgent
	} = options

	if (useHttps && (!certPath || !keyPath)) {
		throw new Error("buildS3Args: HTTPS was requested but certPath/keyPath are missing.")
	}

	const args: string[] = [
		"serve",
		"s3",
		"Filen:",
		"--addr",
		`${hostname}:${port}`,
		// CLI-only; RCLONE_AUTH_KEY is broken and fails OPEN (anonymous) - rclone#9044. The value is the single
		// "<accessKeyId>,<secretKeyId>" string (one element, comma inside it).
		"--auth-key",
		`${accessKeyId},${secretKeyId}`,
		// Single `=`-joined elements: path-style addressing, and ETag hashing disabled (Filen has no MD5).
		"--force-path-style=true",
		"--etag-hash=",
		// Durable, retryable PutObject.
		"--vfs-cache-mode",
		"writes",
		// This role's OWN cache dir (a shared cache on the same remote corrupts, spec §6.5).
		"--cache-dir",
		cachePath,
		"--vfs-write-back",
		"5s",
		// Bound the long-running server's VFS cache: an absolute per-role cap, a disk free-space floor, and an age cutoff
		// (uniform across all rclone roles). rclone never evicts dirty/open files to meet these, so pending writes are safe.
		"--vfs-cache-max-size",
		`${VFS_CACHE_MAX_SIZE_GI}Gi`,
		"--vfs-cache-min-free-space",
		`${VFS_CACHE_MIN_FREE_SPACE_GI}Gi`,
		"--vfs-cache-max-age",
		VFS_CACHE_MAX_AGE,
		// Filen has no ChangeNotify, so dir-cache-time is the only dir-listing freshness lever; short so external/remote
		// changes surface quickly (rclone's default is 5m).
		"--dir-cache-time",
		VFS_DIR_CACHE_TIME,
		// Download throughput: the Filen SDK reads each object as a strictly serial chain of 1-MiB GETs, so per-object
		// parallelism exists ONLY at this layer. --vfs-read-chunk-streams fans a client GET into concurrent range readers
		// (the biggest download win); --buffer-size keeps an async prefetch buffer. (--vfs-read-ahead is omitted - it is a
		// no-op outside --vfs-cache-mode full, and this role runs `writes`.)
		"--vfs-read-chunk-streams",
		"12",
		"--vfs-read-chunk-size",
		"64Mi",
		"--buffer-size",
		"32Mi",
		// Upload throughput: a client PUT uploads to Filen via rclone's multi-thread chunk-writer (Filen's native
		// OpenChunkWriter, worker count = --filen-upload-concurrency) once it reaches --multi-thread-cutoff; --transfers and
		// --checkers also enlarge the shared fshttp keep-alive pool (2*(checkers+transfers+1)) for the parallel streams.
		"--multi-thread-streams",
		"4",
		"--multi-thread-cutoff",
		"32Mi",
		"--filen-upload-concurrency",
		"32",
		"--transfers",
		"8",
		"--checkers",
		"16",
		// The default 1h server timeouts abort long transfers; 0 disables them.
		"--server-read-timeout",
		"0",
		"--server-write-timeout",
		"0",
		// SigV4 signed headers exceed the 4096-byte default.
		"--max-header-bytes",
		"65536",
		"--config",
		configPath
	]

	// Global flags (spec §6.1). The user-agent is STABLE on purpose - it must not drift with the rclone version.
	args.push(
		"--user-agent",
		userAgent && userAgent.length > 0 ? userAgent : "FilenDesktop",
		"--low-level-retries",
		"10",
		"--timeout",
		"5m",
		"--contimeout",
		"1m",
		"--rc",
		"--rc-addr",
		`127.0.0.1:${rcPort}`,
		"--rc-no-auth"
	)

	if (logFilePath) {
		args.push("--log-file", logFilePath, "--log-level", "INFO")
	}

	if (useHttps && certPath && keyPath) {
		args.push("--cert", certPath, "--key", keyPath, "--min-tls-version", "tls1.2")
	}

	return args
}

/**
 * The S3-server role: an `rclone serve s3 Filen:` driven through the lifecycle-managed {@link RcloneProcess},
 * replacing the old `@filen/s3` Express server (spec §6.3).
 *
 * Ties the foundation modules together — credential/hostname/port validation, on-demand TLS cert generation,
 * the per-role (separate) VFS cache, argv building, the supervised child process and the rc stats client —
 * behind a small `start()` / `stop()` / `isOnline()` / `getStats()` surface that preserves the existing IPC
 * contract (`isS3Online`, spec §4). Pure Node + Electron-free: all paths, credentials and the logger arrive via
 * {@link S3Options}.
 *
 * @export
 * @class S3Server
 * @typedef {S3Server}
 */
export class S3Server {
	private readonly options: S3Options
	private readonly logger?: (level: string, message: string) => void
	private readonly httpsAgent?: https.Agent
	private readonly startMutex = new Semaphore(1)
	private readonly stopMutex = new Semaphore(1)

	private process: RcloneProcess | null = null
	private active: boolean = false

	/**
	 * Creates an instance of S3Server.
	 *
	 * @constructor
	 * @param {S3Options} options
	 */
	public constructor(options: S3Options) {
		this.options = options
		this.logger = options.logger
		// A liveness probe only needs to know the port answers, so a self-signed cert must not be rejected.
		this.httpsAgent = options.https
			? new https.Agent({
					rejectUnauthorized: false
				})
			: undefined
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
	 * Whether the S3 server is running (its rclone process is alive).
	 *
	 * @public
	 * @returns {boolean}
	 */
	public isActive(): boolean {
		return this.active && this.process !== null && this.process.isRunning()
	}

	/**
	 * The loopback host to actually connect to for the liveness probe. A bind-all hostname (`0.0.0.0`/`::`, or
	 * empty) is unroutable as a connect target, so it maps to the matching loopback address; every other
	 * hostname is probed as-is.
	 *
	 * @private
	 * @returns {string}
	 */
	private connectHost(): string {
		const h = (this.options.hostname ?? "").trim()

		if (h.length === 0 || h === "0.0.0.0") {
			return "127.0.0.1"
		}

		if (h === "::") {
			return "::1"
		}

		return h
	}

	/**
	 * Whether the S3 server is actually answering on its configured port.
	 *
	 * Issues an unauthenticated HTTP `GET /` to `http(s)://<host>:<port>/` (a bind-all host is probed on
	 * loopback, see {@link connectHost}; IPv6 literals are bracketed for the URL). rclone's `serve s3` answers
	 * an unauthenticated `GET /` (a `ListBuckets` with no SigV4 Authorization header) with an S3 access-denied
	 * error — empirically observed status **HTTP 400** against the bundled rclone v1.74.3, the same code the old
	 * `@filen/s3` server returned (a wrong-*signature* request instead gets 403 SignatureDoesNotMatch). Rather
	 * than pin one status across rclone versions, ANY HTTP response is treated as online: receiving a status
	 * line proves the listener is up, and we exclusively own the port (it is pre-checked free and the process is
	 * ours). All statuses are accepted (`validateStatus` always true) so a `400`/`403`/etc. is a response, not a
	 * thrown error. A self-signed cert is not rejected (this is a liveness check, not a trust check). If the HTTP
	 * layer errors before any status (e.g. a TLS quirk), it falls back to a raw TCP connect (see {@link tcpConnect}).
	 *
	 * @public
	 * @async
	 * @returns {Promise<boolean>}
	 */
	public async isOnline(): Promise<boolean> {
		const { port, https: useHttps } = this.options
		const host = this.connectHost()
		const authority = net.isIP(host) === 6 ? `[${host}]` : host
		const url = `${useHttps ? "https" : "http"}://${authority}:${port}/`

		try {
			const response = await axios.get(url, {
				timeout: 5000,
				validateStatus: () => true,
				httpsAgent: useHttps ? this.httpsAgent : undefined
			})

			return typeof response.status === "number"
		} catch {
			// HTTP failed before any status line; confirm the port answers with a raw TCP connect.
			return await tcpConnect(host, port)
		}
	}

	/**
	 * Start the S3 server. Idempotent (serialized by a start mutex; a no-op when already running).
	 *
	 * Steps (spec §6.3 / §9 / §10):
	 * 1. Validate the credentials, hostname and port format (validation.ts) — bad input is rejected before spawn.
	 * 2. When `https`, generate/renew the SAN self-signed cert+key for `hostname` ({@link ensureServerCert}).
	 * 3. Pre-check that the listen port is free (`isPortInUse`) and throw if not.
	 * 4. Ensure this role's OWN cache dir exists (separate from the drive/webdav caches, spec §6.5).
	 * 5. Build the full argv and spawn rclone under {@link RcloneProcess} (own process group, watchdog, kill ladder).
	 * 6. Poll up to ~30s until the server actually answers ({@link isOnline}), tearing the process back down and
	 *    throwing on timeout or an early rclone exit.
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
				hostname,
				port,
				accessKeyId,
				secretKeyId,
				https: useHttps,
				rcPort,
				cachePath,
				scriptDir,
				certPath,
				keyPath
			} = this.options

			// 1) Validate the credentials and listen address format before spawning anything.
			const accessKeyIdResult = validateS3AccessKeyId(accessKeyId)

			if (!accessKeyIdResult.valid) {
				throw new Error(accessKeyIdResult.error)
			}

			const secretKeyResult = validateS3SecretKey(secretKeyId)

			if (!secretKeyResult.valid) {
				throw new Error(secretKeyResult.error)
			}

			const hostnameResult = validateHostname(hostname)

			if (!hostnameResult.valid) {
				throw new Error(hostnameResult.error)
			}

			const portResult = validatePort(port)

			if (!portResult.valid) {
				throw new Error(portResult.error)
			}

			// 2) HTTPS: generate/renew the SAN self-signed cert+key for this hostname (spec §9).
			if (useHttps) {
				if (!certPath || !keyPath) {
					throw new Error("Cannot start S3 server over HTTPS: certPath and keyPath are required.")
				}

				await ensureServerCert(certPath, keyPath, hostname)
			}

			// 3) Pre-check the listen port is free.
			if (await isPortInUse(port)) {
				throw new Error(`Cannot start S3 server on ${hostname}:${port}: port in use.`)
			}

			// 4) This role's OWN cache dir (separate from the drive/webdav caches, spec §6.5).
			await fs.ensureDir(cachePath)

			// 5) Build the full argv and spawn the supervised rclone process.
			const args = await buildS3Args(this.options)

			const proc = new RcloneProcess({
				binaryPath,
				args,
				rcPort,
				role: "s3",
				scriptDir,
				logger: this.logger,
				logFilePath: this.options.logFilePath
			})

			this.process = proc

			try {
				await proc.start()

				// 6) Wait until the server actually answers before reporting success.
				await this.waitForOnline(proc)
			} catch (e) {
				await this.stop()

				throw e
			}

			this.active = true

			this.log("info", `S3 server listening on ${useHttps ? "https" : "http"}://${hostname}:${port} (config ${configPath}).`)
		} finally {
			this.startMutex.release()
		}
	}

	/**
	 * Stop the S3 server and tear down its rclone process. Idempotent (serialized by a stop mutex; a no-op when
	 * not running). The teardown itself — the `core/quit` → SIGTERM → SIGKILL kill ladder and watchdog reaping —
	 * is handled by {@link RcloneProcess.stop}.
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

			this.log("info", "S3 server stopped.")
		} finally {
			this.stopMutex.release()
		}
	}

	/**
	 * Read S3-server statistics via the managed process' rc client (spec §6.6): `core/stats` for the in-flight
	 * transfers and `vfs/stats` for the write-back disk-cache counters. Returns all-zero/empty defaults when the
	 * server is not active or on any error, and degrades to just the transfer list when `diskCache` is not yet
	 * populated.
	 *
	 * @public
	 * @async
	 * @returns {Promise<S3Stats>}
	 */
	public async getStats(): Promise<S3Stats> {
		const empty: S3Stats = {
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
	 * Poll up to ~30s for the server to start answering, throwing if rclone exits early or the timeout elapses
	 * (the caller tears the process down on either). Readiness is reported the moment {@link isOnline} succeeds.
	 *
	 * @private
	 * @async
	 * @param {RcloneProcess} proc
	 * @returns {Promise<void>}
	 */
	private async waitForOnline(proc: RcloneProcess): Promise<void> {
		const deadline = Date.now() + 30000

		while (Date.now() < deadline) {
			if (!proc.isRunning()) {
				throw new Error(`could not start S3 server (rclone exited before the server became ready)${await proc.readLogTail()}`)
			}

			if (await this.isOnline()) {
				return
			}

			await sleep(500)
		}

		throw new Error(`could not start S3 server (timeout)${await proc.readLogTail()}`)
	}
}

export default S3Server
