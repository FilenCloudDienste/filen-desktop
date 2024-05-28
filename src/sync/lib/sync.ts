import SDK, { type FilenSDKConfig } from "@filen/sdk"
import type { SyncPair } from "../types"
import { SYNC_INTERVAL } from "../constants"
import { LocalFileSystem, LocalTree } from "./filesystems/local"
import { RemoteFileSystem, RemoteTree } from "./filesystems/remote"
import Deltas from "./deltas"
import Tasks from "./tasks"
import State from "./state"

/**
 * Sync
 *
 * @export
 * @class Sync
 * @typedef {Sync}
 */
export class Sync {
	public readonly sdk: SDK
	public readonly syncPair: SyncPair
	private isInitialized = false
	public readonly localFileSystem: LocalFileSystem
	public readonly remoteFileSystem: RemoteFileSystem
	public readonly deltas: Deltas
	public previousLocalTree: LocalTree = { tree: {}, inodes: {} }
	public previousRemoteTree: RemoteTree = { tree: {}, uuids: {} }
	public localFileHashes: Record<string, string> = {}
	public readonly tasks: Tasks
	public readonly state: State
	public readonly dbPath: string

	/**
	 * Creates an instance of Sync.
	 *
	 * @constructor
	 * @public
	 * @param {{ syncPair: SyncPair; dbPath: string, sdkConfig: FilenSDKConfig }} param0
	 * @param {SyncPair} param0.syncPair
	 * @param {string} param0.dbPath
	 * @param {FilenSDKConfig} param0.sdkConfig
	 */
	public constructor({ syncPair, dbPath, sdkConfig }: { syncPair: SyncPair; dbPath: string; sdkConfig: FilenSDKConfig }) {
		this.syncPair = syncPair
		this.dbPath = dbPath
		this.sdk = new SDK(sdkConfig)
		this.localFileSystem = new LocalFileSystem({ sync: this })
		this.remoteFileSystem = new RemoteFileSystem({ sync: this })
		this.deltas = new Deltas({ sync: this })
		this.tasks = new Tasks({ sync: this })
		this.state = new State({ sync: this })
	}

	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		this.isInitialized = true

		try {
			//local/remote smoke test

			await this.localFileSystem.startDirectoryWatcher()
			await this.state.initialize()

			this.run()
		} catch (e) {
			this.isInitialized = false

			throw e
		}
	}

	private async run(): Promise<void> {
		try {
			await this.localFileSystem.waitForLocalDirectoryChanges()

			let [currentLocalTree, currentRemoteTree] = await Promise.all([
				this.localFileSystem.getDirectoryTree(),
				this.remoteFileSystem.getDirectoryTree()
			])

			const deltas = await this.deltas.process({
				currentLocalTree,
				currentRemoteTree,
				previousLocalTree: this.previousLocalTree,
				previousRemoteTree: this.previousRemoteTree
			})

			console.log(deltas)

			const doneTasks = await this.tasks.process({ deltas })

			console.log(doneTasks)

			if (doneTasks.length > 0) {
				const applied = this.state.applyDoneTasksToState({ doneTasks, currentLocalTree, currentRemoteTree })

				currentLocalTree = applied.currentLocalTree
				currentRemoteTree = applied.currentRemoteTree
			}

			this.previousLocalTree = currentLocalTree
			this.previousRemoteTree = currentRemoteTree

			await this.state.save()
		} catch (e) {
			console.error(e) // TODO: Proper debugger
		} finally {
			setTimeout(() => {
				this.run()
			}, SYNC_INTERVAL)
		}
	}
}

export default Sync
