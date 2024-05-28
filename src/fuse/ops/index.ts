import type SDK from "@filen/sdk"
import * as Fuse from "@gcas/fuse"
import {
	FuseErrorCallbackSimple,
	FuseStatFSCallback,
	FuseStatsCallback,
	FuseReaddirCallback,
	FuseReadlinkCallback,
	FuseGetxattrCallback,
	FuseListxattrCallback,
	FuseOpenCallback,
	FuseCreateCallback,
	FuseUpload,
	FuseReadWriteCallback,
	OpenMode
} from "../types"
import { ISemaphore } from "../../semaphore"
import Noop from "./noop"
import Access from "./access"
import StatFS from "./statfs"
import Getattr from "./getattr"
import Readdir from "./readdir"
import Readlink from "./readlink"
import Getxattr from "./getxattr"
import Setxattr from "./setxattr"
import Listxattr from "./listxattr"
import Removexattr from "./removexattr"
import Opendir from "./opendir"
import Unlink from "./unlink"
import Mkdir from "./mkdir"
import Rename from "./rename"
import Create from "./create"
import Open from "./open"
import Release from "./release"
import Read from "./read"
import Write from "./write"

export class Ops implements Fuse.OPERATIONS {
	public readonly sdk: SDK
	public readonly baseTmpPath: string
	public readonly fullDownloadsTmpPath: string
	public readonly writeTmpPath: string
	public readonly decryptedChunksTmpPath: string
	public readonly encryptedChunksTmpPath: string
	public readonly uploadsTmpPath: string
	public readonly xattrPath: string
	public readonly uploads: Record<string, FuseUpload> = {}
	public readonly readWriteMutex: Record<string, ISemaphore> = {}
	public readonly openMode: Record<string, OpenMode> = {}
	public readonly virtualFiles: Record<string, Fuse.Stats> = {}
	public readonly openFileHandles: Record<string, number> = {}
	public readonly writeTmpChunkToDiskMutex: Record<string, ISemaphore> = {}
	public readonly downloadChunkToLocalActive: Record<string, Record<number, boolean>> = {}
	public readonly chunkDownloadsActive: Record<string, number> = {}
	public nextFd: number = 0
	private readonly _noop: Noop
	private readonly _access: Access
	private readonly _statFS: StatFS
	private readonly _getattr: Getattr
	private readonly _readdir: Readdir
	private readonly _readlink: Readlink
	private readonly _getxattr: Getxattr
	private readonly _setxattr: Setxattr
	private readonly _listxattr: Listxattr
	private readonly _removexattr: Removexattr
	private readonly _opendir: Opendir
	private readonly _unlink: Unlink
	private readonly _mkdir: Mkdir
	private readonly _rename: Rename
	private readonly _create: Create
	private readonly _open: Open
	private readonly _release: Release
	private readonly _read: Read
	private readonly _write: Write

	public constructor({
		sdk,
		baseTmpPath,
		fullDownloadsTmpPath,
		writeTmpPath,
		decryptedChunksTmpPath,
		xattrPath,
		encryptedChunksTmpPath,
		uploadsTmpPath
	}: {
		sdk: SDK
		baseTmpPath: string
		fullDownloadsTmpPath: string
		writeTmpPath: string
		decryptedChunksTmpPath: string
		xattrPath: string
		encryptedChunksTmpPath: string
		uploadsTmpPath: string
	}) {
		this.sdk = sdk
		this.baseTmpPath = baseTmpPath
		this.fullDownloadsTmpPath = fullDownloadsTmpPath
		this.writeTmpPath = writeTmpPath
		this.decryptedChunksTmpPath = decryptedChunksTmpPath
		this.xattrPath = xattrPath
		this.encryptedChunksTmpPath = encryptedChunksTmpPath
		this.uploadsTmpPath = uploadsTmpPath
		this._noop = new Noop()
		this._access = new Access({ ops: this })
		this._statFS = new StatFS({ ops: this })
		this._getattr = new Getattr({ ops: this })
		this._readdir = new Readdir({ ops: this })
		this._readlink = new Readlink()
		this._getxattr = new Getxattr({ ops: this })
		this._listxattr = new Listxattr({ ops: this })
		this._setxattr = new Setxattr({ ops: this })
		this._removexattr = new Removexattr({ ops: this })
		this._opendir = new Opendir({ ops: this })
		this._unlink = new Unlink({ ops: this })
		this._mkdir = new Mkdir({ ops: this })
		this._rename = new Rename({ ops: this })
		this._create = new Create({ ops: this })
		this._open = new Open({ ops: this })
		this._release = new Release({ ops: this })
		this._read = new Read({ ops: this })
		this._write = new Write({ ops: this })
	}

