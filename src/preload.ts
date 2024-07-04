import { contextBridge, ipcRenderer } from "electron"
import {
	type IPCDownloadFileParams,
	type IPCDownloadDirectoryParams,
	type IPCShowSaveDialogResult,
	type MainToWindowMessage,
	type IPCDownloadMultipleFilesAndDirectoriesParams,
	type IPCShowSaveDialogResultParams,
	type IPCPauseResumeAbortSignalParams,
	type IPCCanStartServerOnIPAndPort,
	type IPCSelectDirectoryResult
} from "./ipc"
import { type FilenDesktopConfig } from "./types"
import { type State } from "./state"
import { type SyncMessage } from "@filen/sync/dist/types"

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
	setConfig: (config: FilenDesktopConfig) => Promise<void>
	showWindow: () => Promise<void>
	hideWindow: () => Promise<void>
	downloadFile: (params: IPCDownloadFileParams) => Promise<string>
	downloadDirectory: (params: IPCDownloadDirectoryParams) => Promise<string>
	showSaveDialog: (params?: IPCShowSaveDialogResultParams) => Promise<IPCShowSaveDialogResult>
	downloadMultipleFilesAndDirectories: (params: IPCDownloadMultipleFilesAndDirectoriesParams) => Promise<string>
	pausePauseSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>
	resumePauseSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>
	abortAbortSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>
	startWebDAVServer: () => Promise<void>
	stopWebDAVServer: () => Promise<void>
	restartWebDAVServer: () => Promise<void>
	isWebDAVActive: () => Promise<boolean>
	setState: (params: State) => Promise<void>
	getState: () => Promise<State>
	startS3Server: () => Promise<void>
	stopS3Server: () => Promise<void>
	restartS3Server: () => Promise<void>
	isS3Active: () => Promise<boolean>
	startVirtualDrive: () => Promise<void>
	stopVirtualDrive: () => Promise<void>
	restartVirtualDrive: () => Promise<void>
	isVirtualDriveMounted: () => Promise<boolean>
	getExistingDrives: () => Promise<string[]>
	isPortInUse: (port: number) => Promise<boolean>
	getAvailableDrives: () => Promise<string[]>
	openLocalPath: (path: string) => Promise<void>
	virtualDriveAvailableCache: () => Promise<number>
	virtualDriveCacheSize: () => Promise<number>
	virtualDriveCleanupCache: () => Promise<void>
	virtualDriveCleanupLocalDir: () => Promise<void>
	isWebDAVOnline: () => Promise<boolean>
	isS3Online: () => Promise<boolean>
	isVirtualDriveActive: () => Promise<boolean>
	canStartServerOnIPAndPort: (params: IPCCanStartServerOnIPAndPort) => Promise<boolean>
	platform: () => typeof process.platform
	arch: () => typeof process.arch
	selectDirectory: (multiple?: boolean) => Promise<IPCSelectDirectoryResult>
	verifyUnixMountPath: (path: string) => Promise<boolean>
	startSync: () => Promise<void>
	stopSync: () => Promise<void>
	restartSync: () => Promise<void>
	isSyncActive: () => Promise<boolean>
	forwardSyncMessage: (message: SyncMessage) => Promise<void>
	isPathWritable: (path: string) => Promise<boolean>
	isPathReadable: (path: string) => Promise<boolean>
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
		setConfig: config => ipcRenderer.invoke("setConfig", config),
		showWindow: () => ipcRenderer.invoke("showWindow"),
		hideWindow: () => ipcRenderer.invoke("hideWindow"),
		downloadFile: params => ipcRenderer.invoke("downloadFile", params),
		downloadDirectory: params => ipcRenderer.invoke("downloadDirectory", params),
		showSaveDialog: params => ipcRenderer.invoke("showSaveDialog", params),
		downloadMultipleFilesAndDirectories: params => ipcRenderer.invoke("downloadMultipleFilesAndDirectories", params),
		pausePauseSignal: params => ipcRenderer.invoke("pausePauseSignal", params),
		resumePauseSignal: params => ipcRenderer.invoke("resumePauseSignal", params),
		abortAbortSignal: params => ipcRenderer.invoke("abortAbortSignal", params),
		startWebDAVServer: () => ipcRenderer.invoke("startWebDAVServer"),
		stopWebDAVServer: () => ipcRenderer.invoke("stopWebDAVServer"),
		restartWebDAVServer: () => ipcRenderer.invoke("restartWebDAVServer"),
		isWebDAVActive: () => ipcRenderer.invoke("isWebDAVActive"),
		setState: params => ipcRenderer.invoke("setState", params),
		getState: () => ipcRenderer.invoke("getState"),
		startS3Server: () => ipcRenderer.invoke("startS3Server"),
		stopS3Server: () => ipcRenderer.invoke("stopS3Server"),
		restartS3Server: () => ipcRenderer.invoke("restartS3Server"),
		isS3Active: () => ipcRenderer.invoke("isS3Active"),
		startVirtualDrive: () => ipcRenderer.invoke("startVirtualDrive"),
		stopVirtualDrive: () => ipcRenderer.invoke("stopVirtualDrive"),
		restartVirtualDrive: () => ipcRenderer.invoke("restartVirtualDrive"),
		isVirtualDriveMounted: () => ipcRenderer.invoke("isVirtualDriveMounted"),
		getExistingDrives: () => ipcRenderer.invoke("getExistingDrives"),
		isPortInUse: port => ipcRenderer.invoke("isPortInUse", port),
		getAvailableDrives: () => ipcRenderer.invoke("getAvailableDrives"),
		openLocalPath: path => ipcRenderer.invoke("openLocalPath", path),
		virtualDriveAvailableCache: () => ipcRenderer.invoke("virtualDriveAvailableCache"),
		virtualDriveCacheSize: () => ipcRenderer.invoke("virtualDriveCacheSize"),
		virtualDriveCleanupCache: () => ipcRenderer.invoke("virtualDriveCleanupCache"),
		virtualDriveCleanupLocalDir: () => ipcRenderer.invoke("virtualDriveCleanupLocalDir"),
		isWebDAVOnline: () => ipcRenderer.invoke("isWebDAVOnline"),
		isS3Online: () => ipcRenderer.invoke("isS3Online"),
		isVirtualDriveActive: () => ipcRenderer.invoke("isVirtualDriveActive"),
		canStartServerOnIPAndPort: params => ipcRenderer.invoke("canStartServerOnIPAndPort", params),
		platform: () => process.platform,
		arch: () => process.arch,
		selectDirectory: multiple => ipcRenderer.invoke("selectDirectory", multiple),
		verifyUnixMountPath: path => ipcRenderer.invoke("verifyUnixMountPath", path),
		startSync: () => ipcRenderer.invoke("startSync"),
		stopSync: () => ipcRenderer.invoke("stopSync"),
		restartSync: () => ipcRenderer.invoke("restartSync"),
		isSyncActive: () => ipcRenderer.invoke("isSyncActive"),
		forwardSyncMessage: message => ipcRenderer.invoke("forwardSyncMessage", message),
		isPathWritable: path => ipcRenderer.invoke("isPathWritable", path),
		isPathReadable: path => ipcRenderer.invoke("isPathReadable", path)
	} satisfies DesktopAPI)
}
