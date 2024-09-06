import type Worker from "./worker"
import { Semaphore } from "../semaphore"
import express, { type Express, type Request, type Response } from "express"
import http, { type IncomingMessage, type ServerResponse } from "http"
import { isPortInUse, parseByteRange } from "../utils"
import FilenSDK, { type FileEncryptionVersion } from "@filen/sdk"
import mimeTypes from "mime-types"
import { Readable, type Duplex } from "stream"
import { type ReadableStream as ReadableStreamWebType } from "stream/web"
import cors from "cors"
import { type Socket } from "net"
import { v4 as uuidv4 } from "uuid"

export class HTTP {
	private worker: Worker
	public server: Express
	public active: boolean = false
	public port: number = 61034
	public stopMutex = new Semaphore(1)
	public startMutex = new Semaphore(1)
	public serverInstance: http.Server<typeof IncomingMessage, typeof ServerResponse> | null = null
	public connections: Record<string, Socket | Duplex> = {}

	public constructor(worker: Worker) {
		this.worker = worker
		this.server = express()
	}

	public async ping(_: Request, res: Response): Promise<void> {
		try {
			res.set("Content-Length", "4")
			res.status(200)

			await new Promise<void>(resolve => {
				res.end("pong", () => {
					resolve()
				})
			})
		} catch (e) {
			this.worker.logger.log("error", e, "http.ping")
			this.worker.logger.log("error", e)

			res.status(500)
			res.set("Content-Length", "0")
			res.end("Internal server error")
		}
	}

	public async stream(sdk: FilenSDK, req: Request, res: Response): Promise<void> {
		try {
			if (!req || !req.query || !req.query.file) {
				throw new Error("Invalid file.")
			}

			const fileBase64 = decodeURIComponent(req.query.file as string)
			const file = JSON.parse(Buffer.from(fileBase64, "base64").toString("utf-8")) as {
				name: string
				mime: string
				size: number
				uuid: string
				bucket: string
				key: string
				version: FileEncryptionVersion
				chunks: number
				region: string
			}
			const mimeType = file.mime.length > 0 ? file.mime : mimeTypes.lookup(file.name) || "application/octet-stream"
			const totalLength = file.size
			const range = req.headers.range || req.headers["content-range"]
			let start = 0
			let end = totalLength - 1

			if (range) {
				const parsedRange = parseByteRange(range, totalLength)

				if (!parsedRange) {
					res.set("Content-Length", "0")
					res.status(400)
					res.end()

					return
				}

				start = parsedRange.start
				end = parsedRange.end

				res.status(206)
				res.set("Content-Range", `bytes ${start}-${end}/${totalLength}`)
				res.set("Content-Length", (end - start + 1).toString())
			} else {
				res.status(200)
				res.set("Content-Length", file.size.toString())
			}

			res.set("Content-Type", mimeType)
			res.set("Accept-Ranges", "bytes")

			const stream = sdk.cloud().downloadFileToReadableStream({
				uuid: file.uuid,
				bucket: file.bucket,
				region: file.region,
				version: file.version,
				key: file.key,
				size: file.size,
				chunks: file.chunks,
				start,
				end
			})

			const nodeStream = Readable.fromWeb(stream as unknown as ReadableStreamWebType<Buffer>)

			const cleanup = () => {
				try {
					stream.cancel().catch(() => {})

					if (!nodeStream.closed && !nodeStream.destroyed) {
						nodeStream.destroy()
					}
				} catch {
					// Noop
				}
			}

			res.once("close", () => {
				cleanup()
			})

			res.once("error", () => {
				cleanup()
			})

			res.once("finish", () => {
				cleanup()
			})

			req.once("close", () => {
				cleanup()
			})

			req.once("error", () => {
				cleanup()
			})

			nodeStream.once("error", err => {
				cleanup()

				this.worker.logger.log("error", err, "http.videoStream")
				this.worker.logger.log("error", err)

				res.status(500)
				res.set("Content-Length", "0")
				res.end("Internal server error")
			})

			nodeStream.pipe(res)
		} catch (e) {
			this.worker.logger.log("error", e, "http.videoStream")
			this.worker.logger.log("error", e)

			res.status(500)
			res.set("Content-Length", "0")
			res.end("Internal server error")
		}
	}

	public async start(): Promise<void> {
		await this.startMutex.acquire()

		try {
			await this.stop()

			const portUsed = await isPortInUse(this.port)

			if (portUsed) {
				throw new Error("Port in use.")
			}

			const sdk = await this.worker.getSDKInstance()

			await new Promise<void>(resolve => {
				this.connections = {}

				this.server.disable("x-powered-by")

				this.server.use(cors())

				this.server.get("/ping", this.ping)
				this.server.get("/stream", (req, res) => this.stream(sdk, req, res))

				this.serverInstance = http
					.createServer(this.server)
					.listen(this.port, "127.0.0.1", () => {
						resolve()
					})
					.on("connection", socket => {
						const socketId = uuidv4()

						this.connections[socketId] = socket

						socket.once("close", () => {
							delete this.connections[socketId]
						})
					})
			})

			this.active = true
		} catch (e) {
			this.worker.logger.log("error", e, "http.start")
			this.worker.logger.log("error", e)

			await this.stop()

			throw e
		} finally {
			this.startMutex.release()
		}
	}

	public async stop(terminate: boolean = true): Promise<void> {
		await this.stopMutex.acquire()

		try {
			await new Promise<void>((resolve, reject) => {
				if (!this.serverInstance) {
					resolve()

					return
				}

				this.serverInstance.close(err => {
					if (err) {
						reject(err)

						return
					}

					resolve()
				})

				if (terminate) {
					for (const socketId in this.connections) {
						try {
							this.connections[socketId]?.destroy()

							delete this.connections[socketId]
						} catch {
							// Noop
						}
					}
				}
			})
		} catch (e) {
			this.worker.logger.log("error", e, "http.stop")
			this.worker.logger.log("error", e)

			throw e
		} finally {
			this.stopMutex.release()
		}
	}
}

export default HTTP
