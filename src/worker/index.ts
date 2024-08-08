import { Worker as WorkerThread } from "worker_threads"
import pathModule from "path"
import { waitForConfig } from "../config"
import { httpHealthCheck, checkIfMountExists, deserializeError } from "../utils"
import { app } from "electron"
import type FilenDesktop from ".."
import isDev from "../isDev"
import { type WorkerInvokeChannel, type WorkerMessage } from "../types"
import fs from "fs-extra"

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
			this.desktop.logger.log("info", "Starting worker")

			this.worker = new WorkerThread(pathModule.join(__dirname, !isDev ? "worker.js" : "worker.dev.js"), {
				resourceLimits: {
					maxOldGenerationSizeMb: 3584,
					maxYoungGenerationSizeMb: 512,
					codeRangeSizeMb: 512
				}
			})

			this.worker?.on("error", reject)

			if (isDev) {
				this.worker?.stderr.on("data", chunk => {
					console.log("worker stderr", chunk.toString("utf-8"))
				})

				this.worker?.stdout.on("data", chunk => {
					console.log("worker stdout", chunk.toString("utf-8"))
				})
			}

			this.worker?.on("message", async (message: WorkerMessage) => {
				if (message.type === "error") {
					this.desktop.logger.log("error", deserializeError(message.data.error), "workerError")

					reject(deserializeError(message.data.error))
				} else if (message.type === "started") {
					this.desktop.logger.log("info", "Worker started")

					resolve()
				} else if (message.type === "invokeResponse") {
					if (this.invokes[message.data.id]) {
						this.invokes[message.data.id]!.resolve(message.data.result)

						delete this.invokes[message.data.id]
					}
				} else if (message.type === "invokeError") {
					this.desktop.logger.log("error", deserializeError(message.data.error), "workerError")

					if (this.invokes[message.data.id]) {
						this.invokes[message.data.id]!.reject(deserializeError(message.data.error))

						delete this.invokes[message.data.id]
					}
				} else if (message.type === "sync") {
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
		try {
			const desktopConfig = await waitForConfig()

			if (!(await checkIfMountExists(desktopConfig.virtualDriveConfig.mountPoint))) {
				return false
			}

			const stat = await fs.stat(desktopConfig.virtualDriveConfig.mountPoint)

			return process.platform === "darwin" || process.platform === "linux" ? stat.ino === 0 || stat.birthtimeMs === 0 : stat.ino === 1
		} catch {
			return false
		}
	}
}

export default Worker
