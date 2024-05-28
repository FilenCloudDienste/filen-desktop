/// <reference types="node" />
import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
import { Writable } from "stream";
export declare class OpenWriteStream {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    private execute;
    run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<Writable>): void;
}
export default OpenWriteStream;
