import { nativeImage } from "electron"
import pathModule from "path"
import memoize from "lodash/memoize"

export const getAppIcon = memoize(() => {
	return nativeImage.createFromPath(
		pathModule.join(
			__dirname,
			"..",
			"..",
			"assets",
			"icons",
			"app",
			`${process.platform}.${process.platform === "win32" ? "ico" : process.platform === "darwin" ? "icns" : "png"}`
		)
	)
})

export const getTrayIcon = memoize((notification: boolean) => {
	/*return nativeImage.createFromPath(
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
	)*/

	return nativeImage
		.createFromPath(
			pathModule.join(__dirname, "..", "..", "assets", "icons", "tray", `${notification ? "notification@2x.png" : "normal@2x.png"}`)
		)
		.resize({
			width: 16,
			height: 16
		})
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getOverlayIcon = memoize((notificationCount: number) => {
	//const count = notificationCount > 9 ? 99 : notificationCount

	const count = 0

	return nativeImage.createFromPath(pathModule.join(__dirname, "..", "..", "assets", "icons", "app", "overlay", `${count}.png`))
})
