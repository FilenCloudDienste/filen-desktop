/* eslint-disable @typescript-eslint/no-var-requires */
require("dotenv").config()
const pathModule = require("path")

const JSIGN = pathModule.join(__dirname, "jsign-4.2.jar")
const CFG_PATH = pathModule.join(__dirname, "token.cfg")
const PASS = process.env.SIGN_TOKEN_PASS
const TS = "http://timestamp.sectigo.com"
const ALIAS = process.env.SIGN_TOKEN_ALIAS
const TYPE = "PKCS11"

exports.default = async function sign(context) {
	await new Promise(resolve => setTimeout(resolve, 5000))
	await new Promise((resolve, reject) => {
		try {
			if (context.hash === "sha1") {
				const sha1Cmd = `java -jar "${JSIGN}" --keystore "${CFG_PATH}" --storepass "${PASS}" --storetype "${TYPE}" --tsaurl "${TS}" --alias "${ALIAS}" --alg SHA-1 ${context.path}`

				console.log("SIGNING SHA-1", context.path)

				require("child_process").execSync(sha1Cmd, {
					stdio: ["ignore", "ignore", "ignore", "ignore"]
				})

				console.log("SIGNING DONE SHA-1", context.path)
			}

			if (context.hash === "sha256") {
				const sha256Cmd = `java -jar "${JSIGN}" --keystore "${CFG_PATH}" --storepass "${PASS}" --storetype "${TYPE}" --tsaurl "${TS}" --alias "${ALIAS}" --alg SHA-256 ${context.path}`

				console.log("SIGNING SHA-256", context.path)

				require("child_process").execSync(sha256Cmd, {
					stdio: ["ignore", "ignore", "ignore", "ignore"]
				})

				console.log("SIGNING DONE SHA-256", context.path)
			}

			resolve()
		} catch {
			const err = new Error(`Signing failed for ${context.path}`)

			console.error(err)

			reject(err)
		}
	})
}
