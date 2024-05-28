"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockManager = void 0;
const lockManager_1 = __importDefault(require("../lockManager"));
class LockManager {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    run(path, callback) {
        if (!this.fileSystem.lockManagers[path.toString()]) {
            this.fileSystem.lockManagers[path.toString()] = new lockManager_1.default();
        }
        callback(undefined, this.fileSystem.lockManagers[path.toString()]);
    }
}
exports.LockManager = LockManager;
exports.default = LockManager;
//# sourceMappingURL=lockManager.js.map