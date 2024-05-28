import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."
import { pathToHash } from "../utils"
import fs from "fs-extra"
import pathModule from "path"
import { CHUNK_SIZE } from "../../constants"
import mimeTypes from "mime-types"
import { Semaphore } from "../../semaphore"

export class Release {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string): Promise<void> {
		if (!this.ops.openFileHandles[path]) {
			return
		}

		if (this.ops.openFileHandles[path]) {
			this.ops.openFileHandles[path] = this.ops.openFileHandles[path]! >= 1 ? this.ops.openFileHandles[path]! - 1 : 0
		}

		if (!this.ops.readWriteMutex[path]) {
			this.ops.readWriteMutex[path] = new Semaphore(1)
		}

		if (this.ops.openFileHandles[path]! <= 0) {
			delete this.ops.chunkDownloadsActive[path]
		}

		const pathHash = pathToHash(path)
		const writePath = pathModule.join(this.ops.writeTmpPath, pathHash)
		const uploadsPath = pathModule.join(this.ops.uploadsTmpPath, pathHash)
		const fullDownloadsPath = pathModule.join(this.ops.fullDownloadsTmpPath, pathHash)
		const decryptedChunksPath = pathModule.join(this.ops.decryptedChunksTmpPath, pathHash)
		let lockAcquired = false

		try {
			if (
				(this.ops.openMode[path] === "w" || this.ops.openMode[path] === "r+") &&
				this.ops.openFileHandles[path]! <= 0 &&
				(await fs.exists(writePath))
			) {
				await this.ops.readWriteMutex[path]!.acquire()

				lockAcquired = true

				await this.ops.sdk.fs().upload({ path, source: writePath })

				await Promise.all([
					fs.rm(fullDownloadsPath, {
						force: true,
						maxRetries: 60 * 10,
						recursive: true,
						retryDelay: 100
					}),
					fs.rm(decryptedChunksPath, {
						force: true,
						maxRetries: 60 * 10,
						recursive: true,
						retryDelay: 100
					}),
					fs.rm(uploadsPath, {
						force: true,
						maxRetries: 60 * 10,
						recursive: true,
						retryDelay: 100
					}),
					fs.rm(writePath, {
						force: true,
						maxRetries: 60 * 10,
						recursive: true,
						retryDelay: 100
					})
				])
			}

			if (this.ops.openFileHandles[path]! <= 0 && this.ops.uploads[path] && !this.ops.openMode[path]) {
				await this.ops.readWriteMutex[path]!.acquire()

				lockAcquired = true

				if (await fs.exists(uploadsPath)) {
					const files = await fs.readdir(uploadsPath)

					if (files.length > 0) {
						const promises: Promise<void>[] = []

						for (const chunkIndex of files) {
							promises.push(
								new Promise((resolve, reject) => {
									fs.readFile(pathModule.join(uploadsPath, chunkIndex))
										.then(data => {
											this.ops.sdk
												.crypto()
												.encrypt()
												.data({
													data,
													key: this.ops.uploads[path]!.key
												})
												.then(encryptedChunk => {
													this.ops.sdk
														.api(3)
														.file()
														.upload()
														.chunk()
														.buffer({
															buffer: encryptedChunk,
															index: parseInt(chunkIndex),
															uuid: this.ops.uploads[path]!.uuid,
															parent: this.ops.uploads[path]!.parent,
															uploadKey: this.ops.uploads[path]!.uploadKey
														})
														.then(() => {
															resolve()
														})
														.catch(reject)
												})
												.catch(reject)
										})
										.catch(reject)
								})
							)
						}

						await Promise.all(promises)
					}

					const hash = this.ops.uploads[path]!.hasher.digest("hex")
					let fileChunks = 0
					let dummyOffset = 0

					while (dummyOffset < this.ops.uploads[path]!.size) {
						fileChunks += 1
						dummyOffset += CHUNK_SIZE
					}

					const mimeType = mimeTypes.lookup(this.ops.uploads[path]!.name) || "application/octet-stream"

					await this.ops.sdk
						.api(3)
						.upload()
						.done({
							uuid: this.ops.uploads[path]!.uuid,
							name: await this.ops.sdk
								.crypto()
								.encrypt()
								.metadata({ metadata: this.ops.uploads[path]!.name, key: this.ops.uploads[path]!.key }),
							nameHashed: await this.ops.sdk.crypto().utils.hashFn({ input: this.ops.uploads[path]!.name.toLowerCase() }),
							size: await this.ops.sdk
								.crypto()
								.encrypt()
								.metadata({ metadata: this.ops.uploads[path]!.size.toString(), key: this.ops.uploads[path]!.key }),
							chunks: fileChunks,
							mime: await this.ops.sdk.crypto().encrypt().metadata({ metadata: mimeType, key: this.ops.uploads[path]!.key }),
							version: 2,
							uploadKey: this.ops.uploads[path]!.uploadKey,
							rm: await this.ops.sdk.crypto().utils.generateRandomString({ length: 32 }),
							metadata: await this.ops.sdk
								.crypto()
								.encrypt()
								.metadata({
									metadata: JSON.stringify({
										name: this.ops.uploads[path]!.name,
										size: this.ops.uploads[path]!.size,
										mime: mimeType,
										key: this.ops.uploads[path]!.key,
										lastModified: Date.now(),
										creation: Date.now(),
										hash
									})
								})
						})

					await this.ops.sdk.cloud().checkIfItemParentIsShared({
						type: "file",
						parent: this.ops.uploads[path]!.parent,
						uuid: this.ops.uploads[path]!.uuid,
						itemMetadata: {
							name: this.ops.uploads[path]!.name,
							size: this.ops.uploads[path]!.size,
							mime: mimeType,
							lastModified: Date.now(),
							creation: Date.now(),
							key: this.ops.uploads[path]!.key,
							hash
						}
					})

					this.ops.sdk.fs()._removeItem({ path })
					this.ops.sdk.fs()._addItem({
						path,
						item: {
							type: "file",
							uuid: this.ops.uploads[path]!.uuid,
							metadata: {
								name: this.ops.uploads[path]!.name,
								size: this.ops.uploads[path]!.size,
								mime: mimeType,
								key: this.ops.uploads[path]!.key,
								lastModified: Date.now(),
								creation: Date.now(),
								version: 2,
								region: this.ops.uploads[path]!.region,
								chunks: fileChunks,
								bucket: this.ops.uploads[path]!.bucket,
								hash
							}
						}
					})

					await Promise.all([
						fs.rm(fullDownloadsPath, {
							force: true,
							maxRetries: 60 * 10,
							recursive: true,
							retryDelay: 100
						}),
						fs.rm(decryptedChunksPath, {
							force: true,
							maxRetries: 60 * 10,
							recursive: true,
							retryDelay: 100
						}),
						fs.rm(uploadsPath, {
							force: true,
							maxRetries: 60 * 10,
							recursive: true,
							retryDelay: 100
						}),
						fs.rm(writePath, {
							force: true,
							maxRetries: 60 * 10,
							recursive: true,
							retryDelay: 100
						})
					])

					delete this.ops.uploads[path]
				}
			}
		} catch (e) {
			if (typeof e === "number") {
				throw e
			}

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw Fuse.default.ENOENT
			}

			throw Fuse.default.EIO
		} finally {
			delete this.ops.openMode[path]

			if (lockAcquired) {
				this.ops.readWriteMutex[path]!.release()
			}
		}
	}

	public run(path: string, callback: FuseErrorCallbackSimple): void {
		this.execute(path)
			.then(() => {
				callback(0)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Release
