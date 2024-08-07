import fs from "fs-extra"
import pathModule from "path"
import {
	getAvailableDriveLetters,
	generateRandomString,
	checkIfMountExists,
	isUnixMountPointValid,
	isUnixMountPointEmpty,
	httpHealthCheck,
	execCommand,
	killProcessByName,
	isWinFSPInstalled
} from "../utils"
import WebDAVServer from "@filen/webdav"
import { type ChildProcess, spawn } from "child_process"
import findFreePorts from "find-free-ports"
import treeKill from "tree-kill"
import type Worker from "./worker"

export class VirtualDrive {
	private worker: Worker
	public webdavServer: WebDAVServer | null = null
	public rcloneProcess: ChildProcess | null = null
	public webdavUsername: string = "admin"
	public webdavPassword: string = "admin"
	public webdavPort: number = 1905
	public webdavEndpoint: string = "http://127.0.0.1:1905"
	public rcloneBinaryName: string = `filen_rclone_${process.platform}_${process.arch}${process.platform === "win32" ? ".exe" : ""}`
	public active: boolean = false
	public storedBinaryPath = this.normalizePath(pathModule.join(__dirname, "..", "..", "bin", "rclone", this.rcloneBinaryName))

	public constructor(worker: Worker) {
		this.worker = worker

		this.monitor()
	}

	public normalizePath(path: string): string {
		if (process.platform === "win32") {
			return pathModule.normalize(path)
		}

		return pathModule.normalize(path).replace(/(\s+)/g, "\\$1")
	}

	public async copyRCloneBinary(): Promise<void> {
		const paths = await this.paths()

		if (!(await fs.exists(this.storedBinaryPath))) {
			throw new Error("Stored virtual drive binary not found.")
		}

		if (await fs.exists(paths.binary)) {
			return
		}

		await fs.copy(this.storedBinaryPath, paths.binary, {
			overwrite: true
		})

		if (process.platform !== "win32") {
			await execCommand(`chmod +x ${paths.binary}`)
		}
	}

