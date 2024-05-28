import type { SyncPair } from "./types";
/**
 * SyncWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class SyncWorker
 * @typedef {SyncWorker}
 */
export declare class SyncWorker {
    private readonly syncPairs;
    private readonly syncs;
    private readonly dbPath;
    /**
     * Creates an instance of SyncWorker.
     * @date 3/4/2024 - 11:39:47 PM
     *
     * @constructor
     * @public
     * @param {{ syncPairs: SyncPair[], dbPath: string }} param0
     * @param {{}} param0.syncPairs
     * @param {string} param0.dbPath
     */
    constructor({ syncPairs, dbPath }: {
        syncPairs: SyncPair[];
        dbPath: string;
    });
    /**
     * Initialize the Sync worker.
     * @date 2/23/2024 - 5:51:12 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    initialize(): Promise<void>;
}
