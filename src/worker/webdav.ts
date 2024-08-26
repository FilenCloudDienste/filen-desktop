import type Worker from "./worker"
import WebDAVServer from "@filen/webdav"
import { isPortInUse, httpHealthCheck } from "../utils"
import { Semaphore } from "../semaphore"

export class WebDAV {
	private worker: Worker
	public server: WebDAVServer | null = null
	public active: boolean = false
	public stopMutex = new Semaphore(1)
	public startMutex = new Semaphore(1)

	public constructor(worker: Worker) {
		this.worker = worker
	}

	public async isOnline(): Promise<boolean> {
		const desktopConfig = await this.worker.waitForConfig()

		return await httpHealthCheck({
			url: `http${desktopConfig.webdavConfig.https ? "s" : ""}://${desktopConfig.webdavConfig.hostname}:${
				desktopConfig.webdavConfig.port
			}`,
			method: "GET",
			expectedStatusCode: 401
		})
	}

	public async start(): Promise<void> {
		await this.startMutex.acquire()

		try {
			await this.stop()

			const [desktopConfig, sdk] = await Promise.all([this.worker.waitForConfig(), this.worker.getSDKInstance()])

			if (await isPortInUse(desktopConfig.webdavConfig.port)) {
				throw new Error(
					`Cannot start WebDAV server on ${desktopConfig.webdavConfig.hostname}:${desktopConfig.webdavConfig.port}: Port in use.`
				)
			}

			if (this.server) {
				return
			}

			this.server = new WebDAVServer({
				port: desktopConfig.webdavConfig.port,
				hostname: desktopConfig.webdavConfig.hostname,
				user: !desktopConfig.webdavConfig.proxyMode
					? {
							username: desktopConfig.webdavConfig.username,
							password: desktopConfig.webdavConfig.password,
							sdk
					  }
					: undefined,
				https: desktopConfig.webdavConfig.https,
				authMode: desktopConfig.webdavConfig.proxyMode ? "basic" : desktopConfig.webdavConfig.authMode
			})

			await this.server.start()

			if (!(await this.isOnline())) {
				throw new Error("Could not start WebDAV server.")
			}

			this.active = true
		} catch (e) {
			this.worker.logger.log("error", e, "webdav")
			this.worker.logger.log("error", e)

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
			this.worker.logger.log("error", e, "webdav")
			this.worker.logger.log("error", e)

			throw e
		} finally {
			this.stopMutex.release()
		}
	}
}

export default WebDAV
