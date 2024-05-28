import { type FilenSDKConfig } from "@filen/sdk"

export let SDK_CONFIG: FilenSDKConfig | null = null

export function setSDKConfig(config: FilenSDKConfig): void {
	SDK_CONFIG = config

	console.log("SDK config set")
}

export function waitForSDKConfig(): Promise<FilenSDKConfig> {
	return new Promise<FilenSDKConfig>(resolve => {
		if (SDK_CONFIG) {
			resolve(SDK_CONFIG)

			return
		}

		const wait = setInterval(() => {
			if (SDK_CONFIG) {
				clearInterval(wait)

				resolve(SDK_CONFIG)
			}
		}, 100)
	})
}

export default SDK_CONFIG
