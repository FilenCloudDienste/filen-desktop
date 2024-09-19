import net from "net"
import axios from "axios"
import https from "https"
import { exec } from "child_process"
import pathModule from "path"

/**
 * Chunk large Promise.all executions.
 * @date 2/14/2024 - 11:59:34 PM
 *
 * @export
 * @async
 * @template T
 * @param {Promise<T>[]} promises
 * @param {number} [chunkSize=10000]
 * @returns {Promise<T[]>}
 */
export async function promiseAllChunked<T>(promises: Promise<T>[], chunkSize = 100000): Promise<T[]> {
	const results: T[] = []

	for (let i = 0; i < promises.length; i += chunkSize) {
		const chunkResults = await Promise.all(promises.slice(i, i + chunkSize))

		results.push(...chunkResults)
	}

	return results
}

export async function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()

		server.once("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				resolve(true)

				return
			}

			reject(err)
		})

		server.once("listening", () => {
			server.close(() => {
				resolve(false)
			})
		})

		server.listen(port)
	})
}

export function canStartServerOnIPAndPort(ip: string, port: number): Promise<boolean> {
	return new Promise(resolve => {
		const server = net.createServer()

		server.once("error", () => {
			server.close()

			resolve(false)
		})

		server.once("listening", () => {
			server.close()

			resolve(true)
		})

		server.listen(port, ip)
	})
}

export const httpsAgent = new https.Agent({
	rejectUnauthorized: false
})

export async function httpHealthCheck({
	url,
	method = "GET",
	expectedStatusCode = 200,
	timeout = 5000
}: {
	url: string
	expectedStatusCode?: number
	method?: "GET" | "POST" | "HEAD"
	timeout?: number
}): Promise<boolean> {
	const abortController = new AbortController()

	const timeouter = setTimeout(() => {
		abortController.abort()
	}, timeout)

	try {
		const response = await axios({
			url,
			timeout,
			method,
			signal: abortController.signal,
			validateStatus: () => true,
			httpsAgent
		})

		clearTimeout(timeouter)

		return response.status === expectedStatusCode
	} catch (e) {
		clearTimeout(timeouter)

		return false
	}
}

export async function execCommand(command: string, trimStdOut: boolean = true): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(
			command,
			{
				shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh"
			},
			(err, stdout, stderr) => {
				if (err || stderr) {
					reject(err ? err : new Error(stderr))

					return
				}

				resolve(trimStdOut ? stdout.trim() : stdout)
			}
		)
	})
}

export type SerializedError = {
	name: string
	message: string
	stack?: string
	stringified: string
}

export function serializeError(error: Error): SerializedError {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		stringified: JSON.stringify(error)
	}
}

export function deserializeError(serializedError: SerializedError): Error {
	const error = new Error(serializedError.message)

	error.name = serializedError.name
	error.stack = serializedError.stack

	return error
}

export async function isProcessRunning(processName: string): Promise<boolean> {
	return await new Promise<boolean>((resolve, reject) => {
		let command = ""

		if (process.platform === "win32") {
			command = `tasklist /FI "IMAGENAME eq ${processName}"`
		} else if (process.platform === "darwin" || process.platform === "linux") {
			command = `pgrep -f ${processName}`
		} else {
			reject(false)

			return
		}

		exec(command, (err, stdout, stderr) => {
			if (err) {
				reject(false)

				return
			}

			if (stderr) {
				reject(false)

				return
			}

			resolve(stdout.trim().length > 0)
		})
	})
}

/**
 * Parse the requested byte range from the header.
 *
 * @export
 * @param {string} range
 * @param {number} totalLength
 * @returns {({ start: number; end: number } | null)}
 */
