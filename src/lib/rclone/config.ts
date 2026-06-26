import crypto from "crypto"
import pathModule from "path"
import fs from "fs-extra"
import writeFileAtomic from "write-file-atomic"
import { type FilenSDKConfig } from "@filen/sdk"

/**
 * rclone's fixed 32-byte AES-256 key used by `obscure`/`Reveal`.
 *
 * Copied byte-for-byte from rclone's source so our obscured values decode identically inside the
 * bundled binary. If a single byte is wrong, rclone cannot `Reveal` the value and INTERNAL-mode auth
 * silently fails.
 *
 * Verified against (v1.74.3, the pinned/bundled rclone version):
 * https://raw.githubusercontent.com/rclone/rclone/v1.74.3/fs/config/obscure/obscure.go
 */
const CRYPT_KEY = Buffer.from([
	0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d, 0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b, 0xd3, 0x90, 0x19, 0x8e, 0xb8, 0x12,
	0x8a, 0xfb, 0xf4, 0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38
])

/**
 * Faithful JS reimplementation of rclone's `obscure` (fs/config/obscure/obscure.go).
 *
 * Encrypts `value` with AES-256-CTR under rclone's fixed {@link CRYPT_KEY}, prepends a random 16-byte
 * IV, and returns `base64-RawURLEncoding(IV || ciphertext)`. rclone's `Reveal` reverses this exactly,
 * so the output is what the bundled binary needs for an obscured config field.
 *
 * The IV is random per call, so the same input yields different (but equally valid) output every time
 * — fine, since the config is regenerated on demand.
 *
 * Node's "base64url" encoding is RFC 4648 §5 URL-safe base64 with NO padding, matching Go's
 * `base64.RawURLEncoding`.
 *
 * @export
 * @param {string} value
 * @returns {string}
 */
export function obscure(value: string): string {
	const iv = crypto.randomBytes(16)
	const cipher = crypto.createCipheriv("aes-256-ctr", CRYPT_KEY, iv)
	const ciphertext = Buffer.concat([cipher.update(Buffer.from(value, "utf8")), cipher.final()])

	return Buffer.concat([iv, ciphertext]).toString("base64url")
}

/**
 * Build the `[Filen]` rclone remote config text for INTERNAL-mode auth.
 *
 * INTERNAL mode lets rclone's native Filen backend construct its SDK purely from the desktop's
 * already-derived key material — no network login, no raw password. The backend keys off the sentinel
 * `password === "INTERNAL"` (after `Reveal`) and reads the remaining fields directly (see spec §5 /
 * backend/filen/filen.go).
 *
 * Format rules (spec §5.1): `password` and `api_key` are obscured because the backend marks them
 * `IsPassword` and `Reveal`s them; every other field is written raw. `master_keys` is pipe-joined — for
 * auth v3 the array holds the single DEK string as its only element, so the join still yields exactly
 * that value (Phase-0 spike confirms the JS SDK's key material serializes byte-identically to what
 * filen-sdk-go's `NewFromTSConfig` expects). `auth_version` must be non-zero (rclone errors on 0).
 *
 * Throws a clear Error naming the first missing/empty required field.
 *
 * @export
 * @param {FilenSDKConfig} sdkConfig
 * @returns {string}
 */
export function generateRcloneConfig(sdkConfig: FilenSDKConfig): string {
	const { email, apiKey, masterKeys, authVersion, baseFolderUUID, privateKey, publicKey } = sdkConfig

	if (!email) {
		throw new Error("Cannot generate rclone config: missing email.")
	}

	if (!apiKey) {
		throw new Error("Cannot generate rclone config: missing apiKey.")
	}

	if (!masterKeys || masterKeys.length === 0) {
		throw new Error("Cannot generate rclone config: missing masterKeys.")
	}

	if (!authVersion) {
		throw new Error("Cannot generate rclone config: missing authVersion.")
	}

	if (!baseFolderUUID) {
		throw new Error("Cannot generate rclone config: missing baseFolderUUID.")
	}

	if (!privateKey) {
		throw new Error("Cannot generate rclone config: missing privateKey.")
	}

	if (!publicKey) {
		throw new Error("Cannot generate rclone config: missing publicKey.")
	}

	// password = obscure("INTERNAL") and api_key = obscure(apiKey) are obscured; the rest are raw.
	return [
		"[Filen]",
		"type = filen",
		`email = ${email}`,
		`password = ${obscure("INTERNAL")}`,
		`api_key = ${obscure(apiKey)}`,
		`master_keys = ${masterKeys.join("|")}`,
		`private_key = ${privateKey}`,
		`public_key = ${publicKey}`,
		`auth_version = ${String(authVersion)}`,
		`base_folder_uuid = ${baseFolderUUID}`,
		""
	].join("\n")
}

/**
 * Generate the INTERNAL-mode rclone config from `sdkConfig` and write it to `configPath`, ensuring the
 * parent directory exists first.
 *
 * Written atomically with mode `0o600` — the file may contain master keys, so it must not be
 * world/group readable.
 *
 * @export
 * @async
 * @param {string} configPath
 * @param {FilenSDKConfig} sdkConfig
 * @returns {Promise<void>}
 */
export async function writeRcloneConfig(configPath: string, sdkConfig: FilenSDKConfig): Promise<void> {
	const config = generateRcloneConfig(sdkConfig)

	await fs.ensureDir(pathModule.dirname(configPath))

	await writeFileAtomic(configPath, config, {
		mode: 0o600
	})
}

/**
 * Remove the rclone config file (used on logout). No-op if the file is already absent; never throws on
 * absence (`force: true`).
 *
 * @export
 * @async
 * @param {string} configPath
 * @returns {Promise<void>}
 */
export async function deleteRcloneConfig(configPath: string): Promise<void> {
	await fs.rm(configPath, {
		force: true,
		maxRetries: 60 * 10,
		recursive: false,
		retryDelay: 100
	})
}
