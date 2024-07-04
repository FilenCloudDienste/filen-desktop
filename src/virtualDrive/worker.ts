import { parentPort, getEnvironmentData, isMainThread } from "worker_threads"
import { type VirtualDriveWorkerMessage } from "."
import { type FilenDesktopConfig } from "../types"
import fs from "fs-extra"
import pathModule from "path"
import { serializeError } from "../lib/worker"
import { getAvailableDriveLetters, generateRandomString } from "../utils"
import WebDAVServer from "@filen/webdav"
import { type ChildProcess, spawn } from "child_process"
import { type FilenSDKConfig } from "@filen/sdk"
import os from "os"
import findFreePorts from "find-free-ports"
import http from "http"
import treeKill from "tree-kill"
import { execCommand, killProcessByName } from "./utils"

export type VirtualDriveOptions = {
	sdkConfig: FilenSDKConfig
	port: number
	username: string
	password: string
	localPath: string
	mountPoint: string
	cacheSizeInGi: number
}

export const rcloneBinaryName = `filen_rclone_${os.platform()}_${os.arch()}${os.platform() === "win32" ? ".exe" : ""}`

let didSetupExitHandler = false

parentPort?.on("message", message => {
	if (message === "exit" && !didSetupExitHandler) {
		process.exit(0)
	}
})

export class VirtualDrive {
	private readonly webdavServer: WebDAVServer
	private readonly options: VirtualDriveOptions
	private readonly rcloneCachePath: string
	private readonly rcloneBinaryPath: string
	private readonly rcloneConfigPath: string
	private readonly webdavEndpoint: string
	private webdavPingInterval: ReturnType<typeof setInterval> | undefined = undefined
	private webdavStarted: boolean = false
	private isPingingWebDAV: boolean = false
	private rcloneStarted: boolean = false
	private rcloneCheckInterval: ReturnType<typeof setInterval> | undefined = undefined
	private isCheckingRClone: boolean = false
	private rcloneProcess: ChildProcess | null = null

	public constructor(options: VirtualDriveOptions) {
		parentPort?.on("message", message => {
			if (message === "exit") {
				this.cleaupAndExit()
			}
		})

		didSetupExitHandler = true

		this.options = {
			...options,
			sdkConfig: {
				...options.sdkConfig,
				connectToSocket: true
			}
		}
		this.rcloneBinaryPath = pathModule.join(__dirname, "..", "..", "bin", "rclone", rcloneBinaryName)
		this.rcloneCachePath = pathModule.join(options.localPath, "cache")
		this.rcloneConfigPath = pathModule.join(options.localPath, "rclone.conf")
		this.webdavEndpoint = `http://127.0.0.1:${options.port}`
		this.webdavServer = new WebDAVServer({
			hostname: "127.0.0.1",
			port: options.port,
			https: false,
			user: {
				username: options.username,
				password: options.password,
				sdkConfig: options.sdkConfig
			},
			authMode: "basic"
		})

		this.pingWebDAV()
		this.checkRClone()
	}

	private async cleaupAndExit(): Promise<void> {
		clearInterval(this.webdavPingInterval)
		clearInterval(this.rcloneCheckInterval)

		if (this.rcloneProcess) {
			this.rcloneProcess.removeAllListeners()

			if (this.rcloneProcess.stdin) {
				try {
					this.rcloneProcess.stdin.removeAllListeners()
					this.rcloneProcess.stdin.destroy()
				} catch {
					// Noop
				}
			}

			if (this.rcloneProcess.stdout) {
				try {
					this.rcloneProcess.stdout.removeAllListeners()
					this.rcloneProcess.stdout.destroy()
				} catch {
					// Noop
				}
			}

			if (this.rcloneProcess.stderr) {
				try {
					this.rcloneProcess.stderr.removeAllListeners()
					this.rcloneProcess.stderr.destroy()
				} catch {
					// Noop
				}
			}

			if (this.rcloneProcess.pid) {
				await new Promise<void>(resolve => {
					treeKill(this.rcloneProcess!.pid!, "SIGKILL", () => resolve())
				})
			}

			this.rcloneProcess.kill()
		}

		process.exit(0)
	}

	private pingWebDAV(): void {
		clearInterval(this.webdavPingInterval)

		this.webdavPingInterval = setInterval(async () => {
			if (this.isPingingWebDAV || !this.webdavStarted) {
				return
			}

			this.isPingingWebDAV = true

			try {
				await new Promise<void>((resolve, reject) => {
					const request = http.request(
						{
							hostname: "127.0.0.1",
							port: this.options.port,
							path: "/",
							method: "HEAD",
							timeout: 15000,
							agent: false
						},
						res => {
							if (res.statusCode !== 401) {
								reject(new Error("Status code !== 401."))

								return
							}

							resolve()
						}
					)

					request.once("error", err => {
						reject(err)
					})

					request.end()
				})
			} catch {
				this.cleaupAndExit()
			} finally {
				this.isPingingWebDAV = false
			}
		}, 5000)
	}

	private checkRClone(): void {
		clearInterval(this.rcloneCheckInterval)

		this.rcloneCheckInterval = setInterval(async () => {
			if (this.isCheckingRClone || !this.rcloneStarted) {
				return
			}

			this.isCheckingRClone = true

			try {
				const mountExists = await this.checkIfMountExists()

				if (!mountExists) {
					throw new Error("Mount not found.")
				}
			} catch {
				this.cleaupAndExit()
			} finally {
				this.isCheckingRClone = false
			}
		}, 5000)
	}

