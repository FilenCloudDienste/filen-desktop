"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChunkedUploadWriter = void 0;
const stream_1 = require("stream");
const semaphore_1 = require("../../semaphore");
const mime_types_1 = __importDefault(require("mime-types"));
const crypto_1 = __importDefault(require("crypto"));
const constants_1 = require("../../constants");
/**
 * ChunkedUploadWriter
 * @date 2/29/2024 - 9:58:16 PM
 *
 * @export
 * @class ChunkedUploadWriter
 * @typedef {ChunkedUploadWriter}
 * @extends {Writable}
 */
class ChunkedUploadWriter extends stream_1.Writable {
    /**
     * Creates an instance of ChunkedUploadWriter.
     * @date 2/29/2024 - 9:58:21 PM
     *
     * @constructor
     * @public
     * @param {{
     * 		options?: ConstructorParameters<typeof Writable>[0]
     * 		sdk: SDK
     * 		uuid: string
     * 		key: string
     * 		name: string
     * 		uploadKey: string
     * 		parent: string
     * 	}} param0
     * @param {ConstructorParameters<any>} [param0.options=undefined]
     * @param {SDK} param0.sdk
     * @param {string} param0.uuid
     * @param {string} param0.key
     * @param {string} param0.name
     * @param {string} param0.uploadKey
     * @param {string} param0.parent
     */
    constructor({ options = undefined, sdk, uuid, key, name, uploadKey, parent }) {
        super(options);
        this.uploadSemaphore = new semaphore_1.Semaphore(constants_1.MAX_UPLOAD_THREADS);
        this.processingMutex = new semaphore_1.Semaphore(1);
        this.chunksUploaded = 0;
        this.chunkBuffer = Buffer.from([]);
        this.sdk = sdk;
        this.uuid = uuid;
        this.key = key;
        this.version = 2;
        this.size = 0;
        this.name = name;
        this.lastModified = Date.now();
        this.mime = mime_types_1.default.lookup(name) || "application/octet-stream";
        this.bucket = "";
        this.region = "";
        this.index = -1;
        this.uploadKey = uploadKey;
        this.parent = parent;
        this.hasher = crypto_1.default.createHash("sha512");
    }
    /**
     * Write data to the stream.
     * @date 2/29/2024 - 9:58:27 PM
     *
     * @public
     * @param {(Buffer | string)} chunk
     * @param {BufferEncoding} encoding
     * @param {(error?: Error | null | undefined) => void} callback
     */
    _write(chunk, encoding, callback) {
        if (!(chunk instanceof Buffer)) {
            chunk = Buffer.from(chunk, encoding);
        }
        if (chunk.byteLength <= 0) {
            callback();
            return;
        }
        this.uploadSemaphore
            .acquire()
            .then(() => {
            this.chunkBuffer = Buffer.concat([this.chunkBuffer, chunk]);
            if (this.chunkBuffer.byteLength >= constants_1.CHUNK_SIZE) {
                const chunkToWrite = this.chunkBuffer.subarray(0, constants_1.CHUNK_SIZE);
                this.chunkBuffer = this.chunkBuffer.subarray(constants_1.CHUNK_SIZE);
                this.upload(chunkToWrite)
                    .catch(err => {
                    console.error(err);
                    this.destroy(err);
                })
                    .finally(() => {
                    this.uploadSemaphore.release();
                });
            }
            else {
                this.uploadSemaphore.release();
            }
            callback();
        })
            .catch(callback);
    }
    /**
     * Finalize writing.
     * @date 2/29/2024 - 9:58:39 PM
     *
     * @public
     * @param {(error?: Error | null | undefined) => void} callback
     */
    _final(callback) {
        this.processChunks()
            .then(() => {
            this.finalizeUpload()
                .then(() => callback())
                .catch(callback);
        })
            .catch(callback);
    }
    /**
     * Process each chunk.
     * @date 2/29/2024 - 9:58:46 PM
     *
     * @private
     * @async
     * @returns {Promise<void>}
     */
    async processChunks() {
        if (this.chunkBuffer.byteLength <= 0) {
            return;
        }
        while (this.chunkBuffer.byteLength >= constants_1.CHUNK_SIZE) {
            await this.processingMutex.acquire();
            let chunkToWrite = null;
            try {
                chunkToWrite = this.chunkBuffer.subarray(0, constants_1.CHUNK_SIZE);
                this.chunkBuffer = this.chunkBuffer.subarray(constants_1.CHUNK_SIZE);
            }
            finally {
                this.processingMutex.release();
            }
            if (chunkToWrite instanceof Buffer && chunkToWrite.byteLength > 0) {
                await this.upload(chunkToWrite);
            }
        }
    }
    /**
     * Encrypt, hash and upload a chunk.
     * @date 2/29/2024 - 9:58:54 PM
     *
     * @private
     * @async
     * @param {Buffer} chunk
     * @returns {Promise<void>}
     */
    async upload(chunk) {
        if (chunk.byteLength <= 0) {
            return;
        }
        this.index += 1;
        this.size += chunk.byteLength;
        this.hasher.update(chunk);
        const encryptedChunk = await this.sdk.crypto().encrypt().data({ data: chunk, key: this.key });
        const response = await this.sdk
            .api(3)
            .file()
            .upload()
            .chunk()
            .buffer({ uuid: this.uuid, index: this.index, uploadKey: this.uploadKey, parent: this.parent, buffer: encryptedChunk });
        this.bucket = response.bucket;
        this.region = response.region;
        this.chunksUploaded += 1;
    }
    /**
     * Wait for all chunks to be uploaded.
     * @date 3/1/2024 - 5:23:57 AM
     *
     * @private
     * @async
     * @param {number} needed
     * @returns {Promise<void>}
     */
    async waitForAllChunksToBeUploaded(needed) {
        await new Promise(resolve => {
            if (this.chunksUploaded >= needed) {
                resolve();
                return;
            }
            const wait = setInterval(() => {
                if (this.chunksUploaded >= needed) {
                    clearInterval(wait);
                    resolve();
                }
            });
        });
    }
    /**
     * Finalize the upload, marking it as done.
     * @date 2/29/2024 - 9:59:20 PM
     *
     * @private
     * @async
     * @returns {Promise<void>}
     */
    async finalizeUpload() {
        // Upload any leftover chunks in the buffer
        await this.processChunks();
        if (this.chunkBuffer.byteLength > 0) {
            await this.upload(this.chunkBuffer);
        }
        if (this.size <= 0) {
            return;
        }
        // Calculate file chunks and size. Warning: This needs to be called AFTER initiating all chunk uploads or it will spit out a wrong chunk count.
        let fileChunks = 0;
        let dummyOffset = 0;
        while (dummyOffset < this.size) {
            fileChunks += 1;
            dummyOffset += constants_1.CHUNK_SIZE;
        }
        await this.waitForAllChunksToBeUploaded(fileChunks);
        const hash = this.hasher.digest("hex");
        await this.sdk
            .api(3)
            .upload()
            .done({
            uuid: this.uuid,
            name: await this.sdk.crypto().encrypt().metadata({ metadata: this.name, key: this.key }),
            nameHashed: await this.sdk.crypto().utils.hashFn({ input: this.name.toLowerCase() }),
            size: await this.sdk.crypto().encrypt().metadata({ metadata: this.size.toString(), key: this.key }),
            chunks: fileChunks,
            mime: await this.sdk.crypto().encrypt().metadata({ metadata: this.mime, key: this.key }),
            version: this.version,
            uploadKey: this.uploadKey,
            rm: await this.sdk.crypto().utils.generateRandomString({ length: 32 }),
            metadata: await this.sdk
                .crypto()
                .encrypt()
                .metadata({
                metadata: JSON.stringify({
                    name: this.name,
                    size: this.size,
                    mime: this.mime,
                    key: this.key,
                    lastModified: this.lastModified,
                    creation: this.lastModified,
                    hash
                })
            })
        });
        await this.sdk.cloud().checkIfItemParentIsShared({
            type: "file",
            parent: this.parent,
            uuid: this.uuid,
            itemMetadata: {
                name: this.name,
                size: this.size,
                mime: this.mime,
                lastModified: this.lastModified,
                creation: this.lastModified,
                key: this.key,
                hash
            }
        });
        this.emit("uploaded", {
            type: "file",
            uuid: this.uuid,
            metadata: {
                name: this.name,
                size: this.size,
                mime: this.mime,
                key: this.key,
                lastModified: this.lastModified,
                creation: this.lastModified,
                hash,
                version: this.version,
                region: this.region,
                chunks: fileChunks,
                bucket: this.bucket
            }
        });
    }
}
exports.ChunkedUploadWriter = ChunkedUploadWriter;
//# sourceMappingURL=streams.js.map