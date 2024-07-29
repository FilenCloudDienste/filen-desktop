import { Worker as WorkerThread } from "worker_threads"
import pathModule from "path"
import { waitForConfig } from "../config"
import { httpHealthCheck, checkIfMountExists } from "../utils"
import { app } from "electron"
import { type SyncMessage } from "@filen/sync/dist/types"
import type FilenDesktop from ".."

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

export class Worker {
	private worker: WorkerThread | null = null
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private invokes: Record<number, { resolve: (value: any | PromiseLike<any>) => void; reject: (err: Error) => void }> = {}
	private invokesId = 0
	private isQuittingApp = false
	private desktop: FilenDesktop
	public active: boolean = false

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop

		app.on("will-quit", async e => {
			if (this.isQuittingApp) {
				return
			}

			this.isQuittingApp = true

			try {
				e.preventDefault()

				console.log("will-quit")

				await this.stop()
			} catch {
				// Noop
			} finally {
				process.exit(0)
			}
		})
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public invoke<T>(channel: WorkerInvokeChannel, data?: any): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			if (!this.worker) {
				reject(new Error("Worker not online."))

				return
			}

			// Start worker if it's not online for some reason. Should start on client init.
			// eslint-disable-next-line no-extra-semi
			;(this.active ? Promise.resolve() : this.start())
				.then(() => {
					const id = this.invokesId++

					this.invokes[id] = {
						resolve,
						reject
					}

					console.log("invoke", channel)

					this.worker?.postMessage({
						type: "invokeRequest",
						data: {
							id,
							channel,
							data
						}
					} satisfies WorkerMessage)
				})
				.catch(reject)
		})
	}

	public async start(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			console.log("starting worker")

			this.worker = new WorkerThread(
				pathModule.join(__dirname, process.env.NODE_ENV === "production" ? "worker.js" : "worker.dev.js"),
				{
					resourceLimits: {
						maxOldGenerationSizeMb: 8192,
						maxYoungGenerationSizeMb: 8192
					}
				}
			)

			this.worker?.on("error", reject)

			if (process.env.NODE_ENV !== "production") {
				this.worker?.stderr.on("data", chunk => {
					console.log("worker stderr", chunk.toString("utf-8"))
				})

				this.worker?.stdout.on("data", chunk => {
					console.log("worker stdout", chunk.toString("utf-8"))
				})
			}

			this.worker?.on("message", async (message: WorkerMessage) => {
				if (message.type === "error") {
					console.error(deserializeError(message.data.error))

					reject(deserializeError(message.data.error))
				} else if (message.type === "started") {
					console.log("worker started")

					resolve()
				} else if (message.type === "invokeResponse") {
					console.log("invokeResponse", message.data.channel, message.data.result)

					if (this.invokes[message.data.id]) {
						this.invokes[message.data.id]!.resolve(message.data.result)

						delete this.invokes[message.data.id]
					}
				} else if (message.type === "invokeError") {
					console.log("invokeErr", message.data.channel, deserializeError(message.data.error))

					if (this.invokes[message.data.id]) {
						this.invokes[message.data.id]!.reject(deserializeError(message.data.error))

						delete this.invokes[message.data.id]
					}
				} else if (message.type === "sync") {
					//console.log("syncMsg", message.data.type)

					this.desktop.ipc.postMainToWindowMessage({
						type: "sync",
						message: message.data
					})
				}
			})
		})

		this.active = true
	}

	public async stop(): Promise<void> {
		if (!this.worker) {
			this.active = false

			return
		}

		console.log("stopping worker")

		await this.invoke("stop")
		await this.worker.terminate()

		this.worker = null
		this.active = false
	}

	public async isWebDAVOnline(): Promise<boolean> {
		const desktopConfig = await waitForConfig()

		return await httpHealthCheck({
			url: `http${desktopConfig.webdavConfig.https ? "s" : ""}://${desktopConfig.webdavConfig.hostname}:${
				desktopConfig.webdavConfig.port
			}`,
			method: "GET",
			expectedStatusCode: 401
		})
	}

	public async isS3Online(): Promise<boolean> {
		const desktopConfig = await waitForConfig()

		return await httpHealthCheck({
			url: `http${desktopConfig.s3Config.https ? "s" : ""}://${desktopConfig.s3Config.hostname}:${desktopConfig.s3Config.port}`,
			method: "GET",
			expectedStatusCode: 400
		})
	}

	public async isVirtualDriveMounted(): Promise<boolean> {
		const desktopConfig = await waitForConfig()

		return await checkIfMountExists(desktopConfig.virtualDriveConfig.mountPoint)
	}
}

export type SerializedError = {
	name: string
	message: string
	stack?: string
	stringified: string
}

export function serializeError(error: Error): SerializedError {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		stringified: JSON.stringify(error)
	}
}

export function deserializeError(serializedError: SerializedError): Error {
	const error = new Error(serializedError.message)

	error.name = serializedError.name
	error.stack = serializedError.stack

	return error
}

export default Worker
