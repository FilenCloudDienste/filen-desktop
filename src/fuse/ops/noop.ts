import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"

export class Noop {
	private async execute(): Promise<number> {
		return 0
	}

	public run(callback: FuseErrorCallbackSimple): void {
		this.execute()
			.then(result => {
				callback(result)
			})
			.catch(() => {
				callback(Fuse.default.EIO)
			})
	}
}

export default Noop
