import { nativeImage, type NativeImage } from "electron"
import pathModule from "path"
import { type TrayState } from "../types"

export const OVERLAY_ICON = nativeImage.createFromPath(pathModule.join(__dirname, "..", "..", "assets", "icons", "app", "overlay", "0.png"))

export const APP_ICON = nativeImage.createFromPath(
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

export const TRAY_ICON_NORMAL = nativeImage
	.createFromPath(pathModule.join(__dirname, "..", "..", "assets", "icons", "tray", "normal@2x.png"))
	.resize({
		width: 16,
		height: 16
	})

export const TRAY_ICON_SYNC = nativeImage
	.createFromPath(pathModule.join(__dirname, "..", "..", "assets", "icons", "tray", "sync@2x.png"))
	.resize({
		width: 16,
		height: 16
	})

export const TRAY_ICON_NOTIFICATION = nativeImage
	.createFromPath(pathModule.join(__dirname, "..", "..", "assets", "icons", "tray", "notification@2x.png"))
	.resize({
		width: 16,
		height: 16
	})

export const TRAY_ICON_WARNING = nativeImage
	.createFromPath(pathModule.join(__dirname, "..", "..", "assets", "icons", "tray", "warning@2x.png"))
	.resize({
		width: 16,
		height: 16
	})

export function getAppIcon(): NativeImage {
	return APP_ICON
}

export function getTrayIcon({ notificationCount, isSyncing, warningCount, errorCount }: TrayState): NativeImage {
	return notificationCount + errorCount > 0
		? TRAY_ICON_NOTIFICATION
		: warningCount > 0
		? TRAY_ICON_WARNING
		: isSyncing
		? TRAY_ICON_SYNC
		: TRAY_ICON_NORMAL
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getOverlayIcon(notificationCount: number): NativeImage {
	return OVERLAY_ICON
}
