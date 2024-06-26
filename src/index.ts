import { app, BrowserWindow, shell, protocol } from "electron"
import WebDAV from "./webdav"
import VirtualDrive from "./virtualDrive"
import Sync from "./sync"
import os from "os"
import pathModule from "path"
import IPC from "./ipc"
import FilenSDK from "@filen/sdk"
import { waitForConfig } from "./config"
import Cloud from "./lib/cloud"
import FS from "./lib/fs"
import S3 from "./s3"
import url from "url"
import { IS_ELECTRON } from "./constants"

if (IS_ELECTRON) {
	// Needs to be here, otherwise Chromium's FileSystemAccess API won't work. Waiting for the electron team to fix it.
	// Ref: https://github.com/electron/electron/issues/28422
	app?.commandLine.appendSwitch("enable-experimental-web-platform-features")
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
	public readonly webdav: WebDAV
	public readonly virtualDrive: VirtualDrive | null = null
	public readonly sync: Sync
	public readonly ipc: IPC
	public readonly sdk: FilenSDK
	public readonly s3: S3
	public sdkInitialized: boolean = false
	public readonly lib: {
		cloud: Cloud
		fs: FS
	}

	/**
	 * Creates an instance of FilenDesktop.
	 * @date 2/23/2024 - 6:12:33 AM
	 *
	 * @constructor
	 * @public
	 */
	public constructor() {
		this.sdk = new FilenSDK()
		this.ipc = new IPC({ desktop: this })
		this.lib = {
			cloud: new Cloud({ desktop: this }),
			fs: new FS({ desktop: this })
		}
		this.webdav = new WebDAV()
		this.s3 = new S3()

		if (os.platform() === "win32") {
			this.virtualDrive = new VirtualDrive()
		}

		this.sync = new Sync()
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

		await this.createMainWindow()
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

		this.driveWindow.on("closed", () => {
			this.driveWindow = null
		})

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
	}
}

if (IS_ELECTRON) {
	new FilenDesktop().initialize().catch(console.error)
}

export default FilenDesktop
export { DesktopAPI } from "./preload"
export * from "./utils"
export * from "./constants"
