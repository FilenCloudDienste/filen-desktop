import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import pathModule from "path"
import { v4 as uuidv4 } from "uuid"
import mimeTypes from "mime-types"
import { Semaphore } from "../../../semaphore"

export class Create {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	private async execute(path: WebDAV.Path, ctx: WebDAV.CreateInfo): Promise<void> {
		if (!this.fileSystem.readWriteMutex[path.toString()]) {
			this.fileSystem.readWriteMutex[path.toString()] = new Semaphore(1)
		}

		await this.fileSystem.readWriteMutex[path.toString()]!.acquire()

		if (ctx.type === WebDAV.ResourceType.Directory) {
			try {
				await this.fileSystem.sdk.fs().mkdir({ path: path.toString() })

				return
			} catch (e) {
				const err = e as unknown as { code?: string }

				if (err.code === "ENOENT") {
					throw WebDAV.Errors.PropertyNotFound
				}

				console.error(e) // TODO: Proper debugger

				throw WebDAV.Errors.InvalidOperation
			} finally {
				this.fileSystem.readWriteMutex[path.toString()]!.release()
			}
		}

		try {
			const stat = await this.fileSystem.sdk.fs().stat({ path: path.toString() })

			if (stat.type === "file") {
				return
			}
		} catch (e) {
			const err = e as unknown as { code?: string }

			if (err.code !== "ENOENT") {
				console.error(err)

				throw WebDAV.Errors.InvalidOperation
			}
		} finally {
			this.fileSystem.readWriteMutex[path.toString()]!.release()
		}

		const name = pathModule.basename(path.toString())
		const uuid = uuidv4()

		this.fileSystem.virtualFiles[path.toString()] = {
			name,
			uuid,
			type: "file",
			version: 2,
			bucket: "",
			region: "",
			key: "",
			mtimeMs: Date.now(),
			birthtimeMs: Date.now(),
			chunks: 1,
			size: 0,
			mime: mimeTypes.lookup(name) || "application/octet-stream",
			lastModified: Date.now(),
			isDirectory() {
				return false
			},
			isFile() {
				return true
			},
			isSymbolicLink() {
				return false
			}
		}
	}

	public run(path: WebDAV.Path, ctx: WebDAV.CreateInfo, callback: WebDAV.SimpleCallback): void {
		this.execute(path, ctx)
			.then(() => {
				callback(undefined)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Create
