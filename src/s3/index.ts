import pathModule from "path"
import { Worker, deserializeError, type SerializedError } from "../lib/worker"
import { waitForConfig } from "../config"
import { type FilenDesktopConfig } from "../types"
import { setState } from "../state"
import { type ChildProcess } from "child_process"
import { isPortInUse } from "../utils"

export type S3WorkerMessage =
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

export class S3 {
	private readonly worker = new Worker<S3WorkerMessage>({
		path: pathModule.join(__dirname, process.env.NODE_ENV === "production" ? "worker.js" : "worker.dev.js"),
		memory: 8 * 1024
	})

	public async restart(): Promise<void> {
		this.worker.removeAllListeners()

		await this.worker.stop()
		await this.start()
	}

	public async stop(): Promise<void> {
		this.worker.removeAllListeners()

		await this.worker.stop()
	}

	public instance(): ChildProcess | null {
		return this.worker.instance()
	}

	public async start(): Promise<void> {
		await this.stop()

		await new Promise<void>((resolve, reject) => {
			waitForConfig()
				.then(config => {
					isPortInUse(config.s3Config.port)
						.then(portInUse => {
							if (portInUse) {
								reject(
									new Error(`Cannot start S3 server on ${config.s3Config.hostname}:${config.s3Config.port}: Port in use.`)
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
												s3Started: true
											}))

											resolve()
										} else if (message.type === "error") {
											this.stop().catch(console.error)

											setState(prev => ({
												...prev,
												s3Started: false
											}))

											reject(deserializeError(message.error))
										}
									})

									this.worker.on("exit", () => {
										setState(prev => ({
											...prev,
											s3Started: false
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

export default S3
