import WebDAVServer from "@filen/webdav"
import { type WebDAVWorkerMessage } from "."
import { type FilenDesktopConfig } from "../types"
import { serializeError } from "../lib/worker"
import { isPortInUse } from "../utils"
import { parentPort, getEnvironmentData, isMainThread } from "worker_threads"

parentPort?.on("message", message => {
	if (message === "exit") {
		process.exit(0)
	}
})

export async function main(): Promise<void> {
	if (isMainThread || !parentPort) {
		throw new Error("Not running inside a worker thread.")
	}

	const config = getEnvironmentData("webdavConfig") as FilenDesktopConfig

	if (await isPortInUse(config.webdavConfig.port)) {
		throw new Error(`Cannot start WebDAV server on ${config.webdavConfig.hostname}:${config.webdavConfig.port}: Port in use.`)
	}

	const server = new WebDAVServer({
		port: config.webdavConfig.port,
		hostname: config.webdavConfig.hostname,
		user: !config.webdavConfig.proxyMode
			? {
					username: config.webdavConfig.username,
					password: config.webdavConfig.password,
					sdkConfig: config.sdkConfig
			  }
			: undefined,
		https: config.webdavConfig.https,
		authMode: config.webdavConfig.proxyMode ? "basic" : config.webdavConfig.authMode
	})

	await server.start()

	parentPort?.postMessage({
		type: "started"
	} satisfies WebDAVWorkerMessage)
}

main().catch(err => {
	parentPort?.postMessage({
		type: "error",
		error: serializeError(err)
	} satisfies WebDAVWorkerMessage)
})
