"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pathToHash = exports.flagsToMode = exports.uuidToNumber = void 0;
const crypto_1 = __importDefault(require("crypto"));
const memoize_1 = __importDefault(require("lodash/memoize"));
exports.uuidToNumber = (0, memoize_1.default)((uuid) => {
    uuid = uuid.split("-").join("").trim();
    let hash = 0;
    for (let i = 0; i < uuid.length; i++) {
        const character = uuid.charCodeAt(i);
        hash += character;
    }
    return hash;
});
const flagsToMode = (flags) => {
    flags = flags & 3;
    if (flags === 0) {
        return "r";
    }
    if (flags === 1) {
        return "w";
    }
    return "r+";
};
exports.flagsToMode = flagsToMode;
exports.pathToHash = (0, memoize_1.default)((path) => {
    return crypto_1.default.createHash("sha256").update(path).digest("hex");
});
//# sourceMappingURL=utils.js.map