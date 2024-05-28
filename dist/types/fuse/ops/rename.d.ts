import type { FuseErrorCallbackSimple } from "../types";
import type Ops from ".";
export declare class Rename {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private exists;
    private execute;
    run(src: string, dest: string, callback: FuseErrorCallbackSimple): void;
}
export default Rename;
