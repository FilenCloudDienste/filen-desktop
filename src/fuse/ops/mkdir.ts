import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."

export class Mkdir {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async exists(path: string): Promise<boolean> {
		try {
			const stats = await this.ops.sdk.fs().stat({ path })

			if (stats.type === "file") {
				return false
			}

			return true
		} catch (e) {
			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				return false
			}

			throw e
		}
	}

	private async execute(path: string): Promise<void> {
		try {
			if (await this.exists(path)) {
				return
			}

			await this.ops.sdk.fs().mkdir({ path })
		} catch (e) {
			const err = e as unknown as { code?: string }

			if (err.code === "ENOENT") {
				throw Fuse.default.ENOENT
			}

			throw Fuse.default.EIO
		}
	}

	public run(path: string, callback: FuseErrorCallbackSimple): void {
		this.execute(path)
			.then(() => {
				callback(0)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Mkdir
