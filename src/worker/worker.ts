import { parentPort, isMainThread } from "worker_threads"
import { type FilenDesktopConfig, type WorkerMessage, type WorkerInvokeChannel } from "../types"
import WebDAV from "./webdav"
import S3 from "./s3"
import NetworkDrive from "./networkDrive"
import diskusage from "diskusage-ng"
import { serializeError, getLocalDirectorySize } from "../utils"
import pathModule from "path"
import fs from "fs-extra"
import Sync from "./sync"
import FilenSDK from "@filen/sdk"
import { Semaphore } from "../semaphore"
import Logger from "../lib/logger"
import HTTP from "./http"

export class Worker {
	public desktopConfig: FilenDesktopConfig | null = null
	private webdav: WebDAV
	private s3: S3
	private networkDrive: NetworkDrive
	private sync: Sync
	private http: HTTP
	private sdk: FilenSDK | null = null
	private readonly sdkMutex = new Semaphore(1)
	public readonly logger: Logger

	public constructor() {
		if (isMainThread || !parentPort) {
			throw new Error("Not running inside a worker thread.")
		}

		this.webdav = new WebDAV(this)
		this.s3 = new S3(this)
		this.networkDrive = new NetworkDrive(this)
		this.sync = new Sync(this)
		this.http = new HTTP(this)
		this.logger = new Logger(false, true)
	}

	public async getSDKInstance(): Promise<FilenSDK> {
		if (this.sdk) {
			return this.sdk
		}

		await this.sdkMutex.acquire()

		try {
			const desktopConfig = await this.waitForConfig()

			this.sdk = new FilenSDK({
				...desktopConfig.sdkConfig,
				connectToSocket: true,
				metadataCache: true
			})

			return this.sdk
		} finally {
			this.sdkMutex.release()
		}
	}

	public async waitForConfig(): Promise<FilenDesktopConfig> {
		return new Promise<FilenDesktopConfig>(resolve => {
			if (this.desktopConfig && this.desktopConfig.sdkConfig.apiKey && this.desktopConfig.sdkConfig.apiKey.length > 32) {
				resolve(this.desktopConfig)

				return
			}

			const wait = setInterval(() => {
				if (this.desktopConfig && this.desktopConfig.sdkConfig.apiKey && this.desktopConfig.sdkConfig.apiKey.length > 32) {
					clearInterval(wait)

					resolve(this.desktopConfig)
				}
			}, 100)
		})
	}

	public isAuthed(): boolean {
		if (!this.desktopConfig) {
			return false
		}

		return this.desktopConfig.sdkConfig.apiKey && this.desktopConfig.sdkConfig.apiKey.length > 32 ? true : false
	}

	public async networkDriveAvailableCacheSize(): Promise<number> {
		const desktopConfig = await this.waitForConfig()
		const cachePath = desktopConfig.networkDriveConfig.cachePath
			? pathModule.join(desktopConfig.networkDriveConfig.cachePath, "filenCache")
			: pathModule.join(desktopConfig.networkDriveConfig.localDirPath, "cache")

		await fs.ensureDir(cachePath)

		return await new Promise<number>((resolve, reject) => {
			diskusage(cachePath, (err, usage) => {
				if (err) {
					reject(err)

					return
				}

				resolve(usage.available)
			})
		})
	}

	public async networkDriveCacheSize(): Promise<number> {
		const desktopConfig = await this.waitForConfig()
		const cachePath = desktopConfig.networkDriveConfig.cachePath
			? pathModule.join(desktopConfig.networkDriveConfig.cachePath, "filenCache", "vfs")
			: pathModule.join(desktopConfig.networkDriveConfig.localDirPath, "cache", "vfs")

		if (!(await fs.exists(cachePath))) {
			return 0
		}

		const dir = await getLocalDirectorySize(cachePath)

		return dir.size
	}

	public async networkDriveCleanupLocalDir(): Promise<void> {
		const desktopConfig = await this.waitForConfig()

		await fs.rm(desktopConfig.networkDriveConfig.localDirPath, {
			force: true,
			maxRetries: 60 * 10,
			recursive: true,
			retryDelay: 100
		})

		await fs.ensureDir(desktopConfig.networkDriveConfig.localDirPath)
	}

