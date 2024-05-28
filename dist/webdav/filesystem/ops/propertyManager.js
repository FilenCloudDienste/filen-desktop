"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyManager = void 0;
const propertyManager_1 = __importDefault(require("../propertyManager"));
class PropertyManager {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    run(path, callback) {
        if (!this.fileSystem.propertyManagers[path.toString()]) {
            this.fileSystem.propertyManagers[path.toString()] = new propertyManager_1.default();
        }
        callback(undefined, this.fileSystem.propertyManagers[path.toString()]);
    }
}
exports.PropertyManager = PropertyManager;
exports.default = PropertyManager;
//# sourceMappingURL=propertyManager.js.map