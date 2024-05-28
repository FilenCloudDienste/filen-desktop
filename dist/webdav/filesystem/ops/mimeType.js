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
exports.MimeType = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
const mime_types_1 = __importDefault(require("mime-types"));
class MimeType {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(path) {
        if (this.fileSystem.virtualFiles[path.toString()]) {
            return mime_types_1.default.lookup(this.fileSystem.virtualFiles[path.toString()].name) || "application/octet-stream";
        }
        try {
            const stat = await this.fileSystem.sdk.fs().stat({ path: path.toString() });
            return stat.type === "directory" ? "application/octet-stream" : mime_types_1.default.lookup(stat.name) || "application/octet-stream";
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
exports.MimeType = MimeType;
exports.default = MimeType;
//# sourceMappingURL=mimeType.js.map