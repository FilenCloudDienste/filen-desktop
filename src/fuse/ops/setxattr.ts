import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"
import fs from "fs-extra"
import pathModule from "path"
import { pathToHash } from "../utils"
import type Ops from "."

export class Setxattr {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string, name: string, value: Buffer): Promise<number> {
		if (value.byteLength === 0) {
			return 0
		}

		const filePath = pathModule.join(this.ops.xattrPath, pathToHash(path), name)

		await fs.ensureFile(filePath)
		await fs.writeFile(filePath, value)

		return 0
	}

	public run(path: string, name: string, value: Buffer, callback: FuseErrorCallbackSimple): void {
		this.execute(path, name, value)
			.then(result => {
				callback(result)
			})
			.catch(err => {
				// TODO: Proper debugger
				console.error(err)

				callback(Fuse.default.EIO)
			})
	}
}

export default Setxattr
