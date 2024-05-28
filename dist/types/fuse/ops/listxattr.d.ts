import type { FuseListxattrCallback } from "../types";
import type Ops from ".";
export declare class Listxattr {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, callback: FuseListxattrCallback): void;
}
export default Listxattr;
