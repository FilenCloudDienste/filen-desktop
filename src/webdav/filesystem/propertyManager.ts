import * as WebDAV from "@filen/webdav-server"

export class PropertyManager implements WebDAV.IPropertyManager {
	private readonly properties: WebDAV.PropertyBag = {}

	public setProperty(
		name: string,
		value: WebDAV.ResourcePropertyValue,
		attributes: WebDAV.PropertyAttributes,
		callback: WebDAV.SimpleCallback
	): void {
		this.properties[name] = {
			value,
			attributes
		}

		callback(undefined)
	}

	public getProperty(name: string, callback: WebDAV.Return2Callback<WebDAV.ResourcePropertyValue, WebDAV.PropertyAttributes>): void {
		const property = this.properties[name]

		if (!property) {
			callback(WebDAV.Errors.PropertyNotFound)

			return
		}

		callback(undefined, property.value, property.attributes)
	}

	public removeProperty(name: string, callback: WebDAV.SimpleCallback): void {
		delete this.properties[name]

		callback(undefined)
	}

	public getProperties(callback: WebDAV.ReturnCallback<WebDAV.PropertyBag>, byCopy: boolean = false): void {
		callback(undefined, byCopy ? this.properties : JSON.parse(JSON.stringify(this.properties)))
	}
}

export default PropertyManager
