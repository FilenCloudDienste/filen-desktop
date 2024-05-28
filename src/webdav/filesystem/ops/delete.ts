import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import { Semaphore } from "../../../semaphore"

export class Delete {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<void> {
		if (this.fileSystem.virtualFiles[path.toString()]) {
			delete this.fileSystem.virtualFiles[path.toString()]

			return
		}

		if (!this.fileSystem.readWriteMutex[path.toString()]) {
			this.fileSystem.readWriteMutex[path.toString()] = new Semaphore(1)
		}

		await this.fileSystem.readWriteMutex[path.toString()]!.acquire()

		try {
			await this.fileSystem.sdk.fs().stat({ path: path.toString() })
			await this.fileSystem.sdk.fs().unlink({ path: path.toString(), permanent: true })
		} catch (e) {
			console.error(e) // TODO: Proper debugger

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw WebDAV.Errors.PropertyNotFound
			}

			throw WebDAV.Errors.InvalidOperation
		} finally {
			this.fileSystem.readWriteMutex[path.toString()]!.release()
		}
	}

	public run(path: WebDAV.Path, callback: WebDAV.SimpleCallback): void {
		this.execute(path)
			.then(() => {
				callback(undefined)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Delete