export function parseByteRange(range: string, totalLength: number): { start: number; end: number } | null {
	const [unit, rangeValue] = range.split("=")

	if (unit !== "bytes" || !rangeValue) {
		return null
	}

	const [startStr, endStr] = rangeValue.split("-")

	if (!startStr) {
		return null
	}

	const start = parseInt(startStr, 10)
	const end = endStr ? parseInt(endStr, 10) : totalLength - 1

	if (isNaN(start) || isNaN(end) || start < 0 || end >= totalLength || start > end) {
		return null
	}

	return {
		start,
		end
	}
}

export type DriveInfo = {
	isPhysical: boolean
	isExternal: boolean
}

export type LinuxDrive = {
	name: string
	type: string
	mountpoint?: string
	fstype?: string
	model?: string
	serial?: string
	size?: string
	state?: string
	rota?: boolean
	children?: LinuxDrive[]
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getDiskType(filePath: string): Promise<DriveInfo | null> {
	return null // Temporary disabled

	/*const normalizedPath = pathModule.resolve(filePath)

	if (process.platform === "win32") {
		return await getDiskTypeWindows(normalizedPath)
	} else if (process.platform === "darwin") {
		return await getDiskTypeMacOS(normalizedPath)
	} else if (process.platform === "linux") {
		return await getDiskTypeLinux(normalizedPath)
	} else {
		throw new Error(`Unsupported platform: ${process.platform}`)
	}*/
}

export async function getDiskTypeWindows(filePath: string): Promise<DriveInfo | null> {
	const driveLetter = pathModule.parse(filePath).root.split("\\").join("")
	const command = `wmic logicaldisk where "DeviceID='${driveLetter}'" get DriveType`

	const stdout = await execCommand(command)
	const lines = stdout.trim().split("\n")

	if (lines.length < 2 || !lines[1]) {
		return null
	}

	const driveType = lines[1].trim()

	if (!driveType) {
		return null
	}

	const isPhysical = driveType.trim() === "3"
	const isExternal = !isPhysical

	return {
		isPhysical,
		isExternal
	}
}

export async function getDiskTypeMacOS(filePath: string): Promise<DriveInfo | null> {
	try {
		const mountOutput = await execCommand(`df "${filePath}" | tail -1 | awk '{print $1}'`)

		if (!mountOutput || mountOutput.length <= 0) {
			return null
		}

		const volumePath = mountOutput.trim()
		const stdout = await execCommand(`diskutil info -plist "${volumePath}"`)

		if (stdout.length <= 0) {
			return null
		}

		const lines = stdout.split("\n")
		const internalKeyIndex = lines.findIndex(line => line.includes("<key>Internal</key>"))

		if (internalKeyIndex === -1) {
			return null
		}

		const internalValueLine = lines[internalKeyIndex + 1]

		if (!internalValueLine || internalValueLine.length <= 0) {
			return null
		}

		const isInternal = internalValueLine.includes("true")
		const isExternal = !isInternal

		return {
			isPhysical: isInternal,
			isExternal: isExternal
		}
	} catch {
		return null
	}
}

export async function getDiskTypeLinux(filePath: string): Promise<DriveInfo | null> {
	try {
		const stdout = await execCommand("lsblk -o NAME,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,SIZE,STATE,ROTA --json")
		const drives: { blockdevices: LinuxDrive[] } = JSON.parse(stdout)
		const targetDrive = findLinuxDiskByPath(drives.blockdevices, filePath)

		if (!targetDrive) {
			return null
		}

		const isPhysical =
			targetDrive.type === "disk" ||
			["ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "reiserfs", "ntfs", "zfs_member"].includes(targetDrive.fstype ?? "")
		const isExternal = !isPhysical

		return {
			isPhysical,
			isExternal
		}
	} catch {
		return null
	}
}

export function findLinuxDiskByPath(drives: LinuxDrive[], filePath: string): LinuxDrive | null {
	for (const drive of drives) {
		if (drive.mountpoint && filePath.startsWith(drive.mountpoint)) {
			return drive
		}

		if (drive.children) {
			const childDrive = findLinuxDiskByPath(drive.children, filePath)

			if (childDrive) {
				return childDrive
			}
		}
	}

	return null
}
