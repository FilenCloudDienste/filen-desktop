import type { FuseGetxattrCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import fs from "fs-extra"
import pathModule from "path"
import { pathToHash } from "../utils"
import type Ops from "."

export class Getxattr {
	private readonly ops: Ops

	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	private async execute(path: string, name: string): Promise<Buffer | null> {
		const filePath = pathModule.join(this.ops.xattrPath, pathToHash(path), name)

		if (!(await fs.exists(filePath))) {
			return null
		}

		return await fs.readFile(filePath)
	}

	public run(path: string, name: string, callback: FuseGetxattrCallback): void {
		this.execute(path, name)
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

export default Getxattr
