import type { FuseErrorCallbackSimple } from "../types"
import * as Fuse from "@gcas/fuse"
import type Ops from "."

/**
 * Access
 * @date 2/29/2024 - 2:29:39 AM
 *
 * @export
 * @class Access
 * @typedef {Access}
 */
export class Access {
	private readonly ops: Ops

	/**
	 * Creates an instance of Access.
	 * @date 2/29/2024 - 2:29:43 AM
	 *
	 * @constructor
	 * @public
	 * @param {{ ops: Ops }} param0
	 * @param {Ops} param0.ops
	 */
	public constructor({ ops }: { ops: Ops }) {
		this.ops = ops
	}

	/**
	 * Checks if a file/directory exists.
	 * @date 2/29/2024 - 2:30:02 AM
	 *
	 * @private
	 * @async
	 * @param {string} path
	 * @returns {Promise<number>}
	 */
	private async execute(path: string): Promise<number> {
		if (this.ops.virtualFiles[path]) {
			return 0
		}

		try {
			await this.ops.sdk.fs().stat({ path })

			return 0
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

	/**
	 * Run the access op.
	 * @date 2/29/2024 - 2:29:50 AM
	 *
	 * @public
	 * @param {string} path
	 * @param {number} _mode
	 * @param {FuseErrorCallbackSimple} callback
	 */
	public run(path: string, _mode: number, callback: FuseErrorCallbackSimple): void {
		this.execute(path)
			.then(result => {
				callback(result)
			})
			.catch(err => {
				callback(err)
			})
	}
}

export default Access
