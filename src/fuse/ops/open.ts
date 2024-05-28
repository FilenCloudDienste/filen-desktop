import type { FuseCreateCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."
import { pathToHash, flagsToMode } from "../utils"
import fs from "fs-extra"
import pathModule from "path"

export class Open {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string, mode: number): Promise<number> {
		if (this.ops.virtualFiles[path]) {
			this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

			return this.ops.nextFd++
		}

		try {
			const stat = await this.ops.sdk.fs().stat({ path })

			if (stat.type !== "file") {
				throw Fuse.default.ENOENT
			}

			const openMode = flagsToMode(mode)

			if (!this.ops.openMode[path]) {
				this.ops.openMode[path] = openMode
			}

			if (openMode === "r+" || openMode === "w") {
				const pathHash = pathToHash(path)
				const writePath = pathModule.join(this.ops.writeTmpPath, pathHash)
				const decryptedChunksPath = pathModule.join(this.ops.decryptedChunksTmpPath, pathHash)
				const fullDownloadsPath = pathModule.join(this.ops.fullDownloadsTmpPath, pathHash)

				if (await fs.exists(writePath)) {
					this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

					return this.ops.nextFd++
				}

				if (await fs.exists(fullDownloadsPath)) {
					await fs.copy(fullDownloadsPath, writePath, {
						overwrite: true
					})

					this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

					return this.ops.nextFd++
				}

				if (await fs.exists(decryptedChunksPath)) {
					const files = await fs.readdir(decryptedChunksPath)
					let size = 0
					const promises: Promise<void>[] = []

					for (let i = 0; i < files.length; i++) {
						const chunkPath = pathModule.join(decryptedChunksPath, i.toString())

						promises.push(
							new Promise((resolve, reject) => {
								fs.stat(chunkPath)
									.then(stats => {
										if (!stats.isFile()) {
											resolve()

											return
										}

										size += stats.size

										resolve()
									})
									.catch(reject)
							})
						)
					}

					await Promise.all(promises)

					if (files.length === stat.chunks && stat.size === size) {
						for (let i = 0; i < files.length; i++) {
							const chunkPath = pathModule.join(decryptedChunksPath, i.toString())

							if (i === 0) {
								await fs.copy(chunkPath, writePath, {
									overwrite: true
								})
							} else {
								await this.ops.sdk.utils.streams.append({ inputFile: chunkPath, baseFile: writePath })
							}
						}
					}

					this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

					return this.ops.nextFd++
				}

				await this.ops.sdk.fs().download({ path, destination: writePath })
			}

			this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path]! + 1 : 1

			return this.ops.nextFd++
		} catch (e) {
			delete this.ops.openMode[path]

			console.error(e)

			if (typeof e === "number") {
				throw e
			}

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw Fuse.default.ENOENT
			}

			throw Fuse.default.EIO
		}
	}

	public run(path: string, mode: number, callback: FuseCreateCallback): void {
		this.execute(path, mode)
			.then(result => {
				callback(0, result, mode)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Open
