import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class LockManager {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<WebDAV.ILockManager>): void;
}
export default LockManager;
