import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class FastExistsCheck {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(path: WebDAV.Path, callback: (exists: boolean) => void): void;
}
export default FastExistsCheck;
