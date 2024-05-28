import type { FuseReaddirCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."
import pathModule from "path"
import { DIRECTORY_MODE, FILE_MODE, FUSE_DEFAULT_DIRECTORY_MODE, FUSE_DEFAULT_FILE_MODE } from "./constants"
import { uuidToNumber } from "../utils"

export class Readdir {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string): Promise<{ dir: string[]; stats: Fuse.Stats[] }> {
		try {
			await this.ops.sdk.fs().stat({ path })

			const dir = await this.ops.sdk.fs().readdir({ path })
			const allStats: Fuse.Stats[] = []
			const blockSize = 4096

			for (const entry of dir) {
				const entryPath = pathModule.posix.join(path, entry)
				const stats = await this.ops.sdk.fs().stat({ path: entryPath })

				allStats.push({
					mode: stats.isFile() ? FILE_MODE | FUSE_DEFAULT_FILE_MODE : DIRECTORY_MODE | FUSE_DEFAULT_DIRECTORY_MODE,
					uid: process.getuid ? process.getuid() : 0,
					gid: process.getgid ? process.getgid() : 0,
					size: stats.size,
					dev: 1,
					nlink: 1,
					ino: uuidToNumber(stats.uuid),
					rdev: 1,
					blksize: blockSize,
					blocks: stats.isFile() ? Math.floor(stats.size / blockSize) + 1 : 1,
					atime: new Date(stats.mtimeMs),
					mtime: new Date(stats.mtimeMs),
					ctime: new Date(stats.mtimeMs)
				})

				delete this.ops.virtualFiles[entryPath]
			}

			for (const entry in this.ops.virtualFiles) {
				if (entry.startsWith(path + "/") || entry === path) {
					dir.push(pathModule.posix.basename(entry))

					const virtualFilesEntry = this.ops.virtualFiles[entry]

					if (virtualFilesEntry) {
						allStats.push(virtualFilesEntry)
					}
				}
			}

			return {
				dir,
				stats: allStats
			}
		} catch (e) {
			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw Fuse.default.ENOENT
			}

			// TODO: Proper debugger
			console.error(e)

			throw Fuse.default.EIO
		}
	}

	public run(path: string, callback: FuseReaddirCallback): void {
		this.execute(path)
			.then(result => {
				callback(0, result.dir, result.stats)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Readdir
