export type FUSEWorkerMessage = {
    type: "ready";
};
/**
 * FUSE
 * @date 2/23/2024 - 5:49:48 AM
 *
 * @export
 * @class FUSE
 * @typedef {FUSE}
 */
export declare class FUSE {
    private worker;
    private workerReady;
    private sentReady;
    /**
     * Creates an instance of FUSE.
     * @date 2/26/2024 - 7:12:10 AM
     *
     * @constructor
     * @public
     */
    constructor();
    /**
     * Initialize the FUSE worker.
     * @date 2/23/2024 - 5:49:31 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    initialize(): Promise<void>;
    /**
     * Deinitialize the worker.
     * @date 3/1/2024 - 8:45:04 PM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    deinitialize(): Promise<void>;
    /**
     * Wait for the worker to be ready.
     * @date 2/23/2024 - 5:49:17 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    waitForReady(): Promise<void>;
}
export default FUSE;
