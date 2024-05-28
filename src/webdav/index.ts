import { spawn, ChildProcess } from "child_process"
import pathModule from "path"
import os from "os"
import fs from "fs-extra"
import { app } from "electron"

export type WebDAVWorkerMessage = {
	type: "ready"
}

const processEvents = ["exit", "SIGINT", "SIGTERM", "SIGKILL", "SIGABRT"]
const appEvents = ["quit", "before-quit"]

/**
 * WebDAV
 * @date 2/23/2024 - 5:49:48 AM
 *
 * @export
 * @class WebDAV
 * @typedef {WebDAV}
 */
export class WebDAV {
	private worker: ChildProcess | null = null
	private workerReady = false
	private sentReady = false

	/**
	 * Creates an instance of WebDAV.
	 * @date 2/26/2024 - 7:12:10 AM
	 *
	 * @constructor
	 * @public
	 */
	public constructor() {
		for (const event of processEvents) {
			process.on(event, () => {
				if (this.worker) {
					this.worker.removeAllListeners()
					this.worker.kill(0)
				}
			})
		}

		for (const event of appEvents) {
			app.on(event as unknown as "quit", () => {
				if (this.worker) {
					this.worker.removeAllListeners()
					this.worker.kill(0)
				}
			})
		}
	}

	/**
	 * Initialize the WebDAV worker.
	 * @date 2/23/2024 - 5:49:31 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async initialize(): Promise<void> {
		const nodeBinPath = pathModule.join(
			__dirname,
			"..",
			"..",
			"bin",
			"node",
			`${os.platform()}_${os.arch()}${os.platform() === "win32" ? ".exe" : ""}`
		)

		if (!(await fs.exists(nodeBinPath))) {
			throw new Error("Node binary not found.")
		}

		if (this.worker) {
			this.worker.removeAllListeners()
			this.worker.kill(0)
		}

		this.worker = null
		this.workerReady = false

		await new Promise<void>(resolve => {
			this.worker = spawn(nodeBinPath, [
				pathModule.join(__dirname, process.env.NODE_ENV === "production" ? "worker.js" : "worker.dev.js"),
				"--max-old-space-size=8192"
			])

			this.worker.stderr?.on("data", console.error)
			this.worker.stderr?.on("error", console.error)

			this.worker.on("exit", () => {
				this.worker = null
				this.workerReady = false

				console.log("WebDAV worker died, respawning..")

				setTimeout(() => {
					this.initialize().catch(console.error)
				}, 1000)
			})

			this.worker.on("close", () => {
				this.worker = null
				this.workerReady = false

				console.log("WebDAV worker died, respawning..")

				setTimeout(() => {
					this.initialize().catch(console.error)
				}, 1000)
			})

			this.worker.stdout?.on("data", (data?: Buffer | string) => {
				try {
					if (!data) {
						return
					}

					const stringified = typeof data === "string" ? data : data.toString("utf-8")

					if (!(stringified.includes("{") && stringified.includes("}"))) {
						process.stdout.write(stringified)

						return
					}

					const payload: WebDAVWorkerMessage = JSON.parse(stringified)

					if (payload.type === "ready") {
						this.workerReady = true

						if (!this.sentReady) {
							this.sentReady = true

							resolve()
						}
					}

					console.log("WebDAV worker message:", payload)
				} catch (e) {
					console.error(e)
				}
			})

			this.worker.stdout?.on("error", console.error)
		})
	}

	/**
	 * Deinitialize the worker.
	 * @date 3/1/2024 - 8:45:04 PM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async deinitialize(): Promise<void> {
		if (!this.worker) {
			return
		}

		await this.waitForReady()

		this.worker.removeAllListeners()
		this.worker.kill(0)
		this.worker = null
		this.workerReady = false
	}

	/**
	 * Wait for the worker to be ready.
	 * @date 2/23/2024 - 5:49:17 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async waitForReady(): Promise<void> {
		if (this.workerReady) {
			return
		}

		await new Promise<void>(resolve => {
			const wait = setInterval(() => {
				if (this.workerReady) {
					clearInterval(wait)

					resolve()
				}
			}, 100)
		})
	}
}

export default WebDAV
