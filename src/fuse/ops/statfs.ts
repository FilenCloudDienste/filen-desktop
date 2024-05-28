import type { FuseStatFSCallback, FuseStatFS } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."

export class StatFS {
	private cache: FuseStatFS | null = null
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(): Promise<FuseStatFS> {
		try {
			const stats = await this.ops.sdk.fs().statfs()

			const blockSize = 4096
			const blocks = Math.floor(stats.max / blockSize) + 1
			const usedBlocks = Math.floor(stats.used / blockSize) + 1
			const freeBlocks = Math.floor(blocks - usedBlocks) + 1
			const statFS = {
				bsize: blockSize,
				frsize: blockSize,
				blocks,
				bfree: freeBlocks,
				bavail: freeBlocks,
				files: 1,
				ffree: 1,
				favail: 1,
				fsid: 1,
				flag: 1,
				namemax: 255
			}

			this.cache = statFS

			return statFS
		} catch (e) {
			// TODO: Proper debugger
			console.error(e)

			if (this.cache) {
				return this.cache
			}

			throw Fuse.default.EIO
		}
	}

	public run(_path: string, callback: FuseStatFSCallback): void {
		this.execute()
			.then(result => {
				callback(0, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default StatFS
