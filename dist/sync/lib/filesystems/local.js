"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalFileSystem = void 0;
const fs_extra_1 = __importDefault(require("fs-extra"));
const watcher_1 = __importDefault(require("@parcel/watcher"));
const utils_1 = require("../../../utils");
const path_1 = __importDefault(require("path"));
const process_1 = __importDefault(require("process"));
const constants_1 = require("../../constants");
const crypto_1 = __importDefault(require("crypto"));
const stream_1 = require("stream");
const util_1 = require("util");
const pipelineAsync = (0, util_1.promisify)(stream_1.pipeline);
/**
 * LocalFileSystem
 * @date 3/2/2024 - 12:38:22 PM
 *
 * @export
 * @class LocalFileSystem
 * @typedef {LocalFileSystem}
 */
class LocalFileSystem {
    /**
     * Creates an instance of LocalFileSystem.
     * @date 3/2/2024 - 12:38:20 PM
     *
     * @constructor
     * @public
     * @param {{ sync: Sync }} param0
     * @param {Sync} param0.sync
     */
    constructor({ sync }) {
        this.lastDirectoryChangeTimestamp = Date.now() - constants_1.SYNC_INTERVAL * 2;
        this.getDirectoryTreeCache = {
            timestamp: 0,
            tree: {},
            inodes: {}
        };
        this.watcherRunning = false;
        this.watcherInstance = null;
        this.sync = sync;
    }
    /**
     * Get the local directory tree.
     * @date 3/2/2024 - 12:38:13 PM
     *
     * @public
     * @async
     * @returns {Promise<LocalTree>}
     */
    async getDirectoryTree() {
        if (this.lastDirectoryChangeTimestamp > 0 &&
            this.getDirectoryTreeCache.timestamp > 0 &&
            this.lastDirectoryChangeTimestamp < this.getDirectoryTreeCache.timestamp) {
            return {
                tree: this.getDirectoryTreeCache.tree,
                inodes: this.getDirectoryTreeCache.inodes
            };
        }
        const tree = {};
        const inodes = {};
        const dir = await fs_extra_1.default.readdir(this.sync.syncPair.localPath, {
            recursive: true,
            encoding: "utf-8"
        });
        const promises = [];
        for (const entry of dir) {
            promises.push(new Promise((resolve, reject) => {
                if (entry.startsWith(".filen.trash.local")) {
                    resolve();
                    return;
                }
                const itemPath = path_1.default.join(this.sync.syncPair.localPath, entry);
                const entryPath = `/${process_1.default.platform === "win32" ? entry.replace(/\\/g, "/") : entry}`;
                fs_extra_1.default.stat(itemPath)
                    .then(stats => {
                    const item = {
                        lastModified: parseInt(stats.mtimeMs), // Sometimes comes as a float, but we need an int
                        type: stats.isDirectory() ? "directory" : "file",
                        path: entryPath,
                        creation: parseInt(stats.birthtimeMs), // Sometimes comes as a float, but we need an int
                        size: stats.size,
                        inode: stats.ino
                    };
                    tree[entryPath] = item;
                    inodes[stats.ino] = item;
                    resolve();
                })
                    .catch(reject);
            }));
        }
        await (0, utils_1.promiseAllChunked)(promises);
        this.getDirectoryTreeCache = {
            timestamp: Date.now(),
            tree,
            inodes
        };
        return { tree, inodes };
    }
    /**
     * Start the local sync directory watcher.
     * @date 3/2/2024 - 12:38:00 PM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async startDirectoryWatcher() {
        if (this.watcherInstance) {
            return;
        }
        this.watcherInstance = await watcher_1.default.subscribe(this.sync.syncPair.localPath, (err, events) => {
            if (!err && events) {
                this.lastDirectoryChangeTimestamp = Date.now();
            }
        });
    }
    /**
     * Stop the local sync directory watcher.
     * @date 3/2/2024 - 12:37:48 PM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async stopDirectoryWatcher() {
        if (!this.watcherInstance) {
            return;
        }
        await this.watcherInstance.unsubscribe();
        this.watcherInstance = null;
    }
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
    async waitForLocalDirectoryChanges() {
        await new Promise(resolve => {
            if (Date.now() > this.lastDirectoryChangeTimestamp + constants_1.SYNC_INTERVAL) {
                resolve();
                return;
            }
            const wait = setInterval(() => {
                if (Date.now() > this.lastDirectoryChangeTimestamp + constants_1.SYNC_INTERVAL) {
                    clearInterval(wait);
                    resolve();
                }
            }, 100);
        });
    }
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
    async createFileHash({ relativePath, algorithm }) {
        const localPath = path_1.default.join(this.sync.syncPair.localPath, relativePath);
        const hasher = crypto_1.default.createHash(algorithm);
        await pipelineAsync(fs_extra_1.default.createReadStream(localPath), hasher);
        const hash = hasher.digest("hex");
        return hash;
    }
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
    async mkdir({ relativePath }) {
        const localPath = path_1.default.join(this.sync.syncPair.localPath, relativePath);
        await fs_extra_1.default.ensureDir(localPath);
        return await fs_extra_1.default.stat(localPath);
    }
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
    async unlink({ relativePath, permanent = false }) {
        const localPath = path_1.default.join(this.sync.syncPair.localPath, relativePath);
        if (!permanent) {
            const localTrashPath = path_1.default.join(this.sync.syncPair.localPath, ".filen.trash.local");
            await fs_extra_1.default.ensureDir(localTrashPath);
            await fs_extra_1.default.move(localPath, path_1.default.join(localTrashPath, path_1.default.posix.basename(relativePath)), {
                overwrite: true
            });
            return;
        }
        await fs_extra_1.default.rm(localPath, {
            force: true,
            maxRetries: 60 * 10,
            recursive: true,
            retryDelay: 100
        });
    }
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
    async rename({ fromRelativePath, toRelativePath }) {
        const fromLocalPath = path_1.default.join(this.sync.syncPair.localPath, fromRelativePath);
        const toLocalPath = path_1.default.join(this.sync.syncPair.localPath, toRelativePath);
        const fromLocalPathParentPath = path_1.default.dirname(fromLocalPath);
        const toLocalPathParentPath = path_1.default.dirname(toLocalPath);
        await fs_extra_1.default.ensureDir(toLocalPathParentPath);
        if (fromLocalPathParentPath === toLocalPathParentPath) {
            await fs_extra_1.default.rename(fromLocalPath, toLocalPath);
            return await fs_extra_1.default.stat(toLocalPath);
        }
        await fs_extra_1.default.move(fromLocalPath, toLocalPath, {
            overwrite: true
        });
        return await fs_extra_1.default.stat(toLocalPath);
    }
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
    async upload({ relativePath }) {
        const localPath = path_1.default.join(this.sync.syncPair.localPath, relativePath);
        const parentPath = path_1.default.posix.dirname(relativePath);
        await this.sync.remoteFileSystem.mkdir({ relativePath: parentPath });
        const parentUUID = await this.sync.remoteFileSystem.pathToItemUUID({ relativePath: parentPath });
        if (!parentUUID) {
            throw new Error(`Could not upload ${relativePath}: Parent path not found.`);
        }
        const hash = await this.createFileHash({ relativePath, algorithm: "sha512" });
        this.sync.localFileHashes[relativePath] = hash;
        return await this.sync.sdk.cloud().uploadLocalFile({ source: localPath, parent: parentUUID });
    }
}
exports.LocalFileSystem = LocalFileSystem;
exports.default = LocalFileSystem;
//# sourceMappingURL=local.js.map