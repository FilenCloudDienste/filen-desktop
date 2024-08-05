import type Worker from "./worker"
import SyncWorker from "@filen/sync"
import { parentPort } from "worker_threads"
import { WorkerMessage } from "../types"

export class Sync {
	private worker: Worker
	public sync: SyncWorker | null = null
	public active: boolean = false

	public constructor(worker: Worker) {
		this.worker = worker
	}

	public async waitForAtLeastOneSyncPair(): Promise<void> {
		return new Promise<void>(resolve => {
			const wait = async () => {
				const desktopConfig = await this.worker.waitForConfig()

				if (desktopConfig.syncConfig.syncPairs.length > 0) {
					resolve()
				}

				await new Promise<void>(resolve => setTimeout(resolve, 100))

				wait()
			}

			wait()
		})
	}

	public async start(): Promise<void> {
		await this.waitForAtLeastOneSyncPair()
		await this.stop()

		try {
			const [desktopConfig, sdk] = await Promise.all([this.worker.waitForConfig(), this.worker.getSDKInstance()])

			this.sync = new SyncWorker({
				syncPairs: desktopConfig.syncConfig.syncPairs,
				dbPath: desktopConfig.syncConfig.dbPath,
				sdk,
				onMessage: message => {
					parentPort?.postMessage({
						type: "sync",
						data: message
					} satisfies WorkerMessage)
				}
			})

			await this.sync.initialize()

			this.active = true
		} catch (e) {
			await this.stop()

			throw e
		}
	}

	public async stop(): Promise<void> {
		if (!this.sync) {
			this.active = false

			return
		}

		this.active = false
	}
}

export default Sync
