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
exports.Mkdir = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
class Mkdir {
    constructor({ ops }) {
        this.ops = ops;
    }
    async exists(path) {
        try {
            const stats = await this.ops.sdk.fs().stat({ path });
            if (stats.type === "file") {
                return false;
            }
            return true;
        }
        catch (e) {
            const err = e;
            if (err.code === "ENOENT") {
                return false;
            }
            throw e;
        }
    }
    async execute(path) {
        try {
            if (await this.exists(path)) {
                return;
            }
            await this.ops.sdk.fs().mkdir({ path });
        }
        catch (e) {
            const err = e;
            if (err.code === "ENOENT") {
                throw Fuse.default.ENOENT;
            }
            throw Fuse.default.EIO;
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
exports.Mkdir = Mkdir;
exports.default = Mkdir;
//# sourceMappingURL=mkdir.js.map