	private async obscureRClonePassword(): Promise<string> {
		if (!(await fs.exists(this.rcloneBinaryPath))) {
			throw new Error(`Rclone binary not found at ${this.rcloneBinaryPath}.`)
		}

		return await execCommand(`"${this.rcloneBinaryPath}" obscure ${this.options.password}`)
	}

	private async writeRCloneConfig(): Promise<void> {
		const obscuredPassword = await this.obscureRClonePassword()
		const content = `[Filen]\ntype = webdav\nurl = ${this.webdavEndpoint}\nvendor = other\nuser = ${this.options.username}\npass = ${obscuredPassword}`

		await fs.writeFile(this.rcloneConfigPath, content, "utf-8")
	}

	private async checkIfMountExists(): Promise<boolean> {
		try {
			await fs.access(os.platform() === "win32" ? `${this.options.mountPoint}\\\\` : this.options.mountPoint)

			return true
		} catch {
			return false
		}
	}

	private rcloneArgs(): string[] {
		return [
			`mount Filen: ${this.options.mountPoint}`,
			`--config "${this.rcloneConfigPath}"`,
			"--vfs-cache-mode full",
			`--cache-dir "${this.rcloneCachePath}"`,
			"--devname Filen",
			"--volname Filen",
			`--vfs-cache-max-size ${this.options.cacheSizeInGi}Gi`,
			"--dir-cache-time 1m",
			"--cache-info-age 1m",
			"--vfs-block-norm-dupes",
			"--noappledouble",
			"--noapplexattr",
			"--vfs-refresh",
			"--no-gzip-encoding",
			"--checkers 16",
			"--transfers 8",
			"--low-level-retries 3",
			"--retries 3",
			"--use-mmap",
			"--webdav-pacer-min-sleep 1ms",
			"--disable-http2",
			"--file-perms 0640",
			"--dir-perms 0750",
			"--use-server-modtime",
			"--vfs-read-chunk-size 16Mi",
			"--buffer-size 16Mi",
			"--vfs-read-ahead 16Mi",
			"--vfs-read-chunk-size-limit 0",
			"--cache-workers 8",
			"--cache-rps -1"
		]
	}

	private spawnRClone(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			// eslint-disable-next-line no-extra-semi
			;(async () => {
				try {
					if (!(await fs.exists(this.rcloneBinaryPath))) {
						throw new Error(`Rclone binary not found at ${this.rcloneBinaryPath}.`)
					}

					if (!(await fs.exists(this.rcloneConfigPath))) {
						throw new Error(`Rclone config not found at ${this.rcloneConfigPath}.`)
					}

					if (typeof this.options.cacheSizeInGi !== "number" || isNaN(this.options.cacheSizeInGi)) {
						throw new Error("Invalid cache size.")
					}

					await fs.ensureDir(this.rcloneCachePath)

					const checkInterval = setInterval(() => {
						this.checkIfMountExists()
							.then(exists => {
								if (exists) {
									clearInterval(checkInterval)

									resolve()
								}
							})
							.catch(err => {
								clearInterval(checkInterval)

								reject(err)
							})
					}, 1000)

					setTimeout(() => {
						this.checkIfMountExists()
							.then(exists => {
								if (!exists) {
									clearInterval(checkInterval)

									reject(new Error("Could not start rclone process."))
								}
							})
							.catch(err => {
								clearInterval(checkInterval)

								reject(err)
							})
					}, 15000)

					this.rcloneProcess = spawn(this.rcloneBinaryPath, this.rcloneArgs(), {
						stdio: ["ignore", "ignore", "ignore", "ignore"],
						shell: true,
						detached: false
					})
				} catch (e) {
					reject(e)
				}
			})().catch(reject)
		})
	}

	public async start(): Promise<void> {
		await this.webdavServer.start()

		this.webdavStarted = true

		await this.writeRCloneConfig()
		await this.spawnRClone()

		this.rcloneStarted = true
	}
}

export async function main(): Promise<void> {
	if (isMainThread || !parentPort) {
		throw new Error("Not running inside a worker thread.")
	}

	await killProcessByName(rcloneBinaryName).catch(() => {})

	const config = getEnvironmentData("virtualDriveConfig") as FilenDesktopConfig
	const availableDriveLetters = await getAvailableDriveLetters()

	if (!availableDriveLetters.includes(config.virtualDriveConfig.mountPoint)) {
		throw new Error(`Cannot mount virtual drive at ${config.virtualDriveConfig.mountPoint}: Drive letter exists.`)
	}

	const [port] = await findFreePorts(1)

	if (!port) {
		throw new Error("Could not find a free port.")
	}

	const username = generateRandomString(32)
	const password = generateRandomString(32)

	const virtualDrive = new VirtualDrive({
		username,
		password,
		port,
		localPath: config.virtualDriveConfig.localDirPath,
		sdkConfig: config.sdkConfig,
		mountPoint: config.virtualDriveConfig.mountPoint,
		cacheSizeInGi: parseInt(config.virtualDriveConfig.cacheSizeInGi.toString().trim())
	})

	await virtualDrive.start()

	parentPort?.postMessage({
		type: "started"
	} satisfies VirtualDriveWorkerMessage)
}

main().catch(err => {
	parentPort?.postMessage({
		type: "error",
		error: serializeError(err)
	} satisfies VirtualDriveWorkerMessage)
})
