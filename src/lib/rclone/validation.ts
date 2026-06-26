import net from "net"
import os from "os"
import pathModule from "path"

/**
 * Outcome of a single synchronous config-field validation.
 *
 * `{ valid: true }` on success; otherwise `{ valid: false, error }` where `error` is a clear,
 * user-facing message suitable for surfacing directly in the settings UI.
 *
 * Everything in this module is a pure, synchronous *format* validator (spec §10: trim, reject empty,
 * type-check, range-check). Filesystem/runtime *liveness* checks — is the port actually free and
 * distinct across services, is the drive letter free, is the target directory empty or already
 * mounted, is there enough free disk for the cache — are deliberately out of scope here and live in a
 * separate Phase-2 mount-validation module / runtime checks.
 */
export type ValidationResult = { valid: true } | { valid: false; error: string }

/**
 * DNS-name regex from spec §10. Enforces the 1-253 character total-length cap (via the leading
 * lookahead) and per-label rules: each dot-separated label is 1-63 characters of letters/digits/hyphens
 * and may neither start nor end with a hyphen. Deliberately rejects underscores, spaces and non-ASCII.
 *
 * @type {RegExp}
 */
const DNS_HOSTNAME_REGEX =
	/^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/**
 * Windows drive-letter mount point (spec §10): a single letter D-Z, a colon, and an optional trailing
 * backslash (`D:` or `D:\`). A, B and C are excluded (legacy floppy letters / the system volume).
 *
 * @type {RegExp}
 */
const WINDOWS_DRIVE_LETTER_REGEX = /^[D-Z]:\\?$/

/**
 * s3 access key id: 1-128 ASCII letters/digits. Used verbatim in the SigV4 canonical request, so
 * whitespace and control characters are disallowed. The minimum is 1 (not 16) so the desktop's default
 * `admin` credential keeps working - the server binds to localhost, so a short key is acceptable.
 *
 * @type {RegExp}
 */
const S3_ACCESS_KEY_ID_REGEX = /^[A-Za-z0-9]{1,128}$/

/**
 * s3 secret key: 1-256 characters of letters, digits and the base64 alphabet extras `/`, `+`, `=`. Acts
 * as the HMAC signing key. The minimum is 1 (not 16) so the default `admin` credential keeps working.
 *
 * @type {RegExp}
 */
const S3_SECRET_KEY_REGEX = /^[A-Za-z0-9/+=]{1,256}$/

/**
 * True if `value` contains any ASCII control character (code points 0x00-0x1F or 0x7F), which includes
 * CR and LF. Implemented as a char-code scan rather than a regex on purpose, so no raw control character
 * is embedded in a pattern (avoids eslint `no-control-regex`).
 *
 * @param {string} value
 * @returns {boolean}
 */
function hasControlCharacters(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i)

		if (code <= 0x1f || code === 0x7f) {
			return true
		}
	}

	return false
}

/**
 * Validate an s3/webdav `hostname` (spec §9/§10).
 *
 * Accepts, after trimming: any IP address (`net.isIP() !== 0`, which also covers the `0.0.0.0` and `::`
 * bind-all addresses), the literal `localhost`, or a valid DNS name. The IP-vs-DNS distinction drives
 * the SAN type when generating the self-signed TLS cert (§9), so it must stay strict. Rejects
 * empty/whitespace-only input and anything containing spaces, underscores or other non-DNS characters.
 *
 * @export
 * @param {string} hostname
 * @returns {ValidationResult}
 */
export function validateHostname(hostname: string): ValidationResult {
	const h = hostname.trim()

	if (h.length === 0) {
		return {
			valid: false,
			error: "Hostname cannot be empty."
		}
	}

	if (net.isIP(h) !== 0 || h === "localhost" || DNS_HOSTNAME_REGEX.test(h)) {
		return {
			valid: true
		}
	}

	return {
		valid: false,
		error: "Hostname must be a valid IP address, 'localhost', or a valid DNS name (letters, digits, hyphens and dots only, with no spaces or underscores)."
	}
}

/**
 * Validate an s3/webdav/network-drive `port` (spec §10): a whole number in the range 1024-65535.
 *
 * Format only — whether the port is actually free (`isPortInUse`) and distinct across enabled services
 * is checked at runtime elsewhere, not here.
 *
 * @export
 * @param {number} port
 * @returns {ValidationResult}
 */
export function validatePort(port: number): ValidationResult {
	if (!Number.isInteger(port)) {
		return {
			valid: false,
			error: "Port must be a whole number."
		}
	}

	if (port < 1024 || port > 65535) {
		return {
			valid: false,
			error: "Port must be between 1024 and 65535."
		}
	}

	return {
		valid: true
	}
}

/**
 * Validate an s3 `accessKeyId`: 1-128 characters of letters and digits only.
 *
 * @export
 * @param {string} v
 * @returns {ValidationResult}
 */
export function validateS3AccessKeyId(v: string): ValidationResult {
	if (!S3_ACCESS_KEY_ID_REGEX.test(v)) {
		return {
			valid: false,
			error: "Access key ID must be 1 to 128 characters long and may contain only letters and digits."
		}
	}

	return {
		valid: true
	}
}

