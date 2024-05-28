import type { FuseStatFSCallback } from "../types";
import type Ops from ".";
export declare class StatFS {
    private cache;
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(_path: string, callback: FuseStatFSCallback): void;
}
export default StatFS;
