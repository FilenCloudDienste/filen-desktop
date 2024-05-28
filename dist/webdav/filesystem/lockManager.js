"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockManager = void 0;
class LockManager {
    constructor() {
        this.locks = [];
    }
    getLocks(callback) {
        this.locks = this.locks.filter(lock => !lock.expired());
        callback(undefined, this.locks);
    }
    setLock(lock, callback) {
        this.locks.push(lock);
        callback(undefined);
    }
    removeLock(uuid, callback) {
        for (let index = 0; index < this.locks.length; ++index) {
            if (this.locks[index].uuid === uuid) {
                this.locks.splice(index, 1);
                callback(undefined, true);
                return;
            }
        }
        callback(undefined, false);
    }
    getLock(uuid, callback) {
        this.locks = this.locks.filter(lock => !lock.expired());
        for (const lock of this.locks) {
            if (lock.uuid === uuid) {
                callback(undefined, lock);
                return;
            }
        }
        callback();
    }
    refresh(uuid, timeout, callback) {
        this.getLock(uuid, (err, lock) => {
            if (err || !lock) {
                callback(err);
                return;
            }
            lock.refresh(timeout);
            callback(undefined, lock);
        });
    }
}
exports.LockManager = LockManager;
exports.default = LockManager;
//# sourceMappingURL=lockManager.js.map