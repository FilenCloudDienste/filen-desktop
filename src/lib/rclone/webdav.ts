import fs from "fs-extra"
import { Semaphore } from "../../semaphore"
import { RcloneProcess } from "./process"
import { ensureServerCert } from "./tls"
import { validateWebdavUsername, validateWebdavPassword } from "./validation"
import { isPortInUse, httpHealthCheck } from "../../utils"
import { VFS_CACHE_MAX_SIZE_GI, VFS_CACHE_MIN_FREE_SPACE_GI, VFS_CACHE_MAX_AGE, VFS_DIR_CACHE_TIME } from "./constants"

/**
 * The HTTP status an unauthenticated `GET /` returns from a password-protected `rclone serve webdav`.
 *
 * rclone's Basic-auth middleware runs before any path handling, so a credential-less request to the root is rejected with a
 * `401 Unauthorized` (carrying `WWW-Authenticate: Basic`). Confirmed empirically against the bundled rclone v1.74.3 on macOS
 * arm64. Treating 401 as "online" therefore proves three things at once: something is listening, it speaks HTTP, and it is the
 * rclone WebDAV server with auth actually enforced (it fails closed). This mirrors what the old `@filen/webdav` worker asserted.
 *
 * @type {number}
 */
const WEBDAV_ONLINE_STATUS = 401

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
 * Construction options for {@link WebdavServer} and the sole input to {@link buildWebdavArgs}.
 *
 * Everything the role needs is passed in explicitly (paths, ports, the optional logger) so this module never imports Electron
 * and stays unit-testable. `binaryPath`/`configPath` come from the foundation modules (binary extraction + config write);
 * `cachePath` is the PERSISTENT, webdav-private VFS cache that must never be wiped (spec §6.4/§12); `scriptDir` is where the
 * crash-safety watchdog script lives; `rcPort` is a free loopback port for this process' `--rc-addr`.
 *
 * `rclone serve webdav` is single-account and HTTP-Basic only — there is intentionally NO `authMode` (digest is dropped) and NO
 * proxy mode (spec D5). `certPath`/`keyPath` are required only when `https` is set; the SAN cert is generated on demand.
 *
 * @export
 * @interface WebdavOptions
 * @typedef {WebdavOptions}
 */
export interface WebdavOptions {
	binaryPath: string
	configPath: string
	hostname: string
	port: number
	username: string
	password: string
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
 * Build the COMPLETE `rclone serve webdav` argv (spec §6.1 global flags + §6.4 webdav flags).
 *
 * Returns a real argv array — every `--flag value` pair is two separate elements — so the caller can spawn with `shell:false`
 * and no string-joining (spec §7.1). Auth is HTTP Basic via `--user`/`--pass` (single account, no digest, no proxy). The
 * persistent `--cache-dir` plus `--vfs-cache-mode full` lets clients seek and read back what they just wrote (Finder/Explorer/
 * Office). The `--server-read-timeout 0`/`--server-write-timeout 0` pair disables rclone's default 1h transfer cap and
 * `--max-header-bytes 65536` lifts the small default header limit. When `https` is set the TLS flags are appended (the cert/key
 * are ensured by {@link WebdavServer.start} before this runs); they must be present or this throws rather than emit a broken argv.
 *
 * @export
 * @async
 * @param {WebdavOptions} options
 * @returns {Promise<string[]>}
 */
export async function buildWebdavArgs(options: WebdavOptions): Promise<string[]> {
	const { configPath, hostname, port, username, password, https, rcPort, cachePath, certPath, keyPath, logFilePath, userAgent } = options

	const args: string[] = [
		"serve",
		"webdav",
		"Filen:",
		"--addr",
		`${hostname}:${port}`,
		"--user",
		username,
		"--pass",
		password,
		"--vfs-cache-mode",
		"full",
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
		// Download throughput: the Filen SDK reads each file as a strictly serial chain of 1-MiB GETs, so per-file
		// parallelism exists ONLY at this layer. --vfs-read-chunk-streams fans a client GET into concurrent range readers
		// (the biggest download win); --buffer-size keeps an async prefetch buffer; --vfs-read-ahead prefetches ahead of the
		// read position (effective here because this role runs --vfs-cache-mode full).
		"--vfs-read-chunk-streams",
		"12",
		"--vfs-read-chunk-size",
		"64Mi",
		"--buffer-size",
		"32Mi",
		"--vfs-read-ahead",
		"256Mi",
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
		// Filen has no ChangeNotify, so dir-cache-time is the only dir-listing freshness lever; short (was 5m) so
		// external/remote changes surface quickly.
		"--dir-cache-time",
		VFS_DIR_CACHE_TIME,
		"--server-read-timeout",
		"0",
		"--server-write-timeout",
		"0",
		"--max-header-bytes",
		"65536",
		"--config",
		configPath
	]

	if (https) {
		if (!certPath || !keyPath) {
			throw new Error("Cannot build WebDAV args: HTTPS is enabled but certPath/keyPath were not provided.")
		}

		args.push("--cert", certPath, "--key", keyPath, "--min-tls-version", "tls1.2")
	}

	args.push("--rc", "--rc-addr", `127.0.0.1:${rcPort}`, "--rc-no-auth")

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
		"1m"
	)

	return args
}

/**
 * The WebDAV-server role: an `rclone serve webdav Filen:` driven through the lifecycle-managed {@link RcloneProcess}.
 *
 * Replaces the old `@filen/webdav` worker. Ties the foundation modules together — credential validation, on-demand SAN TLS cert
 * generation, the persistent (never-wiped) VFS cache, argv building, the supervised child process and a port-answers health
 * check — behind a small `start()` / `stop()` / `isActive()` / `isOnline()` surface that preserves the existing IPC contract
 * (`isWebDAVOnline`, spec §4). Pure Node + Electron-free: all paths and the logger arrive via {@link WebdavOptions}. Single
 * account, HTTP Basic only — no digest, no proxy mode (spec D5).
 *
 * @export
 * @class WebdavServer
 * @typedef {WebdavServer}
 */
