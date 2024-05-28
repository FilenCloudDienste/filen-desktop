import type Sync from "../sync"
import type { CloudItemTree, FSItemType, FileMetadata, FolderMetadata } from "@filen/sdk"
import pathModule from "path"
import { Semaphore } from "../../../semaphore"
import fs from "fs-extra"
import type { DistributiveOmit, Prettify } from "../../../types"

export type RemoteItem = Prettify<DistributiveOmit<CloudItemTree, "parent"> & { path: string }>
export type RemoteDirectoryTree = Record<string, RemoteItem>
export type RemoteDirectoryUUIDs = Record<string, RemoteItem>
export type RemoteTree = { tree: RemoteDirectoryTree; uuids: RemoteDirectoryUUIDs }

export class RemoteFileSystem {
	private readonly sync: Sync
	public getDirectoryTreeCache: { timestamp: number; tree: RemoteDirectoryTree; uuids: RemoteDirectoryUUIDs } = {
		timestamp: 0,
		tree: {},
		uuids: {}
	}
	private readonly mutex = new Semaphore(1)
	private readonly mkdirMutex = new Semaphore(1)

	public constructor({ sync }: { sync: Sync }) {
		this.sync = sync
	}

	public async getDirectoryTree(): Promise<RemoteTree> {
		// TODO: Actual implementation using cache + different endpoint with deviceId
		// Account for duplicate path names for directories/files. Only keep the first one discovered in the tree.
		const tree: RemoteDirectoryTree = {}
		const dir = await this.sync.sdk.cloud().getDirectoryTree({ uuid: this.sync.syncPair.remoteParentUUID })
		const uuids: RemoteDirectoryUUIDs = {}

		for (const path in dir) {
			if (!dir[path] || dir[path]!.parent === "base" || path.startsWith(".filen.trash.local")) {
				continue
			}

			const item = {
				...dir[path]!,
				path
			}

			tree[path] = item

			const treeItem = tree[path]

			if (treeItem) {
				uuids[treeItem.uuid] = item
			}
		}

		this.getDirectoryTreeCache = {
			timestamp: Date.now(),
			tree,
			uuids
		}

		return { tree, uuids }
	}

	/**
	 * Find the corresponding UUID of the relative path.
	 * @date 3/3/2024 - 6:55:53 PM
	 *
	 * @public
	 * @async
	 * @param {{ relativePath: string; type?: FSItemType }} param0
	 * @param {string} param0.relativePath
	 * @param {FSItemType} param0.type
	 * @returns {Promise<string | null>}
	 */
	public async pathToItemUUID({ relativePath, type }: { relativePath: string; type?: FSItemType }): Promise<string | null> {
		if (this.getDirectoryTreeCache.timestamp <= 0) {
			await this.getDirectoryTree()
		}

		const acceptedTypes: FSItemType[] = !type ? ["directory", "file"] : type === "directory" ? ["directory"] : ["file"]

		if (relativePath === "/" || relativePath === "." || relativePath.length <= 0) {
			return this.sync.syncPair.remoteParentUUID
		}

		if (this.getDirectoryTreeCache.tree[relativePath] && acceptedTypes.includes(this.getDirectoryTreeCache.tree[relativePath]!.type)) {
			return this.getDirectoryTreeCache.tree[relativePath]!.uuid
		}

		return null
	}

