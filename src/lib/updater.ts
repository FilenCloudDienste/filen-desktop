import { autoUpdater } from "electron-updater"
import type FilenDesktop from ".."
import { serializeError } from "../utils"
import { app, BrowserWindow } from "electron"
import isDev from "../isDev"
import fs from "fs-extra"

autoUpdater.allowDowngrade = false
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.disableDifferentialDownload = true
autoUpdater.autoRunAppAfterInstall = true
autoUpdater.allowPrerelease = false
autoUpdater.disableWebInstaller = true

export class Updater {
	private readonly desktop: FilenDesktop
	public updateDownloaded: boolean = false
	public updateAvailable: boolean = false
	private interval: ReturnType<typeof setInterval> | undefined = undefined
	private e2eAutoInstall: boolean = false
	private initialized: boolean = false

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

	public initialize(): void {
		// Idempotent: called from the regular post-window path and, in CI E2E mode, once more right after
		// app-ready - a second call must not double-register the autoUpdater listeners.
		if (isDev || this.initialized) {
			return
		}

		this.initialized = true

		// Route electron-updater's internal log stream (native Squirrel handoff, proxy server, file selection,
		// download/verify steps) into desktop.log - without this, the information needed to diagnose update
		// failures in the field is discarded.
		autoUpdater.logger = {
			info: (message: unknown) => this.desktop.logger.log("info", `updater: ${message}`),
			warn: (message: unknown) => this.desktop.logger.log("warn", `updater: ${message}`),
			error: (message: unknown) => this.desktop.logger.log("error", `updater: ${message}`),
			debug: (message: unknown) => this.desktop.logger.log("info", `updater: ${message}`)
		}

		// CI end-to-end update testing (verify jobs in .github/workflows/build.yml): FILEN_E2E_UPDATER=1 points the
		// updater at a LOOPBACK feed from FILEN_E2E_UPDATE_FEED and installs a downloaded update without the user
		// prompt. Only plain http to 127.0.0.1/localhost is honored, so this can never redirect a production client
		// to a remote feed - an attacker who can set env vars and serve loopback HTTP on the victim's machine can
		// already replace user-writable installs directly.
		if (process.env.FILEN_E2E_UPDATER === "1" && process.env.FILEN_E2E_UPDATE_FEED) {
			try {
				const feed = new URL(process.env.FILEN_E2E_UPDATE_FEED)

				if (feed.protocol === "http:" && (feed.hostname === "127.0.0.1" || feed.hostname === "localhost")) {
					this.e2eAutoInstall = true

					autoUpdater.setFeedURL({
						provider: "generic",
						url: feed.toString()
					})

					this.desktop.logger.log("info", `Updater E2E mode enabled, feed: ${feed.toString()}`)
				}
			} catch (e) {
				this.desktop.logger.log("error", e, "updater.e2e.feed")
			}
		}

		autoUpdater.on("checking-for-update", () => {
			this.desktop.logger.log("info", "Checking for update")

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "checkingForUpdate"
				}
			})
		})

		autoUpdater.on("download-progress", progress => {
			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "downloadProgress",
					progress
				}
			})
		})

		autoUpdater.on("error", err => {
			this.updateDownloaded = false
			this.updateAvailable = false

			this.desktop.logger.log("error", err, "updater")

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "error",
					error: serializeError(err)
				}
			})
		})

		autoUpdater.on("update-available", () => {
			this.updateAvailable = true

			this.desktop.logger.log("info", "Update available")

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "updateAvailable"
				}
			})
		})

		autoUpdater.on("update-not-available", () => {
			this.updateDownloaded = false
			this.updateAvailable = false

			this.desktop.logger.log("info", "No update available")

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "updateNotAvailable"
				}
			})
		})

		autoUpdater.on("update-downloaded", info => {
			this.updateDownloaded = true

			this.desktop.logger.log("info", `Update downloaded: ${JSON.stringify(info)}`)

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "updateDownloaded",
					info
				}
			})

			if (this.e2eAutoInstall) {
				// One-shot guard: the relaunched post-update instance inherits the E2E env on Windows and
				// Linux, so without a marker it would immediately re-install in an endless loop. The marker
				// file is created before the first install; the relaunched instance sees it, still logs its
				// E2E lines (CI uses those as relaunch-liveness evidence), but does not install again.
				const onceFile = process.env.FILEN_E2E_ONCE_FILE

				if (onceFile && fs.existsSync(onceFile)) {
					this.desktop.logger.log("info", "Updater E2E: install already performed, skipping auto-install")

					return
				}

				setTimeout(() => {
					if (onceFile) {
						try {
							fs.writeFileSync(onceFile, String(Date.now()))
						} catch (e) {
							this.desktop.logger.log("error", e, "updater.e2e.onceFile")
						}
					}

					this.e2eInstall().catch(err => {
						this.desktop.logger.log("error", err, "updater.e2e.installUpdate")
						this.desktop.logger.log("error", err)
					})
				}, 2000)
			}
		})

		autoUpdater.on("update-cancelled", () => {
			this.desktop.logger.log("info", "Update cancelled")

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "updateCancelled"
				}
			})
		})

		autoUpdater.checkForUpdates().catch(err => {
			this.desktop.logger.log("error", err, "updater.interval")
			this.desktop.logger.log("error", err)
		})

		clearInterval(this.interval)

		this.interval = setInterval(() => {
			autoUpdater.checkForUpdates().catch(err => {
				this.desktop.logger.log("error", err, "updater.interval")
				this.desktop.logger.log("error", err)
			})
		}, 3600000)
	}

	private async e2eInstall(): Promise<void> {
		// Drive the install through the SAME path a user's click takes - renderer window.desktopAPI ->
		// preload ipcRenderer.invoke("installUpdate") -> ipcMain.handle -> installUpdate() - so CI
		// covers the whole IPC bridge, not only the main-process method. A renamed channel or broken
		// preload would otherwise strand real users' Update clicks while CI stays green. Falls back to
		// the direct call if no window carries the bridge in time (e.g. only the launcher exists yet).
		for (let attempt = 0; attempt < 20; attempt++) {
			for (const window of BrowserWindow.getAllWindows()) {
				if (window.isDestroyed()) {
					continue
				}

				try {
					const invoked = await window.webContents.executeJavaScript(
						"typeof window.desktopAPI?.installUpdate === 'function' ? (window.desktopAPI.installUpdate(), true) : false",
						true
					)

					if (invoked === true) {
						this.desktop.logger.log("info", "Updater E2E: install invoked through the renderer IPC bridge")

						return
					}
				} catch {
					// Window not ready to execute yet - retry.
				}
			}

			await new Promise<void>(resolve => setTimeout(resolve, 500))
		}

		this.desktop.logger.log("warn", "Updater E2E: no renderer bridge available, invoking installUpdate directly")

		await this.installUpdate()
	}

	public async installUpdate(): Promise<void> {
		if (!this.updateDownloaded || !this.updateAvailable) {
			throw new Error("No update available to install.")
		}

		this.desktop.shouldExitOnQuit = true
		this.desktop.isInstallingUpdate = true

		this.desktop.logger.log("info", "Installing update")

		app.removeAllListeners("window-all-closed")
		app.removeAllListeners("will-quit")

		this.desktop.driveWindow?.removeAllListeners("close")
		this.desktop.driveWindow?.removeAllListeners("show")
		this.desktop.driveWindow?.removeAllListeners("minimize")
		this.desktop.driveWindow?.removeAllListeners("maximize")

		// A dead worker's stop() can never settle (invoke against a gone thread) - without a bound, the
		// install would silently never reach quitAndInstall.
		await Promise.race([
			this.desktop.worker.stop(),
			new Promise<void>(resolve => setTimeout(resolve, 15000))
		]).catch(err => {
			this.desktop.logger.log("error", err, "updater.installUpdate")
			this.desktop.logger.log("error", err)
		})

		// The frontend shows a blocking "installing update" overlay from the moment the user confirms
		// (filen-web desktopUpdate.tsx) and awaits this IPC - keep the windows ALIVE so that overlay stays
		// visible through the entire install: Squirrel staging on macOS, the installer handoff on Windows,
		// the package-manager run (including its polkit prompt) on Linux. Each platform's mechanism quits
		// the app itself when it is ready to swap, which closes the window naturally. Destroying the
		// windows here (the old behavior) made the app vanish seconds before anything happened.

		// Unified failure recovery for every platform: a rejected macOS Squirrel staging, a cancelled
		// Linux polkit prompt, a failed Windows installer spawn. Without this the app lingers as a
		// torn-down process that still holds the single-instance lock - the user cannot even restart it
		// manually. Relaunching restores a working current-version app and the update can be retried.
		const recover = (reason: string) => {
			this.desktop.logger.log("error", `Update install failed (${reason}), relaunching the current version`)

			app.relaunch()
			app.exit(1)
		}

		autoUpdater.once("error", err => {
			this.desktop.logger.log("error", err, "updater.installUpdate.quitAndInstall")
			this.desktop.logger.log("error", err)

			recover("updater error")
		})

		if (process.platform === "darwin") {
			// With autoInstallOnAppQuit=false, Squirrel.Mac staging (proxy download -> extraction -> signature
			// verification) only STARTS inside quitAndInstall() and takes multiple seconds for a ~400 MB artifact.
			// electron-updater quits and relaunches via ShipIt on its own once staging completes
			// (autoRunAppAfterInstall), so a fixed exit timer here kills staging mid-flight and the update never
			// installs. Exit only if the updater errors, with a generous failsafe so a silently hung Squirrel
			// can't leave a windowless zombie process behind. 30 minutes: staging deep-verifies a >1 GB unpacked
			// bundle in-process and legitimately takes many minutes on HDD-era Intel machines - a tighter cap
			// would strand exactly the slowest cohort in a permanent install-kill loop.
			setTimeout(() => {
				recover("staging did not complete within 30 minutes")
			}, 1800000)

			autoUpdater.quitAndInstall(true, true)
		} else if (process.platform === "win32") {
			// isSilent=true: the assisted (oneClick:false) installer honors --force-run ONLY in silent mode -
			// non-silent, the wizard parks on the Finish page and the app never relaunches until the user
			// clicks. Silent + --force-run reinstalls in the background and auto-relaunches, which is the
			// right UX for a tray app and what the CI update E2E asserts.
			autoUpdater.quitAndInstall(true, true)

			setTimeout(() => {
				app.exit(0)
			}, 1000)
		} else {
			// BaseUpdater runs install() synchronously (dpkg/dnf via pkexec, or the AppImage swap) before
			// quitAndInstall returns and then quits itself - the timer only guards a stuck quit, mirroring
			// the Windows branch. It is armed AFTER the synchronous install, so a long polkit prompt can
			// never be cut short by it.
			autoUpdater.quitAndInstall(false, true)

			setTimeout(() => {
				app.exit(0)
			}, 1500)
		}
	}
}

export default Updater
