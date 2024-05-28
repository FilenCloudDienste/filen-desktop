"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncWorker = void 0;
const sync_1 = __importDefault(require("./lib/sync"));
/**
 * SyncWorker
 * @date 2/23/2024 - 5:50:56 AM
 *
 * @export
 * @class SyncWorker
 * @typedef {SyncWorker}
 */
class SyncWorker {
    /**
     * Creates an instance of SyncWorker.
     * @date 3/4/2024 - 11:39:47 PM
     *
     * @constructor
     * @public
     * @param {{ syncPairs: SyncPair[], dbPath: string }} param0
     * @param {{}} param0.syncPairs
     * @param {string} param0.dbPath
     */
    constructor({ syncPairs, dbPath }) {
        this.syncs = {};
        this.syncPairs = syncPairs;
        this.dbPath = dbPath;
    }
    /**
     * Initialize the Sync worker.
     * @date 2/23/2024 - 5:51:12 AM
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        const promises = [];
        for (const pair of this.syncPairs) {
            if (!this.syncs[pair.uuid]) {
                this.syncs[pair.uuid] = new sync_1.default({ syncPair: pair, dbPath: this.dbPath, sdkConfig: {} });
                promises.push(this.syncs[pair.uuid].initialize());
            }
        }
        await Promise.all(promises);
    }
}
exports.SyncWorker = SyncWorker;
// Only start the worker if it is actually invoked.
if (process.argv.slice(2).includes("--worker")) {
    // TODO: Proper init
    const syncWorker = new SyncWorker({
        dbPath: "",
        syncPairs: []
    });
    syncWorker
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
//# sourceMappingURL=worker.js.map