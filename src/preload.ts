import { contextBridge, ipcRenderer, type LoginItemSettings } from "electron"
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
import { type SyncMode, type SyncPair } from "@filen/sync/dist/types"
import { type DriveInfo } from "./utils"
import { type GetStats } from "@filen/network-drive/dist/types"

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
	unmaximizeWindow: () => Promise<void>
	isWindowMaximized: () => Promise<boolean>
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
	startS3Server: () => Promise<void>
	stopS3Server: () => Promise<void>
	restartS3Server: () => Promise<void>
	startNetworkDrive: () => Promise<void>
	stopNetworkDrive: () => Promise<void>
	restartNetworkDrive: () => Promise<void>
	getExistingDrives: () => Promise<string[]>
	isPortInUse: (port: number) => Promise<boolean>
	getAvailableDrives: () => Promise<string[]>
	openLocalPath: (path: string) => Promise<void>
	networkDriveAvailableCache: () => Promise<number>
	networkDriveCacheSize: () => Promise<number>
	networkDriveCleanupCache: () => Promise<void>
	networkDriveCleanupLocalDir: () => Promise<void>
	canStartServerOnIPAndPort: (params: IPCCanStartServerOnIPAndPort) => Promise<boolean>
	osPlatform: () => typeof process.platform
	osArch: () => typeof process.arch
	selectDirectory: (multiple?: boolean) => Promise<IPCSelectDirectoryResult>
	isUnixMountPointValid: (path: string) => Promise<boolean>
	startSync: () => Promise<void>
	stopSync: () => Promise<void>
	restartSync: () => Promise<void>
	isPathWritable: (path: string) => Promise<boolean>
	isPathReadable: (path: string) => Promise<boolean>
	isWebDAVOnline: () => Promise<boolean>
	isS3Online: () => Promise<boolean>
	isNetworkDriveMounted: () => Promise<boolean>
	isNetworkDriveActive: () => Promise<boolean>
	isWebDAVActive: () => Promise<boolean>
	isS3Active: () => Promise<boolean>
	isSyncActive: () => Promise<boolean>
	isWorkerActive: () => Promise<boolean>
	syncUpdateExcludeDotFiles: (params: { uuid: string; excludeDotFiles: boolean }) => Promise<void>
	syncUpdateMode: (params: { uuid: string; mode: SyncMode }) => Promise<void>
	syncUpdatePaused: (params: { uuid: string; paused: boolean }) => Promise<void>
	syncUpdateRemoved: (params: { uuid: string; removed: boolean }) => Promise<void>
	syncResetCache: (params: { uuid: string }) => Promise<void>
	syncStopTransfer: (params: { uuid: string; type: "upload" | "download"; relativePath: string }) => Promise<void>
	syncPauseTransfer: (params: { uuid: string; type: "upload" | "download"; relativePath: string }) => Promise<void>
	syncResumeTransfer: (params: { uuid: string; type: "upload" | "download"; relativePath: string }) => Promise<void>
	syncFetchIgnorerContent: (params: { uuid: string }) => Promise<string>
	syncUpdateIgnorerContent: (params: { uuid: string; content: string }) => Promise<void>
	syncUpdateRequireConfirmationOnLargeDeletions: (params: { uuid: string; requireConfirmationOnLargeDeletions: boolean }) => Promise<void>
	syncToggleLocalTrash: (params: { uuid: string; enabled: boolean }) => Promise<void>
	updateNotificationCount: (count: number) => Promise<void>
	updateErrorCount: (count: number) => Promise<void>
	updateWarningCount: (count: number) => Promise<void>
	updateIsSyncing: (isSyncing: boolean) => Promise<void>
	toggleAutoLaunch: (enabled: boolean) => Promise<void>
	installUpdate: () => Promise<void>
	isWinFSPInstalled: () => Promise<boolean>
	isUnixMountPointEmpty: (path: string) => Promise<boolean>
	syncResetTaskErrors: (params: { uuid: string }) => Promise<void>
	syncResetLocalTreeErrors: (params: { uuid: string }) => Promise<void>
	isAllowedToSyncDirectory: (path: string) => Promise<boolean>
	doesPathStartWithHomeDir: (path: string) => Promise<boolean>
	exportLogs: () => Promise<void>
	version: () => Promise<string>
	restartWorker: () => Promise<void>
	getLocalDirectoryItemCount: (path: string) => Promise<number>
	getAutoLaunch: () => Promise<LoginItemSettings>
	isFUSE3InstalledOnLinux: () => Promise<boolean>
	getDiskType: (path: string) => Promise<DriveInfo | null>
	networkDriveStats: () => Promise<GetStats>
	syncUpdatePairs: (params: { pairs: SyncPair[] }) => Promise<void>
	isFUSETInstalledOnMacOS: () => Promise<boolean>
	tryingToSyncDesktop: (path: string) => Promise<boolean>
	isPathSyncedByICloud: (path: string) => Promise<boolean>
	setMinimizeToTray: (minimizeToTray: boolean) => Promise<void>
	setStartMinimized: (startMinimized: boolean) => Promise<void>
	syncUpdateConfirmDeletion: (params: { uuid: string; result: "delete" | "restart" }) => Promise<void>
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
		unmaximizeWindow: () => ipcRenderer.invoke("unmaximizeWindow"),
		isWindowMaximized: () => ipcRenderer.invoke("isWindowMaximized"),
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
		startS3Server: () => ipcRenderer.invoke("startS3Server"),
		stopS3Server: () => ipcRenderer.invoke("stopS3Server"),
		restartS3Server: () => ipcRenderer.invoke("restartS3Server"),
		startNetworkDrive: () => ipcRenderer.invoke("startNetworkDrive"),
		stopNetworkDrive: () => ipcRenderer.invoke("stopNetworkDrive"),
		restartNetworkDrive: () => ipcRenderer.invoke("restartNetworkDrive"),
		getExistingDrives: () => ipcRenderer.invoke("getExistingDrives"),
		isPortInUse: port => ipcRenderer.invoke("isPortInUse", port),
		getAvailableDrives: () => ipcRenderer.invoke("getAvailableDrives"),
		openLocalPath: path => ipcRenderer.invoke("openLocalPath", path),
		networkDriveAvailableCache: () => ipcRenderer.invoke("networkDriveAvailableCache"),
		networkDriveCacheSize: () => ipcRenderer.invoke("networkDriveCacheSize"),
		networkDriveCleanupCache: () => ipcRenderer.invoke("networkDriveCleanupCache"),
		networkDriveCleanupLocalDir: () => ipcRenderer.invoke("networkDriveCleanupLocalDir"),
		canStartServerOnIPAndPort: params => ipcRenderer.invoke("canStartServerOnIPAndPort", params),
		osPlatform: () => process.platform,
		osArch: () => process.arch,
		selectDirectory: multiple => ipcRenderer.invoke("selectDirectory", multiple),
		isUnixMountPointValid: path => ipcRenderer.invoke("isUnixMountPointValid", path),
		startSync: () => ipcRenderer.invoke("startSync"),
		stopSync: () => ipcRenderer.invoke("stopSync"),
		restartSync: () => ipcRenderer.invoke("restartSync"),
		isPathWritable: path => ipcRenderer.invoke("isPathWritable", path),
		isPathReadable: path => ipcRenderer.invoke("isPathReadable", path),
		isWebDAVOnline: () => ipcRenderer.invoke("isWebDAVOnline"),
		isS3Online: () => ipcRenderer.invoke("isS3Online"),
		isNetworkDriveMounted: () => ipcRenderer.invoke("isNetworkDriveMounted"),
		isNetworkDriveActive: () => ipcRenderer.invoke("isNetworkDriveActive"),
		isS3Active: () => ipcRenderer.invoke("isS3Active"),
		isWebDAVActive: () => ipcRenderer.invoke("isWebDAVActive"),
		isSyncActive: () => ipcRenderer.invoke("isSyncActive"),
		isWorkerActive: () => ipcRenderer.invoke("isWorkerActive"),
		syncResetCache: params => ipcRenderer.invoke("syncResetCache", params),
		syncUpdateExcludeDotFiles: params => ipcRenderer.invoke("syncUpdateExcludeDotFiles", params),
		syncUpdateMode: params => ipcRenderer.invoke("syncUpdateMode", params),
		syncUpdatePaused: params => ipcRenderer.invoke("syncUpdatePaused", params),
		syncUpdateRemoved: params => ipcRenderer.invoke("syncUpdateRemoved", params),
		syncPauseTransfer: params => ipcRenderer.invoke("syncPauseTransfer", params),
		syncResumeTransfer: params => ipcRenderer.invoke("syncResumeTransfer", params),
		syncStopTransfer: params => ipcRenderer.invoke("syncStopTransfer", params),
		syncUpdateIgnorerContent: params => ipcRenderer.invoke("syncUpdateIgnorerContent", params),
		syncFetchIgnorerContent: params => ipcRenderer.invoke("syncFetchIgnorerContent", params),
		updateNotificationCount: count => ipcRenderer.invoke("updateNotificationCount", count),
		updateErrorCount: count => ipcRenderer.invoke("updateErrorCount", count),
		updateWarningCount: count => ipcRenderer.invoke("updateWarningCount", count),
		updateIsSyncing: isSyncing => ipcRenderer.invoke("updateIsSyncing", isSyncing),
		toggleAutoLaunch: enabled => ipcRenderer.invoke("toggleAutoLaunch", enabled),
		installUpdate: () => ipcRenderer.invoke("installUpdate"),
		isWinFSPInstalled: () => ipcRenderer.invoke("isWinFSPInstalled"),
		isUnixMountPointEmpty: path => ipcRenderer.invoke("isUnixMountPointEmpty", path),
		syncResetTaskErrors: params => ipcRenderer.invoke("syncResetTaskErrors", params),
		syncResetLocalTreeErrors: params => ipcRenderer.invoke("syncResetLocalTreeErrors", params),
		syncToggleLocalTrash: params => ipcRenderer.invoke("syncToggleLocalTrash", params),
		isAllowedToSyncDirectory: path => ipcRenderer.invoke("isAllowedToSyncDirectory", path),
		doesPathStartWithHomeDir: path => ipcRenderer.invoke("doesPathStartWithHomeDir", path),
		exportLogs: () => ipcRenderer.invoke("exportLogs"),
		version: () => ipcRenderer.invoke("version"),
		restartWorker: () => ipcRenderer.invoke("restartWorker"),
		getLocalDirectoryItemCount: path => ipcRenderer.invoke("getLocalDirectoryItemCount", path),
		getAutoLaunch: () => ipcRenderer.invoke("getAutoLaunch"),
		isFUSE3InstalledOnLinux: () => ipcRenderer.invoke("isFUSE3InstalledOnLinux"),
		isFUSETInstalledOnMacOS: () => ipcRenderer.invoke("isFUSETInstalledOnMacOS"),
		getDiskType: path => ipcRenderer.invoke("getDiskType", path),
		networkDriveStats: () => ipcRenderer.invoke("networkDriveStats"),
		syncUpdatePairs: params => ipcRenderer.invoke("syncUpdatePairs", params),
		tryingToSyncDesktop: path => ipcRenderer.invoke("tryingToSyncDesktop", path),
		isPathSyncedByICloud: path => ipcRenderer.invoke("isPathSyncedByICloud", path),
		setMinimizeToTray: minimizeToTray => ipcRenderer.invoke("setMinimizeToTray", minimizeToTray),
		setStartMinimized: startMinimized => ipcRenderer.invoke("setStartMinimized", startMinimized),
		syncUpdateConfirmDeletion: params => ipcRenderer.invoke("syncUpdateConfirmDeletion", params),
		syncUpdateRequireConfirmationOnLargeDeletions: params => ipcRenderer.invoke("syncUpdateRequireConfirmationOnLargeDeletions", params)
	} satisfies DesktopAPI)
}
