import { app, BrowserWindow, shell, protocol, Tray, nativeTheme } from "electron"
import pathModule from "path"
import IPC from "./ipc"
import FilenSDK from "@filen/sdk"
import { waitForConfig } from "./config"
import Cloud from "./lib/cloud"
import FS from "./lib/fs"
import url from "url"
import { IS_ELECTRON } from "./constants"
import Worker from "./worker"
import { getAppIcon, getTrayIcon } from "./assets"

if (IS_ELECTRON) {
	// Needs to be here, otherwise Chromium's FileSystemAccess API won't work. Waiting for the electron team to fix it.
	// Ref: https://github.com/electron/electron/issues/28422
	app?.commandLine.appendSwitch("enable-experimental-web-platform-features")
	app?.commandLine.appendSwitch("disable-renderer-backgrounding")
}

/**
 * FilenDesktop
 * @date 2/23/2024 - 3:49:42 AM
 *
 * @export
 * @class FilenDesktop
 * @typedef {FilenDesktop}
 */
export class FilenDesktop {
	public driveWindow: BrowserWindow | null = null
	public readonly ipc: IPC
	public readonly sdk: FilenSDK
	public readonly worker: Worker
	public sdkInitialized: boolean = false
	public readonly lib: {
		cloud: Cloud
		fs: FS
	}
	public notificationCount = 0
	public tray: Tray | null = null

	/**
	 * Creates an instance of FilenDesktop.
	 * @date 2/23/2024 - 6:12:33 AM
	 *
	 * @constructor
	 * @public
	 */
	public constructor() {
		this.sdk = new FilenSDK()
		this.ipc = new IPC(this)
		this.lib = {
			cloud: new Cloud(this),
			fs: new FS(this)
		}
		this.worker = new Worker(this)
	}

	/**
	 * Initialize the SDK in the main thread.
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async initializeSDK(): Promise<void> {
		const config = await waitForConfig()

		this.sdk.init(config.sdkConfig)
		this.sdkInitialized = true

		console.log("SDK initialized")
	}

	/**
	 * Initialize the desktop client.
	 * @date 2/23/2024 - 3:49:49 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async initialize(): Promise<void> {
		this.initializeSDK()

		app.on("window-all-closed", () => {
			if (process.platform !== "darwin") {
				app.quit()
			}
		})

		await app.whenReady()

		// Handle frontend bundle loading in production via file://
		protocol.interceptFileProtocol("file", (req, callback) => {
			const url = req.url.slice(7)

			callback({
				path: pathModule.join(__dirname, "..", "node_modules", "@filen/web", "dist", url)
			})
		})

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				this.createMainWindow().catch(console.error)
			}
		})

		app.setUserTasks([])
		app.setName("Filen")

		await this.worker.start()
		await this.createMainWindow()
		await this.worker.invoke("restartSync")
	}

	private async createMainWindow(): Promise<void> {
		if (this.driveWindow) {
			return
		}

		this.driveWindow = new BrowserWindow({
			width: 1280,
			height: 720,
			frame: false,
			title: "Filen",
			minWidth: 1280,
			minHeight: 720,
			titleBarStyle: "hidden",
			icon: getAppIcon(this.notificationCount),
			trafficLightPosition: {
				x: 10,
				y: 10
			},
			backgroundColor: "rgba(0, 0, 0, 0)",
			hasShadow: true,
			show: false,
			webPreferences: {
				backgroundThrottling: false,
				autoplayPolicy: "no-user-gesture-required",
				contextIsolation: true,
				experimentalFeatures: true,
				preload:
					process.env.NODE_ENV === "development"
						? pathModule.join(__dirname, "..", "dist", "preload.js")
						: pathModule.join(__dirname, "preload.js")
			}
		})

		this.tray = new Tray(getTrayIcon(this.notificationCount))
		this.tray.setTitle("Filen")
		this.tray.setContextMenu(null)
		this.tray.setToolTip("Filen")

		this.tray.on("click", () => {
			this.driveWindow?.show()
		})

		this.driveWindow.setThumbarButtons([])

		this.driveWindow.on("closed", () => {
			this.driveWindow = null
		})

		// Handle different icons based on the user's theme (dark/light)
		nativeTheme.on("updated", () => {
			this.driveWindow?.setIcon(getAppIcon(this.notificationCount))
			this.tray?.setImage(getTrayIcon(this.notificationCount))
		})

		// Open links in default external browser
		this.driveWindow.webContents.setWindowOpenHandler(({ url }) => {
			shell.openExternal(url)

			return {
				action: "deny"
			}
		})

		await this.driveWindow.loadURL(
			process.env.NODE_ENV !== "development"
				? url.format({
						pathname: "index.html",
						protocol: "file",
						slashes: true
				  })
				: "http://localhost:5173"
		)

		if (!app.commandLine.hasSwitch("hidden") && !process.argv.includes("--hidden")) {
			this.driveWindow.show()
		}
	}
}

if (IS_ELECTRON) {
	new FilenDesktop().initialize().catch(console.error)
}

export { deserializeError, serializeError } from "@filen/sync"
export { DesktopAPI } from "./preload"
export * from "./utils"
export * from "./constants"

export default FilenDesktop
