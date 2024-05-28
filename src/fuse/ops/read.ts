import type { FuseReadWriteCallback } from "../types"
import type Ops from "."
import { pathToHash } from "../utils"
import fs from "fs-extra"
import pathModule from "path"
import { CHUNK_SIZE } from "../../constants"
import { MAX_DOWNLOAD_THREADS } from "@filen/sdk"

export class Read {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async downloadChunkToLocal({ path, index, to }: { path: string; index: number; to: string }): Promise<void> {
		const stat = await this.ops.sdk.fs().stat({ path })

		if (stat.type === "directory") {
			throw new Error("Cannot download chunk of a directory.")
		}

		const pathHash = pathToHash(path)
		const tmpPathEncrypted = pathModule.join(this.ops.baseTmpPath, `${pathHash}.${index}.encrypted`)
		const tmpPathDecrypted = pathModule.join(this.ops.baseTmpPath, `${pathHash}.${index}.decrypted`)

		try {
			await Promise.all([
				fs.rm(tmpPathEncrypted, {
					force: true,
					maxRetries: 60 * 10,
					recursive: true,
					retryDelay: 100
				}),
				fs.rm(tmpPathDecrypted, {
					force: true,
					maxRetries: 60 * 10,
					recursive: true,
					retryDelay: 100
				}),
				fs.ensureDir(pathModule.join(to, ".."))
			])

			await this.ops.sdk
				.api(3)
				.file()
				.download()
				.chunk()
				.local({ uuid: stat.uuid, bucket: stat.bucket, region: stat.region, chunk: index, to: tmpPathEncrypted })

			await this.ops.sdk
				.crypto()
				.decrypt()
				.dataStream({ inputFile: tmpPathEncrypted, outputFile: tmpPathDecrypted, key: stat.key, version: stat.version })

			await fs.move(tmpPathDecrypted, to, {
				overwrite: true
			})
		} finally {
			await Promise.all([
				fs.rm(tmpPathEncrypted, {
					force: true,
					maxRetries: 60 * 10,
					recursive: true,
					retryDelay: 100
				}),
				fs.rm(tmpPathDecrypted, {
					force: true,
					maxRetries: 60 * 10,
					recursive: true,
					retryDelay: 100
				})
			])
		}
	}

	private async downloadChunk({ index, path, chunkPath }: { index: number; path: string; chunkPath: string }): Promise<void> {
		if (!this.ops.chunkDownloadsActive[path]) {
			this.ops.chunkDownloadsActive[path] = 0
		}

		this.ops.chunkDownloadsActive[path] += 1

		try {
			if (await fs.exists(chunkPath)) {
				return
			}

			if (!this.ops.downloadChunkToLocalActive[path]) {
				this.ops.downloadChunkToLocalActive[path] = {}
			}

			if (this.ops.downloadChunkToLocalActive[path]![index]) {
				await new Promise<void>(resolve => {
					if (!this.ops.downloadChunkToLocalActive[path]![index]) {
						resolve()
					}

					const wait = setInterval(() => {
						if (!this.ops.downloadChunkToLocalActive[path]![index]) {
							clearInterval(wait)

							resolve()
						}
					}, 10)
				})

				if (await fs.exists(chunkPath)) {
					return
				}
			}

			this.ops.downloadChunkToLocalActive[path]![index] = true

			try {
				await this.downloadChunkToLocal({ path, index, to: chunkPath })
			} finally {
				delete this.ops.downloadChunkToLocalActive[path]![index]
			}
		} finally {
			this.ops.chunkDownloadsActive[path] -= 1
		}
	}

