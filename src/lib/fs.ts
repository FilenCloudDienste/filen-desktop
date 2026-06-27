import { type FilenDesktop } from ".."
import fs from "fs-extra"

/**
 * FS
 * @date 3/13/2024 - 8:03:16 PM
 *
 * @export
 * @class FS
 * @typedef {FS}
 */
export class FS {
	/**
	 * Creates an instance of FS.
	 * @date 3/13/2024 - 8:03:20 PM
	 *
	 * @constructor
	 * @public
	 * @param {FilenDesktop} _desktop Unused for now; kept so FS is constructed symmetrically with the other lib classes.
	 */
	public constructor(_desktop: FilenDesktop) {}

	public async isPathWritable(path: string): Promise<boolean> {
		try {
			await fs.access(path, fs.constants.W_OK | fs.constants.R_OK)

			return true
		} catch {
			return false
		}
	}

	public async isPathReadable(path: string): Promise<boolean> {
		try {
			await fs.access(path, fs.constants.R_OK)

			return true
		} catch {
			return false
		}
	}
}

export default FS
