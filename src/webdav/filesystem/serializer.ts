import * as WebDAV from "@filen/webdav-server"
import FileSystem from "."
import type Resource from "./resource"
import type SDK from "@filen/sdk"

export type FileSystemSerializedData = {
	path: string
	resources: {
		[path: string]: Resource
	}
}

export class Serializer implements WebDAV.FileSystemSerializer {
	private readonly sdk: SDK

	public constructor({ sdk }: { sdk: SDK }) {
		this.sdk = sdk
	}

	public uid(): string {
		return "Serializer-1.0.0"
	}

	public serialize(fs: FileSystem, callback: WebDAV.ReturnCallback<FileSystemSerializedData>): void {
		callback(undefined, {
			path: "",
			resources: {}
		})
	}

	public unserialize(serializedData: FileSystemSerializedData, callback: WebDAV.ReturnCallback<FileSystem>): void {
		const fs = new FileSystem({ sdk: this.sdk })

		fs.setSerializer(this)

		callback(undefined, fs)
	}
}

export default Serializer
