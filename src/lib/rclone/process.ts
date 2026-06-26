import { spawn, spawnSync, type ChildProcess } from "child_process"
import fs from "fs-extra"
import { Semaphore } from "../../semaphore"
import { RcClient } from "./rc"
import { RcloneWatchdog } from "./watchdog"
import { type RcloneRole } from "./constants"

/**
 * Read the tail of an rclone `--log-file` and distill it into a short, user-facing reason suffix like
 * `: ERROR : Failed to mount FUSE fs: permission denied`, or `""` when the file is missing/empty or holds nothing that
 * looks like a failure.
 *
 * The rclone child is spawned with `stdio: "ignore"`, so its stderr is discarded — but rclone still writes its real
 * operational failures (bind errors, mount failures, auth/config errors) to `--log-file`. This surfaces that reason, which
 * the generic readiness errors ("timeout" / "exited before ready") otherwise omit. Best-effort; never throws.
 *
 * @param {string} logFilePath
 * @returns {Promise<string>}
 */
export async function readRcloneLogTail(logFilePath: string): Promise<string> {
	try {
		const stat = await fs.stat(logFilePath)

		if (!stat.isFile() || stat.size === 0) {
			return ""
		}

		// Only the last slice matters; an INFO-level log from a long session can be large, and this runs on a failure path.
		const maxBytes = 16384
		const startPos = Math.max(0, stat.size - maxBytes)

		const text = await new Promise<string>((resolve, reject) => {
			let data = ""

			const stream = fs.createReadStream(logFilePath, {
				start: startPos,
				encoding: "utf8"
			})

			stream.on("data", chunk => {
				data += chunk
			})

			stream.on("end", () => resolve(data))
			stream.on("error", reject)
		})

		const lines = text
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(line => line.length > 0)

		// Keep only lines that look like a failure (rclone marks them ERROR/CRITICAL or uses these phrasings), then take the
		// last couple — appending benign INFO chatter would be noise, so when nothing matches we add nothing.
		const failureRegex = /\b(ERROR|CRITICAL)\b|failed|couldn'?t|can'?t|cannot|unable to|permission denied|already in use|no such|not found|fatal/i
		const failureLines = lines.filter(line => failureRegex.test(line))

		if (failureLines.length === 0) {
			return ""
		}

		const reason = failureLines
			.slice(-2)
			// Drop the leading "2024/06/26 21:14:01 " timestamp; keep the level (e.g. "ERROR : ...") for context. The optional
			// ".000000" tolerates rclone's --log-format=microseconds (its default format is date+time only, per fs/log/log.go).
			.map(line => line.replace(/^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+/, "").trim())
			.filter(line => line.length > 0)
			.join(" | ")

		if (reason.length === 0) {
			return ""
		}

		return `: ${reason.length > 300 ? `${reason.slice(0, 297)}...` : reason}`
	} catch {
		return ""
	}
}

/**
 * Construction options for {@link RcloneProcess}.
 *
 * `args` is the COMPLETE argv (subcommand + remote + every flag, including `--rc-addr`/`--config`) built
 * by the caller; this class spawns it verbatim with no shell and no string-joining (spec §7.1).
 *
 * @export
 * @interface RcloneProcessOptions
 * @typedef {RcloneProcessOptions}
 */
export interface RcloneProcessOptions {
	binaryPath: string
	args: string[]
	rcPort: number
	role: RcloneRole
	scriptDir: string
	rcUser?: string
	rcPass?: string
	mountPoint?: string
	onUnmount?: () => Promise<void>
	logger?: (level: string, message: string) => void
	logFilePath?: string
}

/**
 * Manages the full lifecycle of ONE rclone child process (a `mount` or a `serve`).
 *
 * The single most important correctness guarantee is that the child is never orphaned. To that end the
 * process is spawned from the Electron main process with no shell, an argv array, `detached` on POSIX
 * (its own process group, so it can be group-killed) and `windowsHide`; its PID is tracked and the kill
 * path always targets that exact PID — NEVER a process name, since the bundled binary is the generic
 * `rclone`/`rclone.exe` (spec §7.2). A {@link RcloneWatchdog} provides crash safety for the case where no
 * graceful teardown runs.
 *
 * `stop()` runs an idempotent kill ladder (spec §7.3): rc `core/quit` → `SIGTERM` (process group) →
 * `SIGKILL` / `taskkill /T /F` → OS unmount → watchdog teardown.
 *
 * Pure Node + testable: it never imports Electron and reports via the optional `logger` hook.
 *
 * @export
 * @class RcloneProcess
 * @typedef {RcloneProcess}
 */
