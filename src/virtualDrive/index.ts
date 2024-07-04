import pathModule from "path"
import { Worker, deserializeError, type SerializedError } from "../lib/worker"
import { waitForConfig } from "../config"
import { setState } from "../state"
import { type Worker as WorkerThread } from "worker_threads"
import { app } from "electron"
import fs from "fs-extra"
import os from "os"
import diskusage from "diskusage-ng"
import { promiseAllChunked } from "../utils"
import { type FilenDesktopConfig } from "../types"

export type VirtualDriveWorkerMessage =
	| {
			type: "started"
	  }
	| {
			type: "error"
			error: SerializedError
	  }

export class VirtualDrive {
	private readonly worker = new Worker<VirtualDriveWorkerMessage>({
		path: pathModule.join(__dirname, process.env.NODE_ENV === "production" ? "worker.js" : "worker.dev.js")
	})
	public readonly localDirPath = pathModule.join(app.getPath("userData"), "virtualDrive")

	public async restart(): Promise<void> {
		await this.worker.stop()
		await this.start()
	}

	public async stop(): Promise<void> {
		await this.worker.stop()
	}

	public instance(): WorkerThread | null {
		return this.worker.instance()
	}

	public async isMounted(): Promise<boolean> {
		if (this.instance() === null) {
			return false
		}

		try {
			const config = await waitForConfig()

			await fs.access(
				os.platform() === "win32" ? `${config.virtualDriveConfig.mountPoint}\\\\` : config.virtualDriveConfig.mountPoint
			)

			return true
		} catch {
			return false
		}
	}

	public async start(): Promise<void> {
		await this.stop()
		await fs.ensureDir(this.localDirPath)

		const config = await waitForConfig()

		await new Promise<void>((resolve, reject) => {
			this.worker
				.start({
					environmentData: {
						virtualDriveConfig: {
							...config,
							virtualDriveConfig: {
								...config.virtualDriveConfig,
								localDirPath: this.localDirPath
							}
						} satisfies FilenDesktopConfig
					}
				})
				.then(() => {
					this.worker.removeAllListeners()

					this.worker.on("message", message => {
						if (message.type === "started") {
							setState(prev => ({
								...prev,
								virtualDriveStarted: true
							}))

							resolve()
						} else if (message.type === "error") {
							this.stop().catch(console.error)

							setState(prev => ({
								...prev,
								virtualDriveStarted: false
							}))

							reject(deserializeError(message.error))
						}
					})

					this.worker.on("exit", () => {
						this.stop().catch(console.error)

						setState(prev => ({
							...prev,
							virtualDriveStarted: false
						}))

						reject(new Error("Could not start worker."))
					})
				})
				.catch(reject)
		})
	}

	public async availableCacheSize(): Promise<number> {
		return await new Promise<number>((resolve, reject) => {
			diskusage(this.localDirPath, (err, usage) => {
				if (err) {
					reject(err)

					return
				}

				resolve(usage.available)
			})
		})
	}

	public async cacheSize(): Promise<number> {
		await fs.ensureDir(pathModule.join(this.localDirPath, "cache"))

		const dir = await fs.readdir(pathModule.join(this.localDirPath, "cache"), {
			recursive: true,
			encoding: "utf-8"
		})
		let total = 0

		await promiseAllChunked(
			dir.map(async entry => {
				try {
					const stat = await fs.stat(pathModule.join(this.localDirPath, "cache", entry))

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

	public async cleanupLocalDir(): Promise<void> {
		await fs.emptyDir(this.localDirPath)
	}

	public async cleanupCache(): Promise<void> {
		await fs.emptyDir(pathModule.join(this.localDirPath, "cache"))
	}
}

export default VirtualDrive
