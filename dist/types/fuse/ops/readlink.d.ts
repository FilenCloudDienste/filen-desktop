import type { FuseReadlinkCallback } from "../types";
export declare class Readlink {
    private execute;
    run(path: string, callback: FuseReadlinkCallback): void;
}
export default Readlink;
