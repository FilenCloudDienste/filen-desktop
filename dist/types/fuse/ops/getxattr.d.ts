import type { FuseGetxattrCallback } from "../types";
import type Ops from ".";
export declare class Getxattr {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, name: string, callback: FuseGetxattrCallback): void;
}
export default Getxattr;
