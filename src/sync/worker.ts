import { IS_NODE } from "../constants"
import SyncWorker from "@filen/sync"

// Only start the worker if it is actually invoked.
if (process.argv.slice(2).includes("--filen-desktop-worker") && IS_NODE) {
	// TODO: Proper init
	const syncWorker = new SyncWorker({
		dbPath: "",
		syncPairs: [],
		sdkConfig: {}
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

export default SyncWorker
