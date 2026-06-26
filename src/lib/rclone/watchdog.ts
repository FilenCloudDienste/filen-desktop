import { spawn, spawnSync, type ChildProcess } from "child_process"
import pathModule from "path"
import fs from "fs-extra"
import { type RcloneRole } from "./constants"

/**
 * Bumped whenever the emitted monitor-script content changes. The version is part of the script file
 * name (`monitor.v<N>.<role>.{sh,bat}`) so a content change lands as a new file instead of silently
 * reusing a stale one a previous app version wrote.
 *
 * @type {number}
 */
const MONITOR_VERSION = 1

/**
 * Crash-safety monitor for a single rclone process.
 *
 * Electron's child processes are NOT killed when the main process dies abnormally (hard crash, SIGKILL,
 * a forced power-off of the renderer) — `worker.terminate()` and an un-graceful main exit both leave
 * rclone running, which orphans the mount (spec §7.4). To guarantee 100% kill-on-exit even when no
 * graceful teardown runs, `start()` spawns a tiny DETACHED, `unref()`'d helper process that simply polls
 * the Electron main PID; the moment it disappears the helper force-kills the SPECIFIC rclone PID it was
 * handed and, for the drive role, unmounts the mountpoint.
 *
 * KEY INVARIANT: the helper kills by the rclone PID passed to {@link start} — NEVER by process name. The
 * bundled binary is the generic `rclone`/`rclone.exe`, so a name-based kill would also take down a user's
 * own unrelated rclone (spec §7.2).
 *
 * On a normal shutdown the owning {@link RcloneProcess} kills rclone itself and then calls {@link stop} to
 * reap this helper before it can act, so the watchdog only ever fires on an actual crash.
 *
 * @export
 * @class RcloneWatchdog
 * @typedef {RcloneWatchdog}
 */
export class RcloneWatchdog {
	private readonly scriptDir: string
	private readonly role: RcloneRole
	private readonly logger?: (level: string, message: string) => void
	private helper: ChildProcess | null = null

