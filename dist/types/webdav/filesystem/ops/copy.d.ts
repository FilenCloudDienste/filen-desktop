import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class Copy {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(pathFrom: WebDAV.Path, pathTo: WebDAV.Path, callback: WebDAV.ReturnCallback<boolean>): void;
}
export default Copy;
