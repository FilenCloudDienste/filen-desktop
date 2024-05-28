import * as Fuse from "@gcas/fuse"
import Ops from "./ops/index"
import SDK, { type FilenSDKConfig } from "@filen/sdk"
import os from "os"
import pathModule from "path"
import fs from "fs-extra"
import { waitForSDKConfig } from "../config"
import { IS_NODE } from "../constants"

const FUSE = Fuse.default

/**
 * FUSEWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class FUSEWorker
 * @typedef {FUSEWorker}
 */
export class FUSEWorker {
	private readonly sdk: SDK
	private readonly fuse: Fuse.default
	private readonly baseTmpPath: string
	private readonly fullDownloadsTmpPath: string
	private readonly writeTmpPath: string
	private readonly decryptedChunksTmpPath: string
	private readonly encryptedChunksTmpPath: string
	private readonly uploadsTmpPath: string
	private readonly xattrPath: string

	/**
	 * Creates an instance of FUSEWorker.
	 * @date 2/25/2024 - 10:23:24 PM
	 *
	 * @constructor
	 * @public
	 * @param {{ mountPoint: string }} param0
	 * @param {string} param0.mountPoint
	 */
	public constructor({
		mountPoint,
		baseTmpPath,
		fullDownloadsTmpPath,
		writeTmpPath,
		decryptedChunksTmpPath,
		xattrPath,
		encryptedChunksTmpPath,
		uploadsTmpPath,
		sdkConfig
	}: {
		mountPoint: string
		baseTmpPath: string
		fullDownloadsTmpPath: string
		decryptedChunksTmpPath: string
		encryptedChunksTmpPath: string
		xattrPath: string
		writeTmpPath: string
		uploadsTmpPath: string
		sdkConfig: FilenSDKConfig
	}) {
		this.baseTmpPath = baseTmpPath
		this.fullDownloadsTmpPath = fullDownloadsTmpPath
		this.writeTmpPath = writeTmpPath
		this.decryptedChunksTmpPath = decryptedChunksTmpPath
		this.xattrPath = xattrPath
		this.encryptedChunksTmpPath = encryptedChunksTmpPath
		this.uploadsTmpPath = uploadsTmpPath

		this.sdk = new SDK(sdkConfig)

		const ops = new Ops({
			sdk: this.sdk,
			baseTmpPath,
			fullDownloadsTmpPath,
			writeTmpPath,
			decryptedChunksTmpPath,
			xattrPath,
			encryptedChunksTmpPath,
			uploadsTmpPath
		})

		this.fuse = new FUSE(mountPoint, ops, {
			maxRead: 0,
			force: true,
			volname: "Filen",
			debug: false,
			kernelCache: false,
			autoCache: false,
			attrTimeout: 0,
			acAttrTimeout: 0
		})

		if (process.env.NODE_ENV === "development") {
			setInterval(() => {
				console.log("[FUSEWORKER.MEM.USED]", `${(process.memoryUsage().heapUsed / 1000 / 1000).toFixed(2)} MB`)
				console.log("[FUSEWORKER.MEM.TOTAL]", `${(process.memoryUsage().heapTotal / 1000 / 1000).toFixed(2)} MB`)
			}, 5000)
		}
	}

	/**
	 * Mount FUSE on the host.
	 * @date 2/26/2024 - 7:12:17 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async mount(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.fuse.mount(err => {
				if (err) {
					reject(err)

					return
				}

				resolve()
			})
		})
	}

	/**
	 * Unmount FUSE on the host.
	 * @date 2/26/2024 - 7:12:24 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async unmount(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.fuse.unmount(err => {
				if (err) {
					reject(err)

					return
				}

				resolve()
			})
		})
	}

	/**
	 * Initialize the FUSE worker.
	 * @date 2/23/2024 - 5:51:12 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async initialize(): Promise<void> {
		await this.mount()
	}
}

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

export default FUSEWorker
