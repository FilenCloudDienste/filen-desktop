import type { FuseReaddirCallback } from "../types";
import type Ops from ".";
export declare class Readdir {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, callback: FuseReaddirCallback): void;
}
export default Readdir;