	public async paths(): Promise<{
		binary: string
		config: string
		cache: string
	}> {
		const desktopConfig = await this.worker.waitForConfig()

		return {
			binary: this.normalizePath(pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, this.rcloneBinaryName)),
			cache: this.normalizePath(pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "cache")),
			config: this.normalizePath(pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "rclone.conf"))
		}
	}

	public async obscureRClonePassword(): Promise<string> {
		const paths = await this.paths()

		if (!(await fs.exists(paths.binary))) {
			throw new Error(`Virtual drive binary not found at ${paths.binary}.`)
		}

		return await execCommand(`"${paths.binary}" obscure ${this.webdavPassword}`)
	}

	public async writeRCloneConfig(): Promise<void> {
		const paths = await this.paths()
		const obscuredPassword = await this.obscureRClonePassword()
		const content = `[Filen]\ntype = webdav\nurl = ${this.webdavEndpoint}\nvendor = other\nuser = ${this.webdavUsername}\npass = ${obscuredPassword}`

		await fs.writeFile(paths.config, content, "utf-8")
	}

	public async isWebDAVOnline(): Promise<boolean> {
		return await httpHealthCheck({
			url: `http://127.0.0.1:${this.webdavPort}`,
			method: "GET",
			expectedStatusCode: 401
		})
	}

	public async rcloneArgs(): Promise<string[]> {
		const [desktopConfig, paths] = await Promise.all([this.worker.waitForConfig(), this.paths()])

		return [
			`${process.platform === "win32" || process.platform === "linux" ? "mount" : "nfsmount"} Filen: ${this.normalizePath(
				desktopConfig.virtualDriveConfig.mountPoint
			)}`,
			`--config "${paths.config}"`,
			"--vfs-cache-mode full",
			`--cache-dir "${paths.cache}"`,
			"--devname Filen",
			"--volname Filen",
			`--vfs-cache-max-size ${desktopConfig.virtualDriveConfig.cacheSizeInGi}Gi`,
			"--vfs-cache-max-age 24h",
			"--vfs-cache-poll-interval 5m",
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

	public async spawnRClone(): Promise<void> {
		const [desktopConfig, paths] = await Promise.all([this.worker.waitForConfig(), this.paths()])

		if (!(await fs.exists(paths.binary))) {
			throw new Error(`Virtual drive binary not found at ${paths.binary}.`)
		}

		if (!(await fs.exists(paths.config))) {
			throw new Error(`Virtual drive config not found at ${paths.config}.`)
		}

		if (typeof desktopConfig.virtualDriveConfig.cacheSizeInGi !== "number" || isNaN(desktopConfig.virtualDriveConfig.cacheSizeInGi)) {
			throw new Error("Invalid cache size.")
		}

		await fs.ensureDir(paths.cache)

		const args = await this.rcloneArgs()

		return new Promise<void>((resolve, reject) => {
			let checkInterval: NodeJS.Timeout | undefined = undefined
			let checkTimeout: NodeJS.Timeout | undefined = undefined

			checkInterval = setInterval(async () => {
				try {
					const [mountExists, webdavOnline] = await Promise.all([
						checkIfMountExists(desktopConfig.virtualDriveConfig.mountPoint),
						this.isWebDAVOnline()
					])

					if (mountExists && webdavOnline) {
						clearInterval(checkInterval)
						clearTimeout(checkTimeout)

						resolve()
					}
				} catch {
					// Noop
				}
			}, 1000)

			checkTimeout = setTimeout(async () => {
				try {
					const [mountExists, webdavOnline] = await Promise.all([
						checkIfMountExists(desktopConfig.virtualDriveConfig.mountPoint),
						this.isWebDAVOnline()
					])

					if (!mountExists || !webdavOnline) {
						reject(new Error("Could not start virtual drive."))
					}
				} catch (e) {
					reject(e)
				} finally {
					clearInterval(checkInterval)
					clearTimeout(checkTimeout)
				}
			}, 15000)

			this.rcloneProcess = spawn(paths.binary, args, {
				stdio: ["pipe", "pipe", "pipe", "pipe"],
				shell: true,
				detached: false
			})

			this.rcloneProcess.on("error", err => {
				clearInterval(checkInterval)
				clearTimeout(checkTimeout)

				reject(err)
			})

			this.rcloneProcess.on("exit", () => {
				clearInterval(checkInterval)
				clearTimeout(checkTimeout)

				reject(new Error("Could not start virtual drive."))
			})
		})
	}

	public async cleanupRClone(): Promise<void> {
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

		await killProcessByName(this.rcloneBinaryName).catch(() => {})

		if (process.platform !== "win32") {
			const desktopConfig = await this.worker.waitForConfig()

			await execCommand(`umount -f ${this.normalizePath(desktopConfig.virtualDriveConfig.mountPoint)}`).catch(() => {})
		}
	}

	public async monitor(): Promise<void> {
		try {
			if (!this.active) {
				return
			}

			const desktopConfig = await this.worker.waitForConfig()
			const [mountExists, webdavOnline] = await Promise.all([
				checkIfMountExists(desktopConfig.virtualDriveConfig.mountPoint),
				this.isWebDAVOnline()
			])

			if (!mountExists || !webdavOnline) {
				await this.stop()
			}
		} catch (e) {
			this.worker.logger.log("error", e, "virtualDrive")
		} finally {
			await new Promise<void>(resolve => setTimeout(resolve, 1000))

			this.monitor()
		}
	}

	public async start(): Promise<void> {
		await this.stop()

		try {
			if (process.platform === "win32" && !(await isWinFSPInstalled())) {
				throw new Error("WinFSP not found.")
			}

			await this.copyRCloneBinary()

			const [desktopConfig, sdk] = await Promise.all([this.worker.waitForConfig(), this.worker.getSDKInstance()])

			if (process.platform === "win32") {
				const availableDriveLetters = await getAvailableDriveLetters()

				if (!availableDriveLetters.includes(desktopConfig.virtualDriveConfig.mountPoint)) {
					throw new Error(`Cannot mount virtual drive at ${desktopConfig.virtualDriveConfig.mountPoint}: Drive letter exists.`)
				}
			} else {
				if (!(await isUnixMountPointValid(desktopConfig.virtualDriveConfig.mountPoint))) {
					throw new Error(
						`Cannot mount virtual drive at ${desktopConfig.virtualDriveConfig.mountPoint}: Mount point does not exist.`
					)
				}

				if (!(await isUnixMountPointEmpty(desktopConfig.virtualDriveConfig.mountPoint))) {
					throw new Error(`Cannot mount virtual drive at ${desktopConfig.virtualDriveConfig.mountPoint}: Mount point not empty.`)
				}
			}

			const [port] = await findFreePorts(1)

			if (!port) {
				throw new Error("Could not find a free port.")
			}

			this.webdavPort = port
			this.webdavUsername = generateRandomString(32)
			this.webdavPassword = generateRandomString(32)
			this.webdavEndpoint = `http://127.0.0.1:${this.webdavPort}`
			this.webdavServer = new WebDAVServer({
				hostname: "127.0.0.1",
				port: this.webdavPort,
				https: false,
				user: {
					username: this.webdavUsername,
					password: this.webdavPassword,
					sdk
				},
				authMode: "basic"
			})

			await fs.ensureDir(desktopConfig.virtualDriveConfig.localDirPath)
			await this.webdavServer.start()
			await this.writeRCloneConfig()
			await this.spawnRClone()

			const [mountExists, webdavOnline] = await Promise.all([
				checkIfMountExists(desktopConfig.virtualDriveConfig.mountPoint),
				this.isWebDAVOnline()
			])

			if (!mountExists) {
				throw new Error("Mount not found after starting.")
			}

			if (!webdavOnline) {
				throw new Error("WebDAV server not started.")
			}

			this.active = true
		} catch (e) {
			this.worker.logger.log("error", e, "virtualDrive")

			await this.stop()

			throw e
		}
	}

	public async stop(): Promise<void> {
		try {
			const webdavOnline = await this.isWebDAVOnline()

			if (webdavOnline && this.webdavServer?.serverInstance) {
				await this.webdavServer?.stop()
			}

			await this.cleanupRClone()

			this.webdavServer = null
			this.rcloneProcess = null
			this.active = false
		} catch (e) {
			this.worker.logger.log("error", e, "virtualDrive")

			throw e
		}
	}
}

export default VirtualDrive
