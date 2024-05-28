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
exports.ReadDir = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
const path_1 = __importDefault(require("path"));
class ReadDir {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(path) {
        const dirPath = path.toString();
        try {
            const dir = await this.fileSystem.sdk.fs().readdir({ path: dirPath });
            for (const entry of dir) {
                const entryPath = path_1.default.posix.join(dirPath, entry);
                delete this.fileSystem.virtualFiles[entryPath];
            }
            for (const entry in this.fileSystem.virtualFiles) {
                if (entry.startsWith(dirPath + "/") || entry === dirPath) {
                    dir.push(path_1.default.posix.basename(entry));
                }
            }
            return dir;
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
exports.ReadDir = ReadDir;
exports.default = ReadDir;
//# sourceMappingURL=readDir.js.map