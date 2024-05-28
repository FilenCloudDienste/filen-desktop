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
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatFS = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
class StatFS {
    constructor({ ops }) {
        this.cache = null;
        this.ops = ops;
    }
    async execute() {
        try {
            const stats = await this.ops.sdk.fs().statfs();
            const blockSize = 4096;
            const blocks = Math.floor(stats.max / blockSize) + 1;
            const usedBlocks = Math.floor(stats.used / blockSize) + 1;
            const freeBlocks = Math.floor(blocks - usedBlocks) + 1;
            const statFS = {
                bsize: blockSize,
                frsize: blockSize,
                blocks,
                bfree: freeBlocks,
                bavail: freeBlocks,
                files: 1,
                ffree: 1,
                favail: 1,
                fsid: 1,
                flag: 1,
                namemax: 255
            };
            this.cache = statFS;
            return statFS;
        }
        catch (e) {
            // TODO: Proper debugger
            console.error(e);
            if (this.cache) {
                return this.cache;
            }
            throw Fuse.default.EIO;
        }
    }
    run(_path, callback) {
        this.execute()
            .then(result => {
            callback(0, result);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.StatFS = StatFS;
exports.default = StatFS;
//# sourceMappingURL=statfs.js.map