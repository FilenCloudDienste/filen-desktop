"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPC = void 0;
const electron_1 = require("electron");
const sdk_1 = require("@filen/sdk");
const config_1 = require("../config");
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const uuid_1 = require("uuid");
/**
 * IPC
 * @date 3/13/2024 - 8:03:16 PM
 *
 * @export
 * @class IPC
 * @typedef {IPC}
 */
class IPC {
    /**
     * Creates an instance of IPC.
     * @date 3/13/2024 - 8:03:20 PM
     *
     * @constructor
     * @public
     * @param {{ desktop: FilenDesktop }} param0
     * @param {FilenDesktop} param0.desktop
     */
    constructor({ desktop }) {
        this.didCallRestart = false;
        this.postMainToWindowMessageProgressThrottle = {};
        this.pauseSignals = {};
        this.abortControllers = {};
        this.desktop = desktop;
        this.general();
        this.window();
        this.cloud();
    }
    /**
     * Post a message to the main window.
     * We have to throttle the "progress" events of the "download"/"upload" message type. The SDK sends too many events for the electron IPC to handle properly.
     * It freezes the renderer process if we don't throttle it.
     *
     * @public
     * @param {MainToWindowMessage} message
     */
    postMainToWindowMessage(message) {
        if (!this.desktop.driveWindow) {
            return;
        }
        const now = Date.now();
        let key = "";
        if (message.type === "download" || message.type === "upload") {
            if (message.data.type === "progress") {
                key = `${message.type}:${message.data.uuid}:${message.data.name}:${message.data.type}`;
                if (!this.postMainToWindowMessageProgressThrottle[key]) {
                    this.postMainToWindowMessageProgressThrottle[key] = {
                        next: 0,
                        storedBytes: 0
                    };
                }
                this.postMainToWindowMessageProgressThrottle[key].storedBytes += message.data.bytes;
                if (this.postMainToWindowMessageProgressThrottle[key].next > now) {
                    return;
                }
                message = Object.assign(Object.assign({}, message), { data: Object.assign(Object.assign({}, message.data), { bytes: this.postMainToWindowMessageProgressThrottle[key].storedBytes }) });
            }
        }
        this.desktop.driveWindow.webContents.postMessage("mainToWindowMessage", message);
        if (key.length > 0 &&
            this.postMainToWindowMessageProgressThrottle[key] &&
            (message.type === "download" || message.type === "upload")) {
            this.postMainToWindowMessageProgressThrottle[key].storedBytes = 0;
            this.postMainToWindowMessageProgressThrottle[key].next = now + 100;
            if (message.data.type === "error" ||
                message.data.type === "queued" ||
                message.data.type === "stopped" ||
                message.data.type === "finished") {
                delete this.postMainToWindowMessageProgressThrottle[key];
            }
        }
    }
    /**
     * Handle all general related invocations.
     *
     * @private
     */
    general() {
        electron_1.ipcMain.handle("restart", () => {
            if (this.didCallRestart) {
                return;
            }
            this.didCallRestart = true;
            electron_1.app.relaunch();
        });
        electron_1.ipcMain.handle("initSDK", (_, config) => {
            (0, config_1.setSDKConfig)(config);
        });
        electron_1.ipcMain.handle("showSaveDialog", async (_, params) => {
            if (!this.desktop.driveWindow) {
                throw new Error("Drive window missing.");
            }
            const { canceled, filePath } = await electron_1.dialog.showSaveDialog(this.desktop.driveWindow, {
                properties: ["createDirectory", "showHiddenFiles", "showOverwriteConfirmation", "treatPackageAsDirectory"],
                defaultPath: params && params.nameSuggestion ? params.nameSuggestion : `Download_${Date.now()}`
            });
            if (canceled || !filePath) {
                return {
                    cancelled: true
                };
            }
            const name = path_1.default.basename(filePath);
            const parentPath = path_1.default.dirname(filePath);
            const canWrite = await new Promise(resolve => fs_extra_1.default.access(parentPath, fs_extra_1.default.constants.W_OK | fs_extra_1.default.constants.R_OK, err => resolve(err ? false : true)));
            if (!canWrite) {
                throw new Error(`Cannot write at path ${parentPath}.`);
            }
            return {
                cancelled: false,
                path: filePath,
                name
            };
        });
    }
    /**
     * Handle all cloud related invocations.
     *
     * @private
     */
    cloud() {
        electron_1.ipcMain.handle("pausePauseSignal", (_, { id }) => {
            if (!this.pauseSignals[id] || this.pauseSignals[id].isPaused()) {
                return;
            }
            this.pauseSignals[id].pause();
        });
        electron_1.ipcMain.handle("resumePauseSignal", (_, { id }) => {
            if (!this.pauseSignals[id] || !this.pauseSignals[id].isPaused()) {
                return;
            }
            this.pauseSignals[id].resume();
        });
        electron_1.ipcMain.handle("abortAbortSignal", (_, { id }) => {
            if (!this.abortControllers[id] || this.abortControllers[id].signal.aborted) {
                return;
            }
            this.abortControllers[id].abort();
            delete this.abortControllers[id];
            delete this.pauseSignals[id];
        });
        electron_1.ipcMain.handle("downloadFile", async (_, { item, to, dontEmitEvents, name }) => {
            if (item.type === "directory") {
                throw new Error("Invalid file type.");
            }
            if (!this.pauseSignals[item.uuid]) {
                this.pauseSignals[item.uuid] = new sdk_1.PauseSignal();
            }
            if (!this.abortControllers[item.uuid]) {
                this.abortControllers[item.uuid] = new AbortController();
            }
            try {
                return await this.desktop.lib.cloud.downloadFile({
                    uuid: item.uuid,
                    bucket: item.bucket,
                    region: item.region,
                    chunks: item.chunks,
                    key: item.key,
                    to,
                    version: item.version,
                    dontEmitEvents,
                    size: item.size,
                    name,
                    pauseSignal: this.pauseSignals[item.uuid],
                    abortSignal: this.abortControllers[item.uuid].signal
                });
            }
            catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") {
                    return "";
                }
                throw e;
            }
            finally {
                delete this.pauseSignals[item.uuid];
                delete this.abortControllers[item.uuid];
            }
        });
        electron_1.ipcMain.handle("downloadDirectory", async (_, { uuid, name, to, type, linkUUID, linkHasPassword, linkPassword, linkSalt }) => {
            if (!this.pauseSignals[uuid]) {
                this.pauseSignals[uuid] = new sdk_1.PauseSignal();
            }
            if (!this.abortControllers[uuid]) {
                this.abortControllers[uuid] = new AbortController();
            }
            try {
                return await this.desktop.lib.cloud.downloadDirectory({
                    uuid,
                    name,
                    linkUUID,
                    linkHasPassword,
                    linkPassword,
                    linkSalt,
                    to,
                    type,
                    pauseSignal: this.pauseSignals[uuid],
                    abortSignal: this.abortControllers[uuid].signal
                });
            }
            catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") {
                    return "";
                }
                throw e;
            }
            finally {
                delete this.pauseSignals[uuid];
                delete this.abortControllers[uuid];
            }
        });
        electron_1.ipcMain.handle("downloadMultipleFilesAndDirectories", async (_, { items, to, type, linkUUID, linkHasPassword, linkPassword, linkSalt, name }) => {
            const directoryId = (0, uuid_1.v4)();
            if (!this.pauseSignals[directoryId]) {
                this.pauseSignals[directoryId] = new sdk_1.PauseSignal();
            }
            if (!this.abortControllers[directoryId]) {
                this.abortControllers[directoryId] = new AbortController();
            }
            try {
                return await this.desktop.lib.cloud.downloadMultipleFilesAndDirectories({
                    items: items.map(item => (Object.assign(Object.assign({}, item), { path: item.name }))),
                    linkUUID,
                    linkHasPassword,
                    linkPassword,
                    linkSalt,
                    to,
                    type,
                    name,
                    directoryId,
                    pauseSignal: this.pauseSignals[directoryId],
                    abortSignal: this.abortControllers[directoryId].signal
                });
            }
            catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") {
                    return "";
                }
                throw e;
            }
            finally {
                delete this.pauseSignals[directoryId];
                delete this.abortControllers[directoryId];
            }
        });
    }
    /**
     * Handle all window related invocations.
     * @date 3/13/2024 - 8:03:23 PM
     *
     * @private
     */
    window() {
        electron_1.ipcMain.handle("minimizeWindow", () => {
            var _a;
            (_a = this.desktop.driveWindow) === null || _a === void 0 ? void 0 : _a.minimize();
        });
        electron_1.ipcMain.handle("maximizeWindow", () => {
            var _a;
            (_a = this.desktop.driveWindow) === null || _a === void 0 ? void 0 : _a.maximize();
        });
        electron_1.ipcMain.handle("closeWindow", () => {
            var _a;
            (_a = this.desktop.driveWindow) === null || _a === void 0 ? void 0 : _a.close();
        });
        electron_1.ipcMain.handle("showWindow", () => {
            var _a;
            (_a = this.desktop.driveWindow) === null || _a === void 0 ? void 0 : _a.show();
        });
        electron_1.ipcMain.handle("hideWindow", () => {
            var _a;
            (_a = this.desktop.driveWindow) === null || _a === void 0 ? void 0 : _a.hide();
        });
    }
}
exports.IPC = IPC;
exports.default = IPC;
//# sourceMappingURL=index.js.map