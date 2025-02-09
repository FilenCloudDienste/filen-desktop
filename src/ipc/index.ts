import { ipcMain, app, dialog, shell } from "electron"
import { type FilenDesktop } from ".."
import { PauseSignal } from "@filen/sdk"
import { setConfig, waitForConfig } from "../config"
import { type DriveCloudItem, type FilenDesktopConfig } from "../types"
import { type DirDownloadType } from "@filen/sdk/dist/types/api/v3/dir/download"
import pathModule from "path"
import fs from "fs-extra"
import { v4 as uuidv4 } from "uuid"
import { isPortInUse, canStartServerOnIPAndPort, type SerializedError, getDiskType, getLocalDirectorySize } from "../utils"
import { type SyncMessage } from "@filen/sync/dist/types"
import { type ProgressInfo, type UpdateDownloadedEvent } from "electron-updater"
import { DISALLOWED_SYNC_DIRS } from "../constants"
import os from "os"
import { zip } from "zip-a-folder"
import { filenLogsPath } from "../lib/logger"
import {
	getExistingDrives,
	getAvailableDriveLetters,
	isUnixMountPointValid,
	isUnixMountPointEmpty,
	isWinFSPInstalled,
	isFUSE3InstalledOnLinux,
	isFUSETInstalledOnMacOS
} from "@filen/network-drive"
import { tryingToSyncDesktop, isPathSyncedByICloud } from "@filen/sync"

export type IPCDownloadFileParams = {
	item: DriveCloudItem
	to: string
	dontEmitEvents?: boolean
	name: string
}

export type IPCDownloadDirectoryParams = {
	uuid: string
	name: string
	to: string
	type?: DirDownloadType
	linkUUID?: string
	linkHasPassword?: boolean
	linkPassword?: string
	linkSalt?: string
	dontEmitEvents?: boolean
	linkKey?: string
}

export type IPCDownloadMultipleFilesAndDirectoriesParams = {
	items: DriveCloudItem[]
	type?: DirDownloadType
	linkUUID?: string
	linkHasPassword?: boolean
	linkPassword?: string
	linkSalt?: string
	dontEmitEvents?: boolean
	to: string
	name: string
	dontEmitQueuedEvent?: boolean
	linkKey?: string
}

export type IPCShowSaveDialogResult =
	| {
			cancelled: true
	  }
	| {
			cancelled: false
			path: string
			name: string
	  }

export type IPCSelectDirectoryResult =
	| {
			cancelled: true
	  }
	| {
			cancelled: false
			paths: string[]
	  }

export type IPCShowSaveDialogResultParams = {
	nameSuggestion?: string
}

export type MainToWindowMessage =
	| {
			type: "download" | "upload"
			data: { uuid: string; name: string; fileType: "file" | "directory" } & (
				| {
						type: "started"
						size: number
				  }
				| {
						type: "queued"
				  }
				| {
						type: "finished"
						size: number
				  }
				| {
						type: "progress"
						bytes: number
				  }
				| {
						type: "error"
						err: Error
						size: number
				  }
				| {
						type: "stopped"
						size: number
				  }
				| {
						type: "paused"
				  }
				| {
						type: "resumed"
				  }
			)
	  }
	| {
			type: "shareProgress"
			done: number
			total: number
			requestUUID: string
	  }
	| {
			type: "sync"
			message: SyncMessage
	  }
	| {
			type: "updater"
			data:
				| {
						type: "checkingForUpdate" | "updateAvailable" | "updateNotAvailable" | "updateCancelled"
				  }
				| {
						type: "error"
						error: SerializedError
				  }
				| {
						type: "downloadProgress"
						progress: ProgressInfo
				  }
				| {
						type: "updateDownloaded"
						info: UpdateDownloadedEvent
				  }
	  }

export type IPCPauseResumeAbortSignalParams = {
	id: string
}

