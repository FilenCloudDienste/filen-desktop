import type { FuseReadWriteCallback } from "../types"
import type Ops from "."
import { pathToHash } from "../utils"
import fs from "fs-extra"
import pathModule from "path"
import { CHUNK_SIZE } from "../../constants"
import { v4 as uuidv4 } from "uuid"
import { Semaphore } from "../../semaphore"
import crypto from "crypto"

/**
 * Read
 * @date 2/29/2024 - 5:52:51 PM
 *
 * @export
 * @class Read
 * @typedef {Read}
 */
export class Read {
	private readonly ops: Ops

	/**
	 * Creates an instance of Read.
	 * @date 2/29/2024 - 5:52:49 PM
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
	 * Write data to the filesystem.
	 * If the open mode is either R+ or W (Write intent), then we download the full file.
	 * Downloading the full file is needed since we do not support direct writes to files (due to the end to end encryption).
	 * The full file has to be downloaded, the necesarry bytes are written to it and the it is re-uploaded.
	 * If it's a completely new file however, we can utilize streaming, e.g. write each incoming buffer to a temporary file and upload it during the write process. This is genereally more efficient.
	 * @date 2/29/2024 - 5:49:23 PM
	 *
	 * @private
	 * @async
	 * @param {string} path
	 * @param {Buffer} buffer
	 * @param {number} length
	 * @param {number} position
	 * @returns {Promise<number>}
	 */
	private async execute(path: string, buffer: Buffer, length: number, position: number): Promise<number> {
		const pathHash = pathToHash(path)

		try {
			// We are modifying an existing file. Write the changed bytes to the full file and completely re-upload it.
			if (this.ops.openMode[path] === "w" || this.ops.openMode[path] === "r+") {
				const writePath = pathModule.join(this.ops.writeTmpPath, pathHash)

				if (!(await fs.exists(writePath))) {
					await this.ops.sdk.fs().download({ path, destination: writePath })
				}

				const fd = await fs.open(writePath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK)

				try {
					await fs.write(fd, buffer, 0, length, position)

					return length
				} catch (e) {
					console.error(e)

					return 0
				} finally {
					await fs.close(fd)
				}
			}

			const uploadsPath = pathModule.join(this.ops.uploadsTmpPath, pathHash)
			const parentPath = pathModule.posix.dirname(path)
			const tmpChunkPaths: string[] = []
			const parentStat = await this.ops.sdk.fs().stat({ path: parentPath })

			if (parentStat.type !== "directory") {
				return 0
			}

			if (!this.ops.uploads[path]) {
				this.ops.uploads[path] = {
					name: pathModule.posix.basename(path),
					key: await this.ops.sdk.crypto().utils.generateRandomString({ length: 32 }),
					uuid: uuidv4(),
					path,
					size: 0,
					parent: parentStat.uuid,
					uploadKey: await this.ops.sdk.crypto().utils.generateRandomString({ length: 32 }),
					region: "",
					bucket: "",
					hasher: crypto.createHash("sha512"),
					nextHasherChunk: 0
				}
			}

			let currentOffset = 0

			try {
				await fs.ensureDir(uploadsPath)

				if (position <= 0) {
					await fs.emptyDir(uploadsPath)
				}

				while (currentOffset < length) {
					const currentChunkIndex = Math.floor((position + currentOffset) / CHUNK_SIZE)
					const currentChunkPath = pathModule.join(uploadsPath, currentChunkIndex.toString())
					const positionInChunk = (position + currentOffset) % CHUNK_SIZE
					const availableSpaceInChunk = CHUNK_SIZE - positionInChunk

					if (!tmpChunkPaths.includes(currentChunkPath)) {
						tmpChunkPaths.push(currentChunkPath)
					}

					const dataToWrite = Math.min(length - currentOffset, availableSpaceInChunk)
					const writeBuffer = buffer.subarray(currentOffset, currentOffset + dataToWrite)

					if (!this.ops.writeTmpChunkToDiskMutex[path]) {
						this.ops.writeTmpChunkToDiskMutex[path] = new Semaphore(1)
					}

					await this.ops.writeTmpChunkToDiskMutex[path]!.acquire()

					try {
						if (!(await fs.exists(currentChunkPath))) {
							await fs.writeFile(currentChunkPath, writeBuffer)
						} else {
							const fd = await fs.open(currentChunkPath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK)

							try {
								await fs.write(fd, writeBuffer, 0, dataToWrite, positionInChunk)
							} finally {
								await fs.close(fd)
							}
						}
					} finally {
						this.ops.writeTmpChunkToDiskMutex[path]!.release()
					}

					if (positionInChunk + dataToWrite >= CHUNK_SIZE) {
						const data = await fs.readFile(currentChunkPath)

						if (this.ops.uploads[path]!.nextHasherChunk === currentChunkIndex) {
							this.ops.uploads[path]!.hasher.update(data)
							this.ops.uploads[path]!.nextHasherChunk += 1
						}

						const encryptedChunk = await this.ops.sdk.crypto().encrypt().data({ data, key: this.ops.uploads[path]!.key })

						const { region, bucket } = await this.ops.sdk.api(3).file().upload().chunk().buffer({
							buffer: encryptedChunk,
							index: currentChunkIndex,
							uuid: this.ops.uploads[path]!.uuid,
							parent: this.ops.uploads[path]!.parent,
							uploadKey: this.ops.uploads[path]!.uploadKey
						})

						this.ops.uploads[path]!.region = region
						this.ops.uploads[path]!.bucket = bucket

						await fs.rm(currentChunkPath, {
							force: true,
							maxRetries: 60 * 10,
							recursive: true,
							retryDelay: 100
						})
					}

					currentOffset += dataToWrite
				}

				this.ops.uploads[path]!.size += length

				return length
			} catch (e) {
				console.error(e)

				for (const path of tmpChunkPaths) {
					await fs.rm(path, {
						force: true,
						maxRetries: 60 * 10,
						recursive: true,
						retryDelay: 100
					})
				}

				delete this.ops.uploads[path]

				return 0
			}
		} catch (e) {
			console.error(e)

			return 0
		}
	}

	/**
	 * Run the write task.
	 * @date 2/29/2024 - 5:49:01 PM
	 *
	 * @public
	 * @param {string} path
	 * @param {Buffer} buffer
	 * @param {number} length
	 * @param {number} position
	 * @param {FuseReadWriteCallback} callback
	 */
	public run(path: string, buffer: Buffer, length: number, position: number, callback: FuseReadWriteCallback): void {
		this.execute(path, buffer, length, position)
			.then(result => {
				callback(result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Read
