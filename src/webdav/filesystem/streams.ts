import { Writable } from "stream"
import SDK, { FileEncryptionVersion, FSItem } from "@filen/sdk"
import { Semaphore } from "../../semaphore"
import mimeTypes from "mime-types"
import crypto from "crypto"
import { CHUNK_SIZE, MAX_UPLOAD_THREADS } from "../../constants"

/**
 * ChunkedUploadWriter
 * @date 2/29/2024 - 9:58:16 PM
 *
 * @export
 * @class ChunkedUploadWriter
 * @typedef {ChunkedUploadWriter}
 * @extends {Writable}
 */
export class ChunkedUploadWriter extends Writable {
	private chunkBuffer: Buffer
	private readonly sdk: SDK
	private readonly uploadSemaphore = new Semaphore(MAX_UPLOAD_THREADS)
	private readonly uuid: string
	private readonly version: FileEncryptionVersion
	private readonly key: string
	private bucket: string
	private region: string
	private size: number
	private readonly mime: string
	private readonly lastModified: number
	private readonly name: string
	private index: number
	private readonly uploadKey: string
	private readonly parent: string
	private readonly hasher: crypto.Hash
	private readonly processingMutex = new Semaphore(1)
	private chunksUploaded = 0

	/**
	 * Creates an instance of ChunkedUploadWriter.
	 * @date 2/29/2024 - 9:58:21 PM
	 *
	 * @constructor
	 * @public
	 * @param {{
	 * 		options?: ConstructorParameters<typeof Writable>[0]
	 * 		sdk: SDK
	 * 		uuid: string
	 * 		key: string
	 * 		name: string
	 * 		uploadKey: string
	 * 		parent: string
	 * 	}} param0
	 * @param {ConstructorParameters<any>} [param0.options=undefined]
	 * @param {SDK} param0.sdk
	 * @param {string} param0.uuid
	 * @param {string} param0.key
	 * @param {string} param0.name
	 * @param {string} param0.uploadKey
	 * @param {string} param0.parent
	 */
	public constructor({
		options = undefined,
		sdk,
		uuid,
		key,
		name,
		uploadKey,
		parent
	}: {
		options?: ConstructorParameters<typeof Writable>[0]
		sdk: SDK
		uuid: string
		key: string
		name: string
		uploadKey: string
		parent: string
	}) {
		super(options)

		this.chunkBuffer = Buffer.from([])
		this.sdk = sdk
		this.uuid = uuid
		this.key = key
		this.version = 2
		this.size = 0
		this.name = name
		this.lastModified = Date.now()
		this.mime = mimeTypes.lookup(name) || "application/octet-stream"
		this.bucket = ""
		this.region = ""
		this.index = -1
		this.uploadKey = uploadKey
		this.parent = parent
		this.hasher = crypto.createHash("sha512")
	}

