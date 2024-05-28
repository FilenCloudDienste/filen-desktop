"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("desktopAPI", {
    onMainToWindowMessage: listener => {
        const listen = (_, message) => {
            listener(message);
        };
        electron_1.ipcRenderer.addListener("mainToWindowMessage", listen);
        return {
            remove: () => {
                electron_1.ipcRenderer.removeListener("mainToWindowMessage", listen);
            }
        };
    },
    ping: () => electron_1.ipcRenderer.invoke("ping"),
    minimizeWindow: () => electron_1.ipcRenderer.invoke("minimizeWindow"),
    maximizeWindow: () => electron_1.ipcRenderer.invoke("maximizeWindow"),
    closeWindow: () => electron_1.ipcRenderer.invoke("closeWindow"),
    restart: () => electron_1.ipcRenderer.invoke("restart"),
    initSDK: config => electron_1.ipcRenderer.invoke("initSDK", config),
    showWindow: () => electron_1.ipcRenderer.invoke("showWindow"),
    hideWindow: () => electron_1.ipcRenderer.invoke("hideWindow"),
    downloadFile: params => electron_1.ipcRenderer.invoke("downloadFile", params),
    downloadDirectory: params => electron_1.ipcRenderer.invoke("downloadDirectory", params),
    showSaveDialog: params => electron_1.ipcRenderer.invoke("showSaveDialog", params),
    downloadMultipleFilesAndDirectories: params => electron_1.ipcRenderer.invoke("downloadMultipleFilesAndDirectories", params),
    pausePauseSignal: params => electron_1.ipcRenderer.invoke("pausePauseSignal", params),
    resumePauseSignal: params => electron_1.ipcRenderer.invoke("resumePauseSignal", params),
    abortAbortSignal: params => electron_1.ipcRenderer.invoke("abortAbortSignal", params)
});
//# sourceMappingURL=preload.js.map