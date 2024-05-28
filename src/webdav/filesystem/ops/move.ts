import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."

export class Move {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(pathFrom: WebDAV.Path, pathTo: WebDAV.Path): Promise<boolean> {
		if (this.fileSystem.virtualFiles[pathFrom.toString()]) {
			this.fileSystem.virtualFiles[pathTo.toString()] = this.fileSystem.virtualFiles[pathFrom.toString()]!

			delete this.fileSystem.virtualFiles[pathFrom.toString()]

			return true
		}

		try {
			await this.fileSystem.sdk.fs().rename({ from: pathFrom.toString(), to: pathTo.toString() })

			return true
		} catch (e) {
			console.error(e) // TODO: Proper debugger

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw WebDAV.Errors.PropertyNotFound
			}

			throw WebDAV.Errors.InvalidOperation
		}
	}

	public run(pathFrom: WebDAV.Path, pathTo: WebDAV.Path, callback: WebDAV.ReturnCallback<boolean>): void {
		this.execute(pathFrom, pathTo)
			.then(result => {
				callback(undefined, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Move
