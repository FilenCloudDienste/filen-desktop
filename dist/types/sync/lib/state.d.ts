import type Sync from "./sync";
import type { RemoteTree } from "./filesystems/remote";
import type { LocalTree } from "./filesystems/local";
import type { DoneTask } from "./tasks";
/**
 * State
 * @date 3/1/2024 - 11:11:32 PM
 *
 * @export
 * @class State
 * @typedef {State}
 */
export declare class State {
    private readonly sync;
    private readonly statePath;
    /**
     * Creates an instance of State.
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
    applyDoneTasksToState({ doneTasks, currentLocalTree, currentRemoteTree }: {
        doneTasks: DoneTask[];
        currentLocalTree: LocalTree;
        currentRemoteTree: RemoteTree;
    }): {
        currentLocalTree: LocalTree;
        currentRemoteTree: RemoteTree;
    };
    saveLocalFileHashes(): Promise<void>;
    loadLocalFileHashes(): Promise<void>;
    initialize(): Promise<void>;
    save(): Promise<void>;
    loadPreviousTrees(): Promise<void>;
    savePreviousTrees(): Promise<void>;
}
export default State;
