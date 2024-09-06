/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { type CloudItem, type CloudItemShared, type FilenSDKConfig } from "@filen/sdk"
import { type SyncPair, type SyncMessage as SyncSyncMessage } from "@filen/sync/dist/types"
import { type SerializedError } from "./utils"

export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never

export type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

export type DriveCloudItem = Prettify<
	CloudItem &
		CloudItemShared & {
			selected: boolean
		}
>

export type DriveCloudItemWithPath = Prettify<DriveCloudItem & { path: string }>

export type FilenDesktopConfig = {
	sdkConfig: FilenSDKConfig
	webdavConfig: {
		enabled: boolean
		username: string
		password: string
		hostname: string
		port: number
		proxyMode: boolean
		https: boolean
		authMode: "basic" | "digest"
	}
	s3Config: {
		enabled: boolean
		accessKeyId: string
		secretKeyId: string
		hostname: string
		port: number
		https: boolean
	}
	virtualDriveConfig: {
		enabled: boolean
		mountPoint: string
		localDirPath: string
		cacheSizeInGi: number
		cachePath?: string
		readOnly: boolean
	}
	syncConfig: {
		enabled: boolean
		syncPairs: SyncPair[]
		dbPath: string
	}
}

export type SyncMessage = SyncSyncMessage

export type WorkerInvokeChannel =
	| "startVirtualDrive"
	| "stopVirtualDrive"
	| "restartVirtualDrive"
	| "startS3"
	| "stopS3"
	| "restartS3"
	| "startWebDAV"
	| "stopWebDAV"
	| "restartWebDAV"
	| "setConfig"
	| "stop"
	| "virtualDriveAvailableCacheSize"
	| "virtualDriveCacheSize"
	| "virtualDriveCleanupLocalDir"
	| "virtualDriveCleanupCache"
	| "startSync"
	| "stopSync"
	| "restartSync"
	| "isS3Active"
	| "isWebDAVActive"
	| "isSyncActive"
	| "isVirtualDriveActive"
	| "syncUpdateRemoved"
	| "syncUpdatePaused"
	| "syncUpdateIgnorerContent"
	| "syncFetchIgnorerContent"
	| "syncUpdateExcludeDotFiles"
	| "syncUpdateMode"
	| "syncResetCache"
	| "syncStopTransfer"
	| "syncPauseTransfer"
	| "syncResumeTransfer"
	| "syncResetTaskErrors"
	| "syncToggleLocalTrash"
	| "syncResetLocalTreeErrors"
	| "restartHTTP"
	| "startHTTP"
	| "isHTTPActive"
	| "stopHTTP"
	| "virtualDriveStats"
	| "syncUpdatePairs"

export type WorkerMessage =
	| {
			type: "error"
			data: {
				error: SerializedError
			}
	  }
	| {
			type: "started"
	  }
	| {
			type: "invokeRequest"
			data: {
				id: number
				channel: WorkerInvokeChannel
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				data?: any
			}
	  }
	| {
			type: "invokeResponse"
			data: {
				id: number
				channel: WorkerInvokeChannel
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				result?: any
			}
	  }
	| {
			type: "invokeError"
			data: {
				id: number
				channel: WorkerInvokeChannel
				error: SerializedError
			}
	  }
	| {
			type: "sync"
			data: SyncMessage
	  }
