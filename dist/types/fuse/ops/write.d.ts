/// <reference types="node" />
import type { FuseReadWriteCallback } from "../types";
import type Ops from ".";
/**
 * Read
 * @date 2/29/2024 - 5:52:51 PM
 *
 * @export
 * @class Read
 * @typedef {Read}
 */
export declare class Read {
    private readonly ops;
    /**
     * Creates an instance of Read.
     * @date 2/29/2024 - 5:52:49 PM
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
     * Write data to the filesystem.
     * If the open mode is either R+ or W (Write intent), then we download the full file.
     * Downloading the full file is needed since we do not support direct writes to files (due to the end to end encryption).
     * The full file has to be downloaded, the necesarry bytes are written to it and the it is re-uploaded.
     * If it's a completely new file however, we can utilize streaming, e.g. write each incoming buffer to a temporary file and upload it during the write process. This is genereally more efficient.
     * @date 2/29/2024 - 5:49:23 PM
     *
     * @private
     * @async
     * @param {string} path
     * @param {Buffer} buffer
     * @param {number} length
     * @param {number} position
     * @returns {Promise<number>}
     */
    private execute;
    /**
     * Run the write task.
     * @date 2/29/2024 - 5:49:01 PM
     *
     * @public
     * @param {string} path
     * @param {Buffer} buffer
     * @param {number} length
     * @param {number} position
     * @param {FuseReadWriteCallback} callback
     */
    run(path: string, buffer: Buffer, length: number, position: number, callback: FuseReadWriteCallback): void;
}
export default Read;
