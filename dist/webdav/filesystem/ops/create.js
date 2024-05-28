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
exports.Create = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const mime_types_1 = __importDefault(require("mime-types"));
class Create {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(path, ctx) {
        if (ctx.type === WebDAV.ResourceType.Directory) {
            try {
                await this.fileSystem.sdk.fs().mkdir({ path: path.toString() });
                return;
            }
            catch (e) {
                const err = e;
                if (err.code === "ENOENT") {
                    throw WebDAV.Errors.PropertyNotFound;
                }
                console.error(e); // TODO: Proper debugger
                throw WebDAV.Errors.InvalidOperation;
            }
        }
        try {
            const stat = await this.fileSystem.sdk.fs().stat({ path: path.toString() });
            if (stat.type === "file") {
                return;
            }
        }
        catch (e) {
            const err = e;
            if (err.code !== "ENOENT") {
                console.error(err);
                throw WebDAV.Errors.InvalidOperation;
            }
        }
        const name = path_1.default.basename(path.toString());
        const uuid = (0, uuid_1.v4)();
        this.fileSystem.virtualFiles[path.toString()] = {
            name,
            uuid,
            type: "file",
            version: 2,
            bucket: "",
            region: "",
            key: "",
            mtimeMs: Date.now(),
            birthtimeMs: Date.now(),
            chunks: 1,
            size: 0,
            mime: mime_types_1.default.lookup(name) || "application/octet-stream",
            lastModified: Date.now(),
            isDirectory() {
                return false;
            },
            isFile() {
                return true;
            },
            isSymbolicLink() {
                return false;
            }
        };
    }
    run(path, ctx, callback) {
        this.execute(path, ctx)
            .then(() => {
            callback(undefined);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Create = Create;
exports.default = Create;
//# sourceMappingURL=create.js.map