	public async networkDriveCleanupCache(): Promise<void> {
		const desktopConfig = await this.waitForConfig()
		const cachePath = desktopConfig.networkDriveConfig.cachePath
			? pathModule.join(desktopConfig.networkDriveConfig.cachePath, "filenCache")
			: pathModule.join(desktopConfig.networkDriveConfig.localDirPath, "cache")

		await fs.rm(cachePath, {
			force: true,
			maxRetries: 60 * 10,
			recursive: true,
			retryDelay: 100
		})

		await fs.ensureDir(cachePath)
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public invokeResponse(id: number, channel: WorkerInvokeChannel, result?: any): void {
		parentPort?.postMessage({
			type: "invokeResponse",
			data: {
				id,
				channel,
				result: typeof result === "undefined" ? null : result
			}
		} satisfies WorkerMessage)
	}

	public invokeError(id: number, channel: WorkerInvokeChannel, err: Error): void {
		parentPort?.postMessage({
			type: "invokeError",
			data: {
				id,
				channel,
				error: serializeError(err)
			}
		} satisfies WorkerMessage)
	}

	public async start(): Promise<void> {
		parentPort?.on("message", async (message: WorkerMessage) => {
			if (message.type === "invokeRequest") {
				if (message.data.channel === "setConfig") {
					this.desktopConfig = message.data.data as FilenDesktopConfig

					if (this.sync.active && this.sync.sync) {
						await this.sync.sync.updateSyncPairs(this.desktopConfig.syncConfig.syncPairs)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "stop") {
					await this.stop()

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "startNetworkDrive" || message.data.channel === "restartNetworkDrive") {
					try {
						await this.networkDrive.stop()
						await this.networkDrive.start()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "stopNetworkDrive") {
					try {
						await this.networkDrive.stop()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "startS3" || message.data.channel === "restartS3") {
					try {
						await this.s3.stop()
						await this.s3.start()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "stopS3") {
					try {
						await this.s3.stop()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "startWebDAV" || message.data.channel === "restartWebDAV") {
					try {
						await this.webdav.stop()
						await this.webdav.start()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "stopWebDAV") {
					try {
						await this.webdav.stop()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "networkDriveAvailableCacheSize") {
					try {
						const size = await this.networkDriveAvailableCacheSize()

						this.invokeResponse(message.data.id, message.data.channel, size)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "networkDriveStats") {
					try {
						if (!this.networkDrive.networkDrive) {
							this.invokeResponse(message.data.id, message.data.channel, {
								uploadsInProgress: 0,
								uploadsQueued: 0,
								erroredFiles: 0,
								transfers: []
							})
						} else {
							const stats = await this.networkDrive.networkDrive.getStats()

							this.invokeResponse(message.data.id, message.data.channel, stats)
						}
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "networkDriveCacheSize") {
					try {
						const size = await this.networkDriveCacheSize()

						this.invokeResponse(message.data.id, message.data.channel, size)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "networkDriveCleanupCache") {
					try {
						await this.networkDriveCleanupCache()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "networkDriveCleanupLocalDir") {
					try {
						await this.networkDriveCleanupCache()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "startSync" || message.data.channel === "restartSync") {
					try {
						await this.sync.stop()
						await this.sync.start()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "stopSync") {
					try {
						await this.sync.stop()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "isS3Active") {
					this.invokeResponse(message.data.id, message.data.channel, this.s3.active)
				} else if (message.data.channel === "isWebDAVActive") {
					this.invokeResponse(message.data.id, message.data.channel, this.webdav.active)
				} else if (message.data.channel === "isSyncActive") {
					this.invokeResponse(message.data.id, message.data.channel, this.sync.active)
				} else if (message.data.channel === "isNetworkDriveActive") {
					this.invokeResponse(message.data.id, message.data.channel, this.networkDrive.active)
				} else if (message.data.channel === "syncResetCache") {
					if (this.sync.active && this.sync.sync) {
						const { uuid } = message.data.data

						this.sync.sync.resetCache(uuid)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncUpdateExcludeDotFiles") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, excludeDotFiles } = message.data.data

						this.sync.sync.updateExcludeDotFiles(uuid, excludeDotFiles)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncUpdateIgnorerContent") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, content } = message.data.data

						this.sync.sync.updateIgnorerContent(uuid, content)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncFetchIgnorerContent") {
					if (this.sync.active && this.sync.sync) {
						const { uuid } = message.data.data

						try {
							const content = await this.sync.sync.fetchIgnorerContent(uuid)

							this.invokeResponse(message.data.id, message.data.channel, content)
						} catch (e) {
							this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
						}
					} else {
						this.invokeError(message.data.id, message.data.channel, new Error("Sync not active or not found."))
					}
				} else if (message.data.channel === "syncUpdateMode") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, mode } = message.data.data

						this.sync.sync.updateMode(uuid, mode)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncUpdatePaused") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, paused } = message.data.data

						this.sync.sync.updatePaused(uuid, paused)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncUpdateRemoved") {
					try {
						if (this.sync.active && this.sync.sync) {
							const { uuid, removed } = message.data.data

							await this.sync.sync.updateRemoved(uuid, removed)
						}

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "syncPauseTransfer") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, relativePath, type } = message.data.data

						this.sync.sync.pauseTransfer(uuid, type, relativePath)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncResumeTransfer") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, relativePath, type } = message.data.data

						this.sync.sync.resumeTransfer(uuid, type, relativePath)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncStopTransfer") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, relativePath, type } = message.data.data

						this.sync.sync.stopTransfer(uuid, type, relativePath)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncResetTaskErrors") {
					if (this.sync.active && this.sync.sync) {
						const { uuid } = message.data.data

						this.sync.sync.resetTaskErrors(uuid)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncResetLocalTreeErrors") {
					if (this.sync.active && this.sync.sync) {
						const { uuid } = message.data.data

						this.sync.sync.resetLocalTreeErrors(uuid)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "syncUpdatePairs") {
					try {
						if (this.sync.active && this.sync.sync) {
							const { pairs } = message.data.data

							await this.sync.sync.updateSyncPairs(pairs)
						}

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "syncToggleLocalTrash") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, enabled } = message.data.data

						this.sync.sync.toggleLocalTrash(uuid, enabled)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else if (message.data.channel === "startHTTP" || message.data.channel === "restartHTTP") {
					try {
						await this.http.stop(true)
						await this.http.start()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "stopHTTP") {
					try {
						await this.http.stop(true)

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "isHTTPActive") {
					this.invokeResponse(message.data.id, message.data.channel, this.http.active)
				} else if (message.data.channel === "getLocalDirectoryItemCount") {
					try {
						const path = message.data.data
						const canRead = await new Promise<boolean>(resolve =>
							fs.access(path, fs.constants.R_OK, err => resolve(err ? false : true))
						)

						if (!canRead) {
							throw new Error(`Cannot read at path ${path}.`)
						}

						const dir = await getLocalDirectorySize(path)

						this.invokeResponse(message.data.id, message.data.channel, dir.items)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else {
					this.invokeError(message.data.id, message.data.channel, new Error(`Channel ${message.data.channel} not found.`))
				}
			}
		})
	}

	public async stop(): Promise<void> {
		if (this.isAuthed()) {
			// We only need to cleanup the network drive rclone instance, everything else (webdav, s3, sync, http) gets killed automatically
			await this.networkDrive.stop()
		}
	}
}

new Worker()
	.start()
	.then(() => {
		parentPort?.postMessage({
			type: "started"
		} satisfies WorkerMessage)
	})
	.catch(err => {
		parentPort?.postMessage({
			type: "error",
			data: {
				error: err instanceof Error ? serializeError(err) : serializeError(new Error(JSON.stringify(err)))
			}
		} satisfies WorkerMessage)
	})

export default Worker
