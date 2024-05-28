import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import _PropertyManager from "../propertyManager"

export class PropertyManager {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	public run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<WebDAV.IPropertyManager>): void {
		if (!this.fileSystem.propertyManagers[path.toString()]) {
			this.fileSystem.propertyManagers[path.toString()] = new _PropertyManager()
		}

		callback(undefined, this.fileSystem.propertyManagers[path.toString()])
	}
}

export default PropertyManager
