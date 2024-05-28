"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Create = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
const utils_1 = require("../utils");
const semaphore_1 = require("../../semaphore");
const uuid_1 = require("uuid");
const constants_1 = require("./constants");
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
/**
 * Create
 * @date 2/29/2024 - 1:43:36 AM
 *
 * @export
 * @class Create
 * @typedef {Create}
 */
class Create {
    /**
     * Creates an instance of Create.
     * @date 2/29/2024 - 1:43:41 AM
     *
     * @constructor
     * @public
     * @param {{ ops: Ops }} param0
     * @param {Ops} param0.ops
     */
    constructor({ ops }) {
        this.ops = ops;
    }
    /**
     * Get the UUID of a path. If it does not exist, return null.
     * @date 2/29/2024 - 1:43:44 AM
     *
     * @private
     * @async
     * @param {string} path
     * @returns {Promise<string | null>}
     */
    async uuid(path) {
        try {
            const stat = await this.ops.sdk.fs().stat({ path });
            if (stat.type !== "file") {
                return null;
            }
            return stat.uuid;
        }
        catch (e) {
            const err = e;
            if (err.code === "ENOENT") {
                return null;
            }
            throw e;
        }
    }
    /**
     * Creates a "virtual" file handle since we don't support 0 byte files and we do not want to upload a 1 byte placeholder file on each create call.
     * This speeds up all subsequent calls dramatically. Make sure to take the virtual file handles into account (readdir, getattr, unlink, rename, read, write etc.).
     * @date 2/29/2024 - 1:44:07 AM
     *
     * @private
     * @async
     * @param {string} path
     * @returns {Promise<number>}
     */
    async execute(path) {
        if (!this.ops.readWriteMutex[path]) {
            this.ops.readWriteMutex[path] = new semaphore_1.Semaphore(1);
        }
        await this.ops.readWriteMutex[path].acquire();
        try {
            if (this.ops.virtualFiles[path]) {
                this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
                return this.ops.nextFd++;
            }
            const uuid = await this.uuid(path);
            if (uuid) {
                this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
                return this.ops.nextFd++;
            }
            const ino = (0, utils_1.uuidToNumber)((0, uuid_1.v4)());
            this.ops.virtualFiles[path] = {
                mode: constants_1.FILE_MODE | constants_1.FUSE_DEFAULT_FILE_MODE,
                uid: process.getuid ? process.getuid() : 0,
                gid: process.getgid ? process.getgid() : 0,
                size: 0,
                dev: 1,
                nlink: 1,
                ino,
                rdev: 1,
                blksize: 4096,
                blocks: 1,
                atime: new Date(),
                mtime: new Date(),
                ctime: new Date()
            };
            // Write temporary data to disk
            const pathHash = (0, utils_1.pathToHash)(path);
            const writePath = path_1.default.join(this.ops.writeTmpPath, pathHash);
            const decryptedChunksPath = path_1.default.join(this.ops.decryptedChunksTmpPath, pathHash);
            const fullDownloadsPath = path_1.default.join(this.ops.fullDownloadsTmpPath, pathHash);
            const content = Buffer.from(" ", "utf-8");
            await Promise.all([
                fs_extra_1.default.writeFile(writePath, content),
                fs_extra_1.default.writeFile(path_1.default.join(decryptedChunksPath, "0"), content),
                fs_extra_1.default.writeFile(fullDownloadsPath, content)
            ]);
            this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
            return this.ops.nextFd++;
        }
        catch (e) {
            const err = e;
            if (err.code === "ENOENT") {
                throw Fuse.default.ENOENT;
            }
            throw Fuse.default.EIO;
        }
        finally {
            this.ops.readWriteMutex[path].release();
        }
    }
    /**
     * Run the create op.
     * @date 2/29/2024 - 1:44:56 AM
     *
     * @public
     * @param {string} path
     * @param {number} mode
     * @param {FuseCreateCallback} callback
     */
    run(path, mode, callback) {
        this.execute(path)
            .then(result => {
            callback(0, result, mode);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Create = Create;
exports.default = Create;
//# sourceMappingURL=create.js.map