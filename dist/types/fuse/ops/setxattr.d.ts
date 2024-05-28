/// <reference types="node" />
import type { FuseErrorCallbackSimple } from "../types";
import type Ops from ".";
export declare class Setxattr {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, name: string, value: Buffer, callback: FuseErrorCallbackSimple): void;
}
export default Setxattr;
