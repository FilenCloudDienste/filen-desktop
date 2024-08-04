import { parentPort, isMainThread } from "worker_threads"
import { type FilenDesktopConfig, type WorkerMessage, type WorkerInvokeChannel } from "../types"
import WebDAV from "./webdav"
import S3 from "./s3"
import VirtualDrive from "./virtualDrive"
import diskusage from "diskusage-ng"
import { promiseAllChunked, serializeError } from "../utils"
import pathModule from "path"
import fs from "fs-extra"
import Sync from "./sync"

export class Worker {
	public desktopConfig: FilenDesktopConfig | null = null
	private webdav: WebDAV
	private s3: S3
	private virtualDrive: VirtualDrive
	private sync: Sync

	public constructor() {
		if (isMainThread || !parentPort) {
			throw new Error("Not running inside a worker thread.")
		}

		this.webdav = new WebDAV(this)
		this.s3 = new S3(this)
		this.virtualDrive = new VirtualDrive(this)
		this.sync = new Sync(this)
	}

	public async waitForConfig(): Promise<FilenDesktopConfig> {
		return new Promise<FilenDesktopConfig>(resolve => {
			if (this.desktopConfig) {
				resolve(this.desktopConfig)

				return
			}

			const wait = setInterval(() => {
				if (this.desktopConfig) {
					clearInterval(wait)

					resolve(this.desktopConfig)
				}
			}, 100)
		})
	}

	public async virtualDriveAvailableCacheSize(): Promise<number> {
		const desktopConfig = await this.waitForConfig()

		return await new Promise<number>((resolve, reject) => {
			diskusage(desktopConfig.virtualDriveConfig.localDirPath, (err, usage) => {
				if (err) {
					reject(err)

					return
				}

				resolve(usage.available)
			})
		})
	}

	public async virtualDriveCacheSize(): Promise<number> {
		const desktopConfig = await this.waitForConfig()

		await fs.ensureDir(pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "cache"))

		const dir = await fs.readdir(pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "cache"), {
			recursive: true,
			encoding: "utf-8"
		})
		let total = 0

		await promiseAllChunked(
			dir.map(async entry => {
				try {
					const stat = await fs.stat(pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "cache", entry))

					if (stat.isFile()) {
						total += stat.size
					}
				} catch {
					// Noop
				}
			})
		)

		return total
	}

	public async virtualDriveCleanupLocalDir(): Promise<void> {
		const desktopConfig = await this.waitForConfig()

		await fs.emptyDir(desktopConfig.virtualDriveConfig.localDirPath)
	}

	public async virtualDriveCleanupCache(): Promise<void> {
		const desktopConfig = await this.waitForConfig()

		await fs.emptyDir(pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "cache"))
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
				} else if (message.data.channel === "startVirtualDrive" || message.data.channel === "restartVirtualDrive") {
					try {
						await this.virtualDrive.stop()
						await this.virtualDrive.start()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "stopVirtualDrive") {
					try {
						await this.virtualDrive.stop()

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
				} else if (message.data.channel === "virtualDriveAvailableCacheSize") {
					try {
						const size = await this.virtualDriveAvailableCacheSize()

						this.invokeResponse(message.data.id, message.data.channel, size)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "virtualDriveCacheSize") {
					try {
						const size = await this.virtualDriveCacheSize()

						this.invokeResponse(message.data.id, message.data.channel, size)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "virtualDriveCleanupCache") {
					try {
						await this.virtualDriveCleanupCache()

						this.invokeResponse(message.data.id, message.data.channel)
					} catch (e) {
						this.invokeError(message.data.id, message.data.channel, e instanceof Error ? e : new Error(JSON.stringify(e)))
					}
				} else if (message.data.channel === "virtualDriveCleanupLocalDir") {
					try {
						await this.virtualDriveCleanupCache()

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
				} else if (message.data.channel === "isVirtualDriveActive") {
					this.invokeResponse(message.data.id, message.data.channel, this.virtualDrive.active)
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
					if (this.sync.active && this.sync.sync) {
						const { uuid, removed } = message.data.data

						this.sync.sync.updateRemoved(uuid, removed)
					}

					this.invokeResponse(message.data.id, message.data.channel)
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
				} else if (message.data.channel === "syncToggleLocalTrash") {
					if (this.sync.active && this.sync.sync) {
						const { uuid, enabled } = message.data.data

						this.sync.sync.toggleLocalTrash(uuid, enabled)
					}

					this.invokeResponse(message.data.id, message.data.channel)
				} else {
					this.invokeError(message.data.id, message.data.channel, new Error(`Channel ${message.data.channel} not found.`))
				}
			}
		})
	}

	public async stop(): Promise<void> {
		// We only need to cleanup the virtual drive rclone instance, everything else (webdav, s3, sync) gets killed automatically
		await this.virtualDrive.stop()
	}
}

const worker = new Worker()

worker
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
