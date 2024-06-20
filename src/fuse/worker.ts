import FUSE from "@filen/virtual-drive"
import { type FUSEWorkerMessage } from "."
import { type FilenDesktopConfig } from "../types"
import fs from "fs-extra"
import pathModule from "path"
import { serializeError } from "../lib/worker"
import { getAvailableDriveLetters } from "../utils"

let config: FilenDesktopConfig | null = null

process.on("message", (message: FUSEWorkerMessage) => {
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
	const availableDriveLetters = await getAvailableDriveLetters()

	if (!availableDriveLetters.includes(config.fuseConfig.mountPoint)) {
		throw new Error(`Cannot mount virtual drive at ${config.fuseConfig.mountPoint}: Drive letter exists.`)
	}

	const fullDownloadsTmpPath = pathModule.join(config.fuseConfig.localDirPath, "fullDownloads")
	const uploadsTmpPath = pathModule.join(config.fuseConfig.localDirPath, "uploads")
	const encryptedChunksTmpPath = pathModule.join(config.fuseConfig.localDirPath, "encryptedChunks")
	const decryptedChunksTmpPath = pathModule.join(config.fuseConfig.localDirPath, "decryptedChunks")
	const xattrPath = pathModule.join(config.fuseConfig.localDirPath, "xattr")
	const writeTmpPath = pathModule.join(config.fuseConfig.localDirPath, "write")

	await Promise.all([
		fs.ensureDir(config.fuseConfig.localDirPath),
		fs.ensureDir(fullDownloadsTmpPath),
		fs.ensureDir(uploadsTmpPath),
		fs.ensureDir(encryptedChunksTmpPath),
		fs.ensureDir(decryptedChunksTmpPath),
		fs.ensureDir(xattrPath),
		fs.ensureDir(writeTmpPath)
	])

	const fuse = new FUSE({
		mountPoint: config.fuseConfig.mountPoint,
		baseTmpPath: config.fuseConfig.localDirPath,
		fullDownloadsTmpPath,
		uploadsTmpPath,
		encryptedChunksTmpPath,
		decryptedChunksTmpPath,
		xattrPath,
		writeTmpPath,
		sdkConfig: config.sdkConfig
	})

	await fuse.initialize()

	if (process.send) {
		process.send({
			type: "started"
		} satisfies FUSEWorkerMessage)
	}
}

main().catch(err => {
	if (process.send) {
		process.send({
			type: "error",
			error: serializeError(err)
		} satisfies FUSEWorkerMessage)
	}
})
