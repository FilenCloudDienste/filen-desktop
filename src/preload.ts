import { contextBridge, ipcRenderer } from "electron"
import { type FilenSDKConfig } from "@filen/sdk"
import {
	type IPCDownloadFileParams,
	type IPCDownloadDirectoryParams,
	type IPCShowSaveDialogResult,
	type MainToWindowMessage,
	type IPCDownloadMultipleFilesAndDirectoriesParams,
	type IPCShowSaveDialogResultParams,
	type IPCPauseResumeAbortSignalParams
} from "./ipc"

const env = {
	isBrowser:
		(typeof window !== "undefined" && typeof window.document !== "undefined") ||
		// @ts-expect-error WorkerEnv's are not typed
		(typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) ||
		// @ts-expect-error WorkerEnv's are not typed
		(typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope),
	isNode: typeof process !== "undefined" && process.versions !== null && process.versions.node !== null,
	isElectron: typeof process.versions["electron"] === "string" && process.versions["electron"].length > 0
} as const

export type DesktopAPI = {
	onMainToWindowMessage: (listener: (message: MainToWindowMessage) => void) => {
		remove: () => void
	}
	ping: () => Promise<string>
	minimizeWindow: () => Promise<void>
	maximizeWindow: () => Promise<void>
	closeWindow: () => Promise<void>
	restart: () => Promise<void>
	initSDK: (config: FilenSDKConfig) => Promise<void>
	showWindow: () => Promise<void>
	hideWindow: () => Promise<void>
	downloadFile: (params: IPCDownloadFileParams) => Promise<string>
	downloadDirectory: (params: IPCDownloadDirectoryParams) => Promise<string>
	showSaveDialog: (params?: IPCShowSaveDialogResultParams) => Promise<IPCShowSaveDialogResult>
	downloadMultipleFilesAndDirectories: (params: IPCDownloadMultipleFilesAndDirectoriesParams) => Promise<string>
	pausePauseSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>
	resumePauseSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>
	abortAbortSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>
}

if (env.isBrowser || env.isElectron) {
	contextBridge.exposeInMainWorld("desktopAPI", {
		onMainToWindowMessage: listener => {
			const listen = (_: Electron.IpcRendererEvent, message: MainToWindowMessage) => {
				listener(message)
			}

			ipcRenderer.addListener("mainToWindowMessage", listen)

			return {
				remove: () => {
					ipcRenderer.removeListener("mainToWindowMessage", listen)
				}
			}
		},
		ping: () => ipcRenderer.invoke("ping"),
		minimizeWindow: () => ipcRenderer.invoke("minimizeWindow"),
		maximizeWindow: () => ipcRenderer.invoke("maximizeWindow"),
		closeWindow: () => ipcRenderer.invoke("closeWindow"),
		restart: () => ipcRenderer.invoke("restart"),
		initSDK: config => ipcRenderer.invoke("initSDK", config),
		showWindow: () => ipcRenderer.invoke("showWindow"),
		hideWindow: () => ipcRenderer.invoke("hideWindow"),
		downloadFile: params => ipcRenderer.invoke("downloadFile", params),
		downloadDirectory: params => ipcRenderer.invoke("downloadDirectory", params),
		showSaveDialog: params => ipcRenderer.invoke("showSaveDialog", params),
		downloadMultipleFilesAndDirectories: params => ipcRenderer.invoke("downloadMultipleFilesAndDirectories", params),
		pausePauseSignal: params => ipcRenderer.invoke("pausePauseSignal", params),
		resumePauseSignal: params => ipcRenderer.invoke("resumePauseSignal", params),
		abortAbortSignal: params => ipcRenderer.invoke("abortAbortSignal", params)
	} satisfies DesktopAPI)
}
