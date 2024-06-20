import pathModule from "path"
import { Worker, deserializeError, type SerializedError } from "../lib/worker"
import { waitForConfig } from "../config"
import { type FilenDesktopConfig } from "../types"
import { setState } from "../state"
import { type ChildProcess } from "child_process"
import { app } from "electron"
import fs from "fs-extra"
import { getAvailableDriveLetters } from "../utils"

export type FUSEWorkerMessage =
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

export class FUSE {
	private readonly worker = new Worker<FUSEWorkerMessage>({
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

		const localDirPath = pathModule.join(app.getPath("userData"), "fuse")

		await fs.ensureDir(localDirPath)

		await new Promise<void>((resolve, reject) => {
			waitForConfig()
				.then(config => {
					getAvailableDriveLetters()
						.then(availableDriveLetters => {
							if (!availableDriveLetters.includes(config.fuseConfig.mountPoint)) {
								reject(new Error(`Cannot mount virtual drive at ${config.fuseConfig.mountPoint}: Drive letter exists.`))

								return
							}

							this.worker
								.start()
								.then(() => {
									this.worker.on("message", message => {
										if (message.type === "started") {
											setState(prev => ({
												...prev,
												fuseStarted: true
											}))

											resolve()
										} else if (message.type === "error") {
											this.stop().catch(console.error)

											setState(prev => ({
												...prev,
												fuseStarted: false
											}))

											reject(deserializeError(message.error))
										}
									})

									this.worker.on("exit", () => {
										setState(prev => ({
											...prev,
											fuseStarted: false
										}))
									})

									this.worker.sendMessage({
										type: "config",
										config: {
											...config,
											fuseConfig: {
												...config.fuseConfig,
												localDirPath
											}
										}
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

export default FUSE
