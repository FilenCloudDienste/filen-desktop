import { autoUpdater } from "electron-updater"
import type FilenDesktop from ".."
import { serializeError } from "../worker"
import { BrowserWindow, app } from "electron"

autoUpdater.allowDowngrade = false
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = false

export class Updater {
	private readonly desktop: FilenDesktop
	public updateDownloaded: boolean = false
	public updateAvailable: boolean = false

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

	public initialize(): void {
		if (process.env.NODE_ENV === "development") {
			return
		}

		autoUpdater.on("checking-for-update", () => {
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

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "updateNotAvailable"
				}
			})
		})

		autoUpdater.on("update-downloaded", info => {
			this.updateDownloaded = true

			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "updateDownloaded",
					info
				}
			})
		})

		autoUpdater.on("update-cancelled", () => {
			this.desktop.ipc.postMainToWindowMessage({
				type: "updater",
				data: {
					type: "updateCancelled"
				}
			})
		})
	}

	public async installUpdate(): Promise<void> {
		if (!this.updateDownloaded || !this.updateAvailable) {
			throw new Error("No update available to install.")
		}

		await this.desktop.worker.stop()

		for (const window of BrowserWindow.getAllWindows()) {
			window.destroy()
		}

		autoUpdater.quitAndInstall(false, true)

		if (process.platform === "win32") {
			setTimeout(() => {
				app?.exit(0)
			}, 1000)
		}
	}
}

export default Updater