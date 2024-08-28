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
	isWinFSPInstalled,
	killProcessByPid,
	execCommandSudo,
	isFUSEInstalledOnLinux,
	isProcessRunning
} from "../utils"
import WebDAVServer from "@filen/webdav"
import { type ChildProcess, spawn } from "child_process"
import findFreePorts from "find-free-ports"
import type Worker from "./worker"
import { Semaphore } from "../semaphore"
import writeFileAtomic from "write-file-atomic"

export const RCLONE_VERSION = "1670"
export const rcloneBinaryName = `filen_rclone_${process.platform}_${process.arch}_${RCLONE_VERSION}${
	process.platform === "win32" ? ".exe" : ""
}`

export class VirtualDrive {
	private worker: Worker
	public webdavServer: WebDAVServer | null = null
	public rcloneProcess: ChildProcess | null = null
	public webdavUsername: string = "admin"
	public webdavPassword: string = "admin"
	public webdavPort: number = 1905
	public webdavEndpoint: string = "http://127.0.0.1:1905"
	public active: boolean = false
	public storedBinaryPath = pathModule.join(__dirname, "..", "..", "bin", "rclone", rcloneBinaryName)
	public stopMutex = new Semaphore(1)
	public startMutex = new Semaphore(1)

	public constructor(worker: Worker) {
		this.worker = worker

		this.monitor()
	}

	public normalizePathForCmd(path: string): string {
		if (process.platform === "win32") {
			return path
		}

		return pathModule.normalize(path).replace(/(\s+)/g, "\\$1")
	}

	public async copyRCloneBinary(): Promise<void> {
		const paths = await this.paths()

		if (!(await fs.exists(this.storedBinaryPath))) {
			throw new Error("Stored virtual drive binary not found in app bundle.")
		}

		if (!(await fs.exists(paths.binary))) {
			await fs.copy(this.storedBinaryPath, paths.binary, {
				overwrite: true
			})
		}

		if (process.platform !== "win32") {
			await execCommand(`chmod +x ${this.normalizePathForCmd(paths.binary)}`)
		}
	}

