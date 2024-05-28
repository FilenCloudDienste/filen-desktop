import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import pathModule from "path"
import { Readable } from "stream"
import fs from "fs-extra"
import { pathToHash } from "../../../fuse/utils"
import { type ReadableStream } from "stream/web"
import { Semaphore } from "../../../semaphore"

export class OpenReadStream {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<Readable> {
		if (this.fileSystem.virtualFiles[path.toString()]) {
			return Readable.from([])
		}

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
			const pathHash = pathToHash(path.toString())
			const tempPath = pathModule.join(this.fileSystem.tmpDir, "filen-webdav", "downloadCache", pathHash)

			if (await fs.exists(tempPath)) {
				return fs.createReadStream(tempPath)
			}

			const stat = await this.fileSystem.sdk.fs().stat({ path: path.toString() })

			if (stat.type !== "file") {
				throw WebDAV.Errors.InvalidOperation
			}

			const stream = (await this.fileSystem.sdk.cloud().downloadFileToReadableStream({
				uuid: stat.uuid,
				region: stat.region,
				bucket: stat.bucket,
				version: stat.version,
				key: stat.key,
				chunks: stat.chunks,
				size: stat.size
			})) as unknown as ReadableStream<Buffer>

			const nodeStream = Readable.fromWeb(stream)

			nodeStream.once("close", () => releaseMutex)
			nodeStream.once("error", () => releaseMutex)

			return nodeStream
		} catch (e) {
			releaseMutex()

			console.error(e) // TODO: Proper debugger

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw WebDAV.Errors.PropertyNotFound
			}

			throw WebDAV.Errors.InvalidOperation
		}
	}

	public run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<Readable>): void {
		this.execute(path)
			.then(result => {
				callback(undefined, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default OpenReadStream
