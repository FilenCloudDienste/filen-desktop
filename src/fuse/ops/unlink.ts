import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."

export class Unlink {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string): Promise<void> {
		if (this.ops.virtualFiles[path]) {
			delete this.ops.virtualFiles[path]

			return
		}

		try {
			await this.ops.sdk.fs().stat({ path })
			await this.ops.sdk.fs().unlink({ path, permanent: true })
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

export default Unlink
