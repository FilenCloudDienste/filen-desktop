import type { FuseOpenCallback } from "../types";
import type Ops from ".";
export declare class Opendir {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, _mode: number, callback: FuseOpenCallback): void;
}
export default Opendir;
