import pathModule from "path"

/**
 * Pinned rclone version. The matching official release zip is bundled and extracted at runtime.
 *
 * Pinned; bump to latest stable rclone >= 1.74.1 (CVE-2026-49980 fixed in 1.74.1).
 */
export const RCLONE_VERSION = "1.74.3"

/**
 * VFS cache policy applied uniformly across ALL rclone roles (drive, s3, webdav). Each role runs its own process with
 * its own cache dir, so these are PER-ROLE limits.
 *
 * - VFS_CACHE_MAX_SIZE_GI: hard absolute cap on the on-disk VFS cache per role (the drive's optional user-set size,
 *   once wired to the UI, overrides its own cap). rclone never evicts dirty (not-yet-uploaded) or open files to meet it,
 *   so pending writes are never dropped.
 * - VFS_CACHE_MIN_FREE_SPACE_GI: a disk floor - rclone evicts LRU to keep at least this much free on the volume.
 * - VFS_CACHE_MAX_AGE: cache entries unused for longer than this are evicted.
 * - VFS_DIR_CACHE_TIME: how long a directory listing is cached before re-fetch. Filen has no ChangeNotify (poll-interval
 *   is inherently 0), so this is the ONLY freshness lever - kept short so external/remote changes surface quickly.
 */
export const VFS_CACHE_MAX_SIZE_GI = 32
export const VFS_CACHE_MIN_FREE_SPACE_GI = 16
export const VFS_CACHE_MAX_AGE = "720h"
export const VFS_DIR_CACHE_TIME = "15s"

/**
 * The role a single rclone process fulfills. Each role runs as its own process with its own cache directory and rc port.
 */
export type RcloneRole = "drive" | "s3" | "webdav"

/**
 * Map a Node platform/arch pair to the OS/arch tokens rclone uses in its official release zip names (e.g. darwin/x64 -> osx/amd64).
 * Throws on anything unsupported.
 *
 * @export
 * @param {NodeJS.Platform} platform
 * @param {string} arch
 * @returns {{ os: string; arch: string }}
 */
export function rcloneOsArch(platform: NodeJS.Platform, arch: string): { os: string; arch: string } {
	let os: string

	if (platform === "win32") {
		os = "windows"
	} else if (platform === "darwin") {
		os = "osx"
	} else if (platform === "linux") {
		os = "linux"
	} else {
		throw new Error(`Unsupported platform for rclone: ${platform}`)
	}

	let mappedArch: string

	if (arch === "x64") {
		mappedArch = "amd64"
	} else if (arch === "arm64") {
		mappedArch = "arm64"
	} else {
		throw new Error(`Unsupported architecture for rclone: ${arch}`)
	}

	return {
		os,
		arch: mappedArch
	}
}

/**
 * Build the official rclone release zip name for a platform/arch, e.g. "rclone-v1.74.3-osx-arm64.zip".
 *
 * @export
 * @param {NodeJS.Platform} platform
 * @param {string} arch
 * @param {string} [version=RCLONE_VERSION]
 * @returns {string}
 */
export function rcloneZipName(platform: NodeJS.Platform, arch: string, version: string = RCLONE_VERSION): string {
	const mapped = rcloneOsArch(platform, arch)

	return `rclone-v${version}-${mapped.os}-${mapped.arch}.zip`
}

/**
 * The platform-specific rclone executable file name ("rclone.exe" on Windows, otherwise "rclone").
 *
 * @export
 * @param {NodeJS.Platform} platform
 * @returns {string}
 */
export function rcloneBinaryFileName(platform: NodeJS.Platform): string {
	return platform === "win32" ? "rclone.exe" : "rclone"
}

/**
 * Absolute path to the app-owned rclone config file (INTERNAL auth). Takes the absolute userData dir.
 *
 * @export
 * @param {string} userData
 * @returns {string}
 */
export function rcloneConfigPath(userData: string): string {
	return pathModule.join(userData, "rclone", "rclone.conf")
}

/**
 * Absolute path to the directory the matching rclone binary is extracted into for a given version.
 *
 * @export
 * @param {string} userData
 * @param {string} [version=RCLONE_VERSION]
 * @returns {string}
 */
export function rcloneBinDir(userData: string, version: string = RCLONE_VERSION): string {
	return pathModule.join(userData, "rclone", "bin", version)
}

/**
 * Absolute path to the extracted rclone executable for a given version/platform.
 *
 * @export
 * @param {string} userData
 * @param {NodeJS.Platform} platform
 * @param {string} [version=RCLONE_VERSION]
 * @returns {string}
 */
export function rcloneBinaryPath(userData: string, platform: NodeJS.Platform, version: string = RCLONE_VERSION): string {
	return pathModule.join(rcloneBinDir(userData, version), rcloneBinaryFileName(platform))
}

/**
 * Absolute path to the persistent VFS cache directory for a role. Each role gets its own cache dir; a shared cache on the same remote corrupts.
 *
 * @export
 * @param {string} userData
 * @param {RcloneRole} role
 * @returns {string}
 */
export function rcloneCacheDir(userData: string, role: RcloneRole): string {
	switch (role) {
		case "drive": {
			return pathModule.join(userData, "networkDrive", "cache")
		}

		case "s3": {
			return pathModule.join(userData, "rclone-cache", "s3")
		}

		case "webdav": {
			return pathModule.join(userData, "rclone-cache", "webdav")
		}
	}
}

/**
 * Absolute path to the per-role rclone log file, e.g. "<logsDir>/rclone-drive.log".
 *
 * @export
 * @param {string} logsDir
 * @param {RcloneRole} role
 * @returns {string}
 */
export function rcloneLogPath(logsDir: string, role: RcloneRole): string {
	return pathModule.join(logsDir, `rclone-${role}.log`)
}
