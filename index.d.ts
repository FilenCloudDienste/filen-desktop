/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "@gcas/fuse" {
	// Imported from @gcas/fuse, their module exported them wrong
	// Stats object produced by fuse index.js function getStatArray

	export interface Stats {
		mode: number
		uid: number
		gid: number
		size: number
		dev: number
		nlink: number
		ino: number
		rdev: number
		blksize: number
		blocks: number
		atime: Date
		mtime: Date
		ctime: Date
	}

	export interface OPERATIONS {
		init?: (cb: (err: number) => void) => void
		error?: (cb: (err: number) => void) => void
		access?: (path: string, mode: number, cb: (err: number) => void) => void
		statfs?: (
			path: string,
			cb: (
				err: number,
				stats?: {
					bsize: number
					frsize: number
					blocks: number
					bfree: number
					bavail: number
					files: number
					ffree: number
					favail: number
					fsid: number
					flag: number
					namemax: number
				}
			) => void
		) => void
		fgetattr?: (path: string, fd: number, cb: (err: number, stat?: Stats) => void) => void
		getattr?: (path: string, cb: (err: number, stat?: Stats) => void) => void
		flush?: (path: string, fd: number, cb: (err: number) => void) => void
		fsync?: (path: string, dataSync: boolean, fd: number, cb: (err: number) => void) => void
		fsyncdir?: (path: string, dataSync: boolean, fd: number, cb: (err: number) => void) => void
		readdir?: (path: string, cb: (err: number, names?: string[], stats?: Stats[]) => void) => void
		truncate?: (path: string, size: number, cb: (err: number) => void) => void
		ftruncate?: (path: string, fd: number, size: number, cb: (err: number) => void) => void
		utimens?: (path: string, atime: Date, mtime: Date, cb: (err: number) => void) => void
		readlink?: (path: string, cb: (err: number, linkName?: string) => void) => void
		chown?: (path: string, uid: number, gid: number, cb: (err: number) => void) => void
		chmod?: (path: string, mode: number, cb: (err: number) => void) => void
		mknod?: (path: string, mode: number, dev: number, cb: (err: number) => void) => void
		setxattr?: (path: string, name: string, value: Buffer, size: number, flags: number, cb: (err: number) => void) => void
		getxattr?: (path: string, name: string, size: number, cb: (err: number) => void) => void
		listxattr?: (path: string, cb: (err: number, list?: string[]) => void) => void
		removexattr?: (path: string, name: string, cb: (err: number) => void) => void
		open?: (path: string, mode: number, cb: (err: number, fd?: number) => void) => void
		opendir?: (path: string, mode: number, cb: (err: number, fd?: number) => void) => void
		read?: (
			path: string,
			fd: number,
			buffer: Buffer,
			length: number,
			position: number,
			// This contradicts the code in index.js for _op_read, where the callback signature is (err, bytesRead)
			// however, it appears that the calling code indeed interprets the "err" position as the value.
			cb: (bytesRead?: number) => void
		) => void
		write?: (
			path: string,
			fd: number,
			buffer: Buffer,
			length: number,
			position: number,
			// This contradicts the code in index.js for _op_write, where the callback signature is (err, bytesWritten)
			// however, it appears that the calling code indeed interprets the "err" position as the value.
			cb: (bytesWritten?: number) => void
		) => void
		// For every open() call there will be exactly one release() call with the same flags and
		// file handle. It is possible to have a file opened more than once, in which case only the
		// last release will mean, that no more reads/writes will happen on the file. The return
		// value of release is ignored.
		release?: (path: string, fd: number, cb: (err: number) => void) => void
		releasedir?: (path: string, fd: number, cb: (err: number) => void) => void
		create?: (path: string, mode: number, cb: (err: number, fd?: number, modePassedOn?: number) => void) => void
		unlink?: (path: string, cb: (err: number) => void) => void
		rename?: (src: string, dest: string, cb: (err: number) => void) => void
		link?: (src: string, dest: string, cb: (err: number) => void) => void
		symlink?: (src: string, dest: string, cb: (err: number) => void) => void
		mkdir?: (path: string, mode: number, cb: (err: number) => void) => void
		rmdir?: (path: string, cb: (err: number) => void) => void
	}

	// See https://github.com/gcasro/fuse
	// See https://man7.org/linux/man-pages/man8/mount.fuse3.8.html
	export interface OPTIONS {
		uid?: number
		gid?: number
		debug?: boolean
		force?: boolean
		timeout?: number
		allowOther?: boolean
		allowRoot?: boolean
		autoUnmount?: boolean
		defaultPermissions?: string
		blkdev?: string
		blksize?: number
		maxRead?: number
		fd?: number
		userId?: number
		fsname?: string
		subtype?: string
		kernelCache?: boolean
		autoCache?: boolean
		umask?: number
		entryTimeout?: number
		attrTimeout?: number
		acAttrTimeout?: number
		noforget?: boolean
		remember?: number
		modules?: string
		volname?: string
		volicon?: string | boolean
		displayFolder?: boolean
	}

	export default class Fuse {
		constructor(mnt: string, ops?: OPERATIONS, opts?: OPTIONS)

		// Added by @gcas/fuse
		static unmount: (mnt: string, cb: (err: null | Error) => void) => any
		static beforeMount: (cb: (err: null | Error) => any) => void
		static beforeUnmount: (cb: (err: null | Error) => any) => void
		static configure: (cb: (err: null | Error) => any) => void
		static unconfigure: (cb: (err: null | Error) => any) => void
		static isConfigured: (cb: (err: null | Error, result: boolean) => any) => void

		// Error codes - numeric value retrieved from Fuse instance with errno(code)
		static EPERM: -1
		static ENOENT: -2
		static ESRCH: -3
		static EINTR: -4
		static EIO: -5
		static ENXIO: -6
		static E2BIG: -7
		static ENOEXEC: -8
		static EBADF: -9
		static ECHILD: -10
		static EAGAIN: -11
		static ENOMEM: -12
		static EACCES: -13
		static EFAULT: -14
		static ENOTBLK: -15
		static EBUSY: -16
		static EEXIST: -17
		static EXDEV: -18
		static ENODEV: -19
		static ENOTDIR: -20
		static EISDIR: -21
		static EINVAL: -22
		static ENFILE: -23
		static EMFILE: -24
		static ENOTTY: -25
		static ETXTBSY: -26
		static EFBIG: -27
		static ENOSPC: -28
		static ESPIPE: -29
		static EROFS: -30
		static EMLINK: -31
		static EPIPE: -32
		static EDOM: -33
		static ERANGE: -34
		static EDEADLK: -35
		static ENAMETOOLONG: -36
		static ENOLCK: -37
		static ENOSYS: -38
		static ENOTEMPTY: -39
		static ELOOP: -40
		static EWOULDBLOCK: -11
		static ENOMSG: -42
		static EIDRM: -43
		static ECHRNG: -44
		static EL2NSYNC: -45
		static EL3HLT: -46
		static EL3RST: -47
		static ELNRNG: -48
		static EUNATCH: -49
		static ENOCSI: -50
		static EL2HLT: -51
		static EBADE: -52
		static EBADR: -53
		static EXFULL: -54
		static ENOANO: -55
		static EBADRQC: -56
		static EBADSLT: -57
		static EDEADLOCK: -35
		static EBFONT: -59
		static ENOSTR: -60
		static ENODATA: -61
		static ETIME: -62
		static ENOSR: -63
		static ENONET: -64
		static ENOPKG: -65
		static EREMOTE: -66
		static ENOLINK: -67
		static EADV: -68
		static ESRMNT: -69
		static ECOMM: -70
		static EPROTO: -71
		static EMULTIHOP: -72
		static EDOTDOT: -73
		static EBADMSG: -74
		static EOVERFLOW: -75
		static ENOTUNIQ: -76
		static EBADFD: -77
		static EREMCHG: -78
		static ELIBACC: -79
		static ELIBBAD: -80
		static ELIBSCN: -81
		static ELIBMAX: -82
		static ELIBEXEC: -83
		static EILSEQ: -84
		static ERESTART: -85
		static ESTRPIPE: -86
		static EUSERS: -87
		static ENOTSOCK: -88
		static EDESTADDRREQ: -89
		static EMSGSIZE: -90
		static EPROTOTYPE: -91
		static ENOPROTOOPT: -92
		static EPROTONOSUPPORT: -93
		static ESOCKTNOSUPPORT: -94
		static EOPNOTSUPP: -95
		static EPFNOSUPPORT: -96
		static EAFNOSUPPORT: -97
		static EADDRINUSE: -98
		static EADDRNOTAVAIL: -99
		static ENETDOWN: -100
		static ENETUNREACH: -101
		static ENETRESET: -102
		static ECONNABORTED: -103
		static ECONNRESET: -104
		static ENOBUFS: -105
		static EISCONN: -106
		static ENOTCONN: -107
		static ESHUTDOWN: -108
		static ETOOMANYREFS: -109
		static ETIMEDOUT: -110
		static ECONNREFUSED: -111
		static EHOSTDOWN: -112
		static EHOSTUNREACH: -113
		static EALREADY: -114
		static EINPROGRESS: -115
		static ESTALE: -116
		static EUCLEAN: -117
		static ENOTNAM: -118
		static ENAVAIL: -119
		static EISNAM: -120
		static EREMOTEIO: -121
		static EDQUOT: -122
		static ENOMEDIUM: -123
		static EMEDIUMTYPE: -124

		public opts: OPTIONS
		public mnt: string
		public ops: OPERATIONS
		public timeout: number

		public mount: (cb: (err: null | Error) => any) => void
		public unmount: (cb: (err: null | Error) => any) => void
		public errno: (code?: string) => number

		// From "nanoresource"
		// See https://github.com/mafintosh/nanoresource/blob/master/index.js
		public opening: boolean
		public opened: boolean
		public closing: boolean
		public closed: boolean
		public actives: number

		public open(cb: (err: Error) => any): void

		public active(cb?: (err: Error) => any): boolean

		public inactive(): void
		public inactive(cb: (err: Error, val: any) => any, err: null, val: any): void
		public inactive(cb: (err: Error, val: any) => any, err: Error): void

		public close(cb?: (err?: Error) => any): void
		public close(allowActive: boolean, cb: (err?: Error) => any): void
	}
}
