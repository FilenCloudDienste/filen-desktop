import { BrowserWindow } from "electron";
import WebDAV from "./webdav";
import FUSE from "./fuse";
import Sync from "./sync";
import IPC from "./ipc";
import FilenSDK from "@filen/sdk";
import Cloud from "./lib/cloud";
import FS from "./lib/fs";
/**
 * FilenDesktop
 * @date 2/23/2024 - 3:49:42 AM
 *
 * @export
 * @class FilenDesktop
 * @typedef {FilenDesktop}
 */
export declare class FilenDesktop {
    driveWindow: BrowserWindow | null;
    readonly webdav: WebDAV;
    readonly fuse: FUSE | null;
    readonly sync: Sync;
    readonly ipc: IPC;
    readonly sdk: FilenSDK;
    sdkInitialized: boolean;
    readonly lib: {
        cloud: Cloud;
        fs: FS;
    };
    /**
     * Creates an instance of FilenDesktop.
     * @date 2/23/2024 - 6:12:33 AM
     *
     * @constructor
     * @public
     */
    constructor();
    /**
     * Initialize the SDK in the main thread.
     *
     * @private
     * @async
     * @returns {Promise<void>}
     */
    private initializeSDK;
    /**
     * Initialize the desktop client.
     * @date 2/23/2024 - 3:49:49 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    initialize(): Promise<void>;
    private createDriveWindow;
    private startSyncThread;
    private startFuseThread;
    private startWebDAVThread;
}
export { DesktopAPI } from "./preload";
export { WebDAVWorker as WebDAVServer } from "./webdav/worker";
export { SyncWorker as Sync } from "./sync/worker";
