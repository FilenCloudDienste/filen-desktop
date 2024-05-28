import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."

export class FastExistsCheck {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<boolean> {
		if (this.fileSystem.virtualFiles[path.toString()]) {
			return true
		}

		try {
			await this.fileSystem.sdk.fs().stat({ path: path.toString() })

			return true
		} catch (e) {
			return false
		}
	}

	public run(path: WebDAV.Path, callback: (exists: boolean) => void): void {
		this.execute(path)
			.then(result => {
				callback(result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default FastExistsCheck
