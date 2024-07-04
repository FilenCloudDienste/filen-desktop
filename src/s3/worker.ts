import S3Server from "@filen/s3"
import { type S3WorkerMessage } from "."
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

	const config = getEnvironmentData("s3Config") as FilenDesktopConfig

	if (await isPortInUse(config.s3Config.port)) {
		throw new Error(`Cannot start S3 server on ${config.s3Config.hostname}:${config.s3Config.port}: Port in use.`)
	}

	const server = new S3Server({
		port: config.s3Config.port,
		hostname: config.s3Config.hostname,
		user: {
			accessKeyId: config.s3Config.accessKeyId,
			secretKeyId: config.s3Config.secretKeyId,
			sdkConfig: config.sdkConfig
		},
		https: config.s3Config.https
	})

	await server.start()

	parentPort?.postMessage({
		type: "started"
	} satisfies S3WorkerMessage)
}

main().catch(err => {
	parentPort?.postMessage({
		type: "error",
		error: serializeError(err)
	} satisfies S3WorkerMessage)
})
