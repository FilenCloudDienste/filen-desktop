import { type FilenDesktop } from ".."

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
	public constructor({ desktop }: { desktop: FilenDesktop }) {
		this.desktop = desktop
	}
}

export default FS
