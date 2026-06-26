import { Worker as WorkerThread } from "worker_threads"
import pathModule from "path"
import { deserializeError } from "../utils"
import { app } from "electron"
import type FilenDesktop from ".."
import isDev from "../isDev"
import { type WorkerInvokeChannel, type WorkerMessage } from "../types"
import { Semaphore } from "../semaphore"

export class Worker {
	private worker: WorkerThread | null = null
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private invokes: Record<number, { resolve: (value: any | PromiseLike<any>) => void; reject: (err: Error) => void }> = {}
	private invokesId = 0
	private isQuittingApp = false
	private desktop: FilenDesktop
	public active: boolean = false
	private readonly startMutex = new Semaphore(1)
	private readonly stopMutex = new Semaphore(1)
	private didQuitApp = false

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop

		app.on("will-quit", async e => {
			if (this.isQuittingApp || this.didQuitApp) {
				return
			}

			this.isQuittingApp = true

			try {
				e.preventDefault()

				setTimeout(() => {
					app.exit(0)
				}, 60000)

				await this.desktop.rclone.killAll()
				await this.stop()
				await new Promise<void>(resolve => setTimeout(resolve, 250))
			} catch {
				// Noop
			} finally {
				this.didQuitApp = true

				app.exit(0)
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
		await this.startMutex.acquire()

		try {
			await new Promise<void>((resolve, reject) => {
				this.desktop.logger.log("info", "Starting worker")

				this.worker = new WorkerThread(pathModule.join(__dirname, !isDev ? "worker.js" : "worker.dev.js"))

				this.worker.on("error", err => {
					this.desktop.logger.log("error", err, "worker.onError")
					this.desktop.logger.log("error", err)

					reject(err)
				})

				this.worker.on("exit", code => {
					this.desktop.logger.log("error", `Worker exited with code ${code}.`)
				})

				if (isDev) {
					this.worker.stderr.on("data", chunk => {
						console.log("worker stderr", chunk.toString("utf-8"))
					})

					this.worker.stdout.on("data", chunk => {
						console.log("worker stdout", chunk.toString("utf-8"))
					})
				}

				this.worker.on("message", async (message: WorkerMessage) => {
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
		} finally {
			this.startMutex.release()
		}
	}

	public async stop(): Promise<void> {
		await this.stopMutex.acquire()

		try {
			if (!this.worker) {
				this.active = false

				return
			}

			await this.invoke("stop")
			await this.worker.terminate()

			this.worker = null
			this.active = false
		} finally {
			this.stopMutex.release()
		}
	}
}

export default Worker
