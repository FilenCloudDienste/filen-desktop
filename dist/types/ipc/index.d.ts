import { type FilenDesktop } from "..";
import { type DriveCloudItem } from "../types";
import { type DirDownloadType } from "@filen/sdk/dist/types/api/v3/dir/download";
export type IPCDownloadFileParams = {
    item: DriveCloudItem;
    to: string;
    dontEmitEvents?: boolean;
    name: string;
};
export type IPCDownloadDirectoryParams = {
    uuid: string;
    name: string;
    to: string;
    type?: DirDownloadType;
    linkUUID?: string;
    linkHasPassword?: boolean;
    linkPassword?: string;
    linkSalt?: string;
    dontEmitEvents?: boolean;
};
export type IPCDownloadMultipleFilesAndDirectoriesParams = {
    items: DriveCloudItem[];
    type?: DirDownloadType;
    linkUUID?: string;
    linkHasPassword?: boolean;
    linkPassword?: string;
    linkSalt?: string;
    dontEmitEvents?: boolean;
    to: string;
    name: string;
};
export type IPCShowSaveDialogResult = {
    cancelled: true;
} | {
    cancelled: false;
    path: string;
    name: string;
};
export type IPCShowSaveDialogResultParams = {
    nameSuggestion?: string;
};
export type MainToWindowMessage = {
    type: "download" | "upload";
    data: {
        uuid: string;
        name: string;
    } & ({
        type: "started";
        size: number;
    } | {
        type: "queued";
    } | {
        type: "finished";
        size: number;
    } | {
        type: "progress";
        bytes: number;
    } | {
        type: "error";
        err: Error;
        size: number;
    } | {
        type: "stopped";
        size: number;
    } | {
        type: "paused";
    } | {
        type: "resumed";
    });
} | {
    type: "shareProgress";
    done: number;
    total: number;
    requestUUID: string;
};
export type IPCPauseResumeAbortSignalParams = {
    id: string;
};
/**
 * IPC
 * @date 3/13/2024 - 8:03:16 PM
 *
 * @export
 * @class IPC
 * @typedef {IPC}
 */
export declare class IPC {
    private readonly desktop;
    private didCallRestart;
    private readonly postMainToWindowMessageProgressThrottle;
    private readonly pauseSignals;
    private readonly abortControllers;
    /**
     * Creates an instance of IPC.
     * @date 3/13/2024 - 8:03:20 PM
     *
     * @constructor
     * @public
     * @param {{ desktop: FilenDesktop }} param0
     * @param {FilenDesktop} param0.desktop
     */
    constructor({ desktop }: {
        desktop: FilenDesktop;
    });
    /**
     * Post a message to the main window.
     * We have to throttle the "progress" events of the "download"/"upload" message type. The SDK sends too many events for the electron IPC to handle properly.
     * It freezes the renderer process if we don't throttle it.
     *
     * @public
     * @param {MainToWindowMessage} message
     */
    postMainToWindowMessage(message: MainToWindowMessage): void;
    /**
     * Handle all general related invocations.
     *
     * @private
     */
    private general;
    /**
     * Handle all cloud related invocations.
     *
     * @private
     */
    private cloud;
    /**
     * Handle all window related invocations.
     * @date 3/13/2024 - 8:03:23 PM
     *
     * @private
     */
    private window;
}
export default IPC;
