import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class Create {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(path: WebDAV.Path, ctx: WebDAV.CreateInfo, callback: WebDAV.SimpleCallback): void;
}
export default Create;