export class WebdavServer {
	private readonly options: WebdavOptions
	private readonly logger?: (level: string, message: string) => void
	private readonly startMutex = new Semaphore(1)
	private readonly stopMutex = new Semaphore(1)

	private process: RcloneProcess | null = null
	private active: boolean = false

	/**
	 * Creates an instance of WebdavServer.
	 *
	 * @constructor
	 * @param {WebdavOptions} options
	 */
	public constructor(options: WebdavOptions) {
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
	 * Whether the WebDAV server is serving and its rclone process is currently running.
	 *
	 * @public
	 * @returns {boolean}
	 */
	public isActive(): boolean {
		return this.active && this.process !== null && this.process.isRunning()
	}

	/**
	 * Whether the served port actually answers as the rclone WebDAV server.
	 *
	 * Performs an unauthenticated `GET /` against `http(s)://hostname:port/` and treats the expected `401 Unauthorized`
	 * (see {@link WEBDAV_ONLINE_STATUS}) as online — a response that simultaneously proves the server is up, speaks HTTP and is
	 * enforcing Basic auth (fails closed). Self-signed HTTPS is tolerated (the shared health-check agent does not verify the
	 * cert). Any connection error or unexpected status resolves `false`. Drives both the start-up readiness gate and the
	 * `isWebDAVOnline` IPC health check.
	 *
	 * @public
	 * @async
	 * @returns {Promise<boolean>}
	 */
	public async isOnline(): Promise<boolean> {
		const { https, hostname, port } = this.options

		return await httpHealthCheck({
			url: `http${https ? "s" : ""}://${hostname}:${port}/`,
			method: "GET",
			expectedStatusCode: WEBDAV_ONLINE_STATUS
		})
	}

	/**
	 * Start the WebDAV server. Idempotent (serialized by a start mutex; a no-op when already serving).
	 *
	 * Steps (spec §6.4 / §9 / §10):
	 * 1. Validate the `username`/`password` format (no control chars / CR-LF; no colon in the username — the Basic separator).
	 * 2. When `https`: ensure a SAN-matched self-signed cert/key exists for `hostname` (generated on demand, spec §9).
	 * 3. Precheck that the serve port is free, throwing a clear error if it is already in use.
	 * 4. Ensure the PERSISTENT, webdav-private VFS cache dir exists — it is NEVER wiped (spec §12).
	 * 5. Build the full argv and spawn rclone under {@link RcloneProcess} (own process group, watchdog, kill ladder).
	 * 6. Poll up to ~30s until the port answers ({@link isOnline}), tearing the process back down and throwing on timeout.
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

			const { binaryPath, configPath, hostname, port, username, password, https, rcPort, cachePath, scriptDir, certPath, keyPath } =
				this.options

			// 1) Validate the credentials' format (liveness/port checks are separate).
			const usernameResult = validateWebdavUsername(username)

			if (!usernameResult.valid) {
				throw new Error(usernameResult.error)
			}

			const passwordResult = validateWebdavPassword(password)

			if (!passwordResult.valid) {
				throw new Error(passwordResult.error)
			}

			// 2) HTTPS: ensure a self-signed cert whose SAN matches the hostname exists (spec §9).
			if (https) {
				if (!certPath || !keyPath) {
					throw new Error("Cannot start WebDAV server over HTTPS: certPath and keyPath are required.")
				}

				await ensureServerCert(certPath, keyPath, hostname)
			}

			// 3) Precheck the serve port is free.
			if (await isPortInUse(port)) {
				throw new Error(`Cannot start WebDAV server on ${hostname}:${port}: port in use.`)
			}

			// 4) Persistent VFS cache: ensure it exists, NEVER delete it (spec §12, the upload-loss bug fix).
			await fs.ensureDir(cachePath)

			// 5) Build the full argv and spawn the supervised rclone process.
			const args = await buildWebdavArgs(this.options)

			const proc = new RcloneProcess({
				binaryPath,
				args,
				rcPort,
				role: "webdav",
				scriptDir,
				logger: this.logger,
				logFilePath: this.options.logFilePath
			})

			this.process = proc

			try {
				await proc.start()

				// 6) Wait until the served port actually answers before reporting success.
				await this.waitForOnline(proc)
			} catch (e) {
				await this.stop()

				throw e
			}

			this.active = true

			this.log("info", `WebDAV server started on ${hostname}:${port} (https=${String(https)}, config ${configPath}).`)
		} finally {
			this.startMutex.release()
		}
	}

	/**
	 * Stop the WebDAV server and tear down its rclone process. Idempotent (serialized by a stop mutex; a no-op when not
	 * running). The teardown is handled by {@link RcloneProcess.stop} — its `core/quit` → SIGTERM → SIGKILL ladder plus the
	 * watchdog reaping — which flushes any queued write-back before exit.
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

			this.log("info", "WebDAV server stopped.")
		} finally {
			this.stopMutex.release()
		}
	}

	/**
	 * Poll up to ~30s for the served port to answer, throwing if rclone exits early or the timeout elapses (the caller tears
	 * the process down on either). Readiness is reported by {@link isOnline} (an unauthenticated `GET /` returning `401`).
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
				throw new Error(`could not start WebDAV server (rclone exited before the server became ready)${await proc.readLogTail()}`)
			}

			if (await this.isOnline()) {
				return
			}

			await sleep(500)
		}

		throw new Error(`could not start WebDAV server (timeout)${await proc.readLogTail()}`)
	}
}

export default WebdavServer
