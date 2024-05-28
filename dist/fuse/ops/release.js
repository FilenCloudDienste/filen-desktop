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
exports.Release = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
const utils_1 = require("../utils");
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("../../constants");
const mime_types_1 = __importDefault(require("mime-types"));
const semaphore_1 = require("../../semaphore");
class Release {
    constructor({ ops }) {
        this.ops = ops;
    }
    async execute(path) {
        if (!this.ops.openFileHandles[path]) {
            return;
        }
        if (this.ops.openFileHandles[path]) {
            this.ops.openFileHandles[path] = this.ops.openFileHandles[path] >= 1 ? this.ops.openFileHandles[path] - 1 : 0;
        }
        if (!this.ops.readWriteMutex[path]) {
            this.ops.readWriteMutex[path] = new semaphore_1.Semaphore(1);
        }
        if (this.ops.openFileHandles[path] <= 0) {
            delete this.ops.chunkDownloadsActive[path];
        }
        const pathHash = (0, utils_1.pathToHash)(path);
        const writePath = path_1.default.join(this.ops.writeTmpPath, pathHash);
        const uploadsPath = path_1.default.join(this.ops.uploadsTmpPath, pathHash);
        const fullDownloadsPath = path_1.default.join(this.ops.fullDownloadsTmpPath, pathHash);
        const decryptedChunksPath = path_1.default.join(this.ops.decryptedChunksTmpPath, pathHash);
        let lockAcquired = false;
        try {
            if ((this.ops.openMode[path] === "w" || this.ops.openMode[path] === "r+") &&
                this.ops.openFileHandles[path] <= 0 &&
                (await fs_extra_1.default.exists(writePath))) {
                await this.ops.readWriteMutex[path].acquire();
                lockAcquired = true;
                await this.ops.sdk.fs().upload({ path, source: writePath });
                await Promise.all([
                    fs_extra_1.default.rm(fullDownloadsPath, {
                        force: true,
                        maxRetries: 60 * 10,
                        recursive: true,
                        retryDelay: 100
                    }),
                    fs_extra_1.default.rm(decryptedChunksPath, {
                        force: true,
                        maxRetries: 60 * 10,
                        recursive: true,
                        retryDelay: 100
                    }),
                    fs_extra_1.default.rm(uploadsPath, {
                        force: true,
                        maxRetries: 60 * 10,
                        recursive: true,
                        retryDelay: 100
                    }),
                    fs_extra_1.default.rm(writePath, {
                        force: true,
                        maxRetries: 60 * 10,
                        recursive: true,
                        retryDelay: 100
                    })
                ]);
            }
            if (this.ops.openFileHandles[path] <= 0 && this.ops.uploads[path] && !this.ops.openMode[path]) {
                await this.ops.readWriteMutex[path].acquire();
                lockAcquired = true;
                if (await fs_extra_1.default.exists(uploadsPath)) {
                    const files = await fs_extra_1.default.readdir(uploadsPath);
                    if (files.length > 0) {
                        const promises = [];
                        for (const chunkIndex of files) {
                            promises.push(new Promise((resolve, reject) => {
                                fs_extra_1.default.readFile(path_1.default.join(uploadsPath, chunkIndex))
                                    .then(data => {
                                    this.ops.sdk
                                        .crypto()
                                        .encrypt()
                                        .data({
                                        data,
                                        key: this.ops.uploads[path].key
                                    })
                                        .then(encryptedChunk => {
                                        this.ops.sdk
                                            .api(3)
                                            .file()
                                            .upload()
                                            .chunk()
                                            .buffer({
                                            buffer: encryptedChunk,
                                            index: parseInt(chunkIndex),
                                            uuid: this.ops.uploads[path].uuid,
                                            parent: this.ops.uploads[path].parent,
                                            uploadKey: this.ops.uploads[path].uploadKey
                                        })
                                            .then(() => {
                                            resolve();
                                        })
                                            .catch(reject);
                                    })
                                        .catch(reject);
                                })
                                    .catch(reject);
                            }));
                        }
                        await Promise.all(promises);
                    }
                    const hash = this.ops.uploads[path].hasher.digest("hex");
                    let fileChunks = 0;
                    let dummyOffset = 0;
                    while (dummyOffset < this.ops.uploads[path].size) {
                        fileChunks += 1;
                        dummyOffset += constants_1.CHUNK_SIZE;
                    }
                    const mimeType = mime_types_1.default.lookup(this.ops.uploads[path].name) || "application/octet-stream";
                    await this.ops.sdk
                        .api(3)
                        .upload()
                        .done({
                        uuid: this.ops.uploads[path].uuid,
                        name: await this.ops.sdk
                            .crypto()
                            .encrypt()
                            .metadata({ metadata: this.ops.uploads[path].name, key: this.ops.uploads[path].key }),
                        nameHashed: await this.ops.sdk.crypto().utils.hashFn({ input: this.ops.uploads[path].name.toLowerCase() }),
                        size: await this.ops.sdk
                            .crypto()
                            .encrypt()
                            .metadata({ metadata: this.ops.uploads[path].size.toString(), key: this.ops.uploads[path].key }),
                        chunks: fileChunks,
                        mime: await this.ops.sdk.crypto().encrypt().metadata({ metadata: mimeType, key: this.ops.uploads[path].key }),
                        version: 2,
                        uploadKey: this.ops.uploads[path].uploadKey,
                        rm: await this.ops.sdk.crypto().utils.generateRandomString({ length: 32 }),
                        metadata: await this.ops.sdk
                            .crypto()
                            .encrypt()
                            .metadata({
                            metadata: JSON.stringify({
                                name: this.ops.uploads[path].name,
                                size: this.ops.uploads[path].size,
                                mime: mimeType,
                                key: this.ops.uploads[path].key,
                                lastModified: Date.now(),
                                creation: Date.now(),
                                hash
                            })
                        })
                    });
                    await this.ops.sdk.cloud().checkIfItemParentIsShared({
                        type: "file",
                        parent: this.ops.uploads[path].parent,
                        uuid: this.ops.uploads[path].uuid,
                        itemMetadata: {
                            name: this.ops.uploads[path].name,
                            size: this.ops.uploads[path].size,
                            mime: mimeType,
                            lastModified: Date.now(),
                            creation: Date.now(),
                            key: this.ops.uploads[path].key,
                            hash
                        }
                    });
                    this.ops.sdk.fs()._removeItem({ path });
                    this.ops.sdk.fs()._addItem({
                        path,
                        item: {
                            type: "file",
                            uuid: this.ops.uploads[path].uuid,
                            metadata: {
                                name: this.ops.uploads[path].name,
                                size: this.ops.uploads[path].size,
                                mime: mimeType,
                                key: this.ops.uploads[path].key,
                                lastModified: Date.now(),
                                creation: Date.now(),
                                version: 2,
                                region: this.ops.uploads[path].region,
                                chunks: fileChunks,
                                bucket: this.ops.uploads[path].bucket,
                                hash
                            }
                        }
                    });
                    await Promise.all([
                        fs_extra_1.default.rm(fullDownloadsPath, {
                            force: true,
                            maxRetries: 60 * 10,
                            recursive: true,
                            retryDelay: 100
                        }),
                        fs_extra_1.default.rm(decryptedChunksPath, {
                            force: true,
                            maxRetries: 60 * 10,
                            recursive: true,
                            retryDelay: 100
                        }),
                        fs_extra_1.default.rm(uploadsPath, {
                            force: true,
                            maxRetries: 60 * 10,
                            recursive: true,
                            retryDelay: 100
                        }),
                        fs_extra_1.default.rm(writePath, {
                            force: true,
                            maxRetries: 60 * 10,
                            recursive: true,
                            retryDelay: 100
                        })
                    ]);
                    delete this.ops.uploads[path];
                }
            }
        }
        catch (e) {
            if (typeof e === "number") {
                throw e;
            }
            const err = e;
            if (err.code === "ENOENT") {
                throw Fuse.default.ENOENT;
            }
            throw Fuse.default.EIO;
        }
        finally {
            delete this.ops.openMode[path];
            if (lockAcquired) {
                this.ops.readWriteMutex[path].release();
            }
        }
    }
    run(path, callback) {
        this.execute(path)
            .then(() => {
            callback(0);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Release = Release;
exports.default = Release;
//# sourceMappingURL=release.js.map