	public init(callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public access(path: string, mode: number, callback: FuseErrorCallbackSimple): void {
		this._access.run(path, mode, callback)
	}

	public statfs(path: string, callback: FuseStatFSCallback): void {
		this._statFS.run(path, callback)
	}

	public getattr(path: string, callback: FuseStatsCallback): void {
		this._getattr.run(path, callback)
	}

	public fgetattr(path: string, _fd: number, callback: FuseStatsCallback): void {
		this._getattr.run(path, callback)
	}

	public flush(_path: string, _fd: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public fsync(_path: string, _dataSync: boolean, _fd: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public fsyncdir(_path: string, _dataSync: boolean, _fd: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public readdir(path: string, callback: FuseReaddirCallback): void {
		this._readdir.run(path, callback)
	}

	public truncate(_path: string, _size: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public ftruncate(_path: string, _fd: number, _size: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public readlink(path: string, callback: FuseReadlinkCallback): void {
		this._readlink.run(path, callback)
	}

	public chown(_path: string, _uid: number, _gid: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public chmod(_path: string, _mode: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public mknod(_path: string, _mode: number, _dev: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public setxattr(path: string, name: string, value: Buffer, _size: number, _flags: number, callback: FuseErrorCallbackSimple): void {
		this._setxattr.run(path, name, value, callback)
	}

	public getxattr(path: string, name: string, _size: number, callback: FuseGetxattrCallback): void {
		this._getxattr.run(path, name, callback)
	}

	public listxattr(path: string, callback: FuseListxattrCallback): void {
		this._listxattr.run(path, callback)
	}

	public removexattr(path: string, name: string, callback: FuseErrorCallbackSimple): void {
		this._removexattr.run(path, name, callback)
	}

	public open(path: string, mode: number, callback: FuseOpenCallback): void {
		this._open.run(path, mode, callback)
	}

	public opendir(path: string, mode: number, callback: FuseOpenCallback): void {
		this._opendir.run(path, mode, callback)
	}

	public read(path: string, _fd: number, buffer: Buffer, length: number, position: number, callback: FuseReadWriteCallback): void {
		this._read.run(path, buffer, length, position, callback)
	}

	public write(path: string, _fd: number, buffer: Buffer, length: number, position: number, callback: FuseReadWriteCallback): void {
		this._write.run(path, buffer, length, position, callback)
	}

	public release(path: string, _fd: number, callback: FuseErrorCallbackSimple): void {
		this._release.run(path, callback)
	}

	public releasedir(_path: string, _fd: number, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public create(path: string, mode: number, callback: FuseCreateCallback): void {
		this._create.run(path, mode, callback)
	}

	public utimens(_path: string, _atime: Date, _mtime: Date, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public unlink(path: string, callback: FuseErrorCallbackSimple): void {
		this._unlink.run(path, callback)
	}

	public rename(src: string, dest: string, callback: FuseErrorCallbackSimple): void {
		this._rename.run(src, dest, callback)
	}

	public link(_src: string, _dest: string, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public symlink(_src: string, _dest: string, callback: FuseErrorCallbackSimple): void {
		this._noop.run(callback)
	}

	public mkdir(path: string, _mode: number, callback: FuseErrorCallbackSimple): void {
		this._mkdir.run(path, callback)
	}

	public rmdir(path: string, callback: FuseErrorCallbackSimple): void {
		this._unlink.run(path, callback)
	}
}

export default Ops
