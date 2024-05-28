import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"
import fs from "fs-extra"
import pathModule from "path"
import { pathToHash } from "../utils"
import type Ops from "."

export class Removexattr {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string, name: string): Promise<void> {
		const filePath = pathModule.join(this.ops.xattrPath, pathToHash(path), name)

		if (!(await fs.exists(filePath))) {
			return
		}

		return await fs.rm(filePath, {
			force: true,
			maxRetries: 60 * 10,
			recursive: true,
			retryDelay: 100
		})
	}

	public run(path: string, name: string, callback: FuseErrorCallbackSimple): void {
		this.execute(path, name)
			.then(() => {
				callback(0)
			})
			.catch(err => {
				// TODO: Proper debugger
				console.error(err)

				callback(Fuse.default.EIO)
			})
	}
}

export default Removexattr
