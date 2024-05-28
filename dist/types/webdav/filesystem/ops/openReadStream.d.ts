/// <reference types="node" />
import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
import { Readable } from "stream";
export declare class OpenReadStream {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<Readable>): void;
}
export default OpenReadStream;
