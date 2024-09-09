import FilenVirtualDrive from "@filen/network-drive"
import type Worker from "./worker"
import pathModule from "path"
import { filenLogsPath } from "../lib/logger"

export class VirtualDrive {
	private worker: Worker
	public virtualDrive: FilenVirtualDrive | null = null
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

			this.virtualDrive = new FilenVirtualDrive({
				sdk,
				mountPoint: desktopConfig.virtualDriveConfig.mountPoint,
				cachePath: desktopConfig.virtualDriveConfig.cachePath
					? pathModule.join(desktopConfig.virtualDriveConfig.cachePath, "filenCache")
					: pathModule.join(desktopConfig.virtualDriveConfig.localDirPath, "cache"),
				logFilePath: pathModule.join(logDir, "rclone.log"),
				readOnly: desktopConfig.virtualDriveConfig.readOnly,
				cacheSize: desktopConfig.virtualDriveConfig.cacheSizeInGi
			})

			await this.virtualDrive.start()

			this.active = true
		} catch (e) {
			this.worker.logger.log("error", e, "virtualDrive.start")
			this.worker.logger.log("error", e)

			throw e
		}
	}

	public async stop(): Promise<void> {
		if (!this.virtualDrive) {
			return
		}

		try {
			await this.virtualDrive.stop()

			this.active = false
		} catch (e) {
			this.worker.logger.log("error", e, "virtualDrive.stop")
			this.worker.logger.log("error", e)

			throw e
		}
	}
}

export default VirtualDrive
