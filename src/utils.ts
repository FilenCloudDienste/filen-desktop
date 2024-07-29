import fs from "fs-extra"
import net from "net"
import crypto from "crypto"
import axios from "axios"
import os from "os"
import https from "https"
import { exec } from "child_process"

/**
 * "Sleep" for N milliseconds.
 * @date 3/1/2024 - 10:04:06 PM
 *
 * @export
 * @async
 * @param {number} ms
 * @returns {Promise<void>}
 */
export async function sleep(ms: number): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, ms))
}

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

/**
 * Chunk large Promise.allSettled executions.
 * @date 3/5/2024 - 12:41:08 PM
 *
 * @export
 * @async
 * @template T
 * @param {Promise<T>[]} promises
 * @param {number} [chunkSize=100000]
 * @returns {Promise<T[]>}
 */
export async function promiseAllSettledChunked<T>(promises: Promise<T>[], chunkSize = 100000): Promise<T[]> {
	const results: T[] = []

	for (let i = 0; i < promises.length; i += chunkSize) {
		const chunkPromisesSettled = await Promise.allSettled(promises.slice(i, i + chunkSize))
		const chunkResults = chunkPromisesSettled.reduce((acc: T[], current) => {
			if (current.status === "fulfilled") {
				acc.push(current.value)
			} else {
				// Handle rejected promises or do something with the error (current.reason)
			}

			return acc
		}, [])

		results.push(...chunkResults)
	}

	return results
}

export async function getExistingDrives(): Promise<string[]> {
	const drives: string[] = []

	const driveChecks = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(async letter => {
		const drivePath = `${letter}:\\`

		try {
			await fs.access(drivePath)

			drives.push(letter)
		} catch {
			// Noop
		}
	})

	await Promise.all(driveChecks)

	return drives
}

export async function getAvailableDriveLetters(): Promise<string[]> {
	const driveLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
	const existingDrives = await getExistingDrives()
	const availableDrives = driveLetters.filter(letter => !existingDrives.includes(letter)).map(letter => `${letter}:`)

	return availableDrives
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

export function generateRandomString(length: number): string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

	const randomBytes = crypto.randomBytes(length + 2)
	const result = new Array(length)
	let cursor = 0

	for (let i = 0; i < length; i++) {
		cursor += randomBytes[i]!
		result[i] = chars[cursor % chars.length]
	}

	return result.join("")
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

export async function checkIfMountExists(mountPoint: string): Promise<boolean> {
	try {
		await fs.access(os.platform() === "win32" ? `${mountPoint}\\\\` : mountPoint, fs.constants.R_OK | fs.constants.W_OK)

		return true
	} catch {
		return false
	}
}

export async function execCommand(command: string, trimStdOut: boolean = true): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command, (err, stdout, stderr) => {
			if (err || stderr) {
				reject(err ? err : new Error(stderr))

				return
			}

			resolve(trimStdOut ? stdout.trim() : stdout)
		})
	})
}

export async function killProcessByName(processName: string): Promise<void> {
	await execCommand(os.platform() === "win32" ? `taskkill /F /T /IM ${processName}` : `pkill -TERM -P $(pgrep -d',' -f ${processName})`)
}
