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

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

	public initialize(): void {
		if (isDev) {
			return
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
			autoUpdater.quitAndInstall(true, true)

			setTimeout(() => {
				app.exit(0)
			}, 1500)
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
