import { type BrowserWindow, protocol, app, net } from "electron"
import pathModule from "path"
import { pathToFileURL } from "url"

export const SCHEME = "filendesktop"
export const PROD_DIR = pathModule.join(__dirname, "..", "..", "node_modules", "@filen", "web", "dist")

export default function serveProd(): (window: BrowserWindow) => Promise<void> {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: SCHEME,
			privileges: {
				standard: true,
				secure: true,
				allowServiceWorkers: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true,
				codeCache: true,
				bypassCSP: false
			}
		}
	])

	app.on("ready", () => {
		protocol.handle(SCHEME, request => {
			const { pathname, host } = new URL(request.url)
			const decodedPath = decodeURIComponent(pathname)
			const normalizedPath = pathModule.normalize(decodedPath)

			if (host !== "bundle" || normalizedPath.startsWith("..") || normalizedPath.includes("..")) {
				return new Response("404", {
					status: 404,
					headers: { "content-type": "text/html" }
				})
			}

			const filePath = pathname === "/" ? pathModule.join(PROD_DIR, "index.html") : pathModule.join(PROD_DIR, pathname)

			if (!filePath.startsWith(PROD_DIR)) {
				return new Response("404", {
					status: 404,
					headers: { "content-type": "text/html" }
				})
			}

			return net.fetch(pathToFileURL(filePath).toString())
		})
	})

	return async (window: BrowserWindow) => {
		await window.loadURL(`${SCHEME}://bundle`)
	}
}
