import FilenNetworkDrive from "@filen/network-drive"
import type Worker from "./worker"
import pathModule from "path"
import { filenLogsPath } from "../lib/logger"

export class NetworkDrive {
	private worker: Worker
	public networkDrive: FilenNetworkDrive | null = null
	public active: boolean = false

	public constructor(worker: Worker) {
		this.worker = worker
	}

	public async start(): Promise<void> {
		await this.stop()

		try {
			const [desktopConfig, sdk, logDir] = await Promise.all([
				this.worker.waitForConfig(),
				this.worker.getSDKInstance(),
				filenLogsPath()
			])

			this.networkDrive = new FilenNetworkDrive({
				sdk,
				mountPoint: desktopConfig.networkDriveConfig.mountPoint,
				cachePath: desktopConfig.networkDriveConfig.cachePath
					? pathModule.join(desktopConfig.networkDriveConfig.cachePath, "filenCache")
					: pathModule.join(desktopConfig.networkDriveConfig.localDirPath, "cache"),
				logFilePath: pathModule.join(logDir, "rclone.log"),
				readOnly: desktopConfig.networkDriveConfig.readOnly,
				cacheSize: desktopConfig.networkDriveConfig.cacheSizeInGi
			})

			await this.networkDrive.start()

			this.active = true
		} catch (e) {
			this.worker.logger.log("error", e, "networkDrive.start")
			this.worker.logger.log("error", e)

			throw e
		}
	}

	public async stop(): Promise<void> {
		if (!this.networkDrive) {
			return
		}

		try {
			await this.networkDrive.stop()

			this.active = false
		} catch (e) {
			this.worker.logger.log("error", e, "networkDrive.stop")
			this.worker.logger.log("error", e)

			throw e
		}
	}
}

export default NetworkDrive
