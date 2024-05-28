"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Read = void 0;
const utils_1 = require("../utils");
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("../../constants");
const uuid_1 = require("uuid");
const semaphore_1 = require("../../semaphore");
const crypto_1 = __importDefault(require("crypto"));
/**
 * Read
 * @date 2/29/2024 - 5:52:51 PM
 *
 * @export
 * @class Read
 * @typedef {Read}
 */
class Read {
    /**
     * Creates an instance of Read.
     * @date 2/29/2024 - 5:52:49 PM
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
     * Write data to the filesystem.
     * If the open mode is either R+ or W (Write intent), then we download the full file.
     * Downloading the full file is needed since we do not support direct writes to files (due to the end to end encryption).
     * The full file has to be downloaded, the necesarry bytes are written to it and the it is re-uploaded.
     * If it's a completely new file however, we can utilize streaming, e.g. write each incoming buffer to a temporary file and upload it during the write process. This is genereally more efficient.
     * @date 2/29/2024 - 5:49:23 PM
     *
     * @private
     * @async
     * @param {string} path
     * @param {Buffer} buffer
     * @param {number} length
     * @param {number} position
     * @returns {Promise<number>}
     */
    async execute(path, buffer, length, position) {
        const pathHash = (0, utils_1.pathToHash)(path);
        try {
            // We are modifying an existing file. Write the changed bytes to the full file and completely re-upload it.
            if (this.ops.openMode[path] === "w" || this.ops.openMode[path] === "r+") {
                const writePath = path_1.default.join(this.ops.writeTmpPath, pathHash);
                if (!(await fs_extra_1.default.exists(writePath))) {
                    await this.ops.sdk.fs().download({ path, destination: writePath });
                }
                const fd = await fs_extra_1.default.open(writePath, fs_extra_1.default.constants.F_OK | fs_extra_1.default.constants.R_OK | fs_extra_1.default.constants.W_OK);
                try {
                    await fs_extra_1.default.write(fd, buffer, 0, length, position);
                    return length;
                }
                catch (e) {
                    console.error(e);
                    return 0;
                }
                finally {
                    await fs_extra_1.default.close(fd);
                }
            }
            const uploadsPath = path_1.default.join(this.ops.uploadsTmpPath, pathHash);
            const parentPath = path_1.default.posix.dirname(path);
            const tmpChunkPaths = [];
            const parentStat = await this.ops.sdk.fs().stat({ path: parentPath });
            if (parentStat.type !== "directory") {
                return 0;
            }
            if (!this.ops.uploads[path]) {
                this.ops.uploads[path] = {
                    name: path_1.default.posix.basename(path),
                    key: await this.ops.sdk.crypto().utils.generateRandomString({ length: 32 }),
                    uuid: (0, uuid_1.v4)(),
                    path,
                    size: 0,
                    parent: parentStat.uuid,
                    uploadKey: await this.ops.sdk.crypto().utils.generateRandomString({ length: 32 }),
                    region: "",
                    bucket: "",
                    hasher: crypto_1.default.createHash("sha512"),
                    nextHasherChunk: 0
                };
            }
            let currentOffset = 0;
            try {
                await fs_extra_1.default.ensureDir(uploadsPath);
                if (position <= 0) {
                    await fs_extra_1.default.emptyDir(uploadsPath);
                }
                while (currentOffset < length) {
                    const currentChunkIndex = Math.floor((position + currentOffset) / constants_1.CHUNK_SIZE);
                    const currentChunkPath = path_1.default.join(uploadsPath, currentChunkIndex.toString());
                    const positionInChunk = (position + currentOffset) % constants_1.CHUNK_SIZE;
                    const availableSpaceInChunk = constants_1.CHUNK_SIZE - positionInChunk;
                    if (!tmpChunkPaths.includes(currentChunkPath)) {
                        tmpChunkPaths.push(currentChunkPath);
                    }
                    const dataToWrite = Math.min(length - currentOffset, availableSpaceInChunk);
                    const writeBuffer = buffer.subarray(currentOffset, currentOffset + dataToWrite);
                    if (!this.ops.writeTmpChunkToDiskMutex[path]) {
                        this.ops.writeTmpChunkToDiskMutex[path] = new semaphore_1.Semaphore(1);
                    }
                    await this.ops.writeTmpChunkToDiskMutex[path].acquire();
                    try {
                        if (!(await fs_extra_1.default.exists(currentChunkPath))) {
                            await fs_extra_1.default.writeFile(currentChunkPath, writeBuffer);
                        }
                        else {
                            const fd = await fs_extra_1.default.open(currentChunkPath, fs_extra_1.default.constants.F_OK | fs_extra_1.default.constants.R_OK | fs_extra_1.default.constants.W_OK);
                            try {
                                await fs_extra_1.default.write(fd, writeBuffer, 0, dataToWrite, positionInChunk);
                            }
                            finally {
                                await fs_extra_1.default.close(fd);
                            }
                        }
                    }
                    finally {
                        this.ops.writeTmpChunkToDiskMutex[path].release();
                    }
                    if (positionInChunk + dataToWrite >= constants_1.CHUNK_SIZE) {
                        const data = await fs_extra_1.default.readFile(currentChunkPath);
                        if (this.ops.uploads[path].nextHasherChunk === currentChunkIndex) {
                            this.ops.uploads[path].hasher.update(data);
                            this.ops.uploads[path].nextHasherChunk += 1;
                        }
                        const encryptedChunk = await this.ops.sdk.crypto().encrypt().data({ data, key: this.ops.uploads[path].key });
                        const { region, bucket } = await this.ops.sdk.api(3).file().upload().chunk().buffer({
                            buffer: encryptedChunk,
                            index: currentChunkIndex,
                            uuid: this.ops.uploads[path].uuid,
                            parent: this.ops.uploads[path].parent,
                            uploadKey: this.ops.uploads[path].uploadKey
                        });
                        this.ops.uploads[path].region = region;
                        this.ops.uploads[path].bucket = bucket;
                        await fs_extra_1.default.rm(currentChunkPath, {
                            force: true,
                            maxRetries: 60 * 10,
                            recursive: true,
                            retryDelay: 100
                        });
                    }
                    currentOffset += dataToWrite;
                }
                this.ops.uploads[path].size += length;
                return length;
            }
            catch (e) {
                console.error(e);
                for (const path of tmpChunkPaths) {
                    await fs_extra_1.default.rm(path, {
                        force: true,
                        maxRetries: 60 * 10,
                        recursive: true,
                        retryDelay: 100
                    });
                }
                delete this.ops.uploads[path];
                return 0;
            }
        }
        catch (e) {
            console.error(e);
            return 0;
        }
    }
    /**
     * Run the write task.
     * @date 2/29/2024 - 5:49:01 PM
     *
     * @public
     * @param {string} path
     * @param {Buffer} buffer
     * @param {number} length
     * @param {number} position
     * @param {FuseReadWriteCallback} callback
     */
    run(path, buffer, length, position, callback) {
        this.execute(path, buffer, length, position)
            .then(result => {
            callback(result);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Read = Read;
exports.default = Read;
//# sourceMappingURL=write.js.map