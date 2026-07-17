import { app, BrowserWindow, shell, dialog, crashReporter } from "electron"
import pathModule from "path"
import IPC from "./ipc"
import FilenSDK from "@filen/sdk"
import { waitForConfig } from "./config"
import Cloud from "./lib/cloud"
import FS from "./lib/fs"
import { IS_ELECTRON } from "./constants"
import Worker from "./worker"
import { getAppIcon } from "./assets"
import Updater from "./lib/updater"
import isDev from "./isDev"
import Logger, { filenLogsPath } from "./lib/logger"
import RcloneManager from "./lib/rclone/manager"
import serveProd, { SCHEME } from "./lib/serve"
import WindowState from "./lib/windowState"
import Status from "./lib/status"
import Options from "./lib/options"
import os from "os"

if (IS_ELECTRON) {
	// Needs to be here, otherwise Chromium's FileSystemAccess API won't work. Waiting for the electron team to fix it.
	// Ref: https://github.com/electron/electron/issues/28422
	app?.commandLine.appendSwitch("enable-experimental-web-platform-features")
	app?.commandLine.appendSwitch("disable-renderer-backgrounding")
	app?.commandLine.appendSwitch("disable-pinch-zoom")
	app?.commandLine.appendSwitch("disable-pinch")
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
	public launcherWindow: BrowserWindow | null = null
	public readonly ipc: IPC
	public readonly sdk: FilenSDK
	public readonly worker: Worker
	public sdkInitialized: boolean = false
	public readonly lib: {
		cloud: Cloud
		fs: FS
	}
	public updater: Updater
	public logger: Logger
	public rclone!: RcloneManager
	public isUnityRunning: boolean = process.platform === "linux" ? app.isUnityRunning() : false
	public serve: (window: BrowserWindow) => Promise<void>
	public windowState: WindowState
	public minimizeToTray: boolean = false
	public status: Status
	public options: Options
	public shouldExitOnQuit: boolean = false

	/**
	 * Creates an instance of FilenDesktop.
	 * @date 2/23/2024 - 6:12:33 AM
	 *
	 * @constructor
	 * @public
	 */
	public constructor() {
		crashReporter.start({
			submitURL: undefined,
			productName: "io.filen.desktop",
			uploadToServer: false,
			ignoreSystemCrashHandler: false,
			rateLimit: false,
			compress: false,
			globalExtra: {
				cpus: os.cpus().length.toString(),
				ram: os.totalmem().toString(),
				platform: os.platform(),
				release: os.release()
			}
		})

		this.serve = serveProd()
		this.windowState = new WindowState()
		this.sdk = new FilenSDK()
		this.ipc = new IPC(this)
		this.lib = {
			cloud: new Cloud(this),
			fs: new FS(this)
		}
		this.worker = new Worker(this)
		this.updater = new Updater(this)
		this.logger = new Logger(false, false)
		this.status = new Status(this)
		this.options = new Options()
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

		this.logger.log("info", "SDK initialized")
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
		try {
			const lock = app.requestSingleInstanceLock()

			if (!lock) {
				app.exit(0)

				return
			}

			const options = await this.options.get()

			await app.whenReady()

			if (options.startMinimized && process.platform === "darwin") {
				app?.dock?.hide()
			}

			await this.createLauncherWindow()

			// CI update E2E (verify jobs in build.yml): initialize the updater immediately so the check does not
			// depend on SDK/worker/login state on a fresh runner. Updater.initialize() is idempotent, so the
			// regular post-window call below stays harmless.
			if (process.env.FILEN_E2E_UPDATER === "1") {
				this.updater.initialize()
			}

			this.initializeSDK()

			app.on("window-all-closed", () => {
				// Only reached on Windows/Linux when the last real window actually closes (macOS hides to tray, and an
				// explicit quit - Dock "Quit"/Cmd+Q - skips this event entirely, going straight to before-quit -> will-quit).
				// Route through the graceful quit so rclone is flushed + clean-unmounted, instead of a hard app.exit that
				// would orphan it mid-write. app.quit() is a no-op if a quit is already in flight.
				this.shouldExitOnQuit = true

				app.quit()
			})

			// An explicit quit - macOS Cmd+Q, Windows/Linux Ctrl+Q or the app-menu Quit, the macOS Dock "Quit" item - flips
			// this flag so the window `close` handler lets the window actually close instead of intercepting it into hide
			// (macOS) / minimize (tray). Fires on every platform (Ctrl+Q-with-tray on Windows/Linux quit correctly too).
			app.on("before-quit", () => {
				this.shouldExitOnQuit = true
			})

			app.on("second-instance", () => {
				// Never resurrect the window while we're quitting - a launch racing the teardown must not bring the app back.
				if (this.shouldExitOnQuit) {
					return
				}

				if (this.driveWindow) {
					if (this.driveWindow.isMinimized()) {
						this.driveWindow.restore()
					}

					this.driveWindow.focus()
				}
			})

			app.setAppUserModelId("io.filen.desktop")
			app.setName("Filen")

			if (process.platform === "win32") {
				app.setUserTasks([])
			}

			// macOS Dock-icon click: bring back the existing (hidden/minimized) window - never recreate it, since the
			// renderer holds live state. showOrOpenDriveWindow() restores-if-minimized / shows-if-hidden, and only creates a
			// window if somehow none exists. (The `activate` event is macOS-only, so this is a no-op on Windows/Linux.)
			app.on("activate", () => {
				this.showOrOpenDriveWindow()
			})

			// The bundled FUSE-layer installers RcloneManager hands to the network-drive role so a fresh machine can
			// auto-install the FUSE layer when missing (WinFSP on Windows, FUSE-T on macOS). In production they ship
			// under resources/deps (package.json extraResources); in dev they live in the repo tree. Each is undefined
			// off its platform.
			const resolveDepInstaller = (devSegments: string[], prodSegments: string[]): string =>
				isDev ? pathModule.join(__dirname, "..", ...devSegments) : pathModule.join(process.resourcesPath, ...prodSegments)

			const winfspMsiPath =
				process.platform === "win32"
					? resolveDepInstaller(["bin", "deps", "winfsp-2.2.26112.msi"], ["deps", "winfsp-2.2.26112.msi"])
					: undefined

			const fuseTPkgPath =
				process.platform === "darwin"
					? resolveDepInstaller(["bin", "deps", "fuse-t-macos-installer-1.2.7.pkg"], ["deps", "fuse-t-macos-installer-1.2.7.pkg"])
					: undefined

			this.rclone = new RcloneManager({
				userDataPath: app.getPath("userData"),
				logsPath: await filenLogsPath(),
				winfspMsiPath,
				fuseTPkgPath,
				logger: (level, message) => this.logger.log(level as Parameters<Logger["log"]>[0], message)
			})

			// Eagerly extract / self-heal the bundled rclone binary up-front so the first network-drive/S3/WebDAV enable does not
			// pay the (first-run) extraction cost. Fire-and-forget: failures are logged and retried lazily on first use.
			this.rclone.warmUpBinary().catch(() => {})

			this.logger.log("info", "Starting worker and creating window")

			await this.worker.start()
			await this.createMainWindow()

			this.destroyLauncherWindow()

			setTimeout(() => {
				this.updater.initialize()
			}, 15000)

			this.logger.log("info", "Starting sync and http inside worker")

			this.worker.invoke("restartSync").catch(err => {
				this.logger.log("error", err, "sync.start")
				this.logger.log("error", err)
			})

			this.worker.invoke("restartHTTP").catch(err => {
				this.logger.log("error", err, "http.start")
				this.logger.log("error", err)
			})

			this.logger.log("info", "Started")
		} catch (e) {
			this.logger.log("error", e)

			throw e
		} finally {
			this.destroyLauncherWindow()
		}
	}

	private async createLauncherWindow(): Promise<void> {
		if (this.launcherWindow) {
			return
		}

		this.launcherWindow = new BrowserWindow({
			width: 200,
			height: 200,
			frame: false,
			title: "Filen",
			minWidth: 200,
			minHeight: 200,
			icon: getAppIcon(),
			skipTaskbar: true,
			backgroundColor: "rgba(0, 0, 0, 0)",
			transparent: true,
			hasShadow: true,
			center: true,
			alwaysOnTop: true,
			show: false,
			resizable: false,
			webPreferences: {
				devTools: false,
				zoomFactor: 1
			}
		})

		this.launcherWindow.webContents.setZoomFactor(1)
		this.launcherWindow.webContents.setVisualZoomLevelLimits(1, 1)

		this.launcherWindow.setIcon(getAppIcon())

		await this.launcherWindow.loadFile(pathModule.join("..", "public", "launcher.html"))

		const startMinimized = (await this.options.get()).startMinimized ?? false

		if (!app.commandLine.hasSwitch("hidden") && !process.argv.includes("--hidden") && !startMinimized) {
			this.launcherWindow.show()
		}
	}

	private destroyLauncherWindow(): void {
		if (!this.launcherWindow || this.launcherWindow.isDestroyed()) {
			return
		}

		this.launcherWindow.destroy()
		this.launcherWindow = null
	}

	public showOrOpenDriveWindow(): void {
		// Guard against reactivation while quitting: a Dock click, tray "Open" or second-instance during teardown must
		// not recreate the window - that would re-init the app in a process about to exit and can leave a stray
		// window/tray behind (the duplicate-instance symptom). This is the single chokepoint for showing/creating it.
		if (this.shouldExitOnQuit) {
			return
		}

		if (BrowserWindow.getAllWindows().length === 0) {
			this.createMainWindow().catch(err => {
				this.logger.log("error", err)
			})

			return
		}

		if (this.driveWindow?.isMinimized()) {
			this.driveWindow?.restore()
		} else {
			this.driveWindow?.show()
		}
	}

	private async createMainWindow(): Promise<void> {
		if (this.driveWindow) {
			return
		}

		const [state, options] = await Promise.all([this.windowState.get(), this.options.get()])

		this.driveWindow = new BrowserWindow({
			width: state ? state.width : 1280,
			height: state ? state.height : 720,
			x: state ? state.x : undefined,
			y: state ? state.y : undefined,
			frame: false,
			title: "Filen",
			minWidth: 1024,
			minHeight: 576,
			titleBarStyle: "hidden",
			icon: getAppIcon(),
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
				preload: isDev ? pathModule.join(__dirname, "..", "dist", "preload.js") : pathModule.join(__dirname, "preload.js"),
				devTools: isDev,
				zoomFactor: 1
			}
		})

		this.driveWindow.webContents.setZoomFactor(1)
		this.driveWindow.webContents.setVisualZoomLevelLimits(1, 1)

		this.status.initialize()

		if (state) {
			this.driveWindow.setBounds({
				width: state.width,
				height: state.height,
				x: state.x,
				y: state.y
			})
		}

		this.windowState.manage(this.driveWindow)

		if (process.platform === "win32") {
			this.driveWindow?.setThumbarButtons([])
		}

		this.driveWindow?.on("closed", () => {
			this.driveWindow = null
		})

		this.driveWindow?.on("show", () => {
			if (process.platform === "darwin" && !app?.dock?.isVisible()) {
				app?.dock?.show()
			}
		})

		this.driveWindow?.on("close", e => {
			// An explicit quit, or an already-minimized window, closes normally.
			if (this.shouldExitOnQuit || this.driveWindow?.isMinimized()) {
				return
			}

			if (process.platform === "darwin") {
				// macOS: the red traffic light / Cmd+W HIDES the window rather than closing it. The BrowserWindow and its
				// renderer stay fully alive (DOM, sockets, sync state intact - `backgroundThrottling` is off), and the app
				// stays in the Dock + tray; a Dock-icon click or the tray "Open" restores it via showOrOpenDriveWindow().
				// Only in "minimize to tray" mode do we also hide the Dock icon (menu-bar-agent mode); the always-on tray is
				// then the way back. The window is only ever destroyed on a real quit (handled by the early return above).
				e.preventDefault()

				this.driveWindow?.hide()

				if (this.minimizeToTray) {
					app?.dock?.hide()
				}
			} else if (this.minimizeToTray) {
				// Windows/Linux "minimize to tray" - unchanged. The renderer's window controls drive the hide-to-tray path;
				// this minimize is the fallback for OS-level closes (Alt+F4, taskbar close) when tray mode is on.
				e.preventDefault()

				this.driveWindow?.minimize()
			}
		})

		// Open links in default external browser. Only hand safe web/mail schemes to the OS - anything else (file:, smb:,
		// javascript:, custom OS protocol handlers, ...) is denied so a link in untrusted content (e.g. a chat message)
		// cannot reach shell.openExternal with a dangerous scheme. Mirrors blockOffOriginNavigation's http/https policy.
		this.driveWindow?.webContents.setWindowOpenHandler(({ url }) => {
			let protocol: string | null = null

			try {
				protocol = new URL(url).protocol
			} catch {
				protocol = null
			}

			if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
				shell.openExternal(url).catch(() => {})
			}

			return {
				action: "deny"
			}
		})

		// Lock the main window to its own origin. The renderer is the trusted @filen/web bundle
		// (filendesktop://bundle in prod, the Vite dev server in dev) and must never navigate to any other origin
		// (e.g. the loopback HTTP server) - that would expose window.desktopAPI to attacker-controlled content. SPA
		// route changes use the History API and do not fire will-navigate, so in-app routing is unaffected; genuine
		// external http(s) links open in the default browser instead.
		const allowedNavigationOrigin = isDev ? "http://localhost:5173" : `${SCHEME}://bundle`
		const blockOffOriginNavigation = (event: Electron.Event, url: string): void => {
			let parsed: URL | null = null

			try {
				parsed = new URL(url)
			} catch {
				parsed = null
			}

			if (parsed && parsed.origin === allowedNavigationOrigin) {
				return
			}

			event.preventDefault()

			if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
				shell.openExternal(url).catch(() => {})
			}
		}

		this.driveWindow?.webContents.on("will-navigate", details => blockOffOriginNavigation(details, details.url))
		this.driveWindow?.webContents.on("will-redirect", details => blockOffOriginNavigation(details, details.url))

		if (isDev) {
			await this.driveWindow?.loadURL("http://localhost:5173")
		} else {
			await this.serve(this.driveWindow)
		}

		if (!app.commandLine.hasSwitch("hidden") && !process.argv.includes("--hidden") && !options.startMinimized) {
			this.driveWindow?.show()
		}
	}
}

if (IS_ELECTRON) {
	new FilenDesktop().initialize().catch(err => {
		console.error(err)

		dialog.showErrorBox("Could not launch Filen", err instanceof Error ? err.message : "Unknown error")

		setTimeout(() => {
			app?.exit(1)
		}, 3000)
	})
}

export { deserializeError, serializeError } from "@filen/sync"
export { DesktopAPI } from "./preload"
export * from "./utils"
export * from "./constants"

export default FilenDesktop
