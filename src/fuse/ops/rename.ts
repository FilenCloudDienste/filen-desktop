import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."

export class Rename {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async exists(path: string): Promise<boolean> {
		try {
			await this.ops.sdk.fs().stat({ path })

			return true
		} catch (e) {
			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				return false
			}

			throw e
		}
	}

	private async execute(src: string, dest: string): Promise<void> {
		if (this.ops.virtualFiles[src]) {
			this.ops.virtualFiles[dest] = this.ops.virtualFiles[src]!

			delete this.ops.virtualFiles[src]

			return
		}

		try {
			await this.ops.sdk.fs().stat({ path: src })

			if (await this.exists(dest)) {
				throw Fuse.default.EEXIST
			}

			await this.ops.sdk.fs().rename({ from: src, to: dest })
		} catch (e) {
			if (typeof e === "number") {
				throw e
			}

			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw Fuse.default.ENOENT
			}

			throw Fuse.default.EIO
		}
	}

	public run(src: string, dest: string, callback: FuseErrorCallbackSimple): void {
		this.execute(src, dest)
			.then(() => {
				callback(0)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Rename