	/**
	 * Write data to the stream.
	 * @date 2/29/2024 - 9:58:27 PM
	 *
	 * @public
	 * @param {(Buffer | string)} chunk
	 * @param {BufferEncoding} encoding
	 * @param {(error?: Error | null | undefined) => void} callback
	 */
	public _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null | undefined) => void): void {
		if (!(chunk instanceof Buffer)) {
			chunk = Buffer.from(chunk, encoding)
		}

		if (chunk.byteLength <= 0) {
			callback()

			return
		}

		this.uploadSemaphore
			.acquire()
			.then(() => {
				this.chunkBuffer = Buffer.concat([this.chunkBuffer, chunk as Buffer])

				if (this.chunkBuffer.byteLength >= CHUNK_SIZE) {
					const chunkToWrite = this.chunkBuffer.subarray(0, CHUNK_SIZE)

					this.chunkBuffer = this.chunkBuffer.subarray(CHUNK_SIZE)

					this.upload(chunkToWrite)
						.catch(err => {
							console.error(err)

							this.destroy(err)
						})
						.finally(() => {
							this.uploadSemaphore.release()
						})
				} else {
					this.uploadSemaphore.release()
				}

				callback()
			})
			.catch(callback)
	}

	/**
	 * Finalize writing.
	 * @date 2/29/2024 - 9:58:39 PM
	 *
	 * @public
	 * @param {(error?: Error | null | undefined) => void} callback
	 */
	public _final(callback: (error?: Error | null | undefined) => void): void {
		this.processChunks()
			.then(() => {
				this.finalizeUpload()
					.then(() => callback())
					.catch(callback)
			})
			.catch(callback)
	}

	/**
	 * Process each chunk.
	 * @date 2/29/2024 - 9:58:46 PM
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async processChunks(): Promise<void> {
		if (this.chunkBuffer.byteLength <= 0) {
			return
		}

		while (this.chunkBuffer.byteLength >= CHUNK_SIZE) {
			await this.processingMutex.acquire()

			let chunkToWrite: Buffer | null | undefined = null

			try {
				chunkToWrite = this.chunkBuffer.subarray(0, CHUNK_SIZE)

				this.chunkBuffer = this.chunkBuffer.subarray(CHUNK_SIZE)
			} finally {
				this.processingMutex.release()
			}

			if (chunkToWrite instanceof Buffer && chunkToWrite.byteLength > 0) {
				await this.upload(chunkToWrite)
			}
		}
	}

	/**
	 * Encrypt, hash and upload a chunk.
	 * @date 2/29/2024 - 9:58:54 PM
	 *
	 * @private
	 * @async
	 * @param {Buffer} chunk
	 * @returns {Promise<void>}
	 */
	private async upload(chunk: Buffer): Promise<void> {
		if (chunk.byteLength <= 0) {
			return
		}

		this.index += 1
		this.size += chunk.byteLength

		this.hasher.update(chunk)

		const encryptedChunk = await this.sdk.crypto().encrypt().data({ data: chunk, key: this.key })
		const response = await this.sdk
			.api(3)
			.file()
			.upload()
			.chunk()
			.buffer({ uuid: this.uuid, index: this.index, uploadKey: this.uploadKey, parent: this.parent, buffer: encryptedChunk })

		this.bucket = response.bucket
		this.region = response.region
		this.chunksUploaded += 1
	}

	/**
	 * Wait for all chunks to be uploaded.
	 * @date 3/1/2024 - 5:23:57 AM
	 *
	 * @private
	 * @async
	 * @param {number} needed
	 * @returns {Promise<void>}
	 */
	private async waitForAllChunksToBeUploaded(needed: number): Promise<void> {
		await new Promise<void>(resolve => {
			if (this.chunksUploaded >= needed) {
				resolve()

				return
			}

			const wait = setInterval(() => {
				if (this.chunksUploaded >= needed) {
					clearInterval(wait)

					resolve()
				}
			})
		})
	}

	/**
	 * Finalize the upload, marking it as done.
	 * @date 2/29/2024 - 9:59:20 PM
	 *
	 * @private
	 * @async
	 * @returns {Promise<void>}
	 */
	private async finalizeUpload(): Promise<void> {
		// Upload any leftover chunks in the buffer
		await this.processChunks()

		if (this.chunkBuffer.byteLength > 0) {
			await this.upload(this.chunkBuffer)
		}

		if (this.size <= 0) {
			return
		}

		// Calculate file chunks and size. Warning: This needs to be called AFTER initiating all chunk uploads or it will spit out a wrong chunk count.
		let fileChunks = 0
		let dummyOffset = 0

		while (dummyOffset < this.size) {
			fileChunks += 1
			dummyOffset += CHUNK_SIZE
		}

		await this.waitForAllChunksToBeUploaded(fileChunks)

		const hash = this.hasher.digest("hex")

		await this.sdk
			.api(3)
			.upload()
			.done({
				uuid: this.uuid,
				name: await this.sdk.crypto().encrypt().metadata({ metadata: this.name, key: this.key }),
				nameHashed: await this.sdk.crypto().utils.hashFn({ input: this.name.toLowerCase() }),
				size: await this.sdk.crypto().encrypt().metadata({ metadata: this.size.toString(), key: this.key }),
				chunks: fileChunks,
				mime: await this.sdk.crypto().encrypt().metadata({ metadata: this.mime, key: this.key }),
				version: this.version,
				uploadKey: this.uploadKey,
				rm: await this.sdk.crypto().utils.generateRandomString({ length: 32 }),
				metadata: await this.sdk
					.crypto()
					.encrypt()
					.metadata({
						metadata: JSON.stringify({
							name: this.name,
							size: this.size,
							mime: this.mime,
							key: this.key,
							lastModified: this.lastModified,
							creation: this.lastModified,
							hash
						})
					})
			})

		await this.sdk.cloud().checkIfItemParentIsShared({
			type: "file",
			parent: this.parent,
			uuid: this.uuid,
			itemMetadata: {
				name: this.name,
				size: this.size,
				mime: this.mime,
				lastModified: this.lastModified,
				creation: this.lastModified,
				key: this.key,
				hash
			}
		})

		this.emit("uploaded", {
			type: "file",
			uuid: this.uuid,
			metadata: {
				name: this.name,
				size: this.size,
				mime: this.mime,
				key: this.key,
				lastModified: this.lastModified,
				creation: this.lastModified,
				hash,
				version: this.version,
				region: this.region,
				chunks: fileChunks,
				bucket: this.bucket
			}
		} satisfies FSItem)
	}
}
