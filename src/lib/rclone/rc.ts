import axios, { type AxiosRequestConfig } from "axios"

/**
 * Shape of the rclone rc `core/stats` response. Every field is optional because the payload mirrors rclone's raw JSON,
 * which varies by rclone version and by whether any transfer is currently active.
 *
 * @export
 * @interface RcCoreStats
 * @typedef {RcCoreStats}
 */
export interface RcCoreStats {
	bytes?: number
	speed?: number
	transfers?: number
	errors?: number
	checks?: number
	deletes?: number
	elapsedTime?: number
	eta?: number | null
	fatalError?: boolean
	retryError?: boolean
	totalBytes?: number
	totalChecks?: number
	totalTransfers?: number
	transferTime?: number
	transferring?: {
		name?: string
		size?: number
		speed?: number
	}[]
}

/**
 * Shape of the rclone rc `vfs/stats` response. Every field is optional because the payload mirrors rclone's raw JSON.
 * `diskCache` carries the write-back queue counters used to gauge pending uploads before a clean shutdown.
 *
 * @export
 * @interface RcVfsStats
 * @typedef {RcVfsStats}
 */
export interface RcVfsStats {
	diskCache?: {
		uploadsInProgress?: number
		uploadsQueued?: number
		erroredFiles?: number
		bytesUsed?: number
		files?: number
	}
	fs?: string
	inUse?: number
}

/**
 * Minimal rclone Remote Control (rc) HTTP client. Talks to a single rclone process' `--rc-addr` endpoint on loopback
 * (`http://127.0.0.1:<port>`) to read transfer/VFS stats and to request a clean shutdown.
 *
 * @export
 * @class RcClient
 * @typedef {RcClient}
 */
export class RcClient {
	private readonly baseUrl: string
	private readonly user?: string
	private readonly pass?: string

	/**
	 * Creates an instance of RcClient.
	 *
	 * @constructor
	 * @param {{ port: number; user?: string; pass?: string }} param0
	 * @param {number} param0.port rc port the target rclone process listens on (its `--rc-addr` port).
	 * @param {string} [param0.user] Optional rc Basic-auth username (only sent when both user and pass are set).
	 * @param {string} [param0.pass] Optional rc Basic-auth password (only sent when both user and pass are set).
	 */
	public constructor({ port, user, pass }: { port: number; user?: string; pass?: string }) {
		this.baseUrl = `http://127.0.0.1:${port}`
		this.user = user
		this.pass = pass
	}

	/**
	 * POST a JSON body to an rc endpoint and return the parsed JSON response.
	 *
	 * Uses a 5s timeout and `Content-Type: application/json`. HTTP Basic auth is attached only when both `user` and
	 * `pass` were provided to the constructor. Rejects on any non-2xx status (axios default).
	 *
	 * @public
	 * @async
	 * @template T
	 * @param {string} endpoint rc endpoint path without a leading slash, e.g. `"core/stats"`.
	 * @param {Record<string, unknown>} [body={}] Optional JSON arguments for the rc call.
	 * @returns {Promise<T>}
	 */
	public async post<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
		const config: AxiosRequestConfig = {
			timeout: 5000,
			responseType: "json",
			headers: {
				"Content-Type": "application/json"
			}
		}

		if (this.user && this.pass) {
			config.auth = {
				username: this.user,
				password: this.pass
			}
		}

		const response = await axios.post(`${this.baseUrl}/${endpoint}`, body, config)

		return response.data as T
	}

	/**
	 * Fetch global transfer statistics via the rc `core/stats` endpoint.
	 *
	 * @public
	 * @async
	 * @returns {Promise<RcCoreStats>}
	 */
	public async coreStats(): Promise<RcCoreStats> {
		return await this.post<RcCoreStats>("core/stats")
	}

	/**
	 * Fetch VFS statistics (including the write-back disk cache counters) via the rc `vfs/stats` endpoint.
	 *
	 * The `fs` argument selects which mounted remote to report on; it is accepted by current rclone but may be ignored
	 * by older rc builds, which simply report the only/active VFS.
	 *
	 * @public
	 * @async
	 * @returns {Promise<RcVfsStats>}
	 */
	public async vfsStats(): Promise<RcVfsStats> {
		return await this.post<RcVfsStats>("vfs/stats", { fs: "Filen:" })
	}

	/**
	 * Best-effort clean shutdown via the rc `core/quit` endpoint. rclone flushes write-back, unmounts and exits, so the
	 * connection is commonly dropped mid-response - any resulting error is swallowed since the process is terminating.
	 *
	 * @public
	 * @async
	 * @returns {Promise<void>}
	 */
	public async coreQuit(): Promise<void> {
		try {
			await this.post<unknown>("core/quit")
		} catch {
			// Best-effort: rclone tears down the rc listener as it exits, so a dropped or failed request here is expected.
		}
	}
}
