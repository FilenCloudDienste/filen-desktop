import { ipcMain, app, dialog } from "electron"
import { type FilenDesktop } from ".."
import { type FilenSDKConfig, PauseSignal } from "@filen/sdk"
import { setSDKConfig } from "../config"
import { type DriveCloudItem } from "../types"
import { type DirDownloadType } from "@filen/sdk/dist/types/api/v3/dir/download"
import pathModule from "path"
import fs from "fs-extra"
import { v4 as uuidv4 } from "uuid"

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

export type IPCPauseResumeAbortSignalParams = {
	id: string
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

	/**
	 * Creates an instance of IPC.
	 * @date 3/13/2024 - 8:03:20 PM
	 *
	 * @constructor
	 * @public
	 * @param {{ desktop: FilenDesktop }} param0
	 * @param {FilenDesktop} param0.desktop
	 */
	public constructor({ desktop }: { desktop: FilenDesktop }) {
		this.desktop = desktop

		this.general()
		this.window()
		this.cloud()
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

		ipcMain.handle("initSDK", (_, config: FilenSDKConfig): void => {
			setSDKConfig(config)
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
}

export default IPC
