import type { SyncPair } from "./types"
import Sync from "./lib/sync"

/**
 * SyncWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class SyncWorker
 * @typedef {SyncWorker}
 */
export class SyncWorker {
	private readonly syncPairs: SyncPair[]
	private readonly syncs: Record<string, Sync> = {}
	private readonly dbPath: string

	/**
	 * Creates an instance of SyncWorker.
	 * @date 3/4/2024 - 11:39:47 PM
	 *
	 * @constructor
	 * @public
	 * @param {{ syncPairs: SyncPair[], dbPath: string }} param0
	 * @param {{}} param0.syncPairs
	 * @param {string} param0.dbPath
	 */
	public constructor({ syncPairs, dbPath }: { syncPairs: SyncPair[]; dbPath: string }) {
		this.syncPairs = syncPairs
		this.dbPath = dbPath
	}

	/**
	 * Initialize the Sync worker.
	 * @date 2/23/2024 - 5:51:12 AM
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async initialize(): Promise<void> {
		const promises: Promise<void>[] = []

		for (const pair of this.syncPairs) {
			if (!this.syncs[pair.uuid]) {
				this.syncs[pair.uuid] = new Sync({ syncPair: pair, dbPath: this.dbPath, sdkConfig: {} })

				promises.push(this.syncs[pair.uuid]!.initialize())
			}
		}

		await Promise.all(promises)
	}
}

// Only start the worker if it is actually invoked.
if (process.argv.slice(2).includes("--worker")) {
	// TODO: Proper init
	const syncWorker = new SyncWorker({
		dbPath: "",
		syncPairs: []
	})

	syncWorker
		.initialize()
		.then(() => {
			process.stdout.write(
				JSON.stringify({
					type: "ready"
				})
			)
		})
		.catch(err => {
			console.error(err)

			process.exit(1)
		})
}
