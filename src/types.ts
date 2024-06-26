/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { type CloudItem, type CloudItemShared, type FilenSDKConfig } from "@filen/sdk"

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
		username: string
		password: string
		hostname: string
		port: number
		proxyMode: boolean
		https: boolean
		authMode: "basic" | "digest"
	}
	s3Config: {
		accessKeyId: string
		secretKeyId: string
		hostname: string
		port: number
		https: boolean
	}
	virtualDriveConfig: {
		mountPoint: string
		localDirPath: string
		cacheSizeInGi: number
	}
}