	/**
	 * Creates an instance of RcloneWatchdog.
	 *
	 * @constructor
	 * @param {{ scriptDir: string; role: RcloneRole; logger?: (level: string, message: string) => void }} param0
	 * @param {string} param0.scriptDir Directory the monitor script is written into (typically `<userData>/rclone`).
	 * @param {RcloneRole} param0.role Role of the guarded rclone process; used in the script file name.
	 * @param {(level: string, message: string) => void} [param0.logger] Optional logging hook (keeps this module Electron-free).
	 */
	public constructor({
		scriptDir,
		role,
		logger
	}: {
		scriptDir: string
		role: RcloneRole
		logger?: (level: string, message: string) => void
	}) {
		this.scriptDir = scriptDir
		this.role = role
		this.logger = logger
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
	 * Build the POSIX (`sh`) monitor script for the current platform.
	 *
	 * Polls the Electron PID with `kill -0` (no signal sent, just an existence probe); once it is gone it
	 * `kill -9`s the rclone PID and, when a mountpoint arg was passed (drive role only), runs the
	 * platform-appropriate force-unmount. The unmount line is baked in per `process.platform` rather than
	 * branched on `uname` inside the script.
	 *
	 * @private
	 * @returns {string}
	 */
	private buildUnixScript(): string {
		// `mp` is interpolated purely so these stay template literals (the `quotes` lint rule would otherwise
		// demand double quotes for a plain single-line string, which can't hold the inner shell quotes).
		const mp = "$MOUNT_POINT"
		const unmount =
			process.platform === "darwin"
				? `umount -f "${mp}" 2>/dev/null || diskutil unmount force "${mp}" 2>/dev/null || true`
				: `fusermount3 -uz "${mp}" 2>/dev/null || fusermount -uz "${mp}" 2>/dev/null || umount -l "${mp}" 2>/dev/null || true`

		return `#!/bin/sh

# Filen Desktop rclone crash-safety watchdog (role: ${this.role}).
# Args: <electronPid> <rclonePid> [mountPoint]
# Polls the Electron main PID; once it disappears, force-kills the SPECIFIC
# rclone PID it was handed (never by name) and, when a mountpoint is given,
# force-unmounts it. Exits on its own afterwards.

ELECTRON_PID="$1"
RCLONE_PID="$2"
MOUNT_POINT="$3"

if [ -z "$ELECTRON_PID" ] || [ -z "$RCLONE_PID" ]; then
	exit 1
fi

while kill -0 "$ELECTRON_PID" 2>/dev/null; do
	sleep 2
done

kill -9 "$RCLONE_PID" 2>/dev/null || true

if [ -n "$MOUNT_POINT" ]; then
	${unmount}
fi

exit 0
`
	}

	/**
	 * Build the Windows (`.bat`) monitor script.
	 *
	 * Waits for the Electron PID to leave the task list, then `taskkill`s the rclone PID and its child tree
	 * (`/T`). No unmount step — WinFSP auto-reaps the mount when the process dies.
	 *
	 * @private
	 * @returns {string}
	 */
	private buildWindowsScript(): string {
		return `@echo off
setlocal

:: Filen Desktop rclone crash-safety watchdog (role: ${this.role}).
:: Args: <electronPid> <rclonePid>
:: Waits for the Electron main PID to exit, then taskkills the SPECIFIC rclone
:: PID and its child tree. No unmount needed - WinFSP auto-reaps on death.

set "ELECTRON_PID=%~1"
set "RCLONE_PID=%~2"

if "%ELECTRON_PID%"=="" exit /B 1
if "%RCLONE_PID%"=="" exit /B 1

:loop
tasklist /FI "PID eq %ELECTRON_PID%" | findstr %ELECTRON_PID% >nul && (timeout /t 2 >nul & goto loop)

taskkill /F /T /PID %RCLONE_PID% >nul 2>&1

exit /B 0
`
	}

	/**
	 * Write the monitor script to {@link scriptDir} (idempotent) and return its absolute path.
	 *
	 * The script carries no per-process data — the Electron PID, rclone PID and mountpoint are passed as
	 * runtime args — so a single versioned file is reused across launches. Only written when absent (so a
	 * helper from an earlier launch that may still be reading the file is never disturbed); always
	 * re-`chmod`'d executable on POSIX.
	 *
	 * @private
	 * @async
	 * @returns {Promise<string>}
	 */
	private async writeScript(): Promise<string> {
		const isWindows = process.platform === "win32"
		const fileName = `monitor.v${String(MONITOR_VERSION)}.${this.role}.${isWindows ? "bat" : "sh"}`
		const scriptPath = pathModule.join(this.scriptDir, fileName)

		await fs.ensureDir(this.scriptDir)

		if (!(await fs.pathExists(scriptPath))) {
			await fs.writeFile(scriptPath, isWindows ? this.buildWindowsScript() : this.buildUnixScript(), "utf-8")
		}

		if (!isWindows) {
			await fs.chmod(scriptPath, 0o755)
		}

		return scriptPath
	}

	/**
	 * Spawn the detached crash-safety helper that guards `targetRclonePid`.
	 *
	 * Writes (if needed) and spawns the monitor script `detached: true, stdio: "ignore"` and immediately
	 * `unref()`s it so it neither keeps the Electron event loop alive nor dies with a normal shutdown. The
	 * helper is handed `process.pid` (the Electron main PID to watch), `targetRclonePid` (the exact rclone
	 * process to kill — never a name) and, for the drive role, `mountPoint`. Any previously-started helper
	 * is reaped first so at most one runs per role.
	 *
	 * Resolves once the helper reports `"spawn"`; rejects if it emits `"error"` before spawning.
	 *
	 * @public
	 * @async
	 * @param {number} targetRclonePid PID of the rclone process to force-kill if Electron disappears.
	 * @param {string} [mountPoint] Mountpoint to force-unmount after the kill (drive role; POSIX only).
	 * @returns {Promise<void>}
	 */
	public async start(targetRclonePid: number, mountPoint?: string): Promise<void> {
		if (this.helper) {
			await this.stop()
		}

		const scriptPath = await this.writeScript()
		const isWindows = process.platform === "win32"
		const args = [String(process.pid), String(targetRclonePid)]

		// Mountpoint is only meaningful for the POSIX unmount step; the Windows script ignores it.
		if (!isWindows && typeof mountPoint === "string" && mountPoint.length > 0) {
			args.push(mountPoint)
		}

		await new Promise<void>((resolve, reject) => {
			let settled = false

			// On Windows a `.bat` cannot be spawned directly (Node refuses without a shell), so go via
			// `cmd.exe /c`. On POSIX the chmod'd `#!/bin/sh` script is spawned directly.
			const helper = isWindows
				? spawn("cmd.exe", ["/c", scriptPath, ...args], {
						detached: true,
						stdio: "ignore",
						windowsHide: true
					})
				: spawn(scriptPath, args, {
						detached: true,
						stdio: "ignore"
					})

			this.helper = helper

			helper.unref()

			helper.once("error", err => {
				if (settled) {
					return
				}

				settled = true

				if (this.helper === helper) {
					this.helper = null
				}

				reject(err)
			})

			helper.once("spawn", () => {
				if (settled) {
					return
				}

				settled = true

				resolve()
			})

			helper.on("exit", () => {
				if (this.helper === helper) {
					this.helper = null
				}
			})
		})

		this.log(
			"info",
			`Watchdog (${this.role}) armed: watching electron pid ${String(process.pid)}, guarding rclone pid ${String(targetRclonePid)}.`
		)
	}

	/**
	 * Reap the spawned helper so it does not linger after a normal shutdown. Best-effort and idempotent —
	 * a second call (or a call when no helper was started) is a no-op, and killing an already-exited helper
	 * is swallowed.
	 *
	 * Kills by the helper's OWN pid: POSIX `SIGKILL` to its process group (it is a detached group leader),
	 * Windows `taskkill /T` to take down `cmd.exe` plus the `.bat` and its `timeout` child.
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async stop(): Promise<void> {
		const helper = this.helper

		if (!helper) {
			return
		}

		this.helper = null

		const pid = helper.pid

		try {
			if (process.platform === "win32") {
				if (pid !== undefined) {
					spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
						windowsHide: true
					})
				} else {
					helper.kill()
				}
			} else if (pid !== undefined) {
				try {
					process.kill(-pid, "SIGKILL")
				} catch {
					helper.kill("SIGKILL")
				}
			} else {
				helper.kill("SIGKILL")
			}
		} catch {
			// Best-effort: the helper may have already exited (ESRCH) - nothing left to reap.
		}

		this.log("info", `Watchdog (${this.role}) disarmed.`)
	}
}
