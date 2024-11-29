import type FilenDesktop from ".."
import { Tray, app, Menu, nativeTheme } from "electron"
import { getTrayIcon, getAppIcon, getOverlayIcon } from "../assets"
import { type TrayState } from "../types"

export class Status {
	private readonly desktop: FilenDesktop
	public tray: Tray | null = null
	public trayState: TrayState = {
		notificationCount: 0,
		isSyncing: false,
		errorCount: 0,
		warningCount: 0
	}

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

	public initialize(): void {
		if (!this.tray) {
			this.tray = new Tray(getTrayIcon(this.trayState))

			this.tray.setContextMenu(null)
			this.tray.setToolTip("Filen")

			this.tray.on("click", () => {
				if (process.platform !== "win32") {
					return
				}

				this.desktop.showOrOpenDriveWindow()
			})

			this.tray.setContextMenu(
				Menu.buildFromTemplate([
					{
						label: "Filen",
						type: "normal",
						icon: getTrayIcon({
							isSyncing: false,
							warningCount: 0,
							notificationCount: 0,
							errorCount: 0
						}),
						enabled: false
					},
					{
						label: "Open",
						type: "normal",
						click: () => {
							this.desktop.showOrOpenDriveWindow()
						}
					},
					{
						label: "Separator",
						type: "separator"
					},
					{
						label: "Exit",
						type: "normal",
						click: () => {
							app?.quit()
						}
					}
				])
			)
		}

		// Handle different icons based on the user's theme (dark/light)
		nativeTheme.on("updated", () => {
			this.update()
		})
	}

	public update(): void {
		this.desktop.driveWindow?.setIcon(getAppIcon())
		this.tray?.setImage(getTrayIcon(this.trayState))

		if (process.platform === "win32") {
			if (this.trayState.notificationCount > 0) {
				this.desktop.driveWindow?.setOverlayIcon(
					getOverlayIcon(this.trayState.notificationCount),
					this.trayState.notificationCount.toString()
				)
			} else {
				this.desktop.driveWindow?.setOverlayIcon(null, "")
			}
		}

		if (process.platform === "darwin") {
			app?.dock?.setIcon(getAppIcon())
		}

		if (process.platform === "darwin" || (process.platform === "linux" && this.desktop.isUnityRunning)) {
			app?.setBadgeCount(this.trayState.notificationCount)
		}
	}
}

export default Status
