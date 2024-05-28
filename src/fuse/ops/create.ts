import type { FuseCreateCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."
import { uuidToNumber, pathToHash } from "../utils"
import { Semaphore } from "../../semaphore"
import { v4 as uuidv4 } from "uuid"
import { FILE_MODE, FUSE_DEFAULT_FILE_MODE } from "./constants"
import pathModule from "path"
import fs from "fs-extra"

/**
 * Create
 * @date 2/29/2024 - 1:43:36 AM
 *
 * @export
 * @class Create
 * @typedef {Create}
 */
export class Create {
	private readonly ops: Ops

	/**
	 * Creates an instance of Create.
	 * @date 2/29/2024 - 1:43:41 AM
	 *
	 * @constructor
	 * @public
	 * @param {{ ops: Ops }} param0
	 * @param {Ops} param0.ops
	 */
	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	/**
	 * Get the UUID of a path. If it does not exist, return null.
	 * @date 2/29/2024 - 1:43:44 AM
	 *
	 * @private
	 * @async
	 * @param {string} path
	 * @returns {Promise<string | null>}
	 */
	private async uuid(path: string): Promise<string | null> {
		try {
			const stat = await this.ops.sdk.fs().stat({ path })

			if (stat.type !== "file") {
				return null
			}

			return stat.uuid
		} catch (e) {
			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				return null
			}

			throw e
		}
	}

	/**
	 * Creates a "virtual" file handle since we don't support 0 byte files and we do not want to upload a 1 byte placeholder file on each create call.
	 * This speeds up all subsequent calls dramatically. Make sure to take the virtual file handles into account (readdir, getattr, unlink, rename, read, write etc.).
	 * @date 2/29/2024 - 1:44:07 AM
	 *
	 * @private
	 * @async
	 * @param {string} path
	 * @returns {Promise<number>}
	 */
	private async execute(path: string): Promise<number> {
		if (!this.ops.readWriteMutex[path]) {
			this.ops.readWriteMutex[path] = new Semaphore(1)
		}

		await this.ops.readWriteMutex[path]!.acquire()

		try {
			if (this.ops.virtualFiles[path]) {
				this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

				return this.ops.nextFd++
			}

			const uuid = await this.uuid(path)

			if (uuid) {
				this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

				return this.ops.nextFd++
			}

			const ino = uuidToNumber(uuidv4())

			this.ops.virtualFiles[path] = {
				mode: FILE_MODE | FUSE_DEFAULT_FILE_MODE,
				uid: process.getuid ? process.getuid() : 0,
				gid: process.getgid ? process.getgid() : 0,
				size: 0,
				dev: 1,
				nlink: 1,
				ino,
				rdev: 1,
				blksize: 4096,
				blocks: 1,
				atime: new Date(),
				mtime: new Date(),
				ctime: new Date()
			}

			// Write temporary data to disk
			const pathHash = pathToHash(path)
			const writePath = pathModule.join(this.ops.writeTmpPath, pathHash)
			const decryptedChunksPath = pathModule.join(this.ops.decryptedChunksTmpPath, pathHash)
			const fullDownloadsPath = pathModule.join(this.ops.fullDownloadsTmpPath, pathHash)
			const content = Buffer.from(" ", "utf-8")

			await Promise.all([
				fs.writeFile(writePath, content),
				fs.writeFile(pathModule.join(decryptedChunksPath, "0"), content),
				fs.writeFile(fullDownloadsPath, content)
			])

			this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

			return this.ops.nextFd++
		} catch (e) {
			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw Fuse.default.ENOENT
			}

			throw Fuse.default.EIO
		} finally {
			this.ops.readWriteMutex[path]!.release()
		}
	}

	/**
	 * Run the create op.
	 * @date 2/29/2024 - 1:44:56 AM
	 *
	 * @public
	 * @param {string} path
	 * @param {number} mode
	 * @param {FuseCreateCallback} callback
	 */
	public run(path: string, mode: number, callback: FuseCreateCallback): void {
		this.execute(path)
			.then(result => {
				callback(0, result, mode)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Create
