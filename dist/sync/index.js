"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sync = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const electron_1 = require("electron");
const processEvents = ["exit", "SIGINT", "SIGTERM", "SIGKILL", "SIGABRT"];
const appEvents = ["quit", "before-quit"];
/**
 * Sync
 * @date 2/23/2024 - 5:49:48 AM
 *
 * @export
 * @class Sync
 * @typedef {Sync}
 */
class Sync {
    /**
     * Creates an instance of Sync.
     * @date 2/26/2024 - 7:12:10 AM
     *
     * @constructor
     * @public
     */
    constructor() {
        this.worker = null;
        this.workerReady = false;
        this.sentReady = false;
        for (const event of processEvents) {
            process.on(event, () => {
                if (this.worker) {
                    this.worker.removeAllListeners();
                    this.worker.kill(0);
                }
            });
        }
        for (const event of appEvents) {
            electron_1.app.on(event, () => {
                if (this.worker) {
                    this.worker.removeAllListeners();
                    this.worker.kill(0);
                }
            });
        }
    }
    /**
     * Initialize the Sync worker.
     * @date 2/23/2024 - 5:49:31 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        const nodeBinPath = path_1.default.join(__dirname, "..", "..", "bin", "node", `${os_1.default.platform()}_${os_1.default.arch()}${os_1.default.platform() === "win32" ? ".exe" : ""}`);
        if (!(await fs_extra_1.default.exists(nodeBinPath))) {
            throw new Error("Node binary not found.");
        }
        if (this.worker) {
            this.worker.removeAllListeners();
            this.worker.kill(0);
        }
        this.worker = null;
        this.workerReady = false;
        await new Promise(resolve => {
            var _a, _b, _c, _d;
            this.worker = (0, child_process_1.spawn)(nodeBinPath, [
                path_1.default.join(__dirname, process.env.NODE_ENV === "production" ? "worker.js" : "worker.dev.js"),
                "--max-old-space-size=8192"
            ]);
            (_a = this.worker.stderr) === null || _a === void 0 ? void 0 : _a.on("data", console.error);
            (_b = this.worker.stderr) === null || _b === void 0 ? void 0 : _b.on("error", console.error);
            this.worker.on("exit", () => {
                this.worker = null;
                this.workerReady = false;
                console.log("Sync worker died, respawning..");
                setTimeout(() => {
                    this.initialize().catch(console.error);
                }, 1000);
            });
            this.worker.on("close", () => {
                this.worker = null;
                this.workerReady = false;
                console.log("Sync worker died, respawning..");
                setTimeout(() => {
                    this.initialize().catch(console.error);
                }, 1000);
            });
            (_c = this.worker.stdout) === null || _c === void 0 ? void 0 : _c.on("data", (data) => {
                try {
                    if (!data) {
                        return;
                    }
                    const stringified = typeof data === "string" ? data : data.toString("utf-8");
                    if (!(stringified.includes("{") && stringified.includes("}"))) {
                        process.stdout.write(stringified);
                        return;
                    }
                    const payload = JSON.parse(stringified);
                    if (payload.type === "ready") {
                        this.workerReady = true;
                        if (!this.sentReady) {
                            this.sentReady = true;
                            resolve();
                        }
                    }
                    console.log("Sync worker message:", payload);
                }
                catch (e) {
                    console.error(e);
                }
            });
            (_d = this.worker.stdout) === null || _d === void 0 ? void 0 : _d.on("error", console.error);
        });
    }
    /**
     * Deinitialize the worker.
     * @date 3/1/2024 - 8:45:04 PM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async deinitialize() {
        if (!this.worker) {
            return;
        }
        await this.waitForReady();
        this.worker.removeAllListeners();
        this.worker.kill(0);
        this.worker = null;
        this.workerReady = false;
    }
    /**
     * Wait for the worker to be ready.
     * @date 2/23/2024 - 5:49:17 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async waitForReady() {
        if (this.workerReady) {
            return;
        }
        await new Promise(resolve => {
            const wait = setInterval(() => {
                if (this.workerReady) {
                    clearInterval(wait);
                    resolve();
                }
            }, 100);
        });
    }
}
exports.Sync = Sync;
exports.default = Sync;
//# sourceMappingURL=index.js.map