	/**
	 * Create a directory inside the remote sync path. Recursively creates intermediate directories if needed.
	 * @date 3/2/2024 - 9:34:14 PM
	 *
	 * @public
	 * @async
	 * @param {{ relativePath: string }} param0
	 * @param {string} param0.relativePath
	 * @returns {Promise<string>}
	 */
	public async mkdir({ relativePath }: { relativePath: string }): Promise<string> {
		await this.mkdirMutex.acquire()

		try {
			if (relativePath === "/") {
				return this.sync.syncPair.remoteParentUUID
			}

			const exists = await this.pathToItemUUID({ relativePath })

			if (exists) {
				return exists
			}

			const parentPath = pathModule.posix.dirname(relativePath)
			const basename = pathModule.posix.basename(relativePath)

			if (parentPath === "/" || parentPath === "." || parentPath.length <= 0) {
				const uuid = await this.sync.sdk.cloud().createDirectory({ name: basename, parent: this.sync.syncPair.remoteParentUUID })

				this.getDirectoryTreeCache.tree[relativePath] = {
					type: "directory",
					uuid,
					name: basename,
					size: 0,
					path: relativePath
				}

				return uuid
			}

			const pathEx = relativePath.split("/")
			let builtPath = "/"

			for (const part of pathEx) {
				if (pathEx.length <= 0) {
					continue
				}

				builtPath = pathModule.posix.join(builtPath, part)

				if (!this.getDirectoryTreeCache.tree[builtPath]) {
					const partBasename = pathModule.posix.basename(builtPath)
					const partParentPath = pathModule.posix.dirname(builtPath)
					const parentItem = this.getDirectoryTreeCache.tree[partParentPath]

					if (!parentItem) {
						continue
					}

					const parentIsBase = partParentPath === "/" || partParentPath === "." || partParentPath === ""
					const parentUUID = parentIsBase ? this.sync.syncPair.remoteParentUUID : parentItem.uuid
					const uuid = await this.sync.sdk.cloud().createDirectory({ name: partBasename, parent: parentUUID })

					this.getDirectoryTreeCache.tree[relativePath] = {
						type: "directory",
						uuid,
						name: partBasename,
						size: 0,
						path: relativePath
					}
				}
			}

			if (!this.getDirectoryTreeCache.tree[relativePath]) {
				throw new Error(`Could not create directory at path ${relativePath}.`)
			}

			return this.getDirectoryTreeCache.tree[relativePath]!.uuid
		} finally {
			this.mkdirMutex.release()
		}
	}

	/**
	 * Delete a file/directory inside the remote sync path.
	 * @date 3/3/2024 - 7:03:18 PM
	 *
	 * @public
	 * @async
	 * @param {{ relativePath: string; type?: FSItemType; permanent?: boolean }} param0
	 * @param {string} param0.relativePath
	 * @param {FSItemType} param0.type
	 * @param {boolean} [param0.permanent=false]
	 * @returns {Promise<void>}
	 */
	public async unlink({
		relativePath,
		type,
		permanent = false
	}: {
		relativePath: string
		type?: FSItemType
		permanent?: boolean
	}): Promise<void> {
		await this.mutex.acquire()

		try {
			const uuid = await this.pathToItemUUID({ relativePath })

			if (!uuid || !this.getDirectoryTreeCache.tree[relativePath]) {
				return
			}

			const acceptedTypes: FSItemType[] = !type ? ["directory", "file"] : type === "directory" ? ["directory"] : ["file"]

			if (!acceptedTypes.includes(this.getDirectoryTreeCache.tree[relativePath]!.type)) {
				return
			}

			if (this.getDirectoryTreeCache.tree[relativePath]!.type === "directory") {
				if (permanent) {
					await this.sync.sdk.cloud().deleteDirectory({ uuid })
				} else {
					await this.sync.sdk.cloud().trashDirectory({ uuid })
				}
			} else {
				if (permanent) {
					await this.sync.sdk.cloud().deleteFile({ uuid })
				} else {
					await this.sync.sdk.cloud().trashFile({ uuid })
				}
			}

			delete this.getDirectoryTreeCache.tree[relativePath]

			for (const entry in this.getDirectoryTreeCache.tree) {
				if (entry.startsWith(relativePath + "/")) {
					delete this.getDirectoryTreeCache.tree[entry]
				}
			}
		} finally {
			this.mutex.release()
		}
	}

