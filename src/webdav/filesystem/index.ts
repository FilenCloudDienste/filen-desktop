import SDK, { FSStats } from "@filen/sdk"
import * as WebDAV from "@filen/webdav-server"
import Serializer from "./serializer"
import { Readable, Writable } from "stream"
import PropertyManager from "./ops/propertyManager"
import LockManager from "./ops/lockManager"
import Type from "./ops/type"
import ReadDir from "./ops/readDir"
import DisplayName from "./ops/displayName"
import CreationDate from "./ops/creationDate"
import LastModifiedDate from "./ops/lastModifiedDate"
import Size from "./ops/size"
import MimeType from "./ops/mimeType"
import ETag from "./ops/etag"
import FastExistsCheck from "./ops/fastExistsCheck"
import Copy from "./ops/copy"
import Move from "./ops/move"
import Rename from "./ops/rename"
import Delete from "./ops/delete"
import Create from "./ops/create"
import OpenWriteStream from "./ops/openWriteStream"
import OpenReadStream from "./ops/openReadStream"

export class FileSystem extends WebDAV.FileSystem {
	public readonly sdk: SDK
	public readonly propertyManagers: Record<string, WebDAV.IPropertyManager> = {}
	public readonly lockManagers: Record<string, WebDAV.ILockManager> = {}
	public readonly virtualFiles: Record<string, FSStats> = {}
	private readonly __propertyManager: PropertyManager
	private readonly __lockManager: LockManager
	private readonly __type: Type
	private readonly __readDir: ReadDir
	private readonly __displayName: DisplayName
	private readonly __creationDate: CreationDate
	private readonly __lastModifiedDate: LastModifiedDate
	private readonly __size: Size
	private readonly __mimeType: MimeType
	private readonly __etag: ETag
	private readonly __fastExistsCheck: FastExistsCheck
	private readonly __copy: Copy
	private readonly __move: Move
	private readonly __rename: Rename
	private readonly __delete: Delete
	private readonly __create: Create
	private readonly __openWriteStream: OpenWriteStream
	private readonly __openReadStream: OpenReadStream

	public constructor({ sdk }: { sdk: SDK }) {
		super(new Serializer({ sdk }))

		this.sdk = sdk
		this.__propertyManager = new PropertyManager({ fileSystem: this })
		this.__lockManager = new LockManager({ fileSystem: this })
		this.__type = new Type({ fileSystem: this })
		this.__readDir = new ReadDir({ fileSystem: this })
		this.__displayName = new DisplayName({ fileSystem: this })
		this.__creationDate = new CreationDate({ fileSystem: this })
		this.__lastModifiedDate = new LastModifiedDate({ fileSystem: this })
		this.__size = new Size({ fileSystem: this })
		this.__mimeType = new MimeType({ fileSystem: this })
		this.__etag = new ETag({ fileSystem: this })
		this.__fastExistsCheck = new FastExistsCheck({ fileSystem: this })
		this.__copy = new Copy({ fileSystem: this })
		this.__move = new Move({ fileSystem: this })
		this.__rename = new Rename({ fileSystem: this })
		this.__delete = new Delete({ fileSystem: this })
		this.__create = new Create({ fileSystem: this })
		this.__openWriteStream = new OpenWriteStream({ fileSystem: this })
		this.__openReadStream = new OpenReadStream({ fileSystem: this })
	}

	protected _propertyManager(
		path: WebDAV.Path,
		_ctx: WebDAV.PropertyManagerInfo,
		callback: WebDAV.ReturnCallback<WebDAV.IPropertyManager>
	): void {
		this.__propertyManager.run(path, callback)
	}

	protected _lockManager(path: WebDAV.Path, _ctx: WebDAV.LockManagerInfo, callback: WebDAV.ReturnCallback<WebDAV.ILockManager>): void {
		this.__lockManager.run(path, callback)
	}

	protected _type(path: WebDAV.Path, _ctx: WebDAV.TypeInfo, callback: WebDAV.ReturnCallback<WebDAV.ResourceType>): void {
		this.__type.run(path, callback)
	}

	protected _readDir(path: WebDAV.Path, _ctx: WebDAV.ReadDirInfo, callback: WebDAV.ReturnCallback<string[] | WebDAV.Path[]>): void {
		this.__readDir.run(path, callback)
	}

	protected _displayName(path: WebDAV.Path, _ctx: WebDAV.DisplayNameInfo, callback: WebDAV.ReturnCallback<string>): void {
		this.__displayName.run(path, callback)
	}

	protected _creationDate(path: WebDAV.Path, _ctx: WebDAV.CreationDateInfo, callback: WebDAV.ReturnCallback<number>): void {
		this.__creationDate.run(path, callback)
	}

	protected _lastModifiedDate(path: WebDAV.Path, _ctx: WebDAV.LastModifiedDateInfo, callback: WebDAV.ReturnCallback<number>): void {
		this.__lastModifiedDate.run(path, callback)
	}

	protected _size(path: WebDAV.Path, _ctx: WebDAV.SizeInfo, callback: WebDAV.ReturnCallback<number>): void {
		this.__size.run(path, callback)
	}

	protected _mimeType(path: WebDAV.Path, _ctx: WebDAV.MimeTypeInfo, callback: WebDAV.ReturnCallback<string>): void {
		this.__mimeType.run(path, callback)
	}

	protected _etag(path: WebDAV.Path, _ctx: WebDAV.ETagInfo, callback: WebDAV.ReturnCallback<string>): void {
		this.__etag.run(path, callback)
	}

	protected _fastExistCheck(_ctx: WebDAV.RequestContext, path: WebDAV.Path, callback: (exists: boolean) => void): void {
		this.__fastExistsCheck.run(path, callback)
	}

	protected _copy(pathFrom: WebDAV.Path, pathTo: WebDAV.Path, _ctx: WebDAV.CopyInfo, callback: WebDAV.ReturnCallback<boolean>): void {
		this.__copy.run(pathFrom, pathTo, callback)
	}

	protected _move(pathFrom: WebDAV.Path, pathTo: WebDAV.Path, _ctx: WebDAV.MoveInfo, callback: WebDAV.ReturnCallback<boolean>): void {
		this.__move.run(pathFrom, pathTo, callback)
	}

	protected _rename(pathFrom: WebDAV.Path, newName: string, _ctx: WebDAV.RenameInfo, callback: WebDAV.ReturnCallback<boolean>): void {
		this.__rename.run(pathFrom, newName, callback)
	}

	protected _delete(path: WebDAV.Path, _ctx: WebDAV.DeleteInfo, callback: WebDAV.SimpleCallback): void {
		this.__delete.run(path, callback)
	}

	protected _create(path: WebDAV.Path, ctx: WebDAV.CreateInfo, callback: WebDAV.SimpleCallback): void {
		console.log(ctx.type)
		this.__create.run(path, ctx, callback)
	}

	protected _openWriteStream(path: WebDAV.Path, _ctx: WebDAV.OpenWriteStreamInfo, callback: WebDAV.ReturnCallback<Writable>): void {
		console.log(_ctx.mode)

		this.__openWriteStream.run(path, callback)
	}

	protected _openReadStream(path: WebDAV.Path, _ctx: WebDAV.OpenReadStreamInfo, callback: WebDAV.ReturnCallback<Readable>): void {
		this.__openReadStream.run(path, callback)
	}
}

export default FileSystem
