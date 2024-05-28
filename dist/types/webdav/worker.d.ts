import { type FilenSDKConfig } from "@filen/sdk";
export type WebDAVUser = {
    name: string;
    password: string;
    isAdmin: boolean;
};
/**
 * WebDAVWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class WebDAVWorker
 * @typedef {WebDAVWorker}
 */
export declare class WebDAVWorker {
    private readonly sdk;
    private readonly webdavServer;
    /**
     * Creates an instance of WebDAVWorker.
     *
     * @constructor
     * @public
     * @param {{users: WebDAVUser[], hostname?: string, port?: number, sdkConfig: FilenSDKConfig}} param0
     * @param {{}} param0.users
     * @param {string} param0.hostname
     * @param {number} param0.port
     * @param {FilenSDKConfig} param0.sdkConfig
     */
    constructor({ users, hostname, port, sdkConfig }: {
        users: WebDAVUser[];
        hostname?: string;
        port?: number;
        sdkConfig: FilenSDKConfig;
    });
    /**
     * Initialize the WebDAV worker.
     * @date 2/23/2024 - 5:51:12 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    initialize(): Promise<void>;
}
export default WebDAVWorker;
