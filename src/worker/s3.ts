import S3Server from "@filen/s3"
import { isPortInUse, httpHealthCheck } from "../utils"
import type Worker from "./worker"
import { Semaphore } from "../semaphore"

export class S3 {
	private worker: Worker
	public server: S3Server | null = null
	public active: boolean = false
	public stopMutex = new Semaphore(1)
	public startMutex = new Semaphore(1)

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
		await this.startMutex.acquire()

		try {
			await this.stop()

			const [desktopConfig, sdk] = await Promise.all([this.worker.waitForConfig(), this.worker.getSDKInstance()])

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
					sdk
				},
				https: desktopConfig.s3Config.https
			})

			await this.server.start()

			if (!(await this.isOnline())) {
				throw new Error("Could not start S3 server.")
			}

			this.active = true
		} catch (e) {
			this.worker.logger.log("error", e, "s3")

			await this.stop()

			throw e
		} finally {
			this.startMutex.release()
		}
	}

	public async stop(): Promise<void> {
		await this.stopMutex.acquire()

		try {
			if (!this.server) {
				this.active = false

				return
			}

			if ((await this.isOnline()) && this.server.serverInstance) {
				await this.server.stop()
			}

			this.server = null
			this.active = false
		} catch (e) {
			this.worker.logger.log("error", e, "s3")

			throw e
		} finally {
			this.stopMutex.release()
		}
	}
}

export default S3
