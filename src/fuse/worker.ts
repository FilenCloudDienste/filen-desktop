import os from "os"
import pathModule from "path"
import fs from "fs-extra"
import { waitForSDKConfig } from "../config"
import { IS_NODE } from "../constants"
import FUSEWorker from "@filen/virtual-drive"

// Only start the worker if it is actually invoked.
if (process.argv.slice(2).includes("--filen-desktop-worker") && IS_NODE) {
	// TODO: Remove

	const baseTmpPath = pathModule.join(os.tmpdir(), "filen-desktop")
	const fullDownloadsTmpPath = pathModule.join(baseTmpPath, "fullDownloads")
	const uploadsTmpPath = pathModule.join(baseTmpPath, "uploads")
	const encryptedChunksTmpPath = pathModule.join(baseTmpPath, "encryptedChunks")
	const decryptedChunksTmpPath = pathModule.join(baseTmpPath, "decryptedChunks")
	const xattrPath = pathModule.join(baseTmpPath, "xattr")
	const writeTmpPath = pathModule.join(baseTmpPath, "write")

	fs.ensureDirSync(baseTmpPath)
	fs.ensureDirSync(fullDownloadsTmpPath)
	fs.ensureDirSync(uploadsTmpPath)
	fs.ensureDirSync(encryptedChunksTmpPath)
	fs.ensureDirSync(decryptedChunksTmpPath)
	fs.ensureDirSync(xattrPath)
	fs.ensureDirSync(writeTmpPath)

	process.stdout.write(
		JSON.stringify({
			type: "ready"
		})
	)

	waitForSDKConfig()
		.then(sdkConfig => {
			const fuseWorker = new FUSEWorker({
				mountPoint: "M:",
				baseTmpPath,
				fullDownloadsTmpPath,
				uploadsTmpPath,
				encryptedChunksTmpPath,
				decryptedChunksTmpPath,
				xattrPath,
				writeTmpPath,
				sdkConfig
			})

			fuseWorker
				.initialize()
				.then(() => {
					//
				})
				.catch(err => {
					console.error(err)

					process.exit(1)
				})
		})
		.catch(err => {
			console.error(err)

			process.exit(1)
		})
}