export type IPCCanStartServerOnIPAndPort = {
	ip: string
	port: number
}

/**
 * IPC
 * @date 3/13/2024 - 8:03:16 PM
 *
 * @export
 * @class IPC
 * @typedef {IPC}
 */
export class IPC {
	private readonly desktop: FilenDesktop
	private didCallRestart = false
	private readonly pauseSignals: Record<string, PauseSignal> = {}
	private readonly abortControllers: Record<string, AbortController> = {}

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop

		this.general()
		this.window()
		this.cloud()
		this.webdav()
		this.s3()
		this.networkDrive()
		this.sync()
	}

	/**
	 * Send a message to the main window.
	 *
	 * @public
	 * @param {MainToWindowMessage} message
	 */
	public postMainToWindowMessage(message: MainToWindowMessage): void {
		if (!this.desktop.driveWindow) {
			return
		}

		this.desktop.driveWindow.webContents.postMessage("mainToWindowMessage", message)
	}

	/**
	 * Handle all general related invocations.
	 *
	 * @private
	 */
	private general(): void {
		ipcMain.handle("restart", (): void => {
			if (this.didCallRestart) {
				return
			}

			this.didCallRestart = true

			app.relaunch()
			app.exit(0)
		})

		ipcMain.handle("setConfig", async (_, config: FilenDesktopConfig): Promise<void> => {
			config = {
				...config,
				sdkConfig: {
					...config.sdkConfig,
					connectToSocket: true,
					metadataCache: true,
					password: "redacted"
				},
				networkDriveConfig: {
					...config.networkDriveConfig,
					localDirPath: pathModule.join(app.getPath("userData"), "networkDrive")
				},
				syncConfig: {
					...config.syncConfig,
					dbPath: pathModule.join(app.getPath("userData"), "sync"),
					syncPairs: config.syncConfig.syncPairs.map(pair => ({
						...pair,
						requireConfirmationOnLargeDeletion: true
					}))
				}
			}

			setConfig(config)

			await Promise.all([
				this.desktop.worker.invoke("setConfig", config),
				this.desktop.worker.invoke("syncUpdatePairs", { pairs: config.syncConfig.syncPairs })
			])
		})

		ipcMain.handle("showSaveDialog", async (_, params?: IPCShowSaveDialogResultParams): Promise<IPCShowSaveDialogResult> => {
			if (!this.desktop.driveWindow) {
				throw new Error("Drive window missing.")
			}

			const { canceled, filePath } = await dialog.showSaveDialog(this.desktop.driveWindow, {
				properties: ["createDirectory", "showHiddenFiles", "showOverwriteConfirmation", "treatPackageAsDirectory"],
				defaultPath: params && params.nameSuggestion ? params.nameSuggestion : `Download_${Date.now()}`
			})

			if (canceled || !filePath) {
				return {
					cancelled: true
				}
			}

			const name = pathModule.basename(filePath)
			const parentPath = pathModule.dirname(filePath)
			const canWrite = await new Promise<boolean>(resolve =>
				fs.access(parentPath, fs.constants.W_OK | fs.constants.R_OK, err => resolve(err ? false : true))
			)

			if (!canWrite) {
				throw new Error(`Cannot write at path ${parentPath}.`)
			}

			return {
				cancelled: false,
				path: filePath,
				name
			}
		})

		ipcMain.handle("selectDirectory", async (_, multiple: boolean = false): Promise<IPCSelectDirectoryResult> => {
			if (!this.desktop.driveWindow) {
				throw new Error("Drive window missing.")
			}

			const { canceled, filePaths } = await dialog.showOpenDialog(this.desktop.driveWindow, {
				properties: multiple ? ["createDirectory", "openDirectory", "multiSelections"] : ["createDirectory", "openDirectory"]
			})

			if (canceled || filePaths.length === 0) {
				return {
					cancelled: true
				}
			}

			return {
				cancelled: false,
				paths: filePaths
			}
		})

		ipcMain.handle("getExistingDrives", async (): Promise<string[]> => {
			return await getExistingDrives()
		})

		ipcMain.handle("getAvailableDrives", async (): Promise<string[]> => {
			return await getAvailableDriveLetters()
		})

		ipcMain.handle("isPortInUse", async (_, port): Promise<boolean> => {
			return await isPortInUse(port)
		})

		ipcMain.handle("canStartServerOnIPAndPort", async (_, { ip, port }: IPCCanStartServerOnIPAndPort): Promise<boolean> => {
			return await canStartServerOnIPAndPort(ip, port)
		})

		ipcMain.handle("openLocalPath", async (_, path): Promise<void> => {
			const open = await shell.openPath(pathModule.normalize(path))

			if (open.length > 0) {
				throw new Error(open)
			}
		})

		ipcMain.handle("isPathWritable", async (_, path: string) => {
			return await this.desktop.lib.fs.isPathWritable(path)
		})

		ipcMain.handle("isPathReadable", async (_, path: string) => {
			return await this.desktop.lib.fs.isPathReadable(path)
		})

		ipcMain.handle("isWorkerActive", async () => {
			return this.desktop.worker.active
		})

		ipcMain.handle("updateNotificationCount", async (_, count: number) => {
			this.desktop.status.trayState.notificationCount = count

			this.desktop.status.update()
		})

		ipcMain.handle("updateErrorCount", async (_, count: number) => {
			this.desktop.status.trayState.errorCount = count

			this.desktop.status.update()
		})

		ipcMain.handle("updateWarningCount", async (_, count: number) => {
			this.desktop.status.trayState.warningCount = count

			this.desktop.status.update()
		})

		ipcMain.handle("updateIsSyncing", async (_, isSyncing: boolean) => {
			this.desktop.status.trayState.isSyncing = isSyncing

			this.desktop.status.update()
		})

		ipcMain.handle("toggleAutoLaunch", async (_, enabled: boolean) => {
			app.setLoginItemSettings({
				openAtLogin: enabled,
				...(enabled
					? {
							openAsHidden: true,
							args: ["--hidden"]
					  }
					: {})
			})
		})

		ipcMain.handle("getAutoLaunch", async () => {
			return app.getLoginItemSettings({
				args: ["--hidden"]
			})
		})

		ipcMain.handle("installUpdate", async () => {
			await this.desktop.updater.installUpdate()
		})

		ipcMain.handle("exportLogs", async () => {
			if (!this.desktop.driveWindow) {
				return
			}

			const name = `filenDesktopLogs_${Date.now()}.zip`
			const { canceled, filePath } = await dialog.showSaveDialog(this.desktop.driveWindow, {
				properties: ["createDirectory", "showHiddenFiles", "showOverwriteConfirmation", "treatPackageAsDirectory"],
				defaultPath: name
			})

			if (canceled || !filePath) {
				return
			}

			const parentPath = pathModule.dirname(filePath)
			const canWrite = await new Promise<boolean>(resolve =>
				fs.access(parentPath, fs.constants.W_OK | fs.constants.R_OK, err => resolve(err ? false : true))
			)

			if (!canWrite) {
				throw new Error(`Cannot write at path ${parentPath}.`)
			}

			const logsPath = await filenLogsPath()

			await fs.copy(app.getPath("crashDumps"), pathModule.join(logsPath, "crashDumps"), {
				overwrite: true
			})

			const dir = await getLocalDirectorySize(logsPath)

			if (dir.items === 0) {
				return
			}

			await zip(logsPath, pathModule.join(pathModule.dirname(filePath), name), {
				compression: 9
			})
		})

		ipcMain.handle("version", async () => {
			return app.getVersion()
		})

		ipcMain.handle("restartWorker", async () => {
			await this.desktop.worker.stop()
			await this.desktop.worker.start()
		})

		ipcMain.handle("getLocalDirectoryItemCount", async (_, path: string) => {
			return await this.desktop.worker.invoke("getLocalDirectoryItemCount", path)
		})

		ipcMain.handle("getDiskType", async (_, path: string) => {
			return await getDiskType(path)
		})

		ipcMain.handle("tryingToSyncDesktop", async (_, path: string) => {
			return tryingToSyncDesktop(path)
		})

		ipcMain.handle("isPathSyncedByICloud", async (_, path: string) => {
			return await isPathSyncedByICloud(path)
		})

		ipcMain.handle("setMinimizeToTray", async (_, minimizeToTray: boolean) => {
			this.desktop.minimizeToTray = minimizeToTray

			await this.desktop.options.update({
				minimizeToTray
			})
		})

		ipcMain.handle("setStartMinimized", async (_, startMinimized: boolean) => {
			await this.desktop.options.update({
				startMinimized
			})
		})
	}

	/**
	 * Handle all cloud related invocations.
	 *
	 * @private
	 */
	private cloud(): void {
		ipcMain.handle("pausePauseSignal", (_, { id }: IPCPauseResumeAbortSignalParams) => {
			if (!this.pauseSignals[id] || this.pauseSignals[id]!.isPaused()) {
				return
			}

			this.pauseSignals[id]!.pause()
		})

		ipcMain.handle("resumePauseSignal", (_, { id }: IPCPauseResumeAbortSignalParams) => {
			if (!this.pauseSignals[id] || !this.pauseSignals[id]!.isPaused()) {
				return
			}

			this.pauseSignals[id]!.resume()
		})

		ipcMain.handle("abortAbortSignal", (_, { id }: IPCPauseResumeAbortSignalParams) => {
			if (!this.abortControllers[id] || this.abortControllers[id]!.signal.aborted) {
				return
			}

			this.abortControllers[id]!.abort()

			delete this.abortControllers[id]
			delete this.pauseSignals[id]
		})

		ipcMain.handle("downloadFile", async (_, { item, to, dontEmitEvents, name }: IPCDownloadFileParams): Promise<string> => {
			if (item.type === "directory") {
				throw new Error("Invalid file type.")
			}

			await waitForConfig()

			if (!this.pauseSignals[item.uuid]) {
				this.pauseSignals[item.uuid] = new PauseSignal()
			}

			if (!this.abortControllers[item.uuid]) {
				this.abortControllers[item.uuid] = new AbortController()
			}

			try {
				return await this.desktop.lib.cloud.downloadFile({
					uuid: item.uuid,
					bucket: item.bucket,
					region: item.region,
					chunks: item.chunks,
					key: item.key,
					to,
					version: item.version,
					dontEmitEvents,
					size: item.size,
					name,
					pauseSignal: this.pauseSignals[item.uuid],
					abortSignal: this.abortControllers[item.uuid]!.signal
				})
			} catch (e) {
				if (e instanceof DOMException && e.name === "AbortError") {
					return ""
				}

				if (e instanceof Error) {
					this.desktop.ipc.postMainToWindowMessage({
						type: "download",
						data: {
							type: "error",
							uuid: item.uuid,
							name,
							size: item.size,
							err: e,
							fileType: "file"
						}
					})
				}

				throw e
			} finally {
				delete this.pauseSignals[item.uuid]
				delete this.abortControllers[item.uuid]
			}
		})

		ipcMain.handle(
			"downloadDirectory",
			async (
				_,
				{ uuid, name, to, type, linkUUID, linkHasPassword, linkPassword, linkSalt, linkKey }: IPCDownloadDirectoryParams
			): Promise<string> => {
				await waitForConfig()

				if (!this.pauseSignals[uuid]) {
					this.pauseSignals[uuid] = new PauseSignal()
				}

				if (!this.abortControllers[uuid]) {
					this.abortControllers[uuid] = new AbortController()
				}

				try {
					return await this.desktop.lib.cloud.downloadDirectory({
						uuid,
						name,
						linkUUID,
						linkHasPassword,
						linkPassword,
						linkSalt,
						to,
						type,
						pauseSignal: this.pauseSignals[uuid],
						abortSignal: this.abortControllers[uuid]!.signal,
						linkKey
					})
				} catch (e) {
					if (e instanceof DOMException && e.name === "AbortError") {
						return ""
					}

					if (e instanceof Error) {
						this.desktop.ipc.postMainToWindowMessage({
							type: "download",
							data: {
								type: "error",
								uuid,
								name,
								size: 0,
								err: e,
								fileType: "directory"
							}
						})
					}

					throw e
				} finally {
					delete this.pauseSignals[uuid]
					delete this.abortControllers[uuid]
				}
			}
		)

		ipcMain.handle(
			"downloadMultipleFilesAndDirectories",
			async (
				_,
				{
					items,
					to,
					type,
					linkUUID,
					linkHasPassword,
					linkPassword,
					linkSalt,
					name,
					linkKey
				}: IPCDownloadMultipleFilesAndDirectoriesParams
			): Promise<string> => {
				await waitForConfig()

				const directoryId = uuidv4()

				if (!this.pauseSignals[directoryId]) {
					this.pauseSignals[directoryId] = new PauseSignal()
				}

				if (!this.abortControllers[directoryId]) {
					this.abortControllers[directoryId] = new AbortController()
				}

				try {
					return await this.desktop.lib.cloud.downloadMultipleFilesAndDirectories({
						items: items.map(item => ({
							...item,
							path: item.name
						})),
						linkUUID,
						linkHasPassword,
						linkPassword,
						linkSalt,
						to,
						type,
						name,
						directoryId,
						pauseSignal: this.pauseSignals[directoryId],
						abortSignal: this.abortControllers[directoryId]!.signal,
						linkKey
					})
				} catch (e) {
					if (e instanceof DOMException && e.name === "AbortError") {
						return ""
					}

					if (e instanceof Error) {
						this.desktop.ipc.postMainToWindowMessage({
							type: "download",
							data: {
								type: "error",
								uuid: directoryId,
								name,
								size: 0,
								err: e,
								fileType: "directory"
							}
						})
					}

					throw e
				} finally {
					delete this.pauseSignals[directoryId]
					delete this.abortControllers[directoryId]
				}
			}
		)
	}

	/**
	 * Handle all window related invocations.
	 * @date 3/13/2024 - 8:03:23 PM
	 *
	 * @private
	 */
	private window(): void {
		ipcMain.handle("minimizeWindow", async (): Promise<void> => {
			this.desktop.driveWindow?.minimize()
		})

		ipcMain.handle("maximizeWindow", async (): Promise<void> => {
			this.desktop.driveWindow?.maximize()
		})

		ipcMain.handle("unmaximizeWindow", async (): Promise<void> => {
			this.desktop.driveWindow?.unmaximize()
		})

		ipcMain.handle("closeWindow", async (): Promise<void> => {
			this.desktop.driveWindow?.close()
		})

		ipcMain.handle("showWindow", async (): Promise<void> => {
			if (this.desktop.driveWindow?.isMinimized()) {
				this.desktop.driveWindow?.restore()
			} else {
				this.desktop.driveWindow?.show()
			}
		})

		ipcMain.handle("hideWindow", async (): Promise<void> => {
			this.desktop.driveWindow?.hide()
		})

		ipcMain.handle("isWindowMaximized", async (): Promise<boolean> => {
			if (!this.desktop.driveWindow) {
				return false
			}

			return this.desktop.driveWindow.isMaximized()
		})
	}

	/**
	 * Handle all WebDAV related invocations.
	 *
	 * @private
	 */
	private webdav(): void {
		ipcMain.handle("startWebDAVServer", async () => {
			await this.desktop.worker.invoke("startWebDAV")
		})

		ipcMain.handle("stopWebDAVServer", async () => {
			await this.desktop.worker.invoke("stopWebDAV")
		})

		ipcMain.handle("restartWebDAVServer", async () => {
			await this.desktop.worker.invoke("restartWebDAV")
		})

		ipcMain.handle("isWebDAVOnline", async () => {
			return await this.desktop.worker.isWebDAVOnline()
		})

		ipcMain.handle("isWebDAVActive", async () => {
			return await this.desktop.worker.invoke("isWebDAVActive")
		})
	}

	/**
	 * Handle all S3 related invocations.
	 *
	 * @private
	 */
	private s3(): void {
		ipcMain.handle("startS3Server", async () => {
			await this.desktop.worker.invoke("startS3")
		})

		ipcMain.handle("stopS3Server", async () => {
			await this.desktop.worker.invoke("stopS3")
		})

		ipcMain.handle("restartS3Server", async () => {
			await this.desktop.worker.invoke("restartS3")
		})

		ipcMain.handle("isS3Online", async () => {
			return await this.desktop.worker.isS3Online()
		})

		ipcMain.handle("isS3Active", async () => {
			return await this.desktop.worker.invoke("isS3Active")
		})
	}

	/**
	 * Handle all Network Drive related invocations.
	 *
	 * @private
	 */
	private networkDrive(): void {
		ipcMain.handle("startNetworkDrive", async () => {
			await this.desktop.worker.invoke("startNetworkDrive")
		})

		ipcMain.handle("stopNetworkDrive", async () => {
			await this.desktop.worker.invoke("stopNetworkDrive")
		})

		ipcMain.handle("restartNetworkDrive", async () => {
			await this.desktop.worker.invoke("restartNetworkDrive")
		})

		ipcMain.handle("isNetworkDriveMounted", async () => {
			return await this.desktop.worker.isNetworkDriveMounted()
		})

		ipcMain.handle("networkDriveAvailableCache", async () => {
			return await this.desktop.worker.invoke("networkDriveAvailableCacheSize")
		})

		ipcMain.handle("networkDriveStats", async () => {
			return await this.desktop.worker.invoke("networkDriveStats")
		})

		ipcMain.handle("networkDriveCacheSize", async () => {
			return await this.desktop.worker.invoke("networkDriveCacheSize")
		})

		ipcMain.handle("networkDriveCleanupCache", async () => {
			await this.desktop.worker.invoke("networkDriveCleanupCache")
		})

		ipcMain.handle("networkDriveCleanupLocalDir", async () => {
			await this.desktop.worker.invoke("networkDriveCleanupLocalDir")
		})

		ipcMain.handle("isNetworkDriveActive", async () => {
			return await this.desktop.worker.invoke("isNetworkDriveActive")
		})

		ipcMain.handle("isWinFSPInstalled", async () => {
			if (process.platform !== "win32") {
				return false
			}

			return await isWinFSPInstalled()
		})

		ipcMain.handle("isFUSE3InstalledOnLinux", async () => {
			if (process.platform !== "linux") {
				return false
			}

			return await isFUSE3InstalledOnLinux()
		})

		ipcMain.handle("isFUSETInstalledOnMacOS", async () => {
			if (process.platform !== "darwin") {
				return false
			}

			return await isFUSETInstalledOnMacOS()
		})

		ipcMain.handle("isUnixMountPointValid", async (_, path: string): Promise<boolean> => {
			if (process.platform === "win32") {
				return false
			}

			return await isUnixMountPointValid(path)
		})

		ipcMain.handle("isUnixMountPointEmpty", async (_, path: string): Promise<boolean> => {
			if (process.platform === "win32") {
				return false
			}

			return await isUnixMountPointEmpty(path)
		})

		ipcMain.handle("doesPathStartWithHomeDir", async (_, path: string) => {
			if (process.platform === "win32") {
				return path.startsWith(os.homedir() + "\\")
			}

			if (process.platform === "linux" || process.platform === "darwin") {
				return path.startsWith(os.homedir() + "/")
			}
			return false
		})
	}

	/**
	 * Handle all Sync related invocations.
	 *
	 * @private
	 */
	private sync(): void {
		ipcMain.handle("startSync", async () => {
			await this.desktop.worker.invoke("startSync")
		})

		ipcMain.handle("stopSync", async () => {
			await this.desktop.worker.invoke("stopSync")
		})

		ipcMain.handle("restartSync", async () => {
			await this.desktop.worker.invoke("restartSync")
		})

		ipcMain.handle("isSyncActive", async () => {
			return await this.desktop.worker.invoke("isSyncActive")
		})

		ipcMain.handle("syncResetCache", async (_, params) => {
			await this.desktop.worker.invoke("syncResetCache", params)
		})

		ipcMain.handle("syncUpdateExcludeDotFiles", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdateExcludeDotFiles", params)
		})

		ipcMain.handle("syncUpdateIgnorerContent", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdateIgnorerContent", params)
		})

		ipcMain.handle("syncUpdateRequireConfirmationOnLargeDeletions", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdateRequireConfirmationOnLargeDeletions", params)
		})

		ipcMain.handle("syncFetchIgnorerContent", async (_, params) => {
			return await this.desktop.worker.invoke("syncFetchIgnorerContent", params)
		})

		ipcMain.handle("syncUpdateMode", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdateMode", params)
		})

		ipcMain.handle("syncUpdatePaused", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdatePaused", params)
		})

		ipcMain.handle("syncUpdateRemoved", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdateRemoved", params)
		})

		ipcMain.handle("syncPauseTransfer", async (_, params) => {
			await this.desktop.worker.invoke("syncPauseTransfer", params)
		})

		ipcMain.handle("syncResumeTransfer", async (_, params) => {
			await this.desktop.worker.invoke("syncResumeTransfer", params)
		})

		ipcMain.handle("syncStopTransfer", async (_, params) => {
			await this.desktop.worker.invoke("syncStopTransfer", params)
		})

		ipcMain.handle("syncResetTaskErrors", async (_, params) => {
			await this.desktop.worker.invoke("syncResetTaskErrors", params)
		})

		ipcMain.handle("syncToggleLocalTrash", async (_, params) => {
			await this.desktop.worker.invoke("syncToggleLocalTrash", params)
		})

		ipcMain.handle("syncResetLocalTreeErrors", async (_, params) => {
			await this.desktop.worker.invoke("syncResetLocalTreeErrors", params)
		})

		ipcMain.handle("syncUpdatePairs", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdatePairs", params)
		})

		ipcMain.handle("syncUpdateConfirmDeletion", async (_, params) => {
			await this.desktop.worker.invoke("syncUpdateConfirmDeletion", params)
		})

		ipcMain.handle("isAllowedToSyncDirectory", async (_, path: string) => {
			try {
				const normalizedPath = pathModule.normalize(path)

				for (const disallowedDir of DISALLOWED_SYNC_DIRS) {
					if (normalizedPath.startsWith(pathModule.normalize(disallowedDir) + pathModule.sep)) {
						return false
					}
				}

				if (normalizedPath.startsWith(os.tmpdir())) {
					return false
				}

				// if (process.platform === "win32" && normalizedPath.startsWith("\\")) {
				// 	return false
				// }

				const stat = await fs.lstat(path)

				if (
					!stat.isDirectory() ||
					stat.isSymbolicLink() ||
					stat.isFile() ||
					stat.isBlockDevice() ||
					stat.isCharacterDevice() ||
					stat.isFIFO() ||
					stat.isSocket()
				) {
					return false
				}

				return true
			} catch {
				return false
			}
		})
	}
}

export default IPC
