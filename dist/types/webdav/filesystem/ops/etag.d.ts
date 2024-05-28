import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class ETag {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<string>): void;
}
export default ETag;