	private async execute(path: string, buffer: Buffer, length: number, position: number): Promise<number> {
		if (this.ops.virtualFiles[path]) {
			return 0
		}

		try {
			const stat = await this.ops.sdk.fs().stat({ path })

			if (stat.type !== "file") {
				return 0
			}

			const pathHash = pathToHash(path)
			const writePath = pathModule.join(this.ops.writeTmpPath, pathHash)
			const decryptedChunksPath = pathModule.join(this.ops.decryptedChunksTmpPath, pathHash)
			const fullDownloadsPath = pathModule.join(this.ops.fullDownloadsTmpPath, pathHash)

			const [writePathExists, fullDownloadsPathExists] = await Promise.all([fs.exists(writePath), fs.exists(fullDownloadsPath)])

			if (writePathExists) {
				const writePathStat = await fs.stat(writePath)

				if (writePathStat.size === stat.size) {
					const fd = await fs.open(writePath, fs.constants.R_OK | fs.constants.F_OK)

					try {
						const { bytesRead } = await fs.read(fd, buffer, 0, length, position)

						return bytesRead
					} finally {
						await fs.close(fd)
					}
				} else {
					await fs.rm(writePath, {
						force: true,
						maxRetries: 60 * 10,
						recursive: true,
						retryDelay: 100
					})
				}
			}

			if (fullDownloadsPathExists) {
				const fullDownloadsPathStat = await fs.stat(writePath)

				if (fullDownloadsPathStat.size === stat.size) {
					const fd = await fs.open(fullDownloadsPath, fs.constants.R_OK | fs.constants.F_OK)

					try {
						const { bytesRead } = await fs.read(fd, buffer, 0, length, position)

						return bytesRead
					} finally {
						await fs.close(fd)
					}
				} else {
					await fs.rm(fullDownloadsPath, {
						force: true,
						maxRetries: 60 * 10,
						recursive: true,
						retryDelay: 100
					})
				}
			}

			const startChunkIndex = Math.floor(position / CHUNK_SIZE)
			const endChunkIndex = Math.floor((position + length - 1) / CHUNK_SIZE)
			let overallBuffer = Buffer.from([])

			if (endChunkIndex > stat.chunks - 1) {
				return 0
			}

			if (!this.ops.chunkDownloadsActive[path]) {
				this.ops.chunkDownloadsActive[path] = 0
			}

			const downloadPromises: Promise<void>[] = []

			for (let index = startChunkIndex; index <= endChunkIndex; index++) {
				const chunkPath = pathModule.join(decryptedChunksPath, index.toString())

				downloadPromises.push(this.downloadChunk({ path, index, chunkPath }))
			}

			// Download ahead more chunks so we read faster
			if (endChunkIndex < stat.chunks - 1 && this.ops.chunkDownloadsActive[path]! < MAX_DOWNLOAD_THREADS) {
				const downloadAheadStart = stat.chunks - 1 === endChunkIndex ? 0 : endChunkIndex + 1
				const totalChunksLeft = stat.chunks - 1 - downloadAheadStart
				const downloadAheadEnd =
					downloadAheadStart + (totalChunksLeft >= MAX_DOWNLOAD_THREADS ? MAX_DOWNLOAD_THREADS : totalChunksLeft)
				const downloadAheadPromises: Promise<void>[] = []

				for (let index = downloadAheadStart; index <= downloadAheadEnd; index++) {
					const chunkPath = pathModule.join(decryptedChunksPath, index.toString())

					downloadAheadPromises.push(this.downloadChunk({ path, index, chunkPath }))
				}

				Promise.all(downloadAheadPromises).catch(console.error)
			}

			await Promise.all(downloadPromises)

			for (let index = startChunkIndex; index <= endChunkIndex; index++) {
				const chunkPath = pathModule.join(decryptedChunksPath, index.toString())

				const [chunkStats, fd] = await Promise.all([fs.stat(chunkPath), fs.open(chunkPath, fs.constants.R_OK | fs.constants.F_OK)])

				try {
					const localOffset = index === startChunkIndex ? position % CHUNK_SIZE : 0
					let chunkEndPosition = index === endChunkIndex ? (position + length) % CHUNK_SIZE || CHUNK_SIZE : CHUNK_SIZE

					chunkEndPosition = Math.min(chunkEndPosition, chunkStats.size)

					let bytesToRead =
						localOffset + chunkEndPosition <= chunkStats.size ? chunkEndPosition - localOffset : chunkStats.size - localOffset

					if (bytesToRead <= 0) {
						continue
					}

					if (bytesToRead >= length) {
						bytesToRead = length
					}

					const { buffer: bufferRead } = await fs.read(fd, Buffer.alloc(bytesToRead), 0, bytesToRead, localOffset)

					overallBuffer = Buffer.concat([overallBuffer, bufferRead])
				} finally {
					await fs.close(fd)
				}
			}

			overallBuffer.copy(buffer)

			return overallBuffer.byteLength
		} catch (e) {
			// TODO: Proper debugger

			console.error(e)

			return 0
		}
	}

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
