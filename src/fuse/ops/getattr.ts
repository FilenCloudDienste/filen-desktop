import type { FuseStatsCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import { DIRECTORY_MODE, FILE_MODE, FUSE_DEFAULT_DIRECTORY_MODE, FUSE_DEFAULT_FILE_MODE } from "./constants"
import { uuidToNumber } from "../utils"
import type Ops from "."

export class Getattr {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string): Promise<Fuse.Stats> {
		const blockSize = 4096

		if (path === "/") {
			return {
				mode: DIRECTORY_MODE | FUSE_DEFAULT_DIRECTORY_MODE,
				uid: process.getuid ? process.getuid() : 0,
				gid: process.getgid ? process.getgid() : 0,
				size: 1,
				dev: 1,
				nlink: 1,
				ino: 1,
				rdev: 1,
				blksize: blockSize,
				blocks: 1,
				atime: new Date(),
				mtime: new Date(),
				ctime: new Date()
			}
		}

		if (this.ops.virtualFiles[path]) {
			return this.ops.virtualFiles[path]!
		}

		try {
			const stats = await this.ops.sdk.fs().stat({ path })

			return {
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

	public run(path: string, callback: FuseStatsCallback): void {
		this.execute(path)
			.then(result => {
				callback(0, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Getattr
