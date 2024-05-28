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
exports.OpenWriteStream = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const streams_1 = require("../streams");
const sdk_1 = require("@filen/sdk");
class OpenWriteStream {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(path) {
        try {
            const parentPath = path_1.default.dirname(path.toString());
            const parentStat = await this.fileSystem.sdk.fs().stat({ path: parentPath });
            const uuid = (0, uuid_1.v4)();
            const name = path_1.default.posix.basename(path.toString());
            const [key, uploadKey] = await Promise.all([
                this.fileSystem.sdk.crypto().utils.generateRandomString({ length: 32 }),
                this.fileSystem.sdk.crypto().utils.generateRandomString({ length: 32 })
            ]);
            const parent = parentStat.uuid;
            const stream = new streams_1.ChunkedUploadWriter({
                options: {
                    highWaterMark: sdk_1.BUFFER_SIZE
                },
                sdk: this.fileSystem.sdk,
                uuid,
                key,
                uploadKey,
                name,
                parent
            });
            stream.once("uploaded", (item) => {
                this.fileSystem.sdk.fs()._removeItem({ path: path.toString() });
                this.fileSystem.sdk.fs()._addItem({
                    path: path.toString(),
                    item
                });
                delete this.fileSystem.virtualFiles[path.toString()];
            });
            stream.on("error", console.error); // TODO: Proper debugger
            return stream;
        }
        catch (e) {
            delete this.fileSystem.virtualFiles[path.toString()];
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
exports.OpenWriteStream = OpenWriteStream;
exports.default = OpenWriteStream;
//# sourceMappingURL=openWriteStream.js.map