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
exports.Delete = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
class Delete {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(path) {
        if (this.fileSystem.virtualFiles[path.toString()]) {
            delete this.fileSystem.virtualFiles[path.toString()];
            return;
        }
        try {
            await this.fileSystem.sdk.fs().stat({ path: path.toString() });
            await this.fileSystem.sdk.fs().unlink({ path: path.toString(), permanent: true });
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
            .then(() => {
            callback(undefined);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Delete = Delete;
exports.default = Delete;
//# sourceMappingURL=delete.js.map