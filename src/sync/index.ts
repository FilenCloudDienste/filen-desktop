import pathModule from "path"
import { deserializeError as deserializeWorkerError, type SerializedError as SerializedWorkerError, Worker } from "../lib/worker"
import { waitForConfig } from "../config"
import { setState } from "../state"
import { type Worker as WorkerThread } from "worker_threads"
import { type SyncMessage } from "@filen/sync/dist/types"
import { type Prettify, type FilenDesktopConfig } from "../types"
import type FilenDesktop from ".."
import { app } from "electron"
import fs from "fs-extra"

export type SyncWorkerMessage = Prettify<
	| {
			type: "workerStarted"
	  }
	| {
			type: "workerError"
			error: SerializedWorkerError
	  }
	| SyncMessage
>

export class Sync {
	private readonly worker = new Worker<SyncWorkerMessage>({
		path: pathModule.join(__dirname, process.env.NODE_ENV === "production" ? "worker.js" : "worker.dev.js"),
		memory: 8 * 1024
	})
	private readonly desktop: FilenDesktop
	public readonly dbPath = pathModule.join(app.getPath("userData"), "sync")

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

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

	public async start(): Promise<void> {
		await this.stop()
		await fs.ensureDir(this.dbPath)

		const config = await waitForConfig()

		await new Promise<void>((resolve, reject) => {
			this.worker
				.start({
					environmentData: {
						syncConfig: {
							...config,
							syncConfig: {
								...config.syncConfig,
								dbPath: this.dbPath
							}
						} satisfies FilenDesktopConfig
					}
				})
				.then(() => {
					this.worker.removeAllListeners()

					this.worker.on("message", message => {
						if (message.type === "workerStarted") {
							setState(prev => ({
								...prev,
								webdavStarted: true
							}))

							resolve()
						} else if (message.type === "workerError") {
							this.stop().catch(console.error)

							setState(prev => ({
								...prev,
								webdavStarted: false
							}))

							reject(deserializeWorkerError(message.error))
						} else {
							this.desktop.ipc.postMainToWindowMessage({
								type: "sync",
								message
							})
						}
					})

					this.worker.on("exit", () => {
						this.stop().catch(console.error)

						setState(prev => ({
							...prev,
							webdavStarted: false
						}))

						reject(new Error("Could not start worker."))
					})
				})
				.catch(reject)
		})
	}
}

export default Sync
