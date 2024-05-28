import type { FuseErrorCallbackSimple } from "../types";
import type Ops from ".";
export declare class Mkdir {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private exists;
    private execute;
    run(path: string, callback: FuseErrorCallbackSimple): void;
}
export default Mkdir;
