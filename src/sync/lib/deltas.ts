import type Sync from "./sync"
import type { LocalTree } from "./filesystems/local"
import type { RemoteTree } from "./filesystems/remote"
import pathModule from "path"

export type Delta = { path: string } & (
	| {
			type: "uploadFile"
	  }
	| {
			type: "createRemoteDirectory"
	  }
	| {
			type: "createLocalDirectory"
	  }
	| {
			type: "deleteLocalFile"
	  }
	| {
			type: "deleteRemoteFile"
	  }
	| {
			type: "deleteLocalDirectory"
	  }
	| {
			type: "deleteRemoteDirectory"
	  }
	| {
			type: "downloadFile"
	  }
	| {
			type: "moveLocalFile"
			from: string
			to: string
	  }
	| {
			type: "renameLocalFile"
			from: string
			to: string
	  }
	| {
			type: "moveRemoteFile"
			from: string
			to: string
	  }
	| {
			type: "renameRemoteFile"
			from: string
			to: string
	  }
	| {
			type: "renameRemoteDirectory"
			from: string
			to: string
	  }
	| {
			type: "renameLocalDirectory"
			from: string
			to: string
	  }
	| {
			type: "moveRemoteDirectory"
			from: string
			to: string
	  }
	| {
			type: "moveLocalFile"
			from: string
			to: string
	  }
	| {
			type: "moveLocalDirectory"
			from: string
			to: string
	  }
)

/**
 * Deltas
 * @date 3/1/2024 - 11:11:32 PM
 *
 * @export
 * @class Deltas
 * @typedef {Deltas}
 */
export class Deltas {
	private readonly sync: Sync

	/**
	 * Creates an instance of Deltas.
	 * @date 3/1/2024 - 11:11:36 PM
	 *
	 * @constructor
	 * @public
	 * @param {{ sync: Sync }} param0
	 * @param {Sync} param0.sync
	 */
	public constructor({ sync }: { sync: Sync }) {
		this.sync = sync
	}

