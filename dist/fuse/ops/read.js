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
const sdk_1 = require("@filen/sdk");
class Read {
    constructor({ ops }) {
        this.ops = ops;
    }
    async downloadChunkToLocal({ path, index, to }) {
        const stat = await this.ops.sdk.fs().stat({ path });
        if (stat.type === "directory") {
            throw new Error("Cannot download chunk of a directory.");
        }
        const pathHash = (0, utils_1.pathToHash)(path);
        const tmpPathEncrypted = path_1.default.join(this.ops.baseTmpPath, `${pathHash}.${index}.encrypted`);
        const tmpPathDecrypted = path_1.default.join(this.ops.baseTmpPath, `${pathHash}.${index}.decrypted`);
        try {
            await Promise.all([
                fs_extra_1.default.rm(tmpPathEncrypted, {
                    force: true,
                    maxRetries: 60 * 10,
                    recursive: true,
                    retryDelay: 100
                }),
                fs_extra_1.default.rm(tmpPathDecrypted, {
                    force: true,
                    maxRetries: 60 * 10,
                    recursive: true,
                    retryDelay: 100
                }),
                fs_extra_1.default.ensureDir(path_1.default.join(to, ".."))
            ]);
            await this.ops.sdk
                .api(3)
                .file()
                .download()
                .chunk()
                .local({ uuid: stat.uuid, bucket: stat.bucket, region: stat.region, chunk: index, to: tmpPathEncrypted });
            await this.ops.sdk
                .crypto()
                .decrypt()
                .dataStream({ inputFile: tmpPathEncrypted, outputFile: tmpPathDecrypted, key: stat.key, version: stat.version });
            await fs_extra_1.default.move(tmpPathDecrypted, to, {
                overwrite: true
            });
        }
        finally {
            await Promise.all([
                fs_extra_1.default.rm(tmpPathEncrypted, {
                    force: true,
                    maxRetries: 60 * 10,
                    recursive: true,
                    retryDelay: 100
                }),
                fs_extra_1.default.rm(tmpPathDecrypted, {
                    force: true,
                    maxRetries: 60 * 10,
                    recursive: true,
                    retryDelay: 100
                })
            ]);
        }
    }
    async downloadChunk({ index, path, chunkPath }) {
        if (!this.ops.chunkDownloadsActive[path]) {
            this.ops.chunkDownloadsActive[path] = 0;
        }
        this.ops.chunkDownloadsActive[path] += 1;
        try {
            if (await fs_extra_1.default.exists(chunkPath)) {
                return;
            }
            if (!this.ops.downloadChunkToLocalActive[path]) {
                this.ops.downloadChunkToLocalActive[path] = {};
            }
            if (this.ops.downloadChunkToLocalActive[path][index]) {
                await new Promise(resolve => {
                    if (!this.ops.downloadChunkToLocalActive[path][index]) {
                        resolve();
                    }
                    const wait = setInterval(() => {
                        if (!this.ops.downloadChunkToLocalActive[path][index]) {
                            clearInterval(wait);
                            resolve();
                        }
                    }, 10);
                });
                if (await fs_extra_1.default.exists(chunkPath)) {
                    return;
                }
            }
            this.ops.downloadChunkToLocalActive[path][index] = true;
            try {
                await this.downloadChunkToLocal({ path, index, to: chunkPath });
            }
            finally {
                delete this.ops.downloadChunkToLocalActive[path][index];
            }
        }
        finally {
            this.ops.chunkDownloadsActive[path] -= 1;
        }
    }
    async execute(path, buffer, length, position) {
        if (this.ops.virtualFiles[path]) {
            return 0;
        }
        try {
            const stat = await this.ops.sdk.fs().stat({ path });
            if (stat.type !== "file") {
                return 0;
            }
            const pathHash = (0, utils_1.pathToHash)(path);
            const writePath = path_1.default.join(this.ops.writeTmpPath, pathHash);
            const decryptedChunksPath = path_1.default.join(this.ops.decryptedChunksTmpPath, pathHash);
            const fullDownloadsPath = path_1.default.join(this.ops.fullDownloadsTmpPath, pathHash);
            const [writePathExists, fullDownloadsPathExists] = await Promise.all([fs_extra_1.default.exists(writePath), fs_extra_1.default.exists(fullDownloadsPath)]);
            if (writePathExists) {
                const writePathStat = await fs_extra_1.default.stat(writePath);
                if (writePathStat.size === stat.size) {
                    const fd = await fs_extra_1.default.open(writePath, fs_extra_1.default.constants.R_OK | fs_extra_1.default.constants.F_OK);
                    try {
                        const { bytesRead } = await fs_extra_1.default.read(fd, buffer, 0, length, position);
                        return bytesRead;
                    }
                    finally {
                        await fs_extra_1.default.close(fd);
                    }
                }
                else {
                    await fs_extra_1.default.rm(writePath, {
                        force: true,
                        maxRetries: 60 * 10,
                        recursive: true,
                        retryDelay: 100
                    });
                }
            }
            if (fullDownloadsPathExists) {
                const fullDownloadsPathStat = await fs_extra_1.default.stat(writePath);
                if (fullDownloadsPathStat.size === stat.size) {
                    const fd = await fs_extra_1.default.open(fullDownloadsPath, fs_extra_1.default.constants.R_OK | fs_extra_1.default.constants.F_OK);
                    try {
                        const { bytesRead } = await fs_extra_1.default.read(fd, buffer, 0, length, position);
                        return bytesRead;
                    }
                    finally {
                        await fs_extra_1.default.close(fd);
                    }
                }
                else {
                    await fs_extra_1.default.rm(fullDownloadsPath, {
                        force: true,
                        maxRetries: 60 * 10,
                        recursive: true,
                        retryDelay: 100
                    });
                }
            }
            const startChunkIndex = Math.floor(position / constants_1.CHUNK_SIZE);
            const endChunkIndex = Math.floor((position + length - 1) / constants_1.CHUNK_SIZE);
            let overallBuffer = Buffer.from([]);
            if (endChunkIndex > stat.chunks - 1) {
                return 0;
            }
            if (!this.ops.chunkDownloadsActive[path]) {
                this.ops.chunkDownloadsActive[path] = 0;
            }
            const downloadPromises = [];
            for (let index = startChunkIndex; index <= endChunkIndex; index++) {
                const chunkPath = path_1.default.join(decryptedChunksPath, index.toString());
                downloadPromises.push(this.downloadChunk({ path, index, chunkPath }));
            }
            // Download ahead more chunks so we read faster
            if (endChunkIndex < stat.chunks - 1 && this.ops.chunkDownloadsActive[path] < sdk_1.MAX_DOWNLOAD_THREADS) {
                const downloadAheadStart = stat.chunks - 1 === endChunkIndex ? 0 : endChunkIndex + 1;
                const totalChunksLeft = stat.chunks - 1 - downloadAheadStart;
                const downloadAheadEnd = downloadAheadStart + (totalChunksLeft >= sdk_1.MAX_DOWNLOAD_THREADS ? sdk_1.MAX_DOWNLOAD_THREADS : totalChunksLeft);
                const downloadAheadPromises = [];
                for (let index = downloadAheadStart; index <= downloadAheadEnd; index++) {
                    const chunkPath = path_1.default.join(decryptedChunksPath, index.toString());
                    downloadAheadPromises.push(this.downloadChunk({ path, index, chunkPath }));
                }
                Promise.all(downloadAheadPromises).catch(console.error);
            }
            await Promise.all(downloadPromises);
            for (let index = startChunkIndex; index <= endChunkIndex; index++) {
                const chunkPath = path_1.default.join(decryptedChunksPath, index.toString());
                const [chunkStats, fd] = await Promise.all([fs_extra_1.default.stat(chunkPath), fs_extra_1.default.open(chunkPath, fs_extra_1.default.constants.R_OK | fs_extra_1.default.constants.F_OK)]);
                try {
                    const localOffset = index === startChunkIndex ? position % constants_1.CHUNK_SIZE : 0;
                    let chunkEndPosition = index === endChunkIndex ? (position + length) % constants_1.CHUNK_SIZE || constants_1.CHUNK_SIZE : constants_1.CHUNK_SIZE;
                    chunkEndPosition = Math.min(chunkEndPosition, chunkStats.size);
                    let bytesToRead = localOffset + chunkEndPosition <= chunkStats.size ? chunkEndPosition - localOffset : chunkStats.size - localOffset;
                    if (bytesToRead <= 0) {
                        continue;
                    }
                    if (bytesToRead >= length) {
                        bytesToRead = length;
                    }
                    const { buffer: bufferRead } = await fs_extra_1.default.read(fd, Buffer.alloc(bytesToRead), 0, bytesToRead, localOffset);
                    overallBuffer = Buffer.concat([overallBuffer, bufferRead]);
                }
                finally {
                    await fs_extra_1.default.close(fd);
                }
            }
            overallBuffer.copy(buffer);
            return overallBuffer.byteLength;
        }
        catch (e) {
            // TODO: Proper debugger
            console.error(e);
            return 0;
        }
    }
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
//# sourceMappingURL=read.js.map