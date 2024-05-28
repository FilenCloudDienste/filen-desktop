import type { FuseReadlinkCallback } from "../types"
import * as Fuse from "@gcas/fuse"
import pathModule from "path"

export class Readlink {
	private async execute(path: string): Promise<string> {
		return pathModule.posix.basename(path)
	}

	public run(path: string, callback: FuseReadlinkCallback): void {
		this.execute(path)
			.then(result => {
				callback(0, result)
			})
			.catch(() => {
				callback(Fuse.default.EIO)
			})
	}
}

export default Readlink
