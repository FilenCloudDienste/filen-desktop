import { nativeImage, nativeTheme } from "electron"
import pathModule from "path"
import memoize from "lodash/memoize"

export const getAppIcon = memoize((notification: boolean) => {
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
})

export const getTrayIcon = memoize((notification: boolean) => {
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
})
