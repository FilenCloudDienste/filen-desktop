import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import pathModule from "path"
import { Writable } from "stream"
import { v4 as uuidv4 } from "uuid"
import { ChunkedUploadWriter } from "../streams"
import { FSItem, BUFFER_SIZE } from "@filen/sdk"
import { Semaphore } from "../../../semaphore"

export class OpenWriteStream {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<Writable> {
		if (!this.fileSystem.readWriteMutex[path.toString()]) {
			this.fileSystem.readWriteMutex[path.toString()] = new Semaphore(1)
		}

		await this.fileSystem.readWriteMutex[path.toString()]!.acquire()

		let didReleaseMutex = false

		const releaseMutex = () => {
			if (didReleaseMutex) {
				return
			}

			didReleaseMutex = true

			this.fileSystem.readWriteMutex[path.toString()]!
		}

		try {
			const parentPath = pathModule.dirname(path.toString())
			const parentStat = await this.fileSystem.sdk.fs().stat({ path: parentPath })
			const uuid = uuidv4()
			const name = pathModule.posix.basename(path.toString())
			const [key, uploadKey] = await Promise.all([
				this.fileSystem.sdk.crypto().utils.generateRandomString({ length: 32 }),
				this.fileSystem.sdk.crypto().utils.generateRandomString({ length: 32 })
			])
			const parent = parentStat.uuid
			const stream = new ChunkedUploadWriter({
				options: {
					highWaterMark: BUFFER_SIZE
				},
				sdk: this.fileSystem.sdk,
				uuid,
				key,
				uploadKey,
				name,
				parent
			})

			stream.once("uploaded", (item: FSItem) => {
				this.fileSystem.sdk.fs()._removeItem({ path: path.toString() })
				this.fileSystem.sdk.fs()._addItem({
					path: path.toString(),
					item
				})

				releaseMutex()

				delete this.fileSystem.virtualFiles[path.toString()]
			})

			stream.once("close", releaseMutex)
			stream.once("error", releaseMutex) // TODO: Proper debugger

			return stream
		} catch (e) {
			releaseMutex()

			delete this.fileSystem.virtualFiles[path.toString()]

			console.error(e) // TODO: Proper debugger

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw WebDAV.Errors.PropertyNotFound
			}

			throw WebDAV.Errors.InvalidOperation
		}
	}

	public run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<Writable>): void {
		this.execute(path)
			.then(result => {
				callback(undefined, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default OpenWriteStream
