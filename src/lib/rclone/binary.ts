import pathModule from "path"
import fs from "fs-extra"
import { execFile } from "child_process"
import { promisify } from "util"
import extract from "extract-zip"
import isDev from "../../isDev"
import { RCLONE_VERSION, rcloneZipName, rcloneBinaryFileName, rcloneBinDir, rcloneBinaryPath } from "./constants"

const execFileAsync = promisify(execFile)

/**
 * Absolute path to the directory that holds the bundled rclone release zips.
 *
 * Production: `<process.resourcesPath>/rclone` (placed there by electron-builder `extraResources`, per spec §11).
 * Development: the repo's `bin/rclone`, resolved relative to this compiled file (`dist/lib/rclone/binary.js`, three levels
 * below the repo root). The same `..`-walk also resolves correctly when the un-compiled `src/lib/rclone/binary.ts` is run
 * directly via tsx.
 *
 * @export
 * @returns {string}
 */
export function bundledZipDir(): string {
	if (isDev) {
		return pathModule.resolve(__dirname, "..", "..", "..", "bin", "rclone")
	}

	return pathModule.join(process.resourcesPath, "rclone")
}

/**
 * Recursively search `dir` for the first file named exactly `fileName` and return its absolute path, or null if none.
 *
 * Used as a fallback to locate the rclone executable inside an extracted zip when the expected nested path is not present.
 *
 * @async
 * @param {string} dir
 * @param {string} fileName
 * @returns {Promise<string | null>}
 */
async function findFileRecursive(dir: string, fileName: string): Promise<string | null> {
	const entries = await fs.readdir(dir, {
		withFileTypes: true
	})

	for (const entry of entries) {
		const fullPath = pathModule.join(dir, entry.name)

		if (entry.isDirectory()) {
			const found = await findFileRecursive(fullPath, fileName)

			if (found) {
				return found
			}
		} else if (entry.isFile() && entry.name === fileName) {
			return fullPath
		}
	}

	return null
}

/**
 * Run `<binaryPath> version` and return its first output line, trimmed (e.g. "rclone v1.74.3").
 *
 * A liveness/sanity check that the extracted binary actually executes on this OS/arch (catches the macOS `killed: 9`
 * unsigned-binary case, spec R2). Throws a contextual error on spawn failure, non-zero exit, or empty output.
 *
 * @export
 * @async
 * @param {string} binaryPath
 * @returns {Promise<string>}
 */
export async function rcloneVersionOf(binaryPath: string): Promise<string> {
	let stdout: string

	try {
		const result = await execFileAsync(binaryPath, ["version"], {
			timeout: 60000,
			windowsHide: true
		})

		stdout = result.stdout
	} catch (e) {
		throw new Error(`Failed to run "${binaryPath} version": ${e instanceof Error ? e.message : String(e)}`)
	}

	const firstLine = stdout.split(/\r?\n/)[0]

	if (!firstLine || firstLine.trim().length === 0) {
		throw new Error(`Unexpected empty output from "${binaryPath} version".`)
	}

	return firstLine.trim()
}

/**
 * Remove every extracted rclone version directory under `<userData>/rclone/bin` except `keepVersion`.
 *
 * Best-effort: individual removal failures are swallowed so a locked or in-use directory never blocks startup. Strictly
 * scoped to `<userData>/rclone/bin` - legacy binaries and appData dirs elsewhere are never touched (spec D8).
 *
 * @export
 * @async
 * @param {string} userData
 * @param {string} keepVersion
 * @returns {Promise<void>}
 */
export async function pruneOldRcloneVersions(userData: string, keepVersion: string): Promise<void> {
	const binRoot = pathModule.dirname(rcloneBinDir(userData, keepVersion))

	try {
		const entries = await fs.readdir(binRoot, {
			withFileTypes: true
		})

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === keepVersion) {
				continue
			}

			try {
				await fs.rm(pathModule.join(binRoot, entry.name), {
					force: true,
					recursive: true
				})
			} catch {
				// Best-effort: a locked or in-use old version directory must not block startup.
			}
		}
	} catch {
		// Best-effort: the bin directory may not exist yet (first run), which is fine.
	}
}

/**
 * Resolve the bundled rclone binary for the current platform/arch, extracting it on first use, and return its absolute path.
 *
 * Idempotent: if the target already exists it is only re-marked executable (non-Windows) and returned. Otherwise the
 * matching official release zip is located in `zipDir`, extracted into a fresh temp dir, the `rclone`/`rclone.exe` binary is
 * moved into `<userData>/rclone/bin/<version>/`, marked executable (`0o755`, non-Windows), and older extracted versions are
 * pruned (spec §11). The temp dir is always cleaned up, even on failure.
 *
 * @export
 * @async
 * @param {string} userData Absolute Electron `userData` directory.
 * @param {{ zipDir?: string; version?: string }} [options]
 * @param {string} [options.zipDir] Override for the bundled-zip directory (defaults to {@link bundledZipDir}).
 * @param {string} [options.version] Override for the rclone version (defaults to {@link RCLONE_VERSION}).
 * @returns {Promise<string>} Absolute path to the ready-to-run rclone binary.
 */
export async function ensureRcloneBinary(userData: string, options?: { zipDir?: string; version?: string }): Promise<string> {
	const version = options?.version ?? RCLONE_VERSION
	const platform = process.platform
	const target = rcloneBinaryPath(userData, platform, version)

	if (await fs.pathExists(target)) {
		if (platform !== "win32") {
			await fs.chmod(target, 0o755)
		}

		return target
	}

	const zipDir = options?.zipDir ?? bundledZipDir()
	const zipName = rcloneZipName(platform, process.arch, version)
	const zipPath = pathModule.join(zipDir, zipName)

	if (!(await fs.pathExists(zipPath))) {
		throw new Error(`Bundled rclone zip not found: ${zipPath}. The build step must place it there (spec §11).`)
	}

	const tempDir = pathModule.resolve(userData, "rclone", `.extract-${version}`)

	await fs.rm(tempDir, {
		force: true,
		recursive: true
	})

	await fs.ensureDir(tempDir)

	try {
		await extract(zipPath, {
			dir: tempDir
		})

		const binaryFileName = rcloneBinaryFileName(platform)
		// The official zip holds a single top-level folder named exactly like the zip without its extension,
		// e.g. "rclone-v1.74.3-osx-arm64/", containing the binary plus docs.
		const expectedNested = pathModule.join(tempDir, zipName.replace(/\.zip$/i, ""), binaryFileName)
		const binarySource = (await fs.pathExists(expectedNested)) ? expectedNested : await findFileRecursive(tempDir, binaryFileName)

		if (!binarySource) {
			throw new Error(`Could not find "${binaryFileName}" inside the extracted rclone zip: ${zipPath}`)
		}

		await fs.ensureDir(rcloneBinDir(userData, version))

		await fs.move(binarySource, target, {
			overwrite: true
		})

		if (platform !== "win32") {
			await fs.chmod(target, 0o755)
		}
	} finally {
		await fs.rm(tempDir, {
			force: true,
			recursive: true
		})
	}

	await pruneOldRcloneVersions(userData, version)

	return target
}
