/// <reference types="node" />
import fs from "fs-extra";
import type Sync from "../sync";
import type { CloudItem } from "@filen/sdk";
export type LocalItem = {
    lastModified: number;
    type: "file" | "directory";
    path: string;
    size: number;
    creation: number;
    inode: number;
};
export type LocalDirectoryTree = Record<string, LocalItem>;
export type LocalDirectoryINodes = Record<number, LocalItem>;
export type LocalTree = {
    tree: LocalDirectoryTree;
    inodes: LocalDirectoryINodes;
};
/**
 * LocalFileSystem
 * @date 3/2/2024 - 12:38:22 PM
 *
 * @export
 * @class LocalFileSystem
 * @typedef {LocalFileSystem}
 */
export declare class LocalFileSystem {
    private readonly sync;
    lastDirectoryChangeTimestamp: number;
    getDirectoryTreeCache: {
        timestamp: number;
        tree: LocalDirectoryTree;
        inodes: LocalDirectoryINodes;
    };
    watcherRunning: boolean;
    private watcherInstance;
    /**
     * Creates an instance of LocalFileSystem.
     * @date 3/2/2024 - 12:38:20 PM
     *
     * @constructor
     * @public
     * @param {{ sync: Sync }} param0
     * @param {Sync} param0.sync
     */
    constructor({ sync }: {
        sync: Sync;
    });
    /**
     * Get the local directory tree.
     * @date 3/2/2024 - 12:38:13 PM
     *
     * @public
     * @async
     * @returns {Promise<LocalTree>}
     */
    getDirectoryTree(): Promise<LocalTree>;
    /**
     * Start the local sync directory watcher.
     * @date 3/2/2024 - 12:38:00 PM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    startDirectoryWatcher(): Promise<void>;
    /**
     * Stop the local sync directory watcher.
     * @date 3/2/2024 - 12:37:48 PM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    stopDirectoryWatcher(): Promise<void>;
    /**
     * Wait for local directory updates to be done.
     * Sometimes the user might copy a lot of new files, folders etc.
     * We want to wait (or at least try) until all local operations are done until we start syncing.
     * This can save a lot of sync cycles.
     * @date 3/1/2024 - 10:40:14 PM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    waitForLocalDirectoryChanges(): Promise<void>;
    /**
     * Creates a hash of a file using streams.
     * @date 3/2/2024 - 9:29:48 AM
     *
     * @public
     * @async
     * @param {{ relativePath: string; algorithm: "sha512" }} param0
     * @param {string} param0.relativePath
     * @param {"sha512"} param0.algorithm
     * @returns {Promise<string>}
     */
    createFileHash({ relativePath, algorithm }: {
        relativePath: string;
        algorithm: "sha512";
    }): Promise<string>;
    /**
     * Create a directory inside the local sync path. Recursively creates intermediate directories if needed.
     * @date 3/2/2024 - 12:36:23 PM
     *
     * @public
     * @async
     * @param {{ relativePath: string }} param0
     * @param {string} param0.relativePath
     * @returns {Promise<fs.Stats>}
     */
    mkdir({ relativePath }: {
        relativePath: string;
    }): Promise<fs.Stats>;
    /**
     * Delete a file/directory inside the local sync path.
     * @date 3/3/2024 - 10:05:55 PM
     *
     * @public
     * @async
     * @param {{ relativePath: string; permanent?: boolean }} param0
     * @param {string} param0.relativePath
     * @param {boolean} [param0.permanent=false]
     * @returns {Promise<void>}
     */
    unlink({ relativePath, permanent }: {
        relativePath: string;
        permanent?: boolean;
    }): Promise<void>;
    /**
     * Rename a file/directory inside the local sync path. Recursively creates intermediate directories if needed.
     * @date 3/2/2024 - 12:41:15 PM
     *
     * @public
     * @async
     * @param {{ fromRelativePath: string; toRelativePath: string }} param0
     * @param {string} param0.fromRelativePath
     * @param {string} param0.toRelativePath
     * @returns {Promise<fs.Stats>}
     */
    rename({ fromRelativePath, toRelativePath }: {
        fromRelativePath: string;
        toRelativePath: string;
    }): Promise<fs.Stats>;
    /**
     * Upload a local file.
     * @date 3/2/2024 - 9:43:58 PM
     *
     * @public
     * @async
     * @param {{ relativePath: string }} param0
     * @param {string} param0.relativePath
     * @returns {Promise<void>}
     */
    upload({ relativePath }: {
        relativePath: string;
    }): Promise<CloudItem>;
}
export default LocalFileSystem;
