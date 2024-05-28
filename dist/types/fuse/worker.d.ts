import { type FilenSDKConfig } from "@filen/sdk";
/**
 * FUSEWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class FUSEWorker
 * @typedef {FUSEWorker}
 */
export declare class FUSEWorker {
    private readonly sdk;
    private readonly fuse;
    private readonly baseTmpPath;
    private readonly fullDownloadsTmpPath;
    private readonly writeTmpPath;
    private readonly decryptedChunksTmpPath;
    private readonly encryptedChunksTmpPath;
    private readonly uploadsTmpPath;
    private readonly xattrPath;
    /**
     * Creates an instance of FUSEWorker.
     * @date 2/25/2024 - 10:23:24 PM
     *
     * @constructor
     * @public
     * @param {{ mountPoint: string }} param0
     * @param {string} param0.mountPoint
     */
    constructor({ mountPoint, baseTmpPath, fullDownloadsTmpPath, writeTmpPath, decryptedChunksTmpPath, xattrPath, encryptedChunksTmpPath, uploadsTmpPath, sdkConfig }: {
        mountPoint: string;
        baseTmpPath: string;
        fullDownloadsTmpPath: string;
        decryptedChunksTmpPath: string;
        encryptedChunksTmpPath: string;
        xattrPath: string;
        writeTmpPath: string;
        uploadsTmpPath: string;
        sdkConfig: FilenSDKConfig;
    });
    /**
     * Mount FUSE on the host.
     * @date 2/26/2024 - 7:12:17 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    mount(): Promise<void>;
    /**
     * Unmount FUSE on the host.
     * @date 2/26/2024 - 7:12:24 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    unmount(): Promise<void>;
    /**
     * Initialize the FUSE worker.
     * @date 2/23/2024 - 5:51:12 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    initialize(): Promise<void>;
}
export default FUSEWorker;
