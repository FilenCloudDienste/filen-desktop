/// <reference types="node" />
import type Sync from "../sync";
import type { CloudItemTree, FSItemType } from "@filen/sdk";
import fs from "fs-extra";
import type { DistributiveOmit, Prettify } from "../../../types";
export type RemoteItem = Prettify<DistributiveOmit<CloudItemTree, "parent"> & {
    path: string;
}>;
export type RemoteDirectoryTree = Record<string, RemoteItem>;
export type RemoteDirectoryUUIDs = Record<string, RemoteItem>;
export type RemoteTree = {
    tree: RemoteDirectoryTree;
    uuids: RemoteDirectoryUUIDs;
};
export declare class RemoteFileSystem {
    private readonly sync;
    getDirectoryTreeCache: {
        timestamp: number;
        tree: RemoteDirectoryTree;
        uuids: RemoteDirectoryUUIDs;
    };
    private readonly mutex;
    private readonly mkdirMutex;
    constructor({ sync }: {
        sync: Sync;
    });
    getDirectoryTree(): Promise<RemoteTree>;
    /**
     * Find the corresponding UUID of the relative path.
     * @date 3/3/2024 - 6:55:53 PM
     *
     * @public
     * @async
     * @param {{ relativePath: string; type?: FSItemType }} param0
     * @param {string} param0.relativePath
     * @param {FSItemType} param0.type
     * @returns {Promise<string | null>}
     */
    pathToItemUUID({ relativePath, type }: {
        relativePath: string;
        type?: FSItemType;
    }): Promise<string | null>;
    /**
     * Create a directory inside the remote sync path. Recursively creates intermediate directories if needed.
     * @date 3/2/2024 - 9:34:14 PM
     *
     * @public
     * @async
     * @param {{ relativePath: string }} param0
     * @param {string} param0.relativePath
     * @returns {Promise<string>}
     */
    mkdir({ relativePath }: {
        relativePath: string;
    }): Promise<string>;
    /**
     * Delete a file/directory inside the remote sync path.
     * @date 3/3/2024 - 7:03:18 PM
     *
     * @public
     * @async
     * @param {{ relativePath: string; type?: FSItemType; permanent?: boolean }} param0
     * @param {string} param0.relativePath
     * @param {FSItemType} param0.type
     * @param {boolean} [param0.permanent=false]
     * @returns {Promise<void>}
     */
    unlink({ relativePath, type, permanent }: {
        relativePath: string;
        type?: FSItemType;
        permanent?: boolean;
    }): Promise<void>;
    /**
     * Rename a file/directory inside the remote sync path. Recursively creates intermediate directories if needed.
     * @date 3/2/2024 - 9:35:12 PM
     *
     * @public
     * @async
     * @param {{ fromRelativePath: string; toRelativePath: string }} param0
     * @param {string} param0.fromRelativePath
     * @param {string} param0.toRelativePath
     * @returns {Promise<void>}
     */
    rename({ fromRelativePath, toRelativePath }: {
        fromRelativePath: string;
        toRelativePath: string;
    }): Promise<void>;
    /**
     * Download a remote file.
     * @date 3/2/2024 - 9:41:59 PM
     *
     * @public
     * @async
     * @param {{ relativePath: string }} param0
     * @param {string} param0.relativePath
     * @returns {Promise<fs.Stats>}
     */
    download({ relativePath }: {
        relativePath: string;
    }): Promise<fs.Stats>;
}
export default RemoteFileSystem;
