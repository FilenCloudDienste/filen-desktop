import { nativeImage, nativeTheme } from "electron"
import pathModule from "path"

export function getAppIcon(notification: boolean) {
	return nativeImage.createFromPath(
		pathModule.join(
			__dirname,
			"..",
			"..",
			"assets",
			"icons",
			"app",
			`${process.platform}${notification ? "Notification" : ""}.${
				process.platform === "win32" ? "ico" : process.platform === "darwin" ? "icns" : "png"
			}`
		)
	)
}

export function getTrayIcon(notification: boolean) {
	return nativeImage.createFromPath(
		pathModule.join(
			__dirname,
			"..",
			"..",
			"assets",
			"icons",
			"tray",
			nativeTheme.shouldUseDarkColors ? "light" : "dark",
			`${process.platform}${notification ? "Notification" : ""}${process.platform === "darwin" ? "Template" : ""}.${
				process.platform === "win32" ? "ico" : process.platform === "darwin" ? "png" : "png"
			}`
		)
	)
}

export function getOverlayIcon(notificationCount: number) {
	const count = notificationCount > 9 ? 99 : notificationCount

	return nativeImage.createFromPath(pathModule.join(__dirname, "..", "..", "assets", "icons", "app", "overlay", `${count}.png`))
}
