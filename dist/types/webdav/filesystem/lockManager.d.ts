import * as WebDAV from "@filen/webdav-server";
export declare class LockManager implements WebDAV.ILockManager {
    private locks;
    getLocks(callback: WebDAV.ReturnCallback<WebDAV.Lock[]>): void;
    setLock(lock: WebDAV.Lock, callback: WebDAV.SimpleCallback): void;
    removeLock(uuid: string, callback: WebDAV.ReturnCallback<boolean>): void;
    getLock(uuid: string, callback: WebDAV.ReturnCallback<WebDAV.Lock>): void;
    refresh(uuid: string, timeout: number, callback: WebDAV.ReturnCallback<WebDAV.Lock>): void;
}
export default LockManager;
