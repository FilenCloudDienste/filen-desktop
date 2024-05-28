"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sync = exports.WebDAVServer = exports.FilenDesktop = void 0;
const electron_1 = require("electron");
const webdav_1 = __importDefault(require("./webdav"));
const fuse_1 = __importDefault(require("./fuse"));
const sync_1 = __importDefault(require("./sync"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const ipc_1 = __importDefault(require("./ipc"));
const sdk_1 = __importDefault(require("@filen/sdk"));
const config_1 = require("./config");
const cloud_1 = __importDefault(require("./lib/cloud"));
const fs_1 = __importDefault(require("./lib/fs"));
// Needs to be here, otherwise Chromium's FileSystemAccess API won't work. Waiting for the electron team to fix it.
// Ref: https://github.com/electron/electron/issues/28422
electron_1.app.commandLine.appendSwitch("enable-experimental-web-platform-features");
/**
 * FilenDesktop
 * @date 2/23/2024 - 3:49:42 AM
 *
 * @export
 * @class FilenDesktop
 * @typedef {FilenDesktop}
 */
class FilenDesktop {
    /**
     * Creates an instance of FilenDesktop.
     * @date 2/23/2024 - 6:12:33 AM
     *
     * @constructor
     * @public
     */
    constructor() {
        this.driveWindow = null;
        this.fuse = null;
        this.sdkInitialized = false;
        this.sdk = new sdk_1.default();
        this.lib = {
            cloud: new cloud_1.default({ desktop: this }),
            fs: new fs_1.default({ desktop: this })
        };
        this.webdav = new webdav_1.default();
        if (os_1.default.platform() === "win32") {
            this.fuse = new fuse_1.default();
        }
        this.sync = new sync_1.default();
        this.ipc = new ipc_1.default({ desktop: this });
    }
    /**
     * Initialize the SDK in the main thread.
     *
     * @private
     * @async
     * @returns {Promise<void>}
     */
    async initializeSDK() {
        const config = await (0, config_1.waitForSDKConfig)();
        this.sdk.init(config);
        this.sdkInitialized = true;
        console.log("[MAIN] SDK initialized");
    }
    /**
     * Initialize the desktop client.
     * @date 2/23/2024 - 3:49:49 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        this.initializeSDK();
        electron_1.app.on("window-all-closed", () => {
            if (process.platform !== "darwin") {
                electron_1.app.quit();
            }
        });
        await electron_1.app.whenReady();
        electron_1.app.on("activate", () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                this.createDriveWindow().catch(console.error);
            }
        });
        //await Promise.all([this.startFuseThread(), this.startWebDAVThread(), this.startSyncThread()])
        await this.startFuseThread();
        await this.createDriveWindow();
        if (process.env.NODE_ENV === "development") {
            setInterval(() => {
                console.log("[MAIN.MEM.USED]", `${(process.memoryUsage().heapUsed / 1000 / 1000).toFixed(2)} MB`);
                console.log("[MAIN.MEM.TOTAL]", `${(process.memoryUsage().heapTotal / 1000 / 1000).toFixed(2)} MB`);
            }, 5000);
        }
    }
    async createDriveWindow() {
        if (this.driveWindow) {
            return;
        }
        this.driveWindow = new electron_1.BrowserWindow({
            width: 1280,
            height: 720,
            frame: false,
            title: "Filen",
            webPreferences: {
                preload: process.env.NODE_ENV === "development"
                    ? path_1.default.join(__dirname, "..", "dist", "preload.js")
                    : path_1.default.join(__dirname, "preload.js")
            }
        });
        this.driveWindow.on("closed", () => {
            this.driveWindow = null;
        });
        await this.driveWindow.loadURL("http://localhost:5173");
    }
    async startSyncThread() {
        console.log("Starting sync thread");
        //await this._sync.initialize()
    }
    async startFuseThread() {
        if (os_1.default.platform() !== "win32" || os_1.default.arch() !== "x64" || !this.fuse) {
            return;
        }
        console.log("Starting fuse thread");
        await this.fuse.initialize();
    }
    async startWebDAVThread() {
        console.log("Starting WebDAV thread");
        await this.webdav.initialize();
    }
}
exports.FilenDesktop = FilenDesktop;
new FilenDesktop().initialize().catch(console.error);
var worker_1 = require("./webdav/worker");
Object.defineProperty(exports, "WebDAVServer", { enumerable: true, get: function () { return worker_1.WebDAVWorker; } });
var worker_2 = require("./sync/worker");
Object.defineProperty(exports, "Sync", { enumerable: true, get: function () { return worker_2.SyncWorker; } });
//# sourceMappingURL=index.js.map