"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promiseAllSettledChunked = exports.promiseAllChunked = exports.sleep = void 0;
/**
 * "Sleep" for N milliseconds.
 * @date 3/1/2024 - 10:04:06 PM
 *
 * @export
 * @async
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}
exports.sleep = sleep;
/**
 * Chunk large Promise.all executions.
 * @date 2/14/2024 - 11:59:34 PM
 *
 * @export
 * @async
 * @template T
 * @param {Promise<T>[]} promises
 * @param {number} [chunkSize=10000]
 * @returns {Promise<T[]>}
 */
async function promiseAllChunked(promises, chunkSize = 100000) {
    const results = [];
    for (let i = 0; i < promises.length; i += chunkSize) {
        const chunkResults = await Promise.all(promises.slice(i, i + chunkSize));
        results.push(...chunkResults);
    }
    return results;
}
exports.promiseAllChunked = promiseAllChunked;
/**
 * Chunk large Promise.allSettled executions.
 * @date 3/5/2024 - 12:41:08 PM
 *
 * @export
 * @async
 * @template T
 * @param {Promise<T>[]} promises
 * @param {number} [chunkSize=100000]
 * @returns {Promise<T[]>}
 */
async function promiseAllSettledChunked(promises, chunkSize = 100000) {
    const results = [];
    for (let i = 0; i < promises.length; i += chunkSize) {
        const chunkPromisesSettled = await Promise.allSettled(promises.slice(i, i + chunkSize));
        const chunkResults = chunkPromisesSettled.reduce((acc, current) => {
            if (current.status === "fulfilled") {
                acc.push(current.value);
            }
            else {
                // Handle rejected promises or do something with the error (current.reason)
            }
            return acc;
        }, []);
        results.push(...chunkResults);
    }
    return results;
}
exports.promiseAllSettledChunked = promiseAllSettledChunked;
//# sourceMappingURL=utils.js.map