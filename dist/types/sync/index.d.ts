export type SyncWorkerMessage = {
    type: "ready";
};
/**
 * Sync
 * @date 2/23/2024 - 5:49:48 AM
 *
 * @export
 * @class Sync
 * @typedef {Sync}
 */
export declare class Sync {
    private worker;
    private workerReady;
    private sentReady;
    /**
     * Creates an instance of Sync.
     * @date 2/26/2024 - 7:12:10 AM
     *
     * @constructor
     * @public
     */
    constructor();
    /**
     * Initialize the Sync worker.
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
export default Sync;
