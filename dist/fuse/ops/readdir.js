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
exports.Readdir = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const utils_1 = require("../utils");
class Readdir {
    constructor({ ops }) {
        this.ops = ops;
    }
    async execute(path) {
        try {
            await this.ops.sdk.fs().stat({ path });
            const dir = await this.ops.sdk.fs().readdir({ path });
            const allStats = [];
            const blockSize = 4096;
            for (const entry of dir) {
                const entryPath = path_1.default.posix.join(path, entry);
                const stats = await this.ops.sdk.fs().stat({ path: entryPath });
                allStats.push({
                    mode: stats.isFile() ? constants_1.FILE_MODE | constants_1.FUSE_DEFAULT_FILE_MODE : constants_1.DIRECTORY_MODE | constants_1.FUSE_DEFAULT_DIRECTORY_MODE,
                    uid: process.getuid ? process.getuid() : 0,
                    gid: process.getgid ? process.getgid() : 0,
                    size: stats.size,
                    dev: 1,
                    nlink: 1,
                    ino: (0, utils_1.uuidToNumber)(stats.uuid),
                    rdev: 1,
                    blksize: blockSize,
                    blocks: stats.isFile() ? Math.floor(stats.size / blockSize) + 1 : 1,
                    atime: new Date(stats.mtimeMs),
                    mtime: new Date(stats.mtimeMs),
                    ctime: new Date(stats.mtimeMs)
                });
                delete this.ops.virtualFiles[entryPath];
            }
            for (const entry in this.ops.virtualFiles) {
                if (entry.startsWith(path + "/") || entry === path) {
                    dir.push(path_1.default.posix.basename(entry));
                    const virtualFilesEntry = this.ops.virtualFiles[entry];
                    if (virtualFilesEntry) {
                        allStats.push(virtualFilesEntry);
                    }
                }
            }
            return {
                dir,
                stats: allStats
            };
        }
        catch (e) {
            const err = e;
            if (err.code === "ENOENT") {
                throw Fuse.default.ENOENT;
            }
            // TODO: Proper debugger
            console.error(e);
            throw Fuse.default.EIO;
        }
    }
    run(path, callback) {
        this.execute(path)
            .then(result => {
            callback(0, result.dir, result.stats);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Readdir = Readdir;
exports.default = Readdir;
//# sourceMappingURL=readdir.js.map