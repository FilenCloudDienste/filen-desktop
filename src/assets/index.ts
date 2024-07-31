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
			`${process.platform}${notificationCount > 0 ? "Notification" : ""}.${
				process.platform === "win32" ? "ico" : process.platform === "darwin" ? "icns" : "png"
			}`
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
			`${process.platform}${notificationCount > 0 ? "Notification" : ""}${process.platform === "darwin" ? "Template" : ""}.${
				process.platform === "win32" ? "ico" : process.platform === "darwin" ? "png" : "png"
			}`
		)
	)
}
