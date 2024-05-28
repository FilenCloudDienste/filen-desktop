import * as WebDAV from "@filen/webdav-server";
export declare class PropertyManager implements WebDAV.IPropertyManager {
    private readonly properties;
    setProperty(name: string, value: WebDAV.ResourcePropertyValue, attributes: WebDAV.PropertyAttributes, callback: WebDAV.SimpleCallback): void;
    getProperty(name: string, callback: WebDAV.Return2Callback<WebDAV.ResourcePropertyValue, WebDAV.PropertyAttributes>): void;
    removeProperty(name: string, callback: WebDAV.SimpleCallback): void;
    getProperties(callback: WebDAV.ReturnCallback<WebDAV.PropertyBag>, byCopy?: boolean): void;
}
export default PropertyManager;
