import type { FuseOpenCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."
import { uuidToNumber } from "../utils"

export class Opendir {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string): Promise<number> {
		if (this.ops.virtualFiles[path]) {
			return this.ops.virtualFiles[path]!.ino
		}

		try {
			const stats = await this.ops.sdk.fs().stat({ path })

			return uuidToNumber(stats.uuid)
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

	public run(path: string, _mode: number, callback: FuseOpenCallback): void {
		this.execute(path)
			.then(result => {
				callback(0, result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Opendir
