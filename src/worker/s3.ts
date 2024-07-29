import S3Server from "@filen/s3"
import { isPortInUse, httpHealthCheck } from "../utils"
import type Worker from "./worker"

export class S3 {
	private worker: Worker
	public server: S3Server | null = null
	public active: boolean = false

	public constructor(worker: Worker) {
		this.worker = worker
	}

	public async isOnline(): Promise<boolean> {
		const desktopConfig = await this.worker.waitForConfig()

		return await httpHealthCheck({
			url: `http${desktopConfig.s3Config.https ? "s" : ""}://${desktopConfig.s3Config.hostname}:${desktopConfig.s3Config.port}`,
			method: "GET",
			expectedStatusCode: 400
		})
	}

	public async start(): Promise<void> {
		await this.stop()

		try {
			const desktopConfig = await this.worker.waitForConfig()

			if (await isPortInUse(desktopConfig.s3Config.port)) {
				throw new Error(`Cannot start S3 server on ${desktopConfig.s3Config.hostname}:${desktopConfig.s3Config.port}: Port in use.`)
			}

			if (this.server) {
				return
			}

			this.server = new S3Server({
				port: desktopConfig.s3Config.port,
				hostname: desktopConfig.s3Config.hostname,
				user: {
					accessKeyId: desktopConfig.s3Config.accessKeyId,
					secretKeyId: desktopConfig.s3Config.secretKeyId,
					sdkConfig: desktopConfig.sdkConfig
				},
				https: desktopConfig.s3Config.https
			})

			await this.server.start()

			if (!(await this.isOnline())) {
				throw new Error("Could not start S3 server.")
			}

			this.active = true
		} catch (e) {
			await this.stop()

			throw e
		}
	}

	public async stop(): Promise<void> {
		if (!this.server) {
			this.active = false

			return
		}

		if ((await this.isOnline()) && this.server.serverInstance) {
			await this.server.stop()
		}

		this.server = null
		this.active = false
	}
}

export default S3