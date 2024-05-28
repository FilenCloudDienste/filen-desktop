import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."

export class ETag {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<string> {
		if (this.fileSystem.virtualFiles[path.toString()]) {
			return this.fileSystem.virtualFiles[path.toString()]!.uuid
		}

		try {
			const stat = await this.fileSystem.sdk.fs().stat({ path: path.toString() })

			return stat.uuid
		} catch (e) {
			console.error(e) // TODO: Proper debugger

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw WebDAV.Errors.PropertyNotFound
			}

			throw WebDAV.Errors.InvalidOperation
		}
	}

	public run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<string>): void {
		this.execute(path)
			.then(result => {
				callback(undefined, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default ETag
