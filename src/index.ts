import { app, BrowserWindow } from "electron"
import WebDAV from "./webdav"
import FUSE from "./fuse"
import Sync from "./sync"
import os from "os"
import pathModule from "path"
import IPC from "./ipc"
import FilenSDK from "@filen/sdk"
import { waitForSDKConfig } from "./config"
import Cloud from "./lib/cloud"
import FS from "./lib/fs"

// Needs to be here, otherwise Chromium's FileSystemAccess API won't work. Waiting for the electron team to fix it.
// Ref: https://github.com/electron/electron/issues/28422
app.commandLine.appendSwitch("enable-experimental-web-platform-features")

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
	public readonly webdav: WebDAV
	public readonly fuse: FUSE | null = null
	public readonly sync: Sync
	public readonly ipc: IPC
	public readonly sdk: FilenSDK
	public sdkInitialized: boolean = false
	public readonly lib: { cloud: Cloud; fs: FS }

	/**
	 * Creates an instance of FilenDesktop.
	 * @date 2/23/2024 - 6:12:33 AM
	 *
	 * @constructor
	 * @public
	 */
	public constructor() {
		this.sdk = new FilenSDK()

		this.lib = {
			cloud: new Cloud({ desktop: this }),
			fs: new FS({ desktop: this })
		}

		this.webdav = new WebDAV()

		if (os.platform() === "win32") {
			this.fuse = new FUSE()
		}

		this.sync = new Sync()
		this.ipc = new IPC({ desktop: this })
	}

	/**
	 * Initialize the SDK in the main thread.
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async initializeSDK(): Promise<void> {
		const config = await waitForSDKConfig()

		this.sdk.init(config)
		this.sdkInitialized = true

		console.log("[MAIN] SDK initialized")
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

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				this.createDriveWindow().catch(console.error)
			}
		})

		//await Promise.all([this.startFuseThread(), this.startWebDAVThread(), this.startSyncThread()])

		await this.startFuseThread()
		await this.createDriveWindow()

		if (process.env.NODE_ENV === "development") {
			setInterval(() => {
				console.log("[MAIN.MEM.USED]", `${(process.memoryUsage().heapUsed / 1000 / 1000).toFixed(2)} MB`)
				console.log("[MAIN.MEM.TOTAL]", `${(process.memoryUsage().heapTotal / 1000 / 1000).toFixed(2)} MB`)
			}, 5000)
		}
	}

	private async createDriveWindow(): Promise<void> {
		if (this.driveWindow) {
			return
		}

		this.driveWindow = new BrowserWindow({
			width: 1280,
			height: 720,
			frame: false,
			title: "Filen",
			webPreferences: {
				preload:
					process.env.NODE_ENV === "development"
						? pathModule.join(__dirname, "..", "dist", "preload.js")
						: pathModule.join(__dirname, "preload.js")
			}
		})

		this.driveWindow.on("closed", () => {
			this.driveWindow = null
		})

		await this.driveWindow.loadURL("http://localhost:5173")
	}

	private async startSyncThread(): Promise<void> {
		console.log("Starting sync thread")

		//await this._sync.initialize()
	}

	private async startFuseThread(): Promise<void> {
		if (os.platform() !== "win32" || os.arch() !== "x64" || !this.fuse) {
			return
		}

		console.log("Starting fuse thread")

		await this.fuse.initialize()
	}

	private async startWebDAVThread(): Promise<void> {
		console.log("Starting WebDAV thread")

		await this.webdav.initialize()
	}
}

new FilenDesktop().initialize().catch(console.error)

export { DesktopAPI } from "./preload"
