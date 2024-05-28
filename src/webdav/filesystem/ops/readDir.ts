import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import pathModule from "path"

export class ReadDir {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<string[] | WebDAV.Path[]> {
		const dirPath = path.toString()

		try {
			const dir = await this.fileSystem.sdk.fs().readdir({ path: dirPath })

			for (const entry of dir) {
				const entryPath = pathModule.posix.join(dirPath, entry)

				delete this.fileSystem.virtualFiles[entryPath]
			}

			for (const entry in this.fileSystem.virtualFiles) {
				if (entry.startsWith(dirPath + "/") || entry === dirPath) {
					dir.push(pathModule.posix.basename(entry))
				}
			}

			return dir
		} catch (e) {
			console.error(e) // TODO: Proper debugger

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw WebDAV.Errors.PropertyNotFound
			}

			throw WebDAV.Errors.InvalidOperation
		}
	}

	public run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<string[] | WebDAV.Path[]>): void {
		this.execute(path)
			.then(result => {
				callback(undefined, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default ReadDir
