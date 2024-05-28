/// <reference types="node" />
import type { FuseReadWriteCallback } from "../types";
import type Ops from ".";
export declare class Read {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private downloadChunkToLocal;
    private downloadChunk;
    private execute;
    run(path: string, buffer: Buffer, length: number, position: number, callback: FuseReadWriteCallback): void;
}
export default Read;
