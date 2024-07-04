import { Worker as WorkerThread, type Serializable, type TransferListItem, setEnvironmentData } from "worker_threads"
import fs from "fs-extra"
import { EventEmitter } from "events"
import TypedEmitter from "typed-emitter"
import { app } from "electron"
import { v4 as uuidv4 } from "uuid"

app?.on("before-quit", cleanupWorkersAndExit)
app?.on("will-quit", cleanupWorkersAndExit)
app?.on("quit", cleanupWorkersAndExit)

export type WorkerEventName = "message" | "exit"

export type WorkerEvents<T> = {
	[K in WorkerEventName]: (data: K extends "message" ? T : null) => void
}

let isCleaningUp = false
const workers: Record<string, WorkerThread> = {}

export async function cleanupWorkersAndExit(e: { preventDefault: () => void; readonly defaultPrevented: boolean }): Promise<void> {
	if (isCleaningUp) {
		return
	}

	isCleaningUp = true

	e.preventDefault()

	try {
		await Promise.all(
			Object.keys(workers).map(
				id =>
					new Promise(resolve => {
						workers[id]?.removeAllListeners().on("exit", resolve).postMessage("exit")
					})
			)
		)
	} finally {
		app.quit()
	}
}

export class Worker<T> extends (EventEmitter as unknown as { new <T>(): TypedEmitter<WorkerEvents<T>> })<T> {
	private worker: WorkerThread | null = null
	private readonly path: string
	private readonly memory: number | undefined
	private readonly id = uuidv4()

	public constructor({ path, memory }: { path: string; memory?: number }) {
		super()

		this.path = path
		this.memory = memory
	}

	public instance(): WorkerThread | null {
		return this.worker
	}

	public sendMessage(message: T, transfer?: TransferListItem[]): void {
		if (!this.worker) {
			return
		}

		this.worker.postMessage(message as unknown as Serializable, transfer)
	}

	public async start(options?: { environmentData?: Record<string, Serializable> }): Promise<void> {
		if (this.worker) {
			return
		}

		if (!(await fs.exists(this.path))) {
			throw new Error(`Could not locate worker script at ${this.path}.`)
		}

		await this.stop()

		await new Promise<void>((resolve, reject) => {
			if (options && options.environmentData) {
				for (const key in options.environmentData) {
					setEnvironmentData(key, options.environmentData[key]!)
				}
			}

			let didReject = false

			this.worker = new WorkerThread(this.path, {
				resourceLimits: {
					maxOldGenerationSizeMb: this.memory
				}
			})

			workers[this.id] = this.worker

			if (process.env.NODE_ENV === "development") {
				this.worker.stdout?.on("data", data => {
					console.log("Worker stdout", data instanceof Buffer ? data.toString("utf-8") : data)
				})

				this.worker.stderr?.on("data", err => {
					console.log("Worker stderr", err instanceof Buffer ? err.toString("utf-8") : err)
				})

				this.worker.on("messageerror", err => {
					console.log("Worker messageerror", err)
				})
			}

			this.worker.on("message", message => {
				this.emit("message", message as T)
			})

			this.worker.on("error", err => {
				didReject = true

				delete workers[this.id]

				reject(err)
			})

			this.worker.on("exit", () => {
				didReject = true

				delete workers[this.id]

				this.worker = null

				this.emit("exit", null)

				reject(new Error("Could not start worker thread (exit)."))
			})

			this.worker.on("online", () => {
				setTimeout(() => {
					if (didReject) {
						return
					}

					resolve()
				}, 1000)
			})
		})
	}

	public async stop(): Promise<void> {
		if (!this.worker) {
			return
		}

		await new Promise<void>(resolve => {
			this.worker
				?.removeAllListeners()
				.on("exit", () => {
					delete workers[this.id]

					this.worker = null

					this.emit("exit", null)

					resolve()
				})
				.postMessage("exit")
		})
	}
}

export type SerializedError = {
	name: string
	message: string
	stack?: string
}

export function serializeError(error: Error): SerializedError {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack
	}
}

export function deserializeError(serializedError: SerializedError): Error {
	const error = new Error(serializedError.message)

	error.name = serializedError.name
	error.stack = serializedError.stack

	return error
}
