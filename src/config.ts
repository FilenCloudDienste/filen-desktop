import { type FilenDesktopConfig } from "./types"

export let CONFIG: FilenDesktopConfig | null = null

export function setConfig(config: FilenDesktopConfig): void {
	CONFIG = config
}

export function waitForConfig(): Promise<FilenDesktopConfig> {
	return new Promise<FilenDesktopConfig>(resolve => {
		if (CONFIG && CONFIG.sdkConfig.apiKey && CONFIG.sdkConfig.apiKey.length > 32) {
			resolve(CONFIG)

			return
		}

		const wait = setInterval(() => {
			if (CONFIG && CONFIG.sdkConfig.apiKey && CONFIG.sdkConfig.apiKey.length > 32) {
				clearInterval(wait)

				resolve(CONFIG)
			}
		}, 100)
	})
}

export default CONFIG
