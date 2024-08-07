import pathModule from "path"
import pino, { type Logger as PinoLogger } from "pino"
import os from "os"
import fs from "fs-extra"
import { createStream } from "rotating-file-stream"

export async function filenLogsPath(): Promise<string> {
	let configPath = ""

	switch (process.platform) {
		case "win32":
			configPath = pathModule.resolve(process.env.APPDATA!)

			break
		case "darwin":
			configPath = pathModule.resolve(pathModule.join(os.homedir(), "Library/Application Support/"))

			break
		default:
			configPath = process.env.XDG_CONFIG_HOME
				? pathModule.resolve(process.env.XDG_CONFIG_HOME)
				: pathModule.resolve(pathModule.join(os.homedir(), ".config/"))

			break
	}

	if (!configPath || configPath.length === 0) {
		throw new Error("Could not find homedir path.")
	}

	configPath = pathModule.join(configPath, "@filen", "logs")

	if (!(await fs.exists(configPath))) {
		await fs.mkdir(configPath, {
			recursive: true
		})
	}

	return configPath
}

export class Logger {
	private logger: PinoLogger | null = null
	private dest: string | null = null
	private isCleaning: boolean = false
	private readonly disableLogging: boolean
	private readonly isWorker: boolean

	public constructor(disableLogging: boolean = false, isWorker: boolean = false) {
		this.disableLogging = disableLogging
		this.isWorker = isWorker

		this.init()
	}

	public async init(): Promise<void> {
		try {
			this.dest = pathModule.join(await filenLogsPath(), this.isWorker ? "desktop-worker.log" : "desktop.log")

			this.logger = pino(
				createStream(pathModule.basename(this.dest), {
					size: "10M",
					interval: "7d",
					compress: "gzip",
					encoding: "utf-8",
					maxFiles: 3,
					path: pathModule.dirname(this.dest)
				})
			)
		} catch (e) {
			console.error(e)
		}
	}

	public async waitForPino(): Promise<void> {
		if (this.logger) {
			return
		}

		await new Promise<void>(resolve => {
			const wait = setInterval(() => {
				if (this.logger) {
					clearInterval(wait)

					resolve()
				}
			}, 100)
		})
	}

	public log(level: "info" | "debug" | "warn" | "error" | "trace" | "fatal", object?: unknown, where?: string): void {
		if (this.isCleaning || this.disableLogging) {
			return
		}

		// eslint-disable-next-line no-extra-semi
		;(async () => {
			try {
				if (!this.logger) {
					await this.waitForPino()
				}

				const log = `${where ? `[${where}] ` : ""}${
					typeof object !== "undefined"
						? typeof object === "string" || typeof object === "number"
							? object
							: JSON.stringify(object)
						: ""
				}`

				if (level === "info") {
					this.logger?.info(log)
				} else if (level === "debug") {
					this.logger?.debug(log)
				} else if (level === "error") {
					this.logger?.error(log)

					if (object instanceof Error) {
						this.logger?.error(object)
					}
				} else if (level === "warn") {
					this.logger?.warn(log)
				} else if (level === "trace") {
					this.logger?.trace(log)
				} else if (level === "fatal") {
					this.logger?.fatal(log)
				} else {
					this.logger?.info(log)
				}
			} catch (e) {
				console.error(e)
			}
		})()
	}
}

export default Logger
