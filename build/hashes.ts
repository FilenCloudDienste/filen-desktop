import crypto from "crypto"
import fs from "fs-extra"
import pathModule from "path"
import YAML from "yaml"
import { pipeline } from "stream"
import { promisify } from "util"

export const pipelineAsync = promisify(pipeline)

export const artifacts = [
	"Filen_win.exe",
	"Filen_win_arm64.exe",
	"Filen_win_x64.exe",
	"Filen_linux_arm64.AppImage",
	"Filen_linux_amd64.deb",
	"Filen_linux_x86_64.rpm",
	"Filen_linux_x86_64.AppImage",
	"Filen_linux_amd64.deb",
	"Filen_linux_x86_64.rpm",
	"Filen_mac_x64.zip",
	"Filen_mac_arm64.zip",
	"Filen_mac_x64.dmg",
	"Filen_mac_arm64.dmg"
]

export const ymls = ["latest-mac.yml", "latest-linux-arm64.yml", "latest-linux.yml", "latest.yml"]

export type LatestFile = {
	version: string
	files: {
		url: string
		sha512: string
		size: number
		isAdminRightsRequired?: boolean
	}[]
	path: string
	sha512: string
	releaseDate: string
}

export async function hashFile(path: string): Promise<string> {
	const hasher = crypto.createHash("sha512")

	await pipelineAsync(fs.createReadStream(path), hasher)

	return hasher.digest("base64")
}

export default async function main(): Promise<void> {
	const existingArtifacts = artifacts.filter(artifact => {
		return fs.existsSync(pathModule.join(__dirname, "..", "prod", artifact))
	})

	const existingYMLs = ymls.filter(yml => {
		return fs.existsSync(pathModule.join(__dirname, "..", "prod", yml))
	})

	console.log("Listing YAML files")

	for (const file of existingYMLs) {
		const path = pathModule.join(__dirname, "..", "prod", file)
		const content: LatestFile = YAML.parse(fs.readFileSync(path, "utf-8"))

		console.log("Listing files inside", file)

		for (let i = 0; i < content.files.length; i++) {
			if (existingArtifacts.includes(content.files[i].url)) {
				console.log("Found", content.files[i].url, ", hashing...")

				const artifactPath = pathModule.join(__dirname, "..", "prod", content.files[i].url)
				const hash = await hashFile(artifactPath)

				console.log(content.files[i].url, hash)

				console.log("Old", content.files[i].sha512)
				console.log("New", hash)

				content.files[i].sha512 = hash

				console.log(content.files[i].url, "writing...")

				fs.writeFileSync(path, YAML.stringify(content))

				console.log(content.files[i].url, "done!")
			}
		}

		console.log("Modifying root entry of", file)

		if (existingArtifacts.includes(content.path)) {
			console.log("Found", content.path, ", hashing...")

			const artifactPath = pathModule.join(__dirname, "..", "prod", content.path)
			const hash = await hashFile(artifactPath)

			console.log(content.path, hash)

			console.log("Old", content.sha512)
			console.log("New", hash)

			content.sha512 = hash

			console.log(content.path, "writing...")

			fs.writeFileSync(path, YAML.stringify(content))

			console.log(content.path, "done!")
		}
	}

	console.log("Done")
}

main()
	.then(() => {
		process.exit(0)
	})
	.catch(err => {
		console.error(err)

		process.exit(1)
	})
