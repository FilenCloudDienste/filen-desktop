import { type FilenDesktop } from "..";
/**
 * FS
 * @date 3/13/2024 - 8:03:16 PM
 *
 * @export
 * @class FS
 * @typedef {FS}
 */
export declare class FS {
    private readonly desktop;
    /**
     * Creates an instance of FS.
     * @date 3/13/2024 - 8:03:20 PM
     *
     * @constructor
     * @public
     * @param {{ desktop: FilenDesktop }} param0
     * @param {FilenDesktop} param0.desktop
     */
    constructor({ desktop }: {
        desktop: FilenDesktop;
    });
}
export default FS;
