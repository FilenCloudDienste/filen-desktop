import * as WebDAV from "@filen/webdav-server";
import type FileSystem from "..";
export declare class PropertyManager {
    private readonly fileSystem;
    constructor({ fileSystem }: {
        fileSystem: FileSystem;
    });
    run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<WebDAV.IPropertyManager>): void;
}
export default PropertyManager;
