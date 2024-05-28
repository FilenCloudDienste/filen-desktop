"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Serializer = void 0;
const _1 = __importDefault(require("."));
class Serializer {
    constructor({ sdk }) {
        this.sdk = sdk;
    }
    uid() {
        return "Serializer-1.0.0";
    }
    serialize(fs, callback) {
        callback(undefined, {
            path: "",
            resources: {}
        });
    }
    unserialize(serializedData, callback) {
        const fs = new _1.default({ sdk: this.sdk });
        fs.setSerializer(this);
        callback(undefined, fs);
    }
}
exports.Serializer = Serializer;
exports.default = Serializer;
//# sourceMappingURL=serializer.js.map