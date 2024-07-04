import { ipcMain, app, dialog, shell } from "electron"
import { type FilenDesktop } from ".."
import { PauseSignal } from "@filen/sdk"
import { setConfig, waitForConfig } from "../config"
import { type DriveCloudItem, type FilenDesktopConfig } from "../types"
import { type DirDownloadType } from "@filen/sdk/dist/types/api/v3/dir/download"
import pathModule from "path"
import fs from "fs-extra"
import { v4 as uuidv4 } from "uuid"
import { getState, type State, setState } from "../state"
import { getExistingDrives, isPortInUse, getAvailableDriveLetters, canStartServerOnIPAndPort } from "../utils"
import { type SyncMessage } from "@filen/sync/dist/types"

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
			data: { uuid: string; name: string } & (
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
	private readonly postMainToWindowMessageProgressThrottle: Record<string, { next: number; storedBytes: number }> = {}
	private readonly pauseSignals: Record<string, PauseSignal> = {}
	private readonly abortControllers: Record<string, AbortController> = {}

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop

		this.general()
		this.window()
		this.cloud()
		this.webdav()
		this.state()
		this.s3()
		this.virtualDrive()
		this.sync()
	}

	/**
	 * Post a message to the main window.
	 * We have to throttle the "progress" events of the "download"/"upload" message type. The SDK sends too many events for the electron IPC to handle properly.
	 * It freezes the renderer process if we don't throttle it.
	 *
	 * @public
	 * @param {MainToWindowMessage} message
	 */
	public postMainToWindowMessage(message: MainToWindowMessage): void {
		if (!this.desktop.driveWindow) {
			return
		}

		const now = Date.now()
		let key = ""

		if (message.type === "download" || message.type === "upload") {
			if (message.data.type === "progress") {
				key = `${message.type}:${message.data.uuid}:${message.data.name}:${message.data.type}`

				if (!this.postMainToWindowMessageProgressThrottle[key]) {
					this.postMainToWindowMessageProgressThrottle[key] = {
						next: 0,
						storedBytes: 0
					}
				}

				this.postMainToWindowMessageProgressThrottle[key]!.storedBytes += message.data.bytes

				if (this.postMainToWindowMessageProgressThrottle[key]!.next > now) {
					return
				}

				message = {
					...message,
					data: {
						...message.data,
						bytes: this.postMainToWindowMessageProgressThrottle[key]!.storedBytes
					}
				}
			}
		}

		this.desktop.driveWindow.webContents.postMessage("mainToWindowMessage", message)

		if (
			key.length > 0 &&
			this.postMainToWindowMessageProgressThrottle[key] &&
			(message.type === "download" || message.type === "upload")
		) {
			this.postMainToWindowMessageProgressThrottle[key]!.storedBytes = 0
			this.postMainToWindowMessageProgressThrottle[key]!.next = now + 100

			if (
				message.data.type === "error" ||
				message.data.type === "queued" ||
				message.data.type === "stopped" ||
				message.data.type === "finished"
			) {
				delete this.postMainToWindowMessageProgressThrottle[key]
			}
		}
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
		})

		ipcMain.handle("setConfig", (_, config: FilenDesktopConfig): void => {
			setConfig(config)
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

		ipcMain.handle("verifyUnixMountPath", async (_, path): Promise<boolean> => {
			try {
				await fs.access(path)

				const stat = await fs.stat(path)

				return (
					stat.isDirectory() &&
					!stat.isSymbolicLink() &&
					!stat.isBlockDevice() &&
					!stat.isCharacterDevice() &&
					!stat.isFIFO() &&
					!stat.isSocket()
				)
			} catch {
				return false
			}
		})

		ipcMain.handle("isPathWritable", async (_, path: string) => {
			return await this.desktop.lib.fs.isPathWritable(path)
		})

		ipcMain.handle("isPathReadable", async (_, path: string) => {
			return await this.desktop.lib.fs.isPathReadable(path)
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
				{ uuid, name, to, type, linkUUID, linkHasPassword, linkPassword, linkSalt }: IPCDownloadDirectoryParams
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
						abortSignal: this.abortControllers[uuid]!.signal
					})
				} catch (e) {
					if (e instanceof DOMException && e.name === "AbortError") {
						return ""
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
				{ items, to, type, linkUUID, linkHasPassword, linkPassword, linkSalt, name }: IPCDownloadMultipleFilesAndDirectoriesParams
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
						abortSignal: this.abortControllers[directoryId]!.signal
					})
				} catch (e) {
					if (e instanceof DOMException && e.name === "AbortError") {
						return ""
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
		ipcMain.handle("minimizeWindow", (): void => {
			this.desktop.driveWindow?.minimize()
		})

		ipcMain.handle("maximizeWindow", (): void => {
			this.desktop.driveWindow?.maximize()
		})

		ipcMain.handle("closeWindow", (): void => {
			this.desktop.driveWindow?.close()
		})

		ipcMain.handle("showWindow", (): void => {
			this.desktop.driveWindow?.show()
		})

		ipcMain.handle("hideWindow", (): void => {
			this.desktop.driveWindow?.hide()
		})
	}

	/**
	 * Handle all WebDAV related invocations.
	 *
	 * @private
	 */
	private webdav(): void {
		ipcMain.handle("startWebDAVServer", async () => {
			await waitForConfig()
			await this.desktop.webdav.start()
		})

		ipcMain.handle("stopWebDAVServer", async () => {
			await waitForConfig()
			await this.desktop.webdav.stop()
		})

		ipcMain.handle("restartWebDAVServer", async () => {
			await waitForConfig()
			await this.desktop.webdav.restart()
		})

		ipcMain.handle("isWebDAVActive", async () => {
			return this.desktop.webdav.instance() !== null
		})

		ipcMain.handle("isWebDAVOnline", async () => {
			return await this.desktop.webdav.isOnline()
		})
	}

	/**
	 * Handle all state related invocations.
	 *
	 * @private
	 */
	private state(): void {
		ipcMain.handle("setState", async (_, state: State) => {
			setState(state)
		})

		ipcMain.handle("getState", async () => {
			return getState()
		})
	}

	/**
	 * Handle all S3 related invocations.
	 *
	 * @private
	 */
	private s3(): void {
		ipcMain.handle("startS3Server", async () => {
			await waitForConfig()
			await this.desktop.s3.start()
		})

		ipcMain.handle("stopS3Server", async () => {
			await waitForConfig()
			await this.desktop.s3.stop()
		})

		ipcMain.handle("restartS3Server", async () => {
			await waitForConfig()
			await this.desktop.s3.restart()
		})

		ipcMain.handle("isS3Active", async () => {
			return this.desktop.s3.instance() !== null
		})

		ipcMain.handle("isS3Online", async () => {
			return await this.desktop.s3.isOnline()
		})
	}

	/**
	 * Handle all Virtual Drive related invocations.
	 *
	 * @private
	 */
	private virtualDrive(): void {
		ipcMain.handle("startVirtualDrive", async () => {
			await waitForConfig()
			await this.desktop.virtualDrive.start()
		})

		ipcMain.handle("stopVirtualDrive", async () => {
			await waitForConfig()
			await this.desktop.virtualDrive.stop()
		})

		ipcMain.handle("restartVirtualDrive", async () => {
			await waitForConfig()
			await this.desktop.virtualDrive.restart()
		})

		ipcMain.handle("isVirtualDriveMounted", async () => {
			return this.desktop.virtualDrive.isMounted()
		})

		ipcMain.handle("virtualDriveAvailableCache", async () => {
			return await this.desktop.virtualDrive.availableCacheSize()
		})

		ipcMain.handle("virtualDriveCacheSize", async () => {
			return await this.desktop.virtualDrive.cacheSize()
		})

		ipcMain.handle("virtualDriveCleanupCache", async () => {
			await this.desktop.virtualDrive.cleanupCache()
		})

		ipcMain.handle("virtualDriveCleanupLocalDir", async () => {
			await this.desktop.virtualDrive.cleanupLocalDir()
		})

		ipcMain.handle("isVirtualDriveActive", async () => {
			return this.desktop.virtualDrive.instance() !== null
		})
	}

	/**
	 * Handle all Sync related invocations.
	 *
	 * @private
	 */
	private sync(): void {
		ipcMain.handle("startSync", async () => {
			await waitForConfig()
			await this.desktop.sync.start()
		})

		ipcMain.handle("stopSync", async () => {
			await waitForConfig()
			await this.desktop.sync.stop()
		})

		ipcMain.handle("restartSync", async () => {
			await waitForConfig()
			await this.desktop.sync.restart()
		})

		ipcMain.handle("isSyncActive", async () => {
			return this.desktop.sync.instance() !== null
		})

		ipcMain.handle("forwardSyncMessage", async (_, message: SyncMessage) => {
			this.desktop.sync.instance()?.postMessage(message)
		})
	}
}

export default IPC
