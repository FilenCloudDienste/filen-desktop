import Sync from "@filen/sync"
import { type SyncWorkerMessage } from "."
import { type FilenDesktopConfig } from "../types"
import { serializeError } from "../lib/worker"
import { parentPort, getEnvironmentData, isMainThread } from "worker_threads"

parentPort?.on("message", message => {
	if (message === "exit") {
		process.exit(0)
	}
})

export async function main(): Promise<void> {
	if (isMainThread || !parentPort) {
		throw new Error("Not running inside a worker thread.")
	}

	const config = getEnvironmentData("syncConfig") as FilenDesktopConfig

	if (config.syncConfig.syncPairs.length === 0) {
		throw new Error("No sync pairs configured yet.")
	}

	const sync = new Sync({
		syncPairs: config.syncConfig.syncPairs,
		dbPath: config.syncConfig.dbPath,
		sdkConfig: config.sdkConfig
	})

	await sync.initialize()

	parentPort?.postMessage({
		type: "workerStarted"
	} satisfies SyncWorkerMessage)
}

main().catch(err => {
	parentPort?.postMessage({
		type: "workerError",
		error: serializeError(err)
	} satisfies SyncWorkerMessage)
})
