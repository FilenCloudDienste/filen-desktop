import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import pathModule from "path"
import { Readable } from "stream"
import os from "os"
import fs from "fs-extra"
import { pathToHash } from "../../../fuse/utils"
import { type ReadableStream } from "stream/web"

export class OpenReadStream {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path): Promise<Readable> {
		if (this.fileSystem.virtualFiles[path.toString()]) {
			return Readable.from([])
		}

		try {
			const pathHash = pathToHash(path.toString())
			const tempPath = pathModule.join(os.tmpdir(), "filen-webdav", "downloadCache", pathHash)

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

			return Readable.fromWeb(stream)
		} catch (e) {
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
