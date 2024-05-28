/// <reference types="node" />
import type Sync from "./sync";
import type { Delta } from "./deltas";
import type { CloudItem } from "@filen/sdk";
import fs from "fs-extra";
export type DoneTask = {
    path: string;
} & ({
    type: "uploadFile";
    item: CloudItem;
} | {
    type: "createRemoteDirectory";
    uuid: string;
} | {
    type: "createLocalDirectory";
    stats: fs.Stats;
} | {
    type: "deleteLocalFile";
} | {
    type: "deleteRemoteFile";
} | {
    type: "deleteLocalDirectory";
} | {
    type: "deleteRemoteDirectory";
} | {
    type: "downloadFile";
    stats: fs.Stats;
} | {
    type: "moveLocalFile";
    from: string;
    to: string;
} | {
    type: "renameLocalFile";
    from: string;
    to: string;
    stats: fs.Stats;
} | {
    type: "moveRemoteFile";
    from: string;
    to: string;
} | {
    type: "renameRemoteFile";
    from: string;
    to: string;
} | {
    type: "renameRemoteDirectory";
    from: string;
    to: string;
} | {
    type: "renameLocalDirectory";
    from: string;
    to: string;
    stats: fs.Stats;
} | {
    type: "moveRemoteDirectory";
    from: string;
    to: string;
} | {
    type: "moveLocalFile";
    from: string;
    to: string;
    stats: fs.Stats;
} | {
    type: "moveLocalDirectory";
    from: string;
    to: string;
    stats: fs.Stats;
});
/**
 * Tasks
 * @date 3/1/2024 - 11:11:32 PM
 *
 * @export
 * @class Tasks
 * @typedef {Tasks}
 */
export declare class Tasks {
    private readonly sync;
    /**
     * Creates an instance of Tasks.
     * @date 3/1/2024 - 11:11:36 PM
     *
     * @constructor
     * @public
     * @param {{ sync: Sync }} param0
     * @param {Sync} param0.sync
     */
    constructor({ sync }: {
        sync: Sync;
    });
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
    private processTask;
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
    process({ deltas }: {
        deltas: Delta[];
    }): Promise<DoneTask[]>;
}
export default Tasks;
