import type { FuseErrorCallbackSimple } from "../types";
import type Ops from ".";
/**
 * Access
 * @date 2/29/2024 - 2:29:39 AM
 *
 * @export
 * @class Access
 * @typedef {Access}
 */
export declare class Access {
    private readonly ops;
    /**
     * Creates an instance of Access.
     * @date 2/29/2024 - 2:29:43 AM
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
     * Checks if a file/directory exists.
     * @date 2/29/2024 - 2:30:02 AM
     *
     * @private
     * @async
     * @param {string} path
     * @returns {Promise<number>}
     */
    private execute;
    /**
     * Run the access op.
     * @date 2/29/2024 - 2:29:50 AM
     *
     * @public
     * @param {string} path
     * @param {number} _mode
     * @param {FuseErrorCallbackSimple} callback
     */
    run(path: string, _mode: number, callback: FuseErrorCallbackSimple): void;
}
export default Access;
