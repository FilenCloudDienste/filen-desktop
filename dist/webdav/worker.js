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
exports.WebDAVWorker = void 0;
const sdk_1 = __importDefault(require("@filen/sdk"));
const WebDAV = __importStar(require("@filen/webdav-server"));
const filesystem_1 = __importDefault(require("./filesystem"));
/**
 * WebDAVWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class WebDAVWorker
 * @typedef {WebDAVWorker}
 */
class WebDAVWorker {
    /**
     * Creates an instance of WebDAVWorker.
     *
     * @constructor
     * @public
     * @param {{users: WebDAVUser[], hostname?: string, port?: number, sdkConfig: FilenSDKConfig}} param0
     * @param {{}} param0.users
     * @param {string} param0.hostname
     * @param {number} param0.port
     * @param {FilenSDKConfig} param0.sdkConfig
     */
    constructor({ users, hostname, port, sdkConfig }) {
        this.sdk = new sdk_1.default(sdkConfig);
        const userManager = new WebDAV.SimpleUserManager();
        const privilegeManager = new WebDAV.SimplePathPrivilegeManager();
        for (const user of users) {
            const usr = userManager.addUser(user.name, user.password, user.isAdmin);
            privilegeManager.setRights(usr, "/", ["all"]);
        }
        this.webdavServer = new WebDAV.WebDAVServer({
            hostname,
            privilegeManager,
            httpAuthentication: new WebDAV.HTTPDigestAuthentication(userManager, "Default realm"),
            port: port ? port : 1901,
            rootFileSystem: new filesystem_1.default({ sdk: this.sdk })
        });
        if (process.env.NODE_ENV === "development") {
            setInterval(() => {
                console.log("[WEBDAVWORKER.MEM.USED]", `${(process.memoryUsage().heapUsed / 1000 / 1000).toFixed(2)} MB`);
                console.log("[WEBDAVWORKER.MEM.TOTAL]", `${(process.memoryUsage().heapTotal / 1000 / 1000).toFixed(2)} MB`);
            }, 5000);
        }
    }
    /**
     * Initialize the WebDAV worker.
     * @date 2/23/2024 - 5:51:12 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        await new Promise(resolve => {
            this.webdavServer.start(() => {
                console.log("WebDAV server started");
                resolve();
            });
        });
    }
}
exports.WebDAVWorker = WebDAVWorker;
// Only start the worker if it is actually invoked.
if (process.argv.slice(2).includes("--worker")) {
    const webdavWorker = new WebDAVWorker({
        users: [
            {
                name: "admin",
                password: "admin",
                isAdmin: true
            }
        ],
        port: 1901,
        hostname: "0.0.0.0",
        sdkConfig: {}
    });
    webdavWorker
        .initialize()
        .then(() => {
        process.stdout.write(JSON.stringify({
            type: "ready"
        }));
    })
        .catch(err => {
        console.error(err);
        process.exit(1);
    });
}
exports.default = WebDAVWorker;
//# sourceMappingURL=worker.js.map