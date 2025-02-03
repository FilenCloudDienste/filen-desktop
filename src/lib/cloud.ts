import { type FilenDesktop } from ".."
import { type DirDownloadType } from "@filen/sdk/dist/types/api/v3/dir/download"
import { type DriveCloudItemWithPath } from "../types"
import { type FileEncryptionVersion, type CloudItemTree, type PauseSignal } from "@filen/sdk"
import { promiseAllChunked } from "../utils"
import pathModule from "path"
import fs from "fs-extra"

/**
 * Cloud
 * @date 3/13/2024 - 8:03:16 PM
 *
 * @export
 * @class Cloud
 * @typedef {Cloud}
 */
export class Cloud {
	private readonly desktop: FilenDesktop

	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

	/**
	 * Download a file to disk.
	 *
	 * @public
	 * @async
	 * @param {{
	 * 		uuid: string
	 * 		bucket: string
	 * 		region: string
	 * 		chunks: number
	 * 		key: string
	 * 		to: string
	 * 		version: FileEncryptionVersion
	 * 		dontEmitEvents?: boolean
	 * 		name: string
	 * 		size: number,
	 * 		pauseSignal?: PauseSignal,
	 * 		abortSignal?: AbortSignal
	 * 	}} param0
	 * @param {string} param0.uuid
	 * @param {string} param0.bucket
	 * @param {string} param0.region
	 * @param {number} param0.chunks
	 * @param {string} param0.key
	 * @param {string} param0.to
	 * @param {FileEncryptionVersion} param0.version
	 * @param {boolean} param0.dontEmitEvents
	 * @param {string} param0.name
	 * @param {number} param0.size
	 * @param {PauseSignal} param0.pauseSignal
	 * @param {AbortSignal} param0.abortSignal
	 * @returns {Promise<string>}
	 */
	public async downloadFile({
		uuid,
		bucket,
		region,
		chunks,
		key,
		to,
		version,
		dontEmitEvents,
		name,
		size,
		pauseSignal,
		abortSignal
	}: {
		uuid: string
		bucket: string
		region: string
		chunks: number
		key: string
		to: string
		version: FileEncryptionVersion
		dontEmitEvents?: boolean
		name: string
		size: number
		pauseSignal?: PauseSignal
		abortSignal?: AbortSignal
	}): Promise<string> {
		const dirnameWritable = await this.desktop.lib.fs.isPathWritable(pathModule.dirname(to))

		if (!dirnameWritable) {
			throw new Error(`${to} is not writable.`)
		}

		await fs.rm(to, {
			force: true,
			maxRetries: 60 * 10,
			recursive: true,
			retryDelay: 100
		})

		return await this.desktop.sdk.cloud().downloadFileToLocal({
			uuid,
			bucket,
			region,
			chunks,
			key,
			to,
			version,
			pauseSignal,
			abortSignal,
			size,
			onQueued: () => {
				if (dontEmitEvents) {
					return
				}

				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "queued",
						uuid,
						name,
						fileType: "file"
					}
				})
			},
			onStarted: () => {
				if (dontEmitEvents) {
					return
				}

				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "started",
						uuid,
						name,
						size,
						fileType: "file"
					}
				})
			},
			onProgress: transferred => {
				if (dontEmitEvents) {
					return
				}

				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "progress",
						bytes: transferred,
						uuid,
						name,
						fileType: "file"
					}
				})
			},
			onFinished: () => {
				if (dontEmitEvents) {
					return
				}

				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "finished",
						uuid,
						name,
						size,
						fileType: "file"
					}
				})
			},
			onError: err => {
				if (err instanceof DOMException && err.name === "AbortError") {
					return
				}

				if (dontEmitEvents) {
					return
				}

				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "error",
						uuid,
						err,
						name,
						size,
						fileType: "file"
					}
				})
			}
		})
	}

	/**
	 * Download a directory to disk.
	 *
	 * @public
	 * @async
	 * @param {{
	 * 		uuid: string
	 * 		type?: DirDownloadType
	 * 		linkUUID?: string
	 * 		linkHasPassword?: boolean
	 * 		linkPassword?: string
	 * 		linkSalt?: string
	 * 		to: string
	 * 		dontEmitEvents?: boolean
	 * 		name: string,
	 * 		pauseSignal?: PauseSignal,
	 * 		abortSignal?: AbortSignal
	 * 	}} param0
	 * @param {string} param0.uuid
	 * @param {DirDownloadType} param0.type
	 * @param {string} param0.linkUUID
	 * @param {boolean} param0.linkHasPassword
	 * @param {string} param0.linkPassword
	 * @param {string} param0.linkSalt
	 * @param {string} param0.to
	 * @param {boolean} param0.dontEmitEvents
	 * @param {string} param0.name
	 * @param {PauseSignal} param0.pauseSignal
	 * @param {AbortSignal} param0.abortSignal
	 * @returns {Promise<string>}
	 */
	public async downloadDirectory({
		uuid,
		type,
		linkUUID,
		linkHasPassword,
		linkPassword,
		linkSalt,
		to,
		dontEmitEvents,
		name,
		pauseSignal,
		abortSignal,
		linkKey
	}: {
		uuid: string
		type?: DirDownloadType
		linkUUID?: string
		linkHasPassword?: boolean
		linkPassword?: string
		linkSalt?: string
		to: string
		dontEmitEvents?: boolean
		name: string
		pauseSignal?: PauseSignal
		abortSignal?: AbortSignal
		linkKey?: string
	}): Promise<string> {
		const dirnameWritable = await this.desktop.lib.fs.isPathWritable(pathModule.dirname(to))

		if (!dirnameWritable) {
			throw new Error(`${to} is not writable.`)
		}

		let size = 0

		if (!dontEmitEvents) {
			this.desktop.ipc.postMainToWindowMessage({
				type: "download",
				data: {
					type: "queued",
					uuid,
					name,
					fileType: "directory"
				}
			})
		}

		try {
			await fs.rm(to, {
				force: true,
				maxRetries: 60 * 10,
				recursive: true,
				retryDelay: 100
			})

			const tree = await this.getDirectoryTree({
				uuid,
				type,
				linkUUID,
				linkHasPassword,
				linkPassword,
				linkSalt,
				linkKey
			})

			for (const path in tree) {
				const item = tree[path]

				if (item && item.type === "file") {
					size += item.size
				}
			}

			return await this.desktop.sdk.cloud().downloadDirectoryToLocal({
				uuid,
				to,
				type,
				linkHasPassword,
				linkPassword,
				linkSalt,
				linkUUID,
				pauseSignal,
				abortSignal,
				linkKey,
				onStarted: () => {
					if (dontEmitEvents) {
						return
					}

					this.desktop.ipc.postMainToWindowMessage({
						type: "download",
						data: {
							type: "started",
							uuid,
							name,
							size,
							fileType: "directory"
						}
					})
				},
				onProgress: transferred => {
					if (dontEmitEvents) {
						return
					}

					this.desktop.ipc.postMainToWindowMessage({
						type: "download",
						data: {
							type: "progress",
							bytes: transferred,
							uuid,
							name,
							fileType: "directory"
						}
					})
				},
				onFinished: () => {
					if (dontEmitEvents) {
						return
					}

					this.desktop.ipc.postMainToWindowMessage({
						type: "download",
						data: {
							type: "finished",
							uuid,
							name,
							size,
							fileType: "directory"
						}
					})
				},
				onError: err => {
					if (err instanceof DOMException && err.name === "AbortError") {
						return
					}

					if (dontEmitEvents) {
						return
					}

					this.desktop.ipc.postMainToWindowMessage({
						type: "download",
						data: {
							type: "error",
							uuid,
							err,
							name,
							size,
							fileType: "directory"
						}
					})
				}
			})
		} catch (e) {
			if (e instanceof DOMException && e.name === "AbortError") {
				return ""
			}

			if (!dontEmitEvents) {
				const err = e as unknown as Error

				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "error",
						uuid,
						name,
						size,
						err,
						fileType: "directory"
					}
				})
			}

			throw e
		}
	}

	/**
	 * Download multiple files and directories to disk.
	 *
	 * @public
	 * @async
	 * @param {{
	 * 		items: DriveCloudItemWithPath[]
	 * 		type?: DirDownloadType
	 * 		linkUUID?: string
	 * 		linkHasPassword?: boolean
	 * 		linkPassword?: string
	 * 		linkSalt?: string
	 * 		dontEmitEvents?: boolean
	 * 		to: string
	 * 		name: string
	 * 		directoryId: string
	 * 		pauseSignal?: PauseSignal
	 * 		abortSignal?: AbortSignal,
	 * 		dontEmitQueuedEvent?: boolean
	 * 	}} param0
	 * @param {{}} param0.items
	 * @param {DirDownloadType} param0.type
	 * @param {string} param0.linkUUID
	 * @param {boolean} param0.linkHasPassword
	 * @param {string} param0.linkPassword
	 * @param {string} param0.linkSalt
	 * @param {boolean} param0.dontEmitEvents
	 * @param {string} param0.to
	 * @param {string} param0.name
	 * @param {string} param0.directoryId
	 * @param {PauseSignal} param0.pauseSignal
	 * @param {AbortSignal} param0.abortSignal
	 * @param {boolean} param0.dontEmitQueuedEvent
	 * @returns {Promise<string>}
	 */
	public async downloadMultipleFilesAndDirectories({
		items,
		type,
		linkUUID,
		linkHasPassword,
		linkPassword,
		linkSalt,
		dontEmitEvents,
		to,
		name,
		directoryId,
		pauseSignal,
		abortSignal,
		dontEmitQueuedEvent,
		linkKey
	}: {
		items: DriveCloudItemWithPath[]
		type?: DirDownloadType
		linkUUID?: string
		linkHasPassword?: boolean
		linkPassword?: string
		linkSalt?: string
		dontEmitEvents?: boolean
		to: string
		name: string
		directoryId: string
		pauseSignal?: PauseSignal
		abortSignal?: AbortSignal
		dontEmitQueuedEvent?: boolean
		linkKey?: string
	}): Promise<string> {
		const dirnameWritable = await this.desktop.lib.fs.isPathWritable(pathModule.dirname(to))

		if (!dirnameWritable) {
			throw new Error(`${to} is not writable.`)
		}

		await fs.rm(to, {
			force: true,
			maxRetries: 60 * 10,
			recursive: true,
			retryDelay: 100
		})

		const itemsWithPath: DriveCloudItemWithPath[] = []
		const treePromises: Promise<void>[] = []
		let directorySize = 0
		let didQueue = typeof dontEmitQueuedEvent === "boolean" ? dontEmitQueuedEvent : false
		let didStart = false
		let didError = false

		try {
			for (const item of items) {
				if (item.type === "directory") {
					treePromises.push(
						new Promise((resolve, reject) => {
							this.getDirectoryTree({
								uuid: item.uuid,
								type,
								linkHasPassword,
								linkPassword,
								linkSalt,
								linkUUID,
								linkKey
							})
								.then(tree => {
									for (const path in tree) {
										const treeItem = tree[path]

										if (!treeItem || treeItem.type !== "file") {
											continue
										}

										itemsWithPath.push({
											...treeItem,
											sharerId: 0,
											sharerEmail: "",
											receiverId: 0,
											receiverEmail: "",
											selected: false,
											receivers: [],
											timestamp: treeItem.lastModified,
											favorited: false,
											path: `${item.name}/${path.startsWith("/") ? path.slice(1) : path}`,
											rm: ""
										})
									}

									resolve()
								})
								.catch(reject)
						})
					)
				} else {
					itemsWithPath.push(item)
				}
			}

			await promiseAllChunked(treePromises)

			if (itemsWithPath.length === 0) {
				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "finished",
						uuid: directoryId,
						name,
						size: directorySize,
						fileType: "directory"
					}
				})

				return to
			}

			directorySize = itemsWithPath.reduce((prev, item) => prev + item.size, 0)

			await promiseAllChunked(
				itemsWithPath.map(item => {
					return new Promise<void>((resolve, reject) => {
						if (item.type !== "file") {
							resolve()

							return
						}

						const filePath = pathModule.join(to, item.path)

						this.desktop.sdk
							.cloud()
							.downloadFileToLocal({
								uuid: item.uuid,
								bucket: item.bucket,
								region: item.region,
								version: item.version,
								chunks: item.chunks,
								key: item.key,
								to: filePath,
								pauseSignal,
								abortSignal,
								size: item.size,
								onQueued: () => {
									if (dontEmitEvents) {
										return
									}

									if (didQueue) {
										return
									}

									didQueue = true

									this.desktop.ipc.postMainToWindowMessage({
										type: "download",
										data: {
											type: "queued",
											uuid: directoryId,
											name,
											fileType: "directory"
										}
									})
								},
								onStarted: () => {
									if (dontEmitEvents) {
										return
									}

									if (didStart) {
										return
									}

									didStart = true

									this.desktop.ipc.postMainToWindowMessage({
										type: "download",
										data: {
											type: "started",
											uuid: directoryId,
											name,
											size: directorySize,
											fileType: "directory"
										}
									})
								},
								onProgress: transferred => {
									if (dontEmitEvents) {
										return
									}

									this.desktop.ipc.postMainToWindowMessage({
										type: "download",
										data: {
											type: "progress",
											uuid: directoryId,
											name,
											bytes: transferred,
											fileType: "directory"
										}
									})
								},
								onError: err => {
									if (err instanceof DOMException && err.name === "AbortError") {
										return
									}

									if (dontEmitEvents) {
										return
									}

									if (didError) {
										return
									}

									didError = true

									this.desktop.ipc.postMainToWindowMessage({
										type: "download",
										data: {
											type: "error",
											uuid: directoryId,
											name,
											size: directorySize,
											err,
											fileType: "directory"
										}
									})
								}
							})
							.then(() => resolve())
							.catch(reject)
					})
				})
			)

			this.desktop.ipc.postMainToWindowMessage({
				type: "download",
				data: {
					type: "finished",
					uuid: directoryId,
					name,
					size: directorySize,
					fileType: "directory"
				}
			})

			return to
		} catch (e) {
			if (e instanceof DOMException && e.name === "AbortError") {
				return ""
			}

			if (!didError) {
				didError = true

				const err = e as unknown as Error

				this.desktop.ipc.postMainToWindowMessage({
					type: "download",
					data: {
						type: "error",
						uuid: directoryId,
						name,
						size: directorySize,
						err,
						fileType: "directory"
					}
				})
			}

			throw e
		}
	}

	/**
	 * Fetch a directory tree.
	 *
	 * @public
	 * @async
	 * @param {{
	 *         uuid: string
	 *         type?: DirDownloadType
	 *         linkUUID?: string
	 *         linkHasPassword?: boolean
	 *         linkPassword?: string
	 *         linkSalt?: string
	 *         skipCache?: boolean
	 *     }} param0
	 * @param {string} param0.uuid
	 * @param {DirDownloadType} param0.type
	 * @param {string} param0.linkUUID
	 * @param {boolean} param0.linkHasPassword
	 * @param {string} param0.linkPassword
	 * @param {string} param0.linkSalt
	 * @param {boolean} param0.skipCache
	 * @returns {Promise<Record<string, CloudItemTree>>}
	 */
	public async getDirectoryTree({
		uuid,
		type,
		linkUUID,
		linkHasPassword,
		linkPassword,
		linkSalt,
		skipCache,
		linkKey
	}: {
		uuid: string
		type?: DirDownloadType
		linkUUID?: string
		linkHasPassword?: boolean
		linkPassword?: string
		linkSalt?: string
		skipCache?: boolean
		linkKey?: string
	}): Promise<Record<string, CloudItemTree>> {
		return await this.desktop.sdk.cloud().getDirectoryTree({
			uuid,
			type,
			linkUUID,
			linkHasPassword,
			linkPassword,
			linkSalt,
			skipCache,
			linkKey
		})
	}
}

export default Cloud
