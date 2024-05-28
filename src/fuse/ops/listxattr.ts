import type { FuseListxattrCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import fs from "fs-extra"
import pathModule from "path"
import { pathToHash } from "../utils"
import type Ops from "."

export class Listxattr {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string): Promise<string[]> {
		const dirPath = pathModule.join(this.ops.xattrPath, pathToHash(path))

		if (!(await fs.exists(dirPath))) {
			return []
		}

		return await fs.readdir(dirPath)
	}

	public run(path: string, callback: FuseListxattrCallback): void {
		this.execute(path)
			.then(result => {
				callback(0, result)
			})
			.catch(err => {
				// TODO: Proper debugger
				console.error(err)

				callback(Fuse.default.EIO)
			})
	}
}

export default Listxattr
