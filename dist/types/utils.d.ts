/**
 * "Sleep" for N milliseconds.
 * @date 3/1/2024 - 10:04:06 PM
 *
 * @export
 * @async
 * @param {number} ms
 * @returns {Promise<void>}
 */
export declare function sleep(ms: number): Promise<void>;
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
export declare function promiseAllChunked<T>(promises: Promise<T>[], chunkSize?: number): Promise<T[]>;
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
export declare function promiseAllSettledChunked<T>(promises: Promise<T>[], chunkSize?: number): Promise<T[]>;
