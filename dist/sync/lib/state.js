"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.State = void 0;
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const msgpackr_1 = require("msgpackr");
const STATE_VERSION = 1;
/**
 * State
 * @date 3/1/2024 - 11:11:32 PM
 *
 * @export
 * @class State
 * @typedef {State}
 */
class State {
    /**
     * Creates an instance of State.
     * @date 3/1/2024 - 11:11:36 PM
     *
     * @constructor
     * @public
     * @param {{ sync: Sync }} param0
     * @param {Sync} param0.sync
     */
    constructor({ sync }) {
        this.sync = sync;
        this.statePath = path_1.default.join(this.sync.dbPath, "state", `v${STATE_VERSION}`);
    }
    applyDoneTasksToState({ doneTasks, currentLocalTree, currentRemoteTree }) {
        // Work on the done tasks from "right to left" (descending order, path length).
        // This ensures we pick up all individual files/directory movements (e.g. parent moved to /a/b while children are moved /c/d)
        const tasks = doneTasks.sort((a, b) => b.path.split("/").length - a.path.split("/").length);
        for (const task of tasks) {
            switch (task.type) {
                case "renameRemoteDirectory":
                case "renameRemoteFile":
                case "moveRemoteDirectory":
                case "moveRemoteFile": {
                    for (const oldPath in currentRemoteTree.tree) {
                        if (oldPath.startsWith(task.from + "/") || oldPath === task.from) {
                            const newPath = oldPath.split(task.from).join(task.to);
                            const oldItem = currentRemoteTree.tree[oldPath];
                            if (oldItem) {
                                const item = Object.assign(Object.assign({}, oldItem), { path: newPath, name: path_1.default.posix.basename(newPath) });
                                currentRemoteTree.tree[newPath] = item;
                                delete currentRemoteTree.tree[oldPath];
                            }
                        }
                    }
                    for (const uuid in currentRemoteTree.uuids) {
                        const currentItem = currentRemoteTree.uuids[uuid];
                        if (!currentItem) {
                            continue;
                        }
                        const oldPath = currentItem.path;
                        if (oldPath.startsWith(task.from + "/") || oldPath === task.from) {
                            const newPath = oldPath.split(task.from).join(task.to);
                            const item = Object.assign(Object.assign({}, currentItem), { path: newPath, name: path_1.default.posix.basename(newPath) });
                            currentRemoteTree.uuids[uuid] = item;
                        }
                    }
                    break;
                }
                case "moveLocalDirectory":
                case "moveLocalFile":
                case "renameLocalDirectory":
                case "renameLocalFile": {
                    for (const oldPath in currentLocalTree.tree) {
                        if (oldPath.startsWith(task.from + "/") || oldPath === task.from) {
                            const newPath = oldPath.split(task.from).join(task.to);
                            const oldItem = currentLocalTree.tree[oldPath];
                            if (oldItem) {
                                const item = Object.assign(Object.assign({}, oldItem), { path: newPath });
                                currentLocalTree.tree[newPath] = item;
                                delete currentLocalTree.tree[oldPath];
                            }
                        }
                    }
                    for (const inode in currentLocalTree.inodes) {
                        const currentItem = currentLocalTree.inodes[inode];
                        if (!currentItem) {
                            continue;
                        }
                        const oldPath = currentItem.path;
                        if (oldPath.startsWith(task.from + "/") || oldPath === task.from) {
                            const newPath = oldPath.split(task.from).join(task.to);
                            const item = Object.assign(Object.assign({}, currentItem), { path: newPath });
                            currentLocalTree.inodes[inode] = item;
                        }
                    }
                    break;
                }
                case "deleteLocalDirectory":
                case "deleteLocalFile":
                case "deleteRemoteDirectory":
                case "deleteRemoteFile": {
                    for (const path in currentLocalTree.tree) {
                        if (path.startsWith(task.path + "/") || path === task.path) {
                            delete currentLocalTree.tree[path];
                        }
                    }
                    for (const inode in currentLocalTree.inodes) {
                        const currentItem = currentLocalTree.inodes[inode];
                        if (!currentItem) {
                            continue;
                        }
                        const path = currentItem.path;
                        if (path.startsWith(task.path + "/") || path === task.path) {
                            delete currentLocalTree.inodes[inode];
                        }
                    }
                    for (const path in currentRemoteTree.tree) {
                        if (path.startsWith(task.path + "/") || path === task.path) {
                            delete currentRemoteTree.tree[path];
                        }
                    }
                    for (const uuid in currentRemoteTree.uuids) {
                        const currentItem = currentRemoteTree.uuids[uuid];
                        if (!currentItem) {
                            continue;
                        }
                        const path = currentItem.path;
                        if (path.startsWith(task.path + "/") || path === task.path) {
                            delete currentRemoteTree.uuids[uuid];
                        }
                    }
                    delete this.sync.localFileHashes[task.path];
                    break;
                }
                case "createRemoteDirectory": {
                    const item = {
                        name: path_1.default.posix.basename(task.path),
                        type: "directory",
                        uuid: task.uuid,
                        size: 0,
                        path: task.path
                    };
                    currentRemoteTree.tree[task.path] = item;
                    currentRemoteTree.uuids[item.uuid] = item;
                    break;
                }
                case "uploadFile": {
                    const item = Object.assign(Object.assign({}, task.item), { path: task.path });
                    currentRemoteTree.tree[task.path] = item;
                    currentRemoteTree.uuids[item.uuid] = item;
                    break;
                }
                case "createLocalDirectory": {
                    const item = {
                        lastModified: parseInt(task.stats.mtimeMs), // Sometimes comes as a float, but we need an int
                        type: "directory",
                        path: task.path,
                        creation: parseInt(task.stats.birthtimeMs), // Sometimes comes as a float, but we need an int
                        size: task.stats.size,
                        inode: task.stats.ino
                    };
                    currentLocalTree.tree[task.path] = item;
                    currentLocalTree.inodes[item.inode] = item;
                    break;
                }
                case "downloadFile": {
                    const item = {
                        lastModified: parseInt(task.stats.mtimeMs), // Sometimes comes as a float, but we need an int
                        type: "file",
                        path: task.path,
                        creation: parseInt(task.stats.birthtimeMs), // Sometimes comes as a float, but we need an int
                        size: task.stats.size,
                        inode: task.stats.ino
                    };
                    currentLocalTree.tree[task.path] = item;
                    currentLocalTree.inodes[item.inode] = item;
                    break;
                }
            }
        }
        return {
            currentLocalTree,
            currentRemoteTree
        };
    }
    async saveLocalFileHashes() {
        const path = path_1.default.join(this.statePath, "localFileHashes");
        const serialized = (0, msgpackr_1.pack)(this.sync.localFileHashes);
        await fs_extra_1.default.ensureDir(this.statePath);
        await fs_extra_1.default.writeFile(path, serialized);
    }
    async loadLocalFileHashes() {
        const path = path_1.default.join(this.statePath, "localFileHashes");
        await fs_extra_1.default.ensureDir(this.statePath);
        if (!(await fs_extra_1.default.exists(path))) {
            return;
        }
        const buffer = await fs_extra_1.default.readFile(path);
        this.sync.localFileHashes = (0, msgpackr_1.unpack)(buffer);
    }
    async initialize() {
        await Promise.all([this.loadLocalFileHashes(), this.loadPreviousTrees()]);
    }
    async save() {
        await Promise.all([this.saveLocalFileHashes(), this.savePreviousTrees()]);
    }
    async loadPreviousTrees() {
        const localPath = path_1.default.join(this.statePath, "previousLocalTree");
        const remotePath = path_1.default.join(this.statePath, "previousRemoteTree");
        await fs_extra_1.default.ensureDir(this.statePath);
        if (!(await fs_extra_1.default.exists(localPath)) || !(await fs_extra_1.default.exists(remotePath))) {
            return;
        }
        const [localBuffer, remoteBuffer] = await Promise.all([fs_extra_1.default.readFile(localPath), fs_extra_1.default.readFile(remotePath)]);
        this.sync.previousLocalTree = (0, msgpackr_1.unpack)(localBuffer);
        this.sync.previousRemoteTree = (0, msgpackr_1.unpack)(remoteBuffer);
    }
    async savePreviousTrees() {
        const localPath = path_1.default.join(this.statePath, "previousLocalTree");
        const remotePath = path_1.default.join(this.statePath, "previousRemoteTree");
        const localSerialized = (0, msgpackr_1.pack)(this.sync.previousLocalTree);
        const remoteSerialized = (0, msgpackr_1.pack)(this.sync.previousRemoteTree);
        await fs_extra_1.default.ensureDir(this.statePath);
        await Promise.all([fs_extra_1.default.writeFile(localPath, localSerialized), fs_extra_1.default.writeFile(remotePath, remoteSerialized)]);
    }
}
exports.State = State;
exports.default = State;
//# sourceMappingURL=state.js.map