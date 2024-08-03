/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-unreachable */
require("dotenv").config()
const { notarize } = require("@electron/notarize")

exports.default = async function notarizing(context) {
	const { electronPlatformName, appOutDir } = context

	if (electronPlatformName !== "darwin") {
		return
	}

	const appName = context.packager.appInfo.productFilename

	return await notarize({
		appBundleId: "io.filen.desktop",
		appPath: `${appOutDir}/${appName}.app`,
		appleId: process.env.APPLE_NOTARIZE_ID,
		appleIdPassword: process.env.APPLE_NOTARIZE_PASS,
		teamId: process.env.APPLE_NOTARIZE_TEAM_ID
	})
}
