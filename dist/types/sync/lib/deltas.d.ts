import type Sync from "./sync";
import type { LocalTree } from "./filesystems/local";
import type { RemoteTree } from "./filesystems/remote";
export type Delta = {
    path: string;
} & ({
    type: "uploadFile";
} | {
    type: "createRemoteDirectory";
} | {
    type: "createLocalDirectory";
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
} | {
    type: "moveLocalFile";
    from: string;
    to: string;
} | {
    type: "renameLocalFile";
    from: string;
    to: string;
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
} | {
    type: "moveRemoteDirectory";
    from: string;
    to: string;
} | {
    type: "moveLocalFile";
    from: string;
    to: string;
} | {
    type: "moveLocalDirectory";
    from: string;
    to: string;
});
/**
 * Deltas
 * @date 3/1/2024 - 11:11:32 PM
 *
 * @export
 * @class Deltas
 * @typedef {Deltas}
 */
export declare class Deltas {
    private readonly sync;
    /**
     * Creates an instance of Deltas.
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
     * Process the directory trees and return all sync deltas.
     * @date 3/2/2024 - 8:42:25 AM
     *
     * @public
     * @async
     * @param {{
     * 		currentLocalTree: LocalTree
     * 		currentRemoteTree: RemoteTree
     * 		previousLocalTree: LocalTree
     * 		previousRemoteTree: RemoteTree
     * 	}} param0
     * @param {LocalTree} param0.currentLocalTree
     * @param {RemoteTree} param0.currentRemoteTree
     * @param {LocalTree} param0.previousLocalTree
     * @param {RemoteTree} param0.previousRemoteTree
     * @returns {Promise<Delta[]>}
     */
    process({ currentLocalTree, currentRemoteTree, previousLocalTree, previousRemoteTree }: {
        currentLocalTree: LocalTree;
        currentRemoteTree: RemoteTree;
        previousLocalTree: LocalTree;
        previousRemoteTree: RemoteTree;
    }): Promise<Delta[]>;
}
export default Deltas;
