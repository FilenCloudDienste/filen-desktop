import * as WebDAV from "@filen/webdav-server"
import type FileSystem from ".."
import _LockManager from "../lockManager"

export class LockManager {
	private readonly fileSystem: FileSystem

	public constructor({ fileSystem }: { fileSystem: FileSystem }) {
		this.fileSystem = fileSystem
	}

	public run(path: WebDAV.Path, callback: WebDAV.ReturnCallback<WebDAV.ILockManager>): void {
		if (!this.fileSystem.lockManagers[path.toString()]) {
			this.fileSystem.lockManagers[path.toString()] = new _LockManager()
		}

		callback(undefined, this.fileSystem.lockManagers[path.toString()])
	}
}

export default LockManager
