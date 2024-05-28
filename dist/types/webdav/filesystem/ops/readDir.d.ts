import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class ReadDir {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<string[] | WebDAV.Path[]>): void;
}
export default ReadDir;
