import type Worker from "./worker"
import SyncWorker from "@filen/sync"
import { parentPort } from "worker_threads"
import { WorkerMessage } from "../types"
import { Semaphore } from "../semaphore"

export class Sync {
	private worker: Worker
	public sync: SyncWorker | null = null
	public active: boolean = false
	public stopMutex = new Semaphore(1)
	public startMutex = new Semaphore(1)

	public constructor(worker: Worker) {
		this.worker = worker
	}

	public async waitForAtLeastOneSyncPair(): Promise<void> {
		return new Promise<void>(resolve => {
			const wait = async () => {
				const desktopConfig = await this.worker.waitForConfig()

				if (desktopConfig.syncConfig.syncPairs.length > 0) {
					resolve()

					return
				}

				await new Promise<void>(resolve => setTimeout(resolve, 1000))

				wait()
			}

			wait()
		})
	}

	public async start(): Promise<void> {
		await this.waitForAtLeastOneSyncPair()

		await this.startMutex.acquire()

		try {
			await this.stop()

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
			this.worker.logger.log("error", e, "sync")
			this.worker.logger.log("error", e)

			await this.stop()

			throw e
		} finally {
			this.startMutex.release()
		}
	}

	public async stop(): Promise<void> {
		await this.stopMutex.acquire()

		try {
			if (!this.sync) {
				this.active = false

				return
			}

			this.active = false
		} finally {
			this.stopMutex.release()
		}
	}
}

export default Sync
