import pathModule from "path"
import { Worker, deserializeError, type SerializedError } from "../lib/worker"
import { waitForConfig } from "../config"
import { setState } from "../state"
import { type Worker as WorkerThread } from "worker_threads"
import { isPortInUse } from "../utils"
import http from "http"
import https from "https"

export type S3WorkerMessage =
	| {
			type: "started"
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
		await this.worker.stop()
		await this.start()
	}

	public async stop(): Promise<void> {
		await this.worker.stop()
	}

	public instance(): WorkerThread | null {
		return this.worker.instance()
	}

	public async isOnline(): Promise<boolean> {
		const config = await waitForConfig()

		return await new Promise<boolean>(resolve => {
			const request = config.s3Config.https
				? https.request(
						{
							hostname: "127.0.0.1",
							port: config.s3Config.port,
							path: "/",
							method: "HEAD",
							timeout: 15000,
							rejectUnauthorized: false,
							agent: false
						},
						res => {
							if (res.statusCode !== 400) {
								resolve(false)

								return
							}

							resolve(true)
						}
				  )
				: http.request(
						{
							hostname: "127.0.0.1",
							port: config.s3Config.port,
							path: "/",
							method: "HEAD",
							timeout: 15000,
							agent: false
						},
						res => {
							if (res.statusCode !== 400) {
								resolve(false)

								return
							}

							resolve(true)
						}
				  )

			request.once("error", () => {
				resolve(false)
			})

			request.end()
		})
	}

	public async start(): Promise<void> {
		await this.stop()

		const config = await waitForConfig()
		const portInUse = await isPortInUse(config.s3Config.port)

		if (portInUse) {
			throw new Error(`Cannot start S3 server on ${config.s3Config.hostname}:${config.s3Config.port}: Port in use.`)
		}

		await new Promise<void>((resolve, reject) => {
			this.worker
				.start({
					environmentData: {
						s3Config: config
					}
				})
				.then(() => {
					this.worker.removeAllListeners()

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
						this.stop().catch(console.error)

						setState(prev => ({
							...prev,
							s3Started: false
						}))

						reject(new Error("Could not start worker."))
					})
				})
				.catch(reject)
		})
	}
}

export default S3
