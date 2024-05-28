import type { FuseCreateCallback } from "../types";
import type Ops from ".";
export declare class Open {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, mode: number, callback: FuseCreateCallback): void;
}
export default Open;
