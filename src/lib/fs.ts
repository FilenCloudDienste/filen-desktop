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
	private readonly desktop: FilenDesktop

	/**
	 * Creates an instance of FS.
	 * @date 3/13/2024 - 8:03:20 PM
	 *
	 * @constructor
	 * @public
	 * @param {{ desktop: FilenDesktop }} param0
	 * @param {FilenDesktop} param0.desktop
	 */
	public constructor(desktop: FilenDesktop) {
		this.desktop = desktop
	}

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
