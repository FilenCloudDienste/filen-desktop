"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tasks = void 0;
const utils_1 = require("../../utils");
/**
 * Tasks
 * @date 3/1/2024 - 11:11:32 PM
 *
 * @export
 * @class Tasks
 * @typedef {Tasks}
 */
class Tasks {
    /**
     * Creates an instance of Tasks.
     * @date 3/1/2024 - 11:11:36 PM
     *
     * @constructor
     * @public
     * @param {{ sync: Sync }} param0
     * @param {Sync} param0.sync
     */
    constructor({ sync }) {
        this.sync = sync;
    }
    /**
     * Process a task.
     * @date 3/2/2024 - 12:14:48 PM
     *
     * @private
     * @async
     * @param {{delta: Delta}} param0
     * @param {Delta} param0.delta
     * @returns {Promise<DoneTask>}
     */
    async processTask({ delta }) {
        switch (delta.type) {
            case "createLocalDirectory": {
                const stats = await this.sync.localFileSystem.mkdir({ relativePath: delta.path });
                return Object.assign(Object.assign({}, delta), { stats });
            }
            case "createRemoteDirectory": {
                const uuid = await this.sync.remoteFileSystem.mkdir({ relativePath: delta.path });
                return Object.assign(Object.assign({}, delta), { uuid });
            }
            case "deleteLocalDirectory":
            case "deleteLocalFile": {
                await this.sync.localFileSystem.unlink({ relativePath: delta.path });
                return delta;
            }
            case "deleteRemoteDirectory":
            case "deleteRemoteFile": {
                await this.sync.remoteFileSystem.unlink({ relativePath: delta.path });
                return delta;
            }
            case "moveLocalDirectory":
            case "renameLocalDirectory":
            case "renameLocalFile":
            case "moveLocalFile": {
                const stats = await this.sync.localFileSystem.rename({ fromRelativePath: delta.from, toRelativePath: delta.to });
                return Object.assign(Object.assign({}, delta), { stats });
            }
            case "moveRemoteDirectory":
            case "renameRemoteDirectory":
            case "renameRemoteFile":
            case "moveRemoteFile": {
                await this.sync.remoteFileSystem.rename({ fromRelativePath: delta.from, toRelativePath: delta.to });
                return delta;
            }
            case "downloadFile": {
                const stats = await this.sync.remoteFileSystem.download({ relativePath: delta.path });
                return Object.assign(Object.assign({}, delta), { stats });
            }
            case "uploadFile": {
                const item = await this.sync.localFileSystem.upload({ relativePath: delta.path });
                return Object.assign(Object.assign({}, delta), { item });
            }
        }
    }
    /**
     * Process all deltas.
     * @date 3/5/2024 - 3:59:51 PM
     *
     * @public
     * @async
     * @param {{ deltas: Delta[] }} param0
     * @param {{}} param0.deltas
     * @returns {Promise<DoneTask[]>}
     */
    async process({ deltas }) {
        // Work on deltas from "left to right" (ascending order, path length).
        deltas = deltas.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
        const executed = [];
        const promises = [];
        for (const delta of deltas) {
            promises.push(new Promise((resolve, reject) => {
                this.processTask({ delta })
                    .then(doneTask => {
                    executed.push(doneTask);
                    resolve();
                })
                    .catch(reject);
            }));
        }
        await (0, utils_1.promiseAllSettledChunked)(promises);
        return executed;
    }
}
exports.Tasks = Tasks;
exports.default = Tasks;
//# sourceMappingURL=tasks.js.map