import { type FilenDesktopConfig } from "./types"

export let CONFIG: FilenDesktopConfig | null = null

export function setConfig(config: FilenDesktopConfig): void {
	CONFIG = {
		...config,
		sdkConfig: {
			...config.sdkConfig,
			connectToSocket: true
		}
	}

	console.log("Desktop config set")
}

export function waitForConfig(): Promise<FilenDesktopConfig> {
	return new Promise<FilenDesktopConfig>(resolve => {
		if (CONFIG) {
			resolve(CONFIG)

			return
		}

		const wait = setInterval(() => {
			if (CONFIG) {
				clearInterval(wait)

				resolve(CONFIG)
			}
		}, 100)
	})
}

export default CONFIG
