"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Semaphore = void 0;
/**
 * Basic Semaphore implementation.
 * @date 2/15/2024 - 4:52:51 AM
 *
 * @type {new (max: number) => ISemaphore}
 */
exports.Semaphore = function (max) {
    let counter = 0;
    let waiting = [];
    let maxCount = max || 1;
    const take = function () {
        if (waiting.length > 0 && counter < maxCount) {
            counter++;
            const promise = waiting.shift();
            if (!promise) {
                return;
            }
            promise.resolve();
        }
    };
    this.acquire = function () {
        if (counter < maxCount) {
            counter++;
            return new Promise(resolve => {
                resolve();
            });
        }
        else {
            return new Promise((resolve, err) => {
                waiting.push({
                    resolve: resolve,
                    err: err
                });
            });
        }
    };
    this.release = function () {
        counter--;
        take();
    };
    this.count = function () {
        return counter;
    };
    this.setMax = function (newMax) {
        maxCount = newMax;
    };
    this.purge = function () {
        const unresolved = waiting.length;
        for (let i = 0; i < unresolved; i++) {
            const w = waiting[i];
            if (!w) {
                continue;
            }
            w.err("Task has been purged");
        }
        counter = 0;
        waiting = [];
        return unresolved;
    };
};
//# sourceMappingURL=semaphore.js.map