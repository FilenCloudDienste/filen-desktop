import { parentPort, isMainThread } from "worker_threads"
import { type FilenDesktopConfig, type WorkerMessage, type WorkerInvokeChannel } from "../types"
import { serializeError, getLocalDirectorySize } from "../utils"
import fs from "fs-extra"
import Sync from "./sync"
import FilenSDK from "@filen/sdk"
import { Semaphore } from "../semaphore"
import Logger from "../lib/logger"
import HTTP from "./http"

export class Worker {
	public desktopConfig: FilenDesktopConfig | null = null
	private sync: Sync
	private http: HTTP
	private sdk: FilenSDK | null = null
	private readonly sdkMutex = new Semaphore(1)
	public readonly logger: Logger

	public constructor() {
		if (isMainThread || !parentPort) {
			throw new Error("Not running inside a worker thread.")
		}

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
			if (
				this.desktopConfig &&
				this.desktopConfig.sdkConfig.apiKey &&
				this.desktopConfig.sdkConfig.apiKey.length > 32 &&
				this.desktopConfig.sdkConfig.apiKey !== "anonymous"
			) {
				resolve(this.desktopConfig)

				return
			}

			const wait = setInterval(() => {
				if (
					this.desktopConfig &&
					this.desktopConfig.sdkConfig.apiKey &&
					this.desktopConfig.sdkConfig.apiKey.length > 32 &&
					this.desktopConfig.sdkConfig.apiKey !== "anonymous"
				) {
					clearInterval(wait)

					resolve(this.desktopConfig)
				}
			}, 100)
		})
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
				} else if (message.data.channel === "isSyncActive") {
					this.invokeResponse(message.data.id, message.data.channel, this.sync.active)
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

						await this.sync.sync.updateIgnorerContent(uuid, content)
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
				} else if (message.data.channel === "syncUpdateRequireConfirmationOnLargeDeletions") {
					try {
						if (this.sync.active && this.sync.sync) {
							const { uuid, requireConfirmationOnLargeDeletion } = message.data.data

							this.sync.sync.updateRequireConfirmationOnLargeDeletion(uuid, requireConfirmationOnLargeDeletion)
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
				} else if (message.data.channel === "syncUpdateConfirmDeletion") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, result } = message.data.data

						this.sync.sync.confirmDeletion(uuid, result)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else {
					this.invokeError(message.data.id, message.data.channel, new Error(`Channel ${message.data.channel} not found.`))
				}
			}
		})
	}

	public async stop(): Promise<void> {
		// Network drive, S3 and WebDAV now live in the main-thread RcloneManager; sync and http are torn down automatically when the worker thread terminates.
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
