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
exports.Rename = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
const path_1 = __importDefault(require("path"));
class Rename {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(pathFrom, newName) {
        if (this.fileSystem.virtualFiles[pathFrom.toString()]) {
            this.fileSystem.virtualFiles[pathFrom.toString()].name = newName;
            return true;
        }
        try {
            const newPath = path_1.default.posix.join(pathFrom.toString(), "..", newName);
            await this.fileSystem.sdk.fs().rename({ from: pathFrom.toString(), to: newPath });
            return true;
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
    run(pathFrom, newName, callback) {
        this.execute(pathFrom, newName)
            .then(result => {
            callback(undefined, result);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Rename = Rename;
exports.default = Rename;
//# sourceMappingURL=rename.js.map