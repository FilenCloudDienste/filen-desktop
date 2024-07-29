import { nativeImage, nativeTheme } from "electron"
import pathModule from "path"

export function getAppIcon(notificationCount: number) {
	return nativeImage.createFromPath(
		pathModule.join(
			__dirname,
			"..",
			"..",
			"assets",
			"icons",
			"app",
			process.platform,
			nativeTheme.shouldUseDarkColors ? "light" : "dark",
			notificationCount > 0 ? `iconNotification${notificationCount > 9 ? 99 : notificationCount}.png` : "icon.png"
		)
	)
}

export function getTrayIcon(notificationCount: number) {
	return nativeImage.createFromPath(
		pathModule.join(
			__dirname,
			"..",
			"..",
			"assets",
			"icons",
			"tray",
			nativeTheme.shouldUseDarkColors ? "light" : "dark",
			notificationCount > 0 ? "iconNotification.png" : "icon.png"
		)
	)
}