/**
 * Validate an s3 `secretKeyId`: 1-256 characters of letters, digits and the characters `/`, `+`, `=`.
 *
 * @export
 * @param {string} v
 * @returns {ValidationResult}
 */
export function validateS3SecretKey(v: string): ValidationResult {
	if (!S3_SECRET_KEY_REGEX.test(v)) {
		return {
			valid: false,
			error: "Secret key must be 1 to 256 characters long and may contain only letters, digits and the characters / + =."
		}
	}

	return {
		valid: true
	}
}

/**
 * Validate a webdav `username` (spec §10): non-empty, at most 255 characters, no control characters or
 * line breaks (CR/LF) and no colon. The colon is forbidden because it is the `user:pass` separator in
 * HTTP Basic auth.
 *
 * @export
 * @param {string} v
 * @returns {ValidationResult}
 */
export function validateWebdavUsername(v: string): ValidationResult {
	if (v.length === 0) {
		return {
			valid: false,
			error: "WebDAV username cannot be empty."
		}
	}

	if (v.length > 255) {
		return {
			valid: false,
			error: "WebDAV username must be at most 255 characters long."
		}
	}

	if (hasControlCharacters(v)) {
		return {
			valid: false,
			error: "WebDAV username must not contain control characters or line breaks."
		}
	}

	if (v.includes(":")) {
		return {
			valid: false,
			error: "WebDAV username must not contain a colon (':')."
		}
	}

	return {
		valid: true
	}
}

/**
 * Validate a webdav `password` (spec §10): non-empty, at most 1024 characters, no control characters or
 * line breaks (CR/LF). Unlike the username, a colon is allowed (it only ambiguates the username half of
 * `user:pass`).
 *
 * @export
 * @param {string} v
 * @returns {ValidationResult}
 */
export function validateWebdavPassword(v: string): ValidationResult {
	if (v.length === 0) {
		return {
			valid: false,
			error: "WebDAV password cannot be empty."
		}
	}

	if (v.length > 1024) {
		return {
			valid: false,
			error: "WebDAV password must be at most 1024 characters long."
		}
	}

	if (hasControlCharacters(v)) {
		return {
			valid: false,
			error: "WebDAV password must not contain control characters or line breaks."
		}
	}

	return {
		valid: true
	}
}

/**
 * Validate the *format* of a network-drive `mountPoint` for the given platform.
 *
 * - Windows: a single drive letter D-Z with an optional trailing backslash (`D:` or `D:\`); A, B and C
 *   are excluded. A directory path is rejected because the WinFSP network mode mounts to a drive letter
 *   (spec §6.2/§10).
 * - Unix (darwin/linux and other POSIX): an absolute path located under the user's home directory, i.e.
 *   starting with `os.homedir() + path.sep`. Mounting directly at the home directory itself is rejected.
 *
 * Format only. Liveness — whether the drive letter is actually free, whether the target directory
 * exists / is empty, and whether something is already mounted there — is validated separately by the
 * Phase-2 mount-validation module (spec §7.4), since it requires filesystem and mount-table access.
 *
 * @export
 * @param {string} mountPoint
 * @param {NodeJS.Platform} platform
 * @returns {ValidationResult}
 */
export function validateMountPointFormat(mountPoint: string, platform: NodeJS.Platform): ValidationResult {
	if (platform === "win32") {
		if (!WINDOWS_DRIVE_LETTER_REGEX.test(mountPoint)) {
			return {
				valid: false,
				error: "Mount point must be a free drive letter from D: to Z: (for example 'D:' or 'Z:'). The letters A, B and C are reserved."
			}
		}

		return {
			valid: true
		}
	}

	if (!pathModule.isAbsolute(mountPoint)) {
		return {
			valid: false,
			error: "Mount point must be an absolute path."
		}
	}

	const home = os.homedir()

	if (!mountPoint.startsWith(home + pathModule.sep)) {
		return {
			valid: false,
			error: `Mount point must be located inside your home directory (${home}).`
		}
	}

	return {
		valid: true
	}
}

/**
 * Validate a network-drive `cacheSizeInGi` (spec §10): a finite, whole number of at least 1 GiB.
 *
 * Accepts any value that is an integer (`Number.isInteger`, equivalently `Math.floor(n) === n` once
 * finite). Free-disk headroom — keeping the cache at most ~90% of the cache volume's free space — is a
 * runtime concern checked elsewhere, not here, because available disk space is not known to this pure
 * validator.
 *
 * @export
 * @param {number} n
 * @returns {ValidationResult}
 */
export function validateCacheSizeInGi(n: number): ValidationResult {
	if (!Number.isFinite(n)) {
		return {
			valid: false,
			error: "Cache size must be a valid number."
		}
	}

	if (n < 1) {
		return {
			valid: false,
			error: "Cache size must be at least 1 GiB."
		}
	}

	if (!Number.isInteger(n) && Math.floor(n) !== n) {
		return {
			valid: false,
			error: "Cache size must be a whole number of GiB."
		}
	}

	return {
		valid: true
	}
}
