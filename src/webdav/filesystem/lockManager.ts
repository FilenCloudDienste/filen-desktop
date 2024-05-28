import * as WebDAV from "@filen/webdav-server"

export class LockManager implements WebDAV.ILockManager {
	private locks: WebDAV.Lock[] = []

	public getLocks(callback: WebDAV.ReturnCallback<WebDAV.Lock[]>): void {
		this.locks = this.locks.filter(lock => !lock.expired())

		callback(undefined, this.locks)
	}

	public setLock(lock: WebDAV.Lock, callback: WebDAV.SimpleCallback): void {
		this.locks.push(lock)

		callback(undefined)
	}

	public removeLock(uuid: string, callback: WebDAV.ReturnCallback<boolean>): void {
		for (let index = 0; index < this.locks.length; ++index) {
			if (this.locks[index]!.uuid === uuid) {
				this.locks.splice(index, 1)

				callback(undefined, true)

				return
			}
		}

		callback(undefined, false)
	}

	public getLock(uuid: string, callback: WebDAV.ReturnCallback<WebDAV.Lock>): void {
		this.locks = this.locks.filter(lock => !lock.expired())

		for (const lock of this.locks) {
			if (lock.uuid === uuid) {
				callback(undefined, lock)

				return
			}
		}

		callback()
	}

	public refresh(uuid: string, timeout: number, callback: WebDAV.ReturnCallback<WebDAV.Lock>): void {
		this.getLock(uuid, (err, lock) => {
			if (err || !lock) {
				callback(err)

				return
			}

			lock.refresh(timeout)

			callback(undefined, lock)
		})
	}
}

export default LockManager
