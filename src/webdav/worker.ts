import { IS_NODE } from "../constants"
import WebDAVServer from "@filen/webdav"

// Only start the worker if it is actually invoked.
if (process.argv.slice(2).includes("--filen-desktop-worker") && IS_NODE) {
	const server = new WebDAVServer({
		port: 1901,
		hostname: "0.0.0.0",
		user: {
			username: "admin",
			password: "admin",
			sdkConfig: {}
		}
	})

	server
		.start()
		.then(() => {
			process.stdout.write(
				JSON.stringify({
					type: "ready"
				})
			)
		})
		.catch(err => {
			console.error(err)

			process.exit(1)
		})
}
