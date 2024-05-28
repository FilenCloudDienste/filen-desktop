import { type FilenSDKConfig } from "@filen/sdk";
import { type IPCDownloadFileParams, type IPCDownloadDirectoryParams, type IPCShowSaveDialogResult, type MainToWindowMessage, type IPCDownloadMultipleFilesAndDirectoriesParams, type IPCShowSaveDialogResultParams, type IPCPauseResumeAbortSignalParams } from "./ipc";
export type DesktopAPI = {
    onMainToWindowMessage: (listener: (message: MainToWindowMessage) => void) => {
        remove: () => void;
    };
    ping: () => Promise<string>;
    minimizeWindow: () => Promise<void>;
    maximizeWindow: () => Promise<void>;
    closeWindow: () => Promise<void>;
    restart: () => Promise<void>;
    initSDK: (config: FilenSDKConfig) => Promise<void>;
    showWindow: () => Promise<void>;
    hideWindow: () => Promise<void>;
    downloadFile: (params: IPCDownloadFileParams) => Promise<string>;
    downloadDirectory: (params: IPCDownloadDirectoryParams) => Promise<string>;
    showSaveDialog: (params?: IPCShowSaveDialogResultParams) => Promise<IPCShowSaveDialogResult>;
    downloadMultipleFilesAndDirectories: (params: IPCDownloadMultipleFilesAndDirectoriesParams) => Promise<string>;
    pausePauseSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>;
    resumePauseSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>;
    abortAbortSignal: (params: IPCPauseResumeAbortSignalParams) => Promise<void>;
};
