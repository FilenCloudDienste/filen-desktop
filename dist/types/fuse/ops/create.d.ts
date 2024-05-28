import type { FuseCreateCallback } from "../types";
import type Ops from ".";
/**
 * Create
 * @date 2/29/2024 - 1:43:36 AM
 *
 * @export
 * @class Create
 * @typedef {Create}
 */
export declare class Create {
    private readonly ops;
    /**
     * Creates an instance of Create.
     * @date 2/29/2024 - 1:43:41 AM
     *
     * @constructor
     * @public
     * @param {{ ops: Ops }} param0
     * @param {Ops} param0.ops
     */
    constructor({ ops }: {
        ops: Ops;
    });
    /**
     * Get the UUID of a path. If it does not exist, return null.
     * @date 2/29/2024 - 1:43:44 AM
     *
     * @private
     * @async
     * @param {string} path
     * @returns {Promise<string | null>}
     */
    private uuid;
    /**
     * Creates a "virtual" file handle since we don't support 0 byte files and we do not want to upload a 1 byte placeholder file on each create call.
     * This speeds up all subsequent calls dramatically. Make sure to take the virtual file handles into account (readdir, getattr, unlink, rename, read, write etc.).
     * @date 2/29/2024 - 1:44:07 AM
     *
     * @private
     * @async
     * @param {string} path
     * @returns {Promise<number>}
     */
    private execute;
    /**
     * Run the create op.
     * @date 2/29/2024 - 1:44:56 AM
     *
     * @public
     * @param {string} path
     * @param {number} mode
     * @param {FuseCreateCallback} callback
     */
    run(path: string, mode: number, callback: FuseCreateCallback): void;
}
export default Create;
