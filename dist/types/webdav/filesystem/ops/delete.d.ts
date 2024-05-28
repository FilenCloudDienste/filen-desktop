import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class Delete {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(path: WebDAV.Path, callback: WebDAV.SimpleCallback): void;
}
export default Delete;
