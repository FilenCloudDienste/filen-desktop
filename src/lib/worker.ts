import { spawn, type ChildProcess, type Serializable } from "child_process"
import pathModule from "path"
import os from "os"
import fs from "fs-extra"
import { app } from "electron"
import { EventEmitter } from "events"
import { Semaphore } from "../semaphore"
import TypedEmitter from "typed-emitter"

export const nodeBinPath = pathModule.join(
	__dirname,
	"..",
	"..",
	"bin",
	"node",
	`${os.platform()}_${os.arch()}${os.platform() === "win32" ? ".exe" : ""}`
)

export const processEvents = ["exit", "SIGINT", "SIGTERM", "SIGKILL", "SIGABRT"]
export const appEvents = ["quit", "before-quit"]

export type WorkerEventName = "message" | "exit"

export type WorkerEvents<T> = {
	[K in WorkerEventName]: (data: K extends "message" ? T : null) => void
}

export class Worker<T> extends (EventEmitter as unknown as { new <T>(): TypedEmitter<WorkerEvents<T>> })<T> {
	private worker: ChildProcess | null = null
	private readonly path: string
	private readonly memory: number
	private readonly mutex = new Semaphore(1)

	public constructor({ path, memory = 8192 }: { path: string; memory: number }) {
		super()

		this.path = path
		this.memory = memory

		for (const event of processEvents) {
			process.on(event, () => {
				if (this.worker) {
					this.worker.removeAllListeners()
					this.worker.kill(0)
					this.worker = null
				}
			})
		}

		for (const event of appEvents) {
			app.on(event as unknown as "quit", () => {
				if (this.worker) {
					this.worker.removeAllListeners()
					this.worker.kill(0)
					this.worker = null
				}
			})
		}
	}

	public instance(): ChildProcess | null {
		return this.worker
	}

	public sendMessage(message: T): void {
		if (!this.worker) {
			return
		}

		this.worker.send(message as unknown as Serializable)
	}

	public async start(): Promise<void> {
		await this.stop()

		await this.mutex.acquire()

		try {
			if (this.worker) {
				return
			}

			if (!(await fs.exists(nodeBinPath))) {
				throw new Error(`Could not locate node binary at ${nodeBinPath} for ${os.platform()} ${os.arch()}.`)
			}

			if (!(await fs.exists(this.path))) {
				throw new Error(`Could not locate worker script at ${this.path}.`)
			}

			await new Promise<void>((resolve, reject) => {
				this.worker = spawn(nodeBinPath, [this.path, `--max-old-space-size=${this.memory}`, "--filen-desktop-worker"], {
					stdio: ["pipe", "pipe", "pipe", "ipc"]
				})

				if (process.env.NODE_ENV === "development") {
					this.worker.stdout?.on("data", data => {
						console.log("worker stdout", data instanceof Buffer ? data.toString("utf-8") : data)
					})

					this.worker.stderr?.on("data", err => {
						console.log("worker stderr", err instanceof Buffer ? err.toString("utf-8") : err)
					})
				}

				this.worker.on("message", message => {
					console.log("worker msg", message)

					this.emit("message", message as T)
				})

				this.worker.on("error", reject)

				this.worker.on("close", () => {
					this.worker = null

					this.emit("exit", null)
				})

				this.worker.on("exit", () => {
					this.worker = null

					this.emit("exit", null)
				})

				this.worker.on("spawn", () => {
					console.log("worker spawned")

					resolve()
				})
			})
		} finally {
			this.mutex.release()
		}
	}

	public async stop(): Promise<void> {
		await this.mutex.acquire()

		try {
			if (!this.worker) {
				return
			}

			this.worker.removeAllListeners()

			await new Promise<void>(resolve => {
				if (!this.worker) {
					resolve()

					return
				}

				this.worker.on("close", resolve)
				this.worker.on("exit", resolve)

				this.worker.kill("SIGKILL")
			})

			this.emit("exit", null)

			this.worker = null
		} finally {
			this.mutex.release()
		}
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
