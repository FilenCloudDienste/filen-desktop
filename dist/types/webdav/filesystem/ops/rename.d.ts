import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class Rename {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(pathFrom: WebDAV.Path, newName: string, callback: WebDAV.ReturnCallback<boolean>): void;
}
export default Rename;
