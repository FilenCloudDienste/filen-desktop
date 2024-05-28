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
exports.Open = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
const utils_1 = require("../utils");
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
class Open {
    constructor({ ops }) {
        this.ops = ops;
    }
    async execute(path, mode) {
        if (this.ops.virtualFiles[path]) {
            this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
            return this.ops.nextFd++;
        }
        try {
            const stat = await this.ops.sdk.fs().stat({ path });
            if (stat.type !== "file") {
                throw Fuse.default.ENOENT;
            }
            const openMode = (0, utils_1.flagsToMode)(mode);
            if (!this.ops.openMode[path]) {
                this.ops.openMode[path] = openMode;
            }
            if (openMode === "r+" || openMode === "w") {
                const pathHash = (0, utils_1.pathToHash)(path);
                const writePath = path_1.default.join(this.ops.writeTmpPath, pathHash);
                const decryptedChunksPath = path_1.default.join(this.ops.decryptedChunksTmpPath, pathHash);
                const fullDownloadsPath = path_1.default.join(this.ops.fullDownloadsTmpPath, pathHash);
                if (await fs_extra_1.default.exists(writePath)) {
                    this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
                    return this.ops.nextFd++;
                }
                if (await fs_extra_1.default.exists(fullDownloadsPath)) {
                    await fs_extra_1.default.copy(fullDownloadsPath, writePath, {
                        overwrite: true
                    });
                    this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
                    return this.ops.nextFd++;
                }
                if (await fs_extra_1.default.exists(decryptedChunksPath)) {
                    const files = await fs_extra_1.default.readdir(decryptedChunksPath);
                    let size = 0;
                    const promises = [];
                    for (let i = 0; i < files.length; i++) {
                        const chunkPath = path_1.default.join(decryptedChunksPath, i.toString());
                        promises.push(new Promise((resolve, reject) => {
                            fs_extra_1.default.stat(chunkPath)
                                .then(stats => {
                                if (!stats.isFile()) {
                                    resolve();
                                    return;
                                }
                                size += stats.size;
                                resolve();
                            })
                                .catch(reject);
                        }));
                    }
                    await Promise.all(promises);
                    if (files.length === stat.chunks && stat.size === size) {
                        for (let i = 0; i < files.length; i++) {
                            const chunkPath = path_1.default.join(decryptedChunksPath, i.toString());
                            if (i === 0) {
                                await fs_extra_1.default.copy(chunkPath, writePath, {
                                    overwrite: true
                                });
                            }
                            else {
                                await this.ops.sdk.utils.streams.append({ inputFile: chunkPath, baseFile: writePath });
                            }
                        }
                    }
                    this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
                    return this.ops.nextFd++;
                }
                await this.ops.sdk.fs().download({ path, destination: writePath });
            }
            this.ops.openFileHandles[path] = this.ops.openFileHandles[path] ? this.ops.openFileHandles[path] + 1 : 1;
            return this.ops.nextFd++;
        }
        catch (e) {
            delete this.ops.openMode[path];
            console.error(e);
            if (typeof e === "number") {
                throw e;
            }
            const err = e;
            if (err.code === "ENOENT") {
                throw Fuse.default.ENOENT;
            }
            throw Fuse.default.EIO;
        }
    }
    run(path, mode, callback) {
        this.execute(path, mode)
            .then(result => {
            callback(0, result, mode);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Open = Open;
exports.default = Open;
//# sourceMappingURL=open.js.map