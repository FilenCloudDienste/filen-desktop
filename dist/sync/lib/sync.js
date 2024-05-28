"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sync = void 0;
const sdk_1 = __importDefault(require("@filen/sdk"));
const constants_1 = require("../constants");
const local_1 = require("./filesystems/local");
const remote_1 = require("./filesystems/remote");
const deltas_1 = __importDefault(require("./deltas"));
const tasks_1 = __importDefault(require("./tasks"));
const state_1 = __importDefault(require("./state"));
/**
 * Sync
 *
 * @export
 * @class Sync
 * @typedef {Sync}
 */
class Sync {
    /**
     * Creates an instance of Sync.
     *
     * @constructor
     * @public
     * @param {{ syncPair: SyncPair; dbPath: string, sdkConfig: FilenSDKConfig }} param0
     * @param {SyncPair} param0.syncPair
     * @param {string} param0.dbPath
     * @param {FilenSDKConfig} param0.sdkConfig
     */
    constructor({ syncPair, dbPath, sdkConfig }) {
        this.isInitialized = false;
        this.previousLocalTree = { tree: {}, inodes: {} };
        this.previousRemoteTree = { tree: {}, uuids: {} };
        this.localFileHashes = {};
        this.syncPair = syncPair;
        this.dbPath = dbPath;
        this.sdk = new sdk_1.default(sdkConfig);
        this.localFileSystem = new local_1.LocalFileSystem({ sync: this });
        this.remoteFileSystem = new remote_1.RemoteFileSystem({ sync: this });
        this.deltas = new deltas_1.default({ sync: this });
        this.tasks = new tasks_1.default({ sync: this });
        this.state = new state_1.default({ sync: this });
    }
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        this.isInitialized = true;
        try {
            //local/remote smoke test
            await this.localFileSystem.startDirectoryWatcher();
            await this.state.initialize();
            this.run();
        }
        catch (e) {
            this.isInitialized = false;
            throw e;
        }
    }
    async run() {
        try {
            await this.localFileSystem.waitForLocalDirectoryChanges();
            let [currentLocalTree, currentRemoteTree] = await Promise.all([
                this.localFileSystem.getDirectoryTree(),
                this.remoteFileSystem.getDirectoryTree()
            ]);
            const deltas = await this.deltas.process({
                currentLocalTree,
                currentRemoteTree,
                previousLocalTree: this.previousLocalTree,
                previousRemoteTree: this.previousRemoteTree
            });
            console.log(deltas);
            const doneTasks = await this.tasks.process({ deltas });
            console.log(doneTasks);
            if (doneTasks.length > 0) {
                const applied = this.state.applyDoneTasksToState({ doneTasks, currentLocalTree, currentRemoteTree });
                currentLocalTree = applied.currentLocalTree;
                currentRemoteTree = applied.currentRemoteTree;
            }
            this.previousLocalTree = currentLocalTree;
            this.previousRemoteTree = currentRemoteTree;
            await this.state.save();
        }
        catch (e) {
            console.error(e); // TODO: Proper debugger
        }
        finally {
            setTimeout(() => {
                this.run();
            }, constants_1.SYNC_INTERVAL);
        }
    }
}
exports.Sync = Sync;
exports.default = Sync;
//# sourceMappingURL=sync.js.map