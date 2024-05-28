import type { FuseErrorCallbackSimple } from "../types";
import type Ops from ".";
export declare class Removexattr {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, name: string, callback: FuseErrorCallbackSimple): void;
}
export default Removexattr;
