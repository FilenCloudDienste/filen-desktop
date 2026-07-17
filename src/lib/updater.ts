import { autoUpdater } from "electron-updater"
import type FilenDesktop from ".."
import { serializeError } from "../utils"
import { BrowserWindow, app } from "electron"
import isDev from "../isDev"

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
				setTimeout(() => {
					this.installUpdate().catch(err => {
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

	public async installUpdate(): Promise<void> {
		if (!this.updateDownloaded || !this.updateAvailable) {
			throw new Error("No update available to install.")
		}

		this.desktop.shouldExitOnQuit = true

		this.desktop.logger.log("info", "Installing update")

		app.removeAllListeners("window-all-closed")
		app.removeAllListeners("will-quit")

		this.desktop.driveWindow?.removeAllListeners("close")
		this.desktop.driveWindow?.removeAllListeners("show")
		this.desktop.driveWindow?.removeAllListeners("minimize")
		this.desktop.driveWindow?.removeAllListeners("maximize")

		await this.desktop.worker.stop().catch(err => {
			this.desktop.logger.log("error", err, "updater.installUpdate")
			this.desktop.logger.log("error", err)
		})

		try {
			for (const window of BrowserWindow.getAllWindows()) {
				window.destroy()
			}
		} catch (e) {
			this.desktop.logger.log("error", e, "updater.installUpdate.destroyWindows")
			this.desktop.logger.log("error", e)
		}

		if (process.platform === "darwin") {
			// With autoInstallOnAppQuit=false, Squirrel.Mac staging (proxy download -> extraction -> signature
			// verification) only STARTS inside quitAndInstall() and takes multiple seconds for a ~400 MB artifact.
			// electron-updater quits and relaunches via ShipIt on its own once staging completes
			// (autoRunAppAfterInstall), so a fixed exit timer here kills staging mid-flight and the update never
			// installs. Exit only if the updater errors, with a generous failsafe so a silently hung Squirrel
			// can't leave a windowless zombie process behind.
			const failsafe = setTimeout(() => {
				this.desktop.logger.log("error", "Update did not install within 10 minutes, exiting")

				app.exit(1)
			}, 600000)

			autoUpdater.once("error", err => {
				clearTimeout(failsafe)

				this.desktop.logger.log("error", err, "updater.installUpdate.quitAndInstall")
				this.desktop.logger.log("error", err)

				app.exit(1)
			})

			autoUpdater.quitAndInstall(true, true)
		} else {
			autoUpdater.quitAndInstall(false, true)

			if (process.platform === "win32") {
				setTimeout(() => {
					app.exit(0)
				}, 1000)
			}
		}
	}
}

export default Updater
