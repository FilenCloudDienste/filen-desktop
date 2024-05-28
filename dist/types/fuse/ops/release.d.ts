import type { FuseErrorCallbackSimple } from "../types";
import type Ops from ".";
export declare class Release {
    private readonly ops;
    constructor({ ops }: {
        ops: Ops;
    });
    private execute;
    run(path: string, callback: FuseErrorCallbackSimple): void;
}
export default Release;
