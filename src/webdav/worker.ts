import { type FilenSDKConfig } from "@filen/sdk"
import { IS_NODE } from "../constants"
import WebDAVServer, { type WebDAVUser } from "@filen/webdav"

/**
 * WebDAVWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class WebDAVWorker
 * @typedef {WebDAVWorker}
 */
export class WebDAVWorker {
	private readonly server: WebDAVServer

	/**
	 * Creates an instance of WebDAVWorker.
	 *
	 * @constructor
	 * @public
	 * @param {{
	 * 		users: WebDAVUser[]
	 * 		hostname?: string
	 * 		port?: number
	 * 		sdkConfig: FilenSDKConfig
	 * 		tmpDir?: string
	 * 	}} param0
	 * @param {{}} param0.users
	 * @param {string} param0.hostname
	 * @param {number} param0.port
	 * @param {FilenSDKConfig} param0.sdkConfig
	 * @param {string} param0.tmpDir
	 */
	public constructor({
		users,
		hostname,
		port,
		sdkConfig,
		tmpDir
	}: {
		users: WebDAVUser[]
		hostname?: string
		port?: number
		sdkConfig: FilenSDKConfig
		tmpDir?: string
	}) {
		this.server = new WebDAVServer({
			users,
			hostname,
			port,
			sdkConfig,
			tmpDir
		})

		if (process.env.NODE_ENV === "development") {
			setInterval(() => {
				console.log("[WEBDAVWORKER.MEM.USED]", `${(process.memoryUsage().heapUsed / 1000 / 1000).toFixed(2)} MB`)
				console.log("[WEBDAVWORKER.MEM.TOTAL]", `${(process.memoryUsage().heapTotal / 1000 / 1000).toFixed(2)} MB`)
			}, 5000)
		}
	}

	/**
	 * Initialize the WebDAV worker.
	 * @date 2/23/2024 - 5:51:12 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async initialize(): Promise<void> {
		await this.server.initialize()
	}
}

// Only start the worker if it is actually invoked.
if (process.argv.slice(2).includes("--filen-desktop-worker") && IS_NODE) {
	const webdavWorker = new WebDAVWorker({
		users: [
			{
				name: "admin",
				password: "admin",
				isAdmin: true
			}
		],
		port: 1901,
		hostname: "0.0.0.0",
		sdkConfig: {}
	})

	webdavWorker
		.initialize()
		.then(() => {
			process.stdout.write(
				JSON.stringify({
					type: "ready"
				})
			)
		})
		.catch(err => {
			console.error(err)

			process.exit(1)
		})
}

export default WebDAVWorker
