export interface ISemaphore {
    acquire(): Promise<void>;
    release(): void;
    count(): number;
    setMax(newMax: number): void;
    purge(): number;
}
/**
 * Basic Semaphore implementation.
 * @date 2/15/2024 - 4:52:51 AM
 *
 * @type {new (max: number) => ISemaphore}
 */
export declare const Semaphore: new (max: number) => ISemaphore;
