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
exports.Access = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
/**
 * Access
 * @date 2/29/2024 - 2:29:39 AM
 *
 * @export
 * @class Access
 * @typedef {Access}
 */
class Access {
    /**
     * Creates an instance of Access.
     * @date 2/29/2024 - 2:29:43 AM
     *
     * @constructor
     * @public
     * @param {{ ops: Ops }} param0
     * @param {Ops} param0.ops
     */
    constructor({ ops }) {
        this.ops = ops;
    }
    /**
     * Checks if a file/directory exists.
     * @date 2/29/2024 - 2:30:02 AM
     *
     * @private
     * @async
     * @param {string} path
     * @returns {Promise<number>}
     */
    async execute(path) {
        if (this.ops.virtualFiles[path]) {
            return 0;
        }
        try {
            await this.ops.sdk.fs().stat({ path });
            return 0;
        }
        catch (e) {
            const err = e;
            if (err.code === "ENOENT") {
                throw Fuse.default.ENOENT;
            }
            // TODO: Proper debugger
            console.error(e);
            throw Fuse.default.EIO;
        }
    }
    /**
     * Run the access op.
     * @date 2/29/2024 - 2:29:50 AM
     *
     * @public
     * @param {string} path
     * @param {number} _mode
     * @param {FuseErrorCallbackSimple} callback
     */
    run(path, _mode, callback) {
        this.execute(path)
            .then(result => {
            callback(result);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.Access = Access;
exports.default = Access;
//# sourceMappingURL=access.js.map