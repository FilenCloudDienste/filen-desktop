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
exports.PropertyManager = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
class PropertyManager {
    constructor() {
        this.properties = {};
    }
    setProperty(name, value, attributes, callback) {
        this.properties[name] = {
            value,
            attributes
        };
        callback(undefined);
    }
    getProperty(name, callback) {
        const property = this.properties[name];
        if (!property) {
            callback(WebDAV.Errors.PropertyNotFound);
            return;
        }
        callback(undefined, property.value, property.attributes);
    }
    removeProperty(name, callback) {
        delete this.properties[name];
        callback(undefined);
    }
    getProperties(callback, byCopy = false) {
        callback(undefined, byCopy ? this.properties : JSON.parse(JSON.stringify(this.properties)));
    }
}
exports.PropertyManager = PropertyManager;
exports.default = PropertyManager;
//# sourceMappingURL=propertyManager.js.map