export class RcloneProcess {
	/**
	 * rc client for the managed process' `--rc-addr` endpoint. Public so callers can read stats
	 * (`core/stats`, `vfs/stats`) without reaching into the process.
	 *
	 * @public
	 * @readonly
	 * @type {RcClient}
	 */
	public readonly rc: RcClient

	private readonly binaryPath: string
	private readonly args: string[]
	private readonly role: RcloneRole
	private readonly mountPoint?: string
	private readonly onUnmount?: () => Promise<void>
	private readonly logger?: (level: string, message: string) => void
	private readonly logFilePath?: string
	private readonly watchdog: RcloneWatchdog
	private readonly startMutex = new Semaphore(1)
	private readonly stopMutex = new Semaphore(1)

	private child: ChildProcess | null = null
	private running: boolean = false
	private stopping: boolean = false

	/**
	 * Creates an instance of RcloneProcess.
	 *
	 * @constructor
	 * @param {RcloneProcessOptions} options
	 */
	public constructor(options: RcloneProcessOptions) {
		this.binaryPath = options.binaryPath
		this.args = options.args
		this.role = options.role
		this.mountPoint = options.mountPoint
		this.onUnmount = options.onUnmount
		this.logger = options.logger
		this.logFilePath = options.logFilePath
		this.rc = new RcClient({
			port: options.rcPort,
			user: options.rcUser,
			pass: options.rcPass
		})
		this.watchdog = new RcloneWatchdog({
			scriptDir: options.scriptDir,
			role: options.role,
			logger: options.logger
		})
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
	 * Whether the managed rclone child is currently spawned and running.
	 *
	 * @public
	 * @returns {boolean}
	 */
	public isRunning(): boolean {
		return this.running && this.child !== null
	}

	/**
	 * PID of the managed rclone child, or `undefined` when not running.
	 *
	 * @public
	 * @readonly
	 * @type {(number | undefined)}
	 */
	public get pid(): number | undefined {
		return this.child?.pid
	}

	/**
	 * Best-effort, user-facing reason suffix distilled from this process' `--log-file` (see {@link readRcloneLogTail}), or
	 * `""` when no log file was configured or nothing failure-like was found. Used to enrich the otherwise-generic startup
	 * readiness errors with rclone's actual reason.
	 *
	 * @public
	 * @async
	 * @returns {Promise<string>}
	 */
	public async readLogTail(): Promise<string> {
		return this.logFilePath ? await readRcloneLogTail(this.logFilePath) : ""
	}

	/**
	 * Spawn the rclone child and arm its crash-safety watchdog.
	 *
	 * Serialized by a start mutex and a no-op if already running. Spawns with `stdio: "ignore"` (rclone
	 * logs via `--log-file`), `windowsHide: true` and `detached` on POSIX (own process group for
	 * group-kill); the child is intentionally NOT `unref()`'d — this class tracks and owns it. Resolves on
	 * the child's `"spawn"` event and rejects if `"error"` fires first (e.g. ENOENT). An `"exit"` handler
	 * marks the process not-running and logs an unexpected exit (it never auto-restarts). After a
	 * successful spawn the watchdog is armed with the child PID and mountpoint; a watchdog failure is
	 * logged but does not fail the start (rclone is already up, and the normal kill ladder still works).
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async start(): Promise<void> {
		await this.startMutex.acquire()

		try {
			if (this.running && this.child) {
				return
			}

			this.stopping = false

			const child = await new Promise<ChildProcess>((resolve, reject) => {
				let settled = false

				const spawned = spawn(this.binaryPath, this.args, {
					stdio: "ignore",
					windowsHide: true,
					detached: process.platform !== "win32"
				})

				this.child = spawned

				spawned.once("error", err => {
					if (settled) {
						return
					}

					settled = true
					this.running = false

					if (this.child === spawned) {
						this.child = null
					}

					reject(err)
				})

				spawned.once("spawn", () => {
					if (settled) {
						return
					}

					settled = true
					this.running = true

					resolve(spawned)
				})

				spawned.on("exit", (code, signal) => {
					const wasRunning = this.running

					this.running = false

					if (this.child === spawned) {
						this.child = null
					}

					if (wasRunning && !this.stopping) {
						this.log("warn", `rclone (${this.role}) exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`)
					}
				})
			})

			this.log("info", `rclone (${this.role}) spawned with pid ${String(child.pid)}.`)

			if (child.pid !== undefined) {
				try {
					await this.watchdog.start(child.pid, this.mountPoint)
				} catch (e) {
					this.log("error", `Failed to arm rclone watchdog (${this.role}): ${e instanceof Error ? e.message : String(e)}`)
				}
			}
		} finally {
			this.startMutex.release()
		}
	}

	/**
	 * Stop the rclone child via the idempotent kill ladder, then tear down its watchdog.
	 *
	 * Serialized by a stop mutex and a no-op if not running (the watchdog is still reaped so it cannot
	 * linger). A `stopping` flag is set so the `"exit"` handler does not treat the deliberate kill as a
	 * crash. The ladder (spec §7.3):
	 *
	 * 1. rc `core/quit` (best-effort), then wait up to ~3s for a clean self-exit.
	 * 2. Still alive → `SIGTERM` to the process group (POSIX, falling back to a direct child signal) /
	 *    `child.kill()` (Windows); wait up to ~3s.
	 * 3. Still alive → `SIGKILL` to the process group (POSIX) / `taskkill /pid <pid> /T /F` (Windows).
	 * 4. `onUnmount()` for the drive role (best-effort; errors swallowed).
	 * 5. Reap the watchdog helper.
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async stop(): Promise<void> {
		await this.stopMutex.acquire()

		try {
			const child = this.child

			if (!child || !this.running) {
				// Not running: nothing to kill, but make sure the watchdog helper isn't left lingering.
				await this.watchdog.stop()

				this.child = null
				this.running = false

				return
			}

			this.stopping = true

			const pid = child.pid

			// 1) Graceful: rclone flushes write-back, clean-unmounts and exits.
			await this.rc.coreQuit()

			if (!(await this.waitForExit(3000))) {
				// 2) SIGTERM - to the process group on POSIX, a direct terminate on Windows.
				if (process.platform === "win32") {
					try {
						child.kill()
					} catch {
						// Best-effort.
					}
				} else if (pid !== undefined) {
					try {
						process.kill(-pid, "SIGTERM")
					} catch {
						try {
							child.kill("SIGTERM")
						} catch {
							// Best-effort.
						}
					}
				} else {
					try {
						child.kill("SIGTERM")
					} catch {
						// Best-effort.
					}
				}

				if (!(await this.waitForExit(3000))) {
					// 3) SIGKILL the group on POSIX; taskkill the whole tree on Windows.
					if (process.platform === "win32") {
						if (pid !== undefined) {
							try {
								spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
									windowsHide: true
								})
							} catch {
								// Best-effort.
							}
						} else {
							try {
								child.kill("SIGKILL")
							} catch {
								// Best-effort.
							}
						}
					} else if (pid !== undefined) {
						try {
							process.kill(-pid, "SIGKILL")
						} catch {
							try {
								child.kill("SIGKILL")
							} catch {
								// Best-effort.
							}
						}
					} else {
						try {
							child.kill("SIGKILL")
						} catch {
							// Best-effort.
						}
					}

					await this.waitForExit(2000)
				}
			}

			// 4) OS-level unmount (drive role supplies this); best-effort.
			if (this.onUnmount) {
				try {
					await this.onUnmount()
				} catch (e) {
					this.log("warn", `onUnmount (${this.role}) failed: ${e instanceof Error ? e.message : String(e)}`)
				}
			}

			// 5) Normal shutdown - tear down the crash-safety watchdog so it doesn't linger.
			await this.watchdog.stop()

			this.child = null
			this.running = false

			this.log("info", `rclone (${this.role}) stopped.`)
		} finally {
			this.stopping = false
			this.stopMutex.release()
		}
	}

	/**
	 * Resolve `true` if the managed child's `"exit"` fires within `ms`, otherwise `false`. Resolves `true`
	 * immediately when the process is already gone.
	 *
	 * @private
	 * @param {number} ms
	 * @returns {Promise<boolean>}
	 */
	private waitForExit(ms: number): Promise<boolean> {
		const child = this.child

		if (!child || !this.running) {
			return Promise.resolve(true)
		}

		return new Promise<boolean>(resolve => {
			let done = false

			const settle = (didExit: boolean): void => {
				if (done) {
					return
				}

				done = true

				resolve(didExit)
			}

			const timer = setTimeout((): void => {
				settle(false)
			}, ms)

			child.once("exit", (): void => {
				clearTimeout(timer)

				settle(true)
			})
		})
	}
}
