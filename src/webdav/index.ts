import pathModule from "path"
import { Worker, deserializeError, type SerializedError } from "../lib/worker"
import { waitForConfig } from "../config"
import { type FilenDesktopConfig } from "../types"
import { setState } from "../state"
import { type Worker as WorkerThread } from "worker_threads"
import { isPortInUse } from "../utils"

export type WebDAVWorkerMessage =
	| {
			type: "started"
	  }
	| {
			type: "config"
			config: FilenDesktopConfig
	  }
	| {
			type: "error"
			error: SerializedError
	  }

/**
 * WebDAV
 * @date 2/23/2024 - 5:49:48 AM
 *
 * @export
 * @class WebDAV
 * @typedef {WebDAV}
 */
export class WebDAV {
	private readonly worker = new Worker<WebDAVWorkerMessage>({
		path: pathModule.join(__dirname, process.env.NODE_ENV === "production" ? "worker.js" : "worker.dev.js"),
		memory: 8 * 1024
	})

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

		await new Promise<void>((resolve, reject) => {
			waitForConfig()
				.then(config => {
					isPortInUse(config.webdavConfig.port)
						.then(portInUse => {
							if (portInUse) {
								reject(
									new Error(
										`Cannot start WebDAV server on ${config.webdavConfig.hostname}:${config.webdavConfig.port}: Port in use.`
									)
								)

								return
							}

							this.worker
								.start()
								.then(() => {
									this.worker.on("message", message => {
										if (message.type === "started") {
											setState(prev => ({
												...prev,
												webdavStarted: true
											}))

											resolve()
										} else if (message.type === "error") {
											this.stop().catch(console.error)

											setState(prev => ({
												...prev,
												webdavStarted: false
											}))

											reject(deserializeError(message.error))
										}
									})

									this.worker.on("exit", () => {
										setState(prev => ({
											...prev,
											webdavStarted: false
										}))
									})

									this.worker.sendMessage({
										type: "config",
										config
									})
								})
								.catch(reject)
						})
						.catch(reject)
				})
				.catch(reject)
		})
	}
}

export default WebDAV
