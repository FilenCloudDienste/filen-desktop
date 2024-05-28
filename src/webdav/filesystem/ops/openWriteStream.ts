import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import pathModule from "path"
import { Writable } from "stream"
import { v4 as uuidv4 } from "uuid"
import { ChunkedUploadWriter } from "../streams"
import { FSItem, BUFFER_SIZE } from "@filen/sdk"

export class OpenWriteStream {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<Writable> {
		try {
			const parentPath = pathModule.dirname(path.toString())
			const uuid = uuidv4()
			const name = pathModule.posix.basename(path.toString())
			const [key, uploadKey, parentStat] = await Promise.all([
				this.fileSystem.sdk.crypto().utils.generateRandomString({ length: 32 }),
				this.fileSystem.sdk.crypto().utils.generateRandomString({ length: 32 }),
				this.fileSystem.sdk.fs().stat({ path: parentPath })
			])

			const stream = new ChunkedUploadWriter({
				options: {
					highWaterMark: BUFFER_SIZE
				},
				sdk: this.fileSystem.sdk,
				uuid,
				key,
				uploadKey,
				name,
				parent: parentStat.uuid
			})

			stream.once("uploaded", (item: FSItem) => {
				this.fileSystem.sdk.fs()._removeItem({ path: path.toString() })
				this.fileSystem.sdk.fs()._addItem({
					path: path.toString(),
					item
				})

				delete this.fileSystem.virtualFiles[path.toString()]
			})

			stream.once("error", console.error) // TODO: Proper debugger

			return stream
		} catch (e) {
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
