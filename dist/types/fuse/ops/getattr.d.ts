import type { FuseStatsCallback } from "../types";
import type Ops from ".";
export declare class Getattr {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, callback: FuseStatsCallback): void;
}
export default Getattr;
