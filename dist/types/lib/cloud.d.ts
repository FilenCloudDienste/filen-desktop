import { type FilenDesktop } from "..";
import { type DirDownloadType } from "@filen/sdk/dist/types/api/v3/dir/download";
import { type DriveCloudItemWithPath } from "../types";
import { type FileEncryptionVersion, type CloudItemTree, type PauseSignal } from "@filen/sdk";
/**
 * Cloud
 * @date 3/13/2024 - 8:03:16 PM
 *
 * @export
 * @class Cloud
 * @typedef {Cloud}
 */
export declare class Cloud {
    private readonly desktop;
    /**
     * Creates an instance of Cloud.
     * @date 3/13/2024 - 8:03:20 PM
     *
     * @constructor
     * @public
     * @param {{ desktop: FilenDesktop }} param0
     * @param {FilenDesktop} param0.desktop
     */
    constructor({ desktop }: {
        desktop: FilenDesktop;
    });
    /**
     * Download a file to disk.
     *
     * @public
     * @async
     * @param {{
     * 		uuid: string
     * 		bucket: string
     * 		region: string
     * 		chunks: number
     * 		key: string
     * 		to: string
     * 		version: FileEncryptionVersion
     * 		dontEmitEvents?: boolean
     * 		name: string
     * 		size: number,
     * 		pauseSignal?: PauseSignal,
     * 		abortSignal?: AbortSignal
     * 	}} param0
     * @param {string} param0.uuid
     * @param {string} param0.bucket
     * @param {string} param0.region
     * @param {number} param0.chunks
     * @param {string} param0.key
     * @param {string} param0.to
     * @param {FileEncryptionVersion} param0.version
     * @param {boolean} param0.dontEmitEvents
     * @param {string} param0.name
     * @param {number} param0.size
     * @param {PauseSignal} param0.pauseSignal
     * @param {AbortSignal} param0.abortSignal
     * @returns {Promise<string>}
     */
    downloadFile({ uuid, bucket, region, chunks, key, to, version, dontEmitEvents, name, size, pauseSignal, abortSignal }: {
        uuid: string;
        bucket: string;
        region: string;
        chunks: number;
        key: string;
        to: string;
        version: FileEncryptionVersion;
        dontEmitEvents?: boolean;
        name: string;
        size: number;
        pauseSignal?: PauseSignal;
        abortSignal?: AbortSignal;
    }): Promise<string>;
    /**
     * Download a directory to disk.
     *
     * @public
     * @async
     * @param {{
     * 		uuid: string
     * 		type?: DirDownloadType
     * 		linkUUID?: string
     * 		linkHasPassword?: boolean
     * 		linkPassword?: string
     * 		linkSalt?: string
     * 		to: string
     * 		dontEmitEvents?: boolean
     * 		name: string,
     * 		pauseSignal?: PauseSignal,
     * 		abortSignal?: AbortSignal
     * 	}} param0
     * @param {string} param0.uuid
     * @param {DirDownloadType} param0.type
     * @param {string} param0.linkUUID
     * @param {boolean} param0.linkHasPassword
     * @param {string} param0.linkPassword
     * @param {string} param0.linkSalt
     * @param {string} param0.to
     * @param {boolean} param0.dontEmitEvents
     * @param {string} param0.name
     * @param {PauseSignal} param0.pauseSignal
     * @param {AbortSignal} param0.abortSignal
     * @returns {Promise<string>}
     */
    downloadDirectory({ uuid, type, linkUUID, linkHasPassword, linkPassword, linkSalt, to, dontEmitEvents, name, pauseSignal, abortSignal }: {
        uuid: string;
        type?: DirDownloadType;
        linkUUID?: string;
        linkHasPassword?: boolean;
        linkPassword?: string;
        linkSalt?: string;
        to: string;
        dontEmitEvents?: boolean;
        name: string;
        pauseSignal?: PauseSignal;
        abortSignal?: AbortSignal;
    }): Promise<string>;
    /**
     * Download multiple files and directories to disk.
     *
     * @public
     * @async
     * @param {{
     * 		items: DriveCloudItemWithPath[]
     * 		type?: DirDownloadType
     * 		linkUUID?: string
     * 		linkHasPassword?: boolean
     * 		linkPassword?: string
     * 		linkSalt?: string
     * 		dontEmitEvents?: boolean
     * 		to: string
     * 		name: string
     * 		directoryId: string,
     * 		pauseSignal?: PauseSignal,
     * 		abortSignal?: AbortSignal
     * 	}} param0
     * @param {{}} param0.items
     * @param {DirDownloadType} param0.type
     * @param {string} param0.linkUUID
     * @param {boolean} param0.linkHasPassword
     * @param {string} param0.linkPassword
     * @param {string} param0.linkSalt
     * @param {boolean} param0.dontEmitEvents
     * @param {string} param0.to
     * @param {string} param0.name
     * @param {string} param0.directoryId
     * @param {PauseSignal} param0.pauseSignal
     * @param {AbortSignal} param0.abortSignal
     * @returns {Promise<string>}
     */
    downloadMultipleFilesAndDirectories({ items, type, linkUUID, linkHasPassword, linkPassword, linkSalt, dontEmitEvents, to, name, directoryId, pauseSignal, abortSignal }: {
        items: DriveCloudItemWithPath[];
        type?: DirDownloadType;
        linkUUID?: string;
        linkHasPassword?: boolean;
        linkPassword?: string;
        linkSalt?: string;
        dontEmitEvents?: boolean;
        to: string;
        name: string;
        directoryId: string;
        pauseSignal?: PauseSignal;
        abortSignal?: AbortSignal;
    }): Promise<string>;
    /**
     * Fetch a directory tree.
     *
     * @public
     * @async
     * @param {{
     *         uuid: string
     *         type?: DirDownloadType
     *         linkUUID?: string
     *         linkHasPassword?: boolean
     *         linkPassword?: string
     *         linkSalt?: string
     *         skipCache?: boolean
     *     }} param0
     * @param {string} param0.uuid
     * @param {DirDownloadType} param0.type
     * @param {string} param0.linkUUID
     * @param {boolean} param0.linkHasPassword
     * @param {string} param0.linkPassword
     * @param {string} param0.linkSalt
     * @param {boolean} param0.skipCache
     * @returns {Promise<Record<string, CloudItemTree>>}
     */
    getDirectoryTree({ uuid, type, linkUUID, linkHasPassword, linkPassword, linkSalt, skipCache }: {
        uuid: string;
        type?: DirDownloadType;
        linkUUID?: string;
        linkHasPassword?: boolean;
        linkPassword?: string;
        linkSalt?: string;
        skipCache?: boolean;
    }): Promise<Record<string, CloudItemTree>>;
}
export default Cloud;
