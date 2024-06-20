import S3Server from "@filen/s3"
import { type S3WorkerMessage } from "."
import { type FilenDesktopConfig } from "../types"
import { serializeError } from "../lib/worker"
import { isPortInUse } from "../utils"

let config: FilenDesktopConfig | null = null

process.on("message", (message: S3WorkerMessage) => {
	if (message.type === "config") {
		config = message.config
	}
})

export function waitForConfig(): Promise<FilenDesktopConfig> {
	return new Promise<FilenDesktopConfig>(resolve => {
		if (config) {
			resolve(config)

			return
		}

		const wait = setInterval(() => {
			if (config) {
				clearInterval(wait)

				resolve(config)
			}
		}, 100)
	})
}

export async function main(): Promise<void> {
	if (!process.argv.slice(2).includes("--filen-desktop-worker")) {
		return
	}

	const config = await waitForConfig()

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

	if (process.send) {
		process.send({
			type: "started"
		} satisfies S3WorkerMessage)
	}
}

main().catch(err => {
	if (process.send) {
		process.send({
			type: "error",
			error: serializeError(err)
		} satisfies S3WorkerMessage)
	}
})
