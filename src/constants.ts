export const CHUNK_SIZE = 1024 * 1024
export const MAX_UPLOAD_THREADS = 16

export const env = {
	isBrowser:
		(typeof window !== "undefined" && typeof window.document !== "undefined") ||
		// @ts-expect-error WorkerEnv's are not typed
		(typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) ||
		// @ts-expect-error WorkerEnv's are not typed
		(typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope),
	isNode: typeof process !== "undefined" && process.versions !== null && process.versions.node !== null,
	isElectron: typeof process.versions["electron"] === "string" && process.versions["electron"].length > 0
} as const

export const IS_BROWSER = env.isBrowser
export const IS_ELECTRON = env.isElectron
export const IS_NODE = env.isNode
export const DISALLOWED_SYNC_DIRS = [
	"C:\\Windows",
	"C:\\Program Files",
	"C:\\Program Files (x86)",
	`C:\\Users\\${process.env.USER ?? "User"}\\AppData\\Local`,
	`C:\\Users\\${process.env.USER ?? "User"}\\AppData\\LocalLow`,
	"C:\\Temp",
	"C:\\Windows\\Temp",
	"/System",
	"/Library",
	"/Applications",
	"/usr",
	"/bin",
	"/sbin",
	// "/var",
	"/tmp",
	"/private",
	`/home/${process.env.USER ?? "User"}/.cache`,
	`/var/home/${process.env.USER ?? "User"}/.cache`
]