	public async paths(): Promise<{
		binary: string
		config: string
		cache: string
		log: string
	}> {
		const desktopConfig = await this.worker.waitForConfig()

		return {
			binary: pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, rcloneBinaryName),
			cache: desktopConfig.virtualDriveConfig.cachePath
				? pathModule.join(desktopConfig.virtualDriveConfig.cachePath, "filenCache")
				: pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "cache"),
			config: pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "rclone.conf"),
			log: pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "rclone.log")
		}
	}

	public async obscureRClonePassword(): Promise<string> {
		const paths = await this.paths()

		if (!(await fs.exists(paths.binary))) {
			throw new Error(`Virtual drive binary not found at ${paths.binary}.`)
		}

		return await execCommand(`${this.normalizePathForCmd(paths.binary)} obscure ${this.webdavPassword}`)
	}

	public async writeRCloneConfig(): Promise<void> {
		const paths = await this.paths()
		const obscuredPassword = await this.obscureRClonePassword()
		const content = `[Filen]\ntype = webdav\nurl = ${this.webdavEndpoint}\nvendor = other\nuser = ${this.webdavUsername}\npass = ${obscuredPassword}`

		await writeFileAtomic(paths.config, content, "utf-8")
	}

	public async isWebDAVOnline(): Promise<boolean> {
		return await httpHealthCheck({
			url: `http://127.0.0.1:${this.webdavPort}`,
			method: "GET",
			expectedStatusCode: 401
		})
	}

	public async rcloneArgs(): Promise<string[]> {
		const [desktopConfig, paths, availableCacheSize] = await Promise.all([
			this.worker.waitForConfig(),
			this.paths(),
			this.worker.virtualDriveAvailableCacheSize()
		])

		const excludePatterns = [
			// macOS temporary files and folders
			".DS_Store",
			"._*",
			".Trashes/**",
			".Spotlight-V100/**",
			".TemporaryItems/**",
			// Windows temporary files and folders
			"*.tmp",
			"~*",
			"Thumbs.db",
			"desktop.ini",
			"$RECYCLE.BIN/**",
			"System Volume Information/**",
			"Temp/**",
			"AppData/Local/Temp/**",
			// Linux temporary files and folders
			".Trash*",
			"*.swp",
			"*.temp",
			".*.swx",
			"/tmp/**",
			"/var/tmp/**",
			// Other common exclusions
			"**/.cache/**",
			"**/Cache/**",
			"**/.npm/_cacache/**"
		]

		const availableCacheSizeGib = Math.floor(availableCacheSize / (1024 / 1024 / 1024))
		const cacheSize =
			desktopConfig.virtualDriveConfig.cacheSizeInGi >= availableCacheSizeGib
				? availableCacheSizeGib
				: desktopConfig.virtualDriveConfig.cacheSizeInGi

		return [
			`${process.platform === "win32" || process.platform === "linux" ? "mount" : "nfsmount"} Filen: ${this.normalizePathForCmd(
				desktopConfig.virtualDriveConfig.mountPoint
			)}`,
			`--config "${paths.config}"`,
			"--vfs-cache-mode full",
			...(desktopConfig.virtualDriveConfig.readOnly ? ["--read-only"] : []),
			`--cache-dir "${paths.cache}"`,
			`--vfs-cache-max-size ${cacheSize}Gi`,
			"--vfs-cache-min-free-space 5Gi",
			"--vfs-cache-max-age 720h",
			"--vfs-cache-poll-interval 1m",
			"--dir-cache-time 1m",
			"--cache-info-age 1m",
			// Already present in the SDK fs() class
			//"--vfs-block-norm-dupes",
			"--noappledouble",
			"--noapplexattr",
			"--no-gzip-encoding",
			"--low-level-retries 10",
			"--retries 10",
			"--use-mmap",
			"--disable-http2",
			"--file-perms 0666",
			"--dir-perms 0777",
			"--use-server-modtime",
			"--vfs-read-chunk-size 128Mi",
			"--buffer-size 0",
			"--vfs-read-ahead 1024Mi",
			"--vfs-read-chunk-size-limit 0",
			"--no-checksum",
			"--transfers 16",
			"--vfs-fast-fingerprint",
			`--log-file "${paths.log}"`,
			"--devname Filen",
			...(process.platform === "win32" || process.platform === "darwin" ? ["--volname \\\\Filen\\Filen"] : []),
			...(process.platform === "win32"
				? // eslint-disable-next-line quotes
				  ['-o FileSecurity="D:P(A;;FA;;;WD)"', "--network-mode"]
				: []),
			...excludePatterns.map(pattern => `--exclude "${pattern}"`)
		]
	}

	public async isMountActuallyActive(): Promise<boolean> {
		try {
			const desktopConfig = await this.worker.waitForConfig()
			const [mountExists, webdavOnline, rcloneRunning] = await Promise.all([
				checkIfMountExists(desktopConfig.virtualDriveConfig.mountPoint),
				this.isWebDAVOnline(),
				isProcessRunning(rcloneBinaryName)
			])

			if (!mountExists || !webdavOnline || !rcloneRunning) {
				return false
			}

			const stat = await fs.stat(desktopConfig.virtualDriveConfig.mountPoint)

			return process.platform === "darwin" || process.platform === "linux" ? stat.ino === 0 || stat.birthtimeMs === 0 : stat.ino === 1
		} catch {
			return false
		}
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

		if (await fs.exists(paths.log)) {
			const logStats = await fs.stat(paths.log)

			if (logStats.size > 1024 * 1024 * 10) {
				await fs.unlink(paths.log)
			}
		}

		const args = await this.rcloneArgs()

		return new Promise<void>((resolve, reject) => {
			let checkInterval: NodeJS.Timeout | undefined = undefined
			let checkTimeout: NodeJS.Timeout | undefined = undefined
			let rcloneSpawned = false

			checkInterval = setInterval(async () => {
				try {
					if ((await this.isMountActuallyActive()) && rcloneSpawned) {
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
					if (!(await this.isMountActuallyActive())) {
						clearInterval(checkInterval)
						clearTimeout(checkTimeout)

						reject(new Error("Could not start virtual drive."))
					}
				} catch (e) {
					clearInterval(checkInterval)
					clearTimeout(checkTimeout)

					reject(e)
				}
			}, 15000)

			this.rcloneProcess = spawn(this.normalizePathForCmd(paths.binary), args, {
				stdio: "ignore",
				shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
				detached: false
			})

			this.rcloneProcess.on("spawn", () => {
				rcloneSpawned = true
			})

			this.rcloneProcess.on("error", err => {
				rcloneSpawned = false

				clearInterval(checkInterval)
				clearTimeout(checkTimeout)

				reject(err)
			})

			this.rcloneProcess.on("exit", () => {
				rcloneSpawned = false

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

			this.rcloneProcess.kill("SIGKILL")

			if (this.rcloneProcess.pid) {
				await killProcessByPid(this.rcloneProcess.pid).catch(() => {})
			}
		}

		await killProcessByName(rcloneBinaryName).catch(() => {})

		if (this.worker.isAuthed() && (process.platform === "linux" || process.platform === "darwin")) {
			const desktopConfig = await this.worker.waitForConfig()
			const umountCmd =
				process.platform === "darwin"
					? `umount -f ${this.normalizePathForCmd(desktopConfig.virtualDriveConfig.mountPoint)}`
					: `umount -f -l ${this.normalizePathForCmd(desktopConfig.virtualDriveConfig.mountPoint)}`
			const listCmd = `mount -t ${process.platform === "linux" ? "fuse.rclone" : "nfs"}`
			let listedMounts = await execCommand(listCmd)

			if (listedMounts.length > 0 && listedMounts.includes(this.normalizePathForCmd(desktopConfig.virtualDriveConfig.mountPoint))) {
				await execCommand(umountCmd).catch(() => {})
			}

			await new Promise<void>(resolve => setTimeout(resolve, 1000))

			listedMounts = await execCommand(listCmd)

			if (listedMounts.length > 0 && listedMounts.includes(this.normalizePathForCmd(desktopConfig.virtualDriveConfig.mountPoint))) {
				await execCommandSudo(umountCmd).catch(() => {})
			}
		}
	}

	public async monitor(): Promise<void> {
		try {
			if (!this.active) {
				return
			}

			if (!(await this.isMountActuallyActive())) {
				await this.stop()
			}
		} catch (e) {
			this.worker.logger.log("error", e, "virtualDrive")
			this.worker.logger.log("error", e)
		} finally {
			await new Promise<void>(resolve => setTimeout(resolve, 30000))

			this.monitor()
		}
	}

	public async start(): Promise<void> {
		await this.startMutex.acquire()

		try {
			await this.stop()

			if (process.platform === "win32" && !(await isWinFSPInstalled())) {
				throw new Error("WinFSP not installed.")
			}

			if (process.platform === "linux" && !(await isFUSEInstalledOnLinux())) {
				throw new Error("FUSE not installed.")
			}

			await this.copyRCloneBinary()

			const [desktopConfig, sdk] = await Promise.all([this.worker.waitForConfig(), this.worker.getSDKInstance()])

			if (process.platform === "win32") {
				const availableDriveLetters = await getAvailableDriveLetters()

				if (!availableDriveLetters.includes(desktopConfig.virtualDriveConfig.mountPoint)) {
					throw new Error(`Cannot mount virtual drive at ${desktopConfig.virtualDriveConfig.mountPoint}: Drive letter exists.`)
				}
			} else {
				if (
					process.platform === "linux" &&
					!desktopConfig.virtualDriveConfig.mountPoint.startsWith(`/home/${process.env.USER ?? "user"}`)
				) {
					throw new Error("Cannot mount to a directory outside of your home directory.")
				}

				if (
					process.platform === "darwin" &&
					!desktopConfig.virtualDriveConfig.mountPoint.startsWith(`/Users/${process.env.USER ?? "user"}`)
				) {
					throw new Error("Cannot mount to a directory outside of your user directory.")
				}

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

			if (!(await this.isMountActuallyActive())) {
				throw new Error("Could not start virtual drive.")
			}

			this.active = true
		} catch (e) {
			this.worker.logger.log("error", e, "virtualDrive")
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
			this.worker.logger.log("error", e)

			throw e
		} finally {
			this.stopMutex.release()
		}
	}
}

export default VirtualDrive