	/**
	 * Rename a file/directory inside the remote sync path. Recursively creates intermediate directories if needed.
	 * @date 3/2/2024 - 9:35:12 PM
	 *
	 * @public
	 * @async
	 * @param {{ fromRelativePath: string; toRelativePath: string }} param0
	 * @param {string} param0.fromRelativePath
	 * @param {string} param0.toRelativePath
	 * @returns {Promise<void>}
	 */
	public async rename({ fromRelativePath, toRelativePath }: { fromRelativePath: string; toRelativePath: string }): Promise<void> {
		await this.mutex.acquire()

		try {
			if (fromRelativePath === "/" || fromRelativePath === toRelativePath) {
				return
			}

			const uuid = await this.pathToItemUUID({ relativePath: fromRelativePath })
			const item = this.getDirectoryTreeCache.tree[fromRelativePath]

			if (!uuid || !item) {
				throw new Error(`Could not rename ${fromRelativePath} to ${toRelativePath}: Path not found.`)
			}

			const currentParentPath = pathModule.posix.dirname(fromRelativePath)
			const newParentPath = pathModule.posix.dirname(toRelativePath)
			const newBasename = pathModule.posix.basename(toRelativePath)
			const oldBasename = pathModule.posix.basename(fromRelativePath)

			const itemMetadata =
				item.type === "file"
					? ({
							name: newBasename,
							size: item.size,
							mime: item.mime,
							lastModified: item.lastModified,
							creation: item.creation,
							hash: item.hash,
							key: item.key
					  } satisfies FileMetadata)
					: ({
							name: newBasename
					  } satisfies FolderMetadata)

			if (newParentPath === currentParentPath) {
				if (toRelativePath === "/" || newBasename.length <= 0) {
					return
				}

				if (item.type === "directory") {
					await this.sync.sdk.cloud().renameDirectory({ uuid, name: newBasename })
				} else {
					await this.sync.sdk.cloud().renameFile({
						uuid,
						metadata: itemMetadata as FileMetadata,
						name: newBasename
					})
				}

				const oldItem = this.getDirectoryTreeCache.tree[fromRelativePath]

				if (oldItem) {
					this.getDirectoryTreeCache.tree[toRelativePath] = {
						...oldItem,
						name: newBasename
					}
				}

				delete this.getDirectoryTreeCache.tree[fromRelativePath]
			} else {
				if (oldBasename !== newBasename) {
					if (item.type === "directory") {
						await this.sync.sdk.cloud().renameDirectory({ uuid, name: newBasename })
					} else {
						await this.sync.sdk.cloud().renameFile({
							uuid,
							metadata: itemMetadata as FileMetadata,
							name: newBasename
						})
					}
				}

				if (newParentPath === "/" || newParentPath === "." || newParentPath === "") {
					if (item.type === "directory") {
						await this.sync.sdk
							.cloud()
							.moveDirectory({ uuid, to: this.sync.syncPair.remoteParentUUID, metadata: itemMetadata as FolderMetadata })
					} else {
						await this.sync.sdk
							.cloud()
							.moveFile({ uuid, to: this.sync.syncPair.remoteParentUUID, metadata: itemMetadata as FileMetadata })
					}
				} else {
					await this.mkdir({ relativePath: newParentPath })

					const newParentItem = this.getDirectoryTreeCache.tree[newParentPath]

					if (!newParentItem) {
						throw new Error(`Could not find path ${newParentPath}.`)
					}

					if (item.type === "directory") {
						await this.sync.sdk
							.cloud()
							.moveDirectory({ uuid, to: newParentItem.uuid!, metadata: itemMetadata as FolderMetadata })
					} else {
						await this.sync.sdk.cloud().moveFile({ uuid, to: newParentItem.uuid, metadata: itemMetadata as FileMetadata })
					}
				}

				const oldItem = this.getDirectoryTreeCache.tree[fromRelativePath]

				if (oldItem) {
					this.getDirectoryTreeCache.tree[toRelativePath] = {
						...oldItem,
						name: newBasename
					}
				}

				delete this.getDirectoryTreeCache.tree[fromRelativePath]

				for (const oldPath in this.getDirectoryTreeCache.tree) {
					if (oldPath.startsWith(fromRelativePath + "/")) {
						const newPath = oldPath.split(fromRelativePath).join(toRelativePath)
						const oldItem = this.getDirectoryTreeCache.tree[oldPath]

						if (oldItem) {
							this.getDirectoryTreeCache.tree[newPath] = {
								...oldItem,
								name: newBasename
							}
						}

						delete this.getDirectoryTreeCache.tree[oldPath]
					}
				}
			}
		} finally {
			this.mutex.release()
		}
	}

	/**
	 * Download a remote file.
	 * @date 3/2/2024 - 9:41:59 PM
	 *
	 * @public
	 * @async
	 * @param {{ relativePath: string }} param0
	 * @param {string} param0.relativePath
	 * @returns {Promise<fs.Stats>}
	 */
	public async download({ relativePath }: { relativePath: string }): Promise<fs.Stats> {
		const localPath = pathModule.posix.join(this.sync.syncPair.localPath, relativePath)

		const uuid = await this.pathToItemUUID({ relativePath })
		const item = this.getDirectoryTreeCache.tree[relativePath]

		if (!uuid || !item) {
			throw new Error(`Could not download ${relativePath}: File not found.`)
		}

		if (item.type === "directory") {
			throw new Error(`Could not download ${relativePath}: Not a file.`)
		}

		const tmpPath = await this.sync.sdk.cloud().downloadFileToLocal({
			uuid,
			bucket: item.bucket,
			region: item.region,
			chunks: item.chunks,
			version: item.version,
			key: item.key
		})

		await fs.move(tmpPath, localPath, {
			overwrite: true
		})

		await fs.utimes(localPath, Date.now(), item.lastModified)

		return await fs.stat(localPath)
	}
}

export default RemoteFileSystem
