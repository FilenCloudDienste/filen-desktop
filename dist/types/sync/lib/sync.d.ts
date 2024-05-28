import SDK, { type FilenSDKConfig } from "@filen/sdk";
import type { SyncPair } from "../types";
import { LocalFileSystem, LocalTree } from "./filesystems/local";
import { RemoteFileSystem, RemoteTree } from "./filesystems/remote";
import Deltas from "./deltas";
import Tasks from "./tasks";
import State from "./state";
/**
 * Sync
 *
 * @export
 * @class Sync
 * @typedef {Sync}
 */
export declare class Sync {
    readonly sdk: SDK;
    readonly syncPair: SyncPair;
    private isInitialized;
    readonly localFileSystem: LocalFileSystem;
    readonly remoteFileSystem: RemoteFileSystem;
    readonly deltas: Deltas;
    previousLocalTree: LocalTree;
    previousRemoteTree: RemoteTree;
    localFileHashes: Record<string, string>;
    readonly tasks: Tasks;
    readonly state: State;
    readonly dbPath: string;
    /**
     * Creates an instance of Sync.
     *
     * @constructor
     * @public
     * @param {{ syncPair: SyncPair; dbPath: string, sdkConfig: FilenSDKConfig }} param0
     * @param {SyncPair} param0.syncPair
     * @param {string} param0.dbPath
     * @param {FilenSDKConfig} param0.sdkConfig
     */
    constructor({ syncPair, dbPath, sdkConfig }: {
        syncPair: SyncPair;
        dbPath: string;
        sdkConfig: FilenSDKConfig;
    });
    initialize(): Promise<void>;
    private run;
}
export default Sync;