	/**
	 * Process the directory trees and return all sync deltas.
	 * @date 3/2/2024 - 8:42:25 AM
	 *
	 * @public
	 * @async
	 * @param {{
	 * 		currentLocalTree: LocalTree
	 * 		currentRemoteTree: RemoteTree
	 * 		previousLocalTree: LocalTree
	 * 		previousRemoteTree: RemoteTree
	 * 	}} param0
	 * @param {LocalTree} param0.currentLocalTree
	 * @param {RemoteTree} param0.currentRemoteTree
	 * @param {LocalTree} param0.previousLocalTree
	 * @param {RemoteTree} param0.previousRemoteTree
	 * @returns {Promise<Delta[]>}
	 */
	public async process({
		currentLocalTree,
		currentRemoteTree,
		previousLocalTree,
		previousRemoteTree
	}: {
		currentLocalTree: LocalTree
		currentRemoteTree: RemoteTree
		previousLocalTree: LocalTree
		previousRemoteTree: RemoteTree
	}): Promise<Delta[]> {
		const deltas: Delta[] = []
		const pathsAdded: Record<string, boolean> = {}

		// Local file/directory move/rename

		for (const inode in currentLocalTree.inodes) {
			const currentItem = currentLocalTree.inodes[inode]
			const previousItem = previousLocalTree.inodes[inode]

			if (!currentItem || !previousItem || pathsAdded[currentItem.path] || pathsAdded[previousItem.path]) {
				continue
			}

			// Path from current item changed, it was either renamed or moved
			if (currentItem.path !== previousItem.path) {
				const currentItemParentPath = pathModule.posix.dirname(currentItem.path)
				const previousItemParentPath = pathModule.posix.dirname(previousItem.path)
				const currentItemParent = currentLocalTree.tree[currentItemParentPath]
				const previousItemParent = previousLocalTree.tree[previousItemParentPath]
				const currentItemName = pathModule.posix.basename(currentItem.path)
				const previousItemName = pathModule.posix.basename(previousItem.path)

				// Names changed
				if (currentItemName !== previousItemName) {
					deltas.push({
						type: currentItem.type === "directory" ? "renameRemoteDirectory" : "renameRemoteFile",
						path: currentItem.path,
						from: previousItem.path,
						to: currentItem.path
					})
				}

				pathsAdded[currentItem.path] = true
				pathsAdded[previousItem.path] = true

				// Parents did not change, continue
				if (currentItemParent?.inode === previousItemParent?.inode) {
					continue
				}

				// Item was also moved
				deltas.push({
					type: currentItem.type === "directory" ? "moveRemoteDirectory" : "moveRemoteFile",
					path: currentItem.path,
					from: previousItem.path,
					to: currentItem.path
				})
			}
		}

		// Remote file/directory move/rename

		for (const uuid in currentRemoteTree.uuids) {
			const currentItem = currentRemoteTree.uuids[uuid]
			const previousItem = currentRemoteTree.uuids[uuid]

			if (!currentItem || !previousItem || pathsAdded[currentItem.path] || pathsAdded[previousItem.path]) {
				continue
			}

			// Path from current item changed, it was either renamed or moved
			if (currentItem.path !== previousItem.path) {
				const currentItemParentPath = pathModule.posix.dirname(currentItem.path)
				const previousItemParentPath = pathModule.posix.dirname(previousItem.path)
				const currentItemParent = currentRemoteTree.tree[currentItemParentPath]
				const previousItemParent = previousRemoteTree.tree[previousItemParentPath]
				const currentItemName = pathModule.posix.basename(currentItem.path)
				const previousItemName = pathModule.posix.basename(previousItem.path)

				// Names changed
				if (currentItemName !== previousItemName) {
					deltas.push({
						type: currentItem.type === "directory" ? "renameRemoteDirectory" : "renameRemoteFile",
						path: currentItem.path,
						from: previousItem.path,
						to: currentItem.path
					})
				}

				pathsAdded[currentItem.path] = true
				pathsAdded[previousItem.path] = true

				// Parents did not change, continue
				if (currentItemParent?.uuid === previousItemParent?.uuid) {
					continue
				}

				// Item was also moved
				deltas.push({
					type: currentItem.type === "directory" ? "moveRemoteDirectory" : "moveRemoteFile",
					path: currentItem.path,
					from: previousItem.path,
					to: currentItem.path
				})
			}
		}

		// Local deletions

		for (const path in previousLocalTree.tree) {
			if (pathsAdded[path]) {
				continue
			}

			const previousLocalItem = previousLocalTree.tree[path]
			const currentLocalItem = currentLocalTree.tree[path]

			if (!currentLocalItem && previousLocalItem) {
				deltas.push({
					type: previousLocalItem.type === "directory" ? "deleteRemoteDirectory" : "deleteRemoteFile",
					path
				})

				pathsAdded[path] = true
			}
		}

		// Remote deletions

		for (const path in previousRemoteTree.tree) {
			if (pathsAdded[path]) {
				continue
			}

			const previousRemoteItem = previousRemoteTree.tree[path]
			const currentRemoteItem = currentRemoteTree.tree[path]

			if (!currentRemoteItem && previousRemoteItem) {
				deltas.push({
					type: previousRemoteItem.type === "directory" ? "deleteLocalDirectory" : "deleteLocalFile",
					path
				})

				pathsAdded[path] = true
			}
		}

		// Local additions/changes

		for (const path in currentLocalTree.tree) {
			if (pathsAdded[path]) {
				continue
			}

			const currentLocalItem = currentLocalTree.tree[path]
			const currentRemoteItem = currentRemoteTree.tree[path]

			if (!currentRemoteItem && currentLocalItem) {
				deltas.push({
					type: currentLocalItem.type === "directory" ? "createRemoteDirectory" : "uploadFile",
					path
				})

				pathsAdded[path] = true

				continue
			}

			if (currentRemoteItem && currentRemoteItem.type === "file") {
				if (currentLocalItem && currentLocalItem.lastModified > currentRemoteItem.lastModified) {
					const itemLocalPath = pathModule.join(this.sync.syncPair.localPath, currentLocalItem.path)

					if (
						(await this.sync.localFileSystem.createFileHash({ relativePath: path, algorithm: "sha512" })) !==
						this.sync.localFileHashes[itemLocalPath]
					) {
						deltas.push({
							type: "uploadFile",
							path
						})

						pathsAdded[path] = true
					}
				}
			}
		}

		// Remote additions/changes

		for (const path in currentRemoteTree.tree) {
			if (pathsAdded[path]) {
				continue
			}

			const currentLocalItem = currentLocalTree.tree[path]
			const currentRemoteItem = currentRemoteTree.tree[path]

			if (!currentLocalItem && currentRemoteItem) {
				deltas.push({
					type: currentRemoteItem.type === "directory" ? "createLocalDirectory" : "downloadFile",
					path
				})

				pathsAdded[path] = true

				continue
			}

			if (currentRemoteItem && currentRemoteItem.type === "file") {
				if (currentLocalItem && currentRemoteItem.lastModified > currentLocalItem.lastModified) {
					deltas.push({
						type: "downloadFile",
						path
					})

					pathsAdded[path] = true
				}
			}
		}

		return deltas
	}
}

export default Deltas
