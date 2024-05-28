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
exports.OpenReadStream = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
const os_1 = __importDefault(require("os"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const utils_1 = require("../../../fuse/utils");
class OpenReadStream {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(path) {
        if (this.fileSystem.virtualFiles[path.toString()]) {
            return stream_1.Readable.from([]);
        }
        try {
            const pathHash = (0, utils_1.pathToHash)(path.toString());
            const tempPath = path_1.default.join(os_1.default.tmpdir(), "filen-webdav", "downloadCache", pathHash);
            if (await fs_extra_1.default.exists(tempPath)) {
                return fs_extra_1.default.createReadStream(tempPath);
            }
            const stat = await this.fileSystem.sdk.fs().stat({ path: path.toString() });
            if (stat.type !== "file") {
                throw WebDAV.Errors.InvalidOperation;
            }
            const stream = (await this.fileSystem.sdk.cloud().downloadFileToReadableStream({
                uuid: stat.uuid,
                region: stat.region,
                bucket: stat.bucket,
                version: stat.version,
                key: stat.key,
                chunks: stat.chunks,
                size: stat.size
            }));
            return stream_1.Readable.fromWeb(stream);
        }
        catch (e) {
            console.error(e); // TODO: Proper debugger
            const err = e;
            if (err.code === "ENOENT") {
                throw WebDAV.Errors.PropertyNotFound;
            }
            throw WebDAV.Errors.InvalidOperation;
        }
    }
    run(path, callback) {
        this.execute(path)
            .then(result => {
            callback(undefined, result);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.OpenReadStream = OpenReadStream;
exports.default = OpenReadStream;
//# sourceMappingURL=openReadStream.js.map