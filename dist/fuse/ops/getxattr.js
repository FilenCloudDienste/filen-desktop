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
exports.Getxattr = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("../utils");
class Getxattr {
    constructor({ ops }) {
        this.ops = ops;
    }
    async execute(path, name) {
        const filePath = path_1.default.join(this.ops.xattrPath, (0, utils_1.pathToHash)(path), name);
        if (!(await fs_extra_1.default.exists(filePath))) {
            return null;
        }
        return await fs_extra_1.default.readFile(filePath);
    }
    run(path, name, callback) {
        this.execute(path, name)
            .then(result => {
            callback(0, result);
        })
            .catch(err => {
            // TODO: Proper debugger
            console.error(err);
            callback(Fuse.default.EIO);
        });
    }
}
exports.Getxattr = Getxattr;
exports.default = Getxattr;
//# sourceMappingURL=getxattr.js.map