import * as WebDAV from "@filen/webdav-server";
import FileSystem from ".";
import type Resource from "./resource";
import type SDK from "@filen/sdk";
export type FileSystemSerializedData = {
    path: string;
    resources: {
        [path: string]: Resource;
    };
};
export declare class Serializer implements WebDAV.FileSystemSerializer {
    private readonly sdk;
    constructor({ sdk }: {
        sdk: SDK;
    });
    uid(): string;
    serialize(fs: FileSystem, callback: WebDAV.ReturnCallback<FileSystemSerializedData>): void;
    unserialize(serializedData: FileSystemSerializedData, callback: WebDAV.ReturnCallback<FileSystem>): void;
}
export default Serializer;
