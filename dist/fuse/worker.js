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
exports.FUSEWorker = void 0;
const Fuse = __importStar(require("@gcas/fuse"));
const index_1 = __importDefault(require("./ops/index"));
const sdk_1 = __importDefault(require("@filen/sdk"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const config_1 = require("../config");
const FUSE = Fuse.default;
/**
 * FUSEWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class FUSEWorker
 * @typedef {FUSEWorker}
 */
class FUSEWorker {
    /**
     * Creates an instance of FUSEWorker.
     * @date 2/25/2024 - 10:23:24 PM
     *
     * @constructor
     * @public
     * @param {{ mountPoint: string }} param0
     * @param {string} param0.mountPoint
     */
    constructor({ mountPoint, baseTmpPath, fullDownloadsTmpPath, writeTmpPath, decryptedChunksTmpPath, xattrPath, encryptedChunksTmpPath, uploadsTmpPath, sdkConfig }) {
        this.baseTmpPath = baseTmpPath;
        this.fullDownloadsTmpPath = fullDownloadsTmpPath;
        this.writeTmpPath = writeTmpPath;
        this.decryptedChunksTmpPath = decryptedChunksTmpPath;
        this.xattrPath = xattrPath;
        this.encryptedChunksTmpPath = encryptedChunksTmpPath;
        this.uploadsTmpPath = uploadsTmpPath;
        this.sdk = new sdk_1.default(sdkConfig);
        const ops = new index_1.default({
            sdk: this.sdk,
            baseTmpPath,
            fullDownloadsTmpPath,
            writeTmpPath,
            decryptedChunksTmpPath,
            xattrPath,
            encryptedChunksTmpPath,
            uploadsTmpPath
        });
        this.fuse = new FUSE(mountPoint, ops, {
            maxRead: 0,
            force: true,
            volname: "Filen",
            debug: false,
            kernelCache: false,
            autoCache: false,
            attrTimeout: 0,
            acAttrTimeout: 0
        });
        if (process.env.NODE_ENV === "development") {
            setInterval(() => {
                console.log("[FUSEWORKER.MEM.USED]", `${(process.memoryUsage().heapUsed / 1000 / 1000).toFixed(2)} MB`);
                console.log("[FUSEWORKER.MEM.TOTAL]", `${(process.memoryUsage().heapTotal / 1000 / 1000).toFixed(2)} MB`);
            }, 5000);
        }
    }
    /**
     * Mount FUSE on the host.
     * @date 2/26/2024 - 7:12:17 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async mount() {
        await new Promise((resolve, reject) => {
            this.fuse.mount(err => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }
    /**
     * Unmount FUSE on the host.
     * @date 2/26/2024 - 7:12:24 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async unmount() {
        await new Promise((resolve, reject) => {
            this.fuse.unmount(err => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }
    /**
     * Initialize the FUSE worker.
     * @date 2/23/2024 - 5:51:12 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        await this.mount();
    }
}
exports.FUSEWorker = FUSEWorker;
// TODO: Remove
const baseTmpPath = path_1.default.join(os_1.default.tmpdir(), "filen-desktop");
const fullDownloadsTmpPath = path_1.default.join(baseTmpPath, "fullDownloads");
const uploadsTmpPath = path_1.default.join(baseTmpPath, "uploads");
const encryptedChunksTmpPath = path_1.default.join(baseTmpPath, "encryptedChunks");
const decryptedChunksTmpPath = path_1.default.join(baseTmpPath, "decryptedChunks");
const xattrPath = path_1.default.join(baseTmpPath, "xattr");
const writeTmpPath = path_1.default.join(baseTmpPath, "write");
fs_extra_1.default.ensureDirSync(baseTmpPath);
fs_extra_1.default.ensureDirSync(fullDownloadsTmpPath);
fs_extra_1.default.ensureDirSync(uploadsTmpPath);
fs_extra_1.default.ensureDirSync(encryptedChunksTmpPath);
fs_extra_1.default.ensureDirSync(decryptedChunksTmpPath);
fs_extra_1.default.ensureDirSync(xattrPath);
fs_extra_1.default.ensureDirSync(writeTmpPath);
process.stdout.write(JSON.stringify({
    type: "ready"
}));
(0, config_1.waitForSDKConfig)()
    .then(sdkConfig => {
    const fuseWorker = new FUSEWorker({
        mountPoint: "M:",
        baseTmpPath,
        fullDownloadsTmpPath,
        uploadsTmpPath,
        encryptedChunksTmpPath,
        decryptedChunksTmpPath,
        xattrPath,
        writeTmpPath,
        sdkConfig
    });
    fuseWorker
        .initialize()
        .then(() => {
        //
    })
        .catch(err => {
        console.error(err);
        process.exit(1);
    });
})
    .catch(err => {
    console.error(err);
    process.exit(1);
});
exports.default = FUSEWorker;
//# sourceMappingURL=worker.js.map