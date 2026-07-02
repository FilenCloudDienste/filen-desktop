import pathModule from "path"
import os from "os"
import fs from "fs-extra"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

/**
 * Result of a detection/install probe. We always decide on {@link ProbeResult.code} (the process exit code) and NEVER on a
 * non-empty stderr — the old `@filen/network-drive` `execCommand` rejected on any stderr output, which produced false
 * negatives (e.g. tools that print harmless warnings to stderr). `code` is `null` when the command could not be spawned
 * at all (e.g. the binary is missing → ENOENT) or was killed (timeout).
 *
 * @typedef {ProbeResult}
 */
interface ProbeResult {
	code: number | null
	stdout: string
	stderr: string
}

/**
 * Shape of the error `promisify(execFile)` rejects with. On a non-zero exit `code` is the numeric exit code; on a spawn
 * failure (ENOENT, EACCES, …) it is the string error code instead, in which case we treat it as "could not run".
 *
 * @typedef {ExecFileFailure}
 */
interface ExecFileFailure {
	code?: number | string | null
	stdout?: string | Buffer
	stderr?: string | Buffer
}

/**
 * Coerce a child-process stdout/stderr value (string, Buffer or undefined) into a plain string.
 *
 * @param {(string | Buffer | undefined)} value
 * @returns {string}
 */
function decodeStdio(value: string | Buffer | undefined): string {
	if (typeof value === "string") {
		return value
	}

	if (Buffer.isBuffer(value)) {
		return value.toString("utf-8")
	}

	return ""
}

/**
 * Run a command via `execFile` (no shell, argv array) and resolve `{ code, stdout, stderr }` WITHOUT throwing on a
 * non-zero exit, a non-empty stderr or a spawn failure. This is the single cross-cutting fix from spec §8: every probe
 * decides on the exit code, never on stderr.
 *
 * @async
 * @param {string} file
 * @param {string[]} args
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<ProbeResult>}
 */
async function runProbe(file: string, args: string[], timeoutMs: number = 15000): Promise<ProbeResult> {
	try {
		const result = await execFileAsync(file, args, {
			timeout: timeoutMs,
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024
		})

		return {
			code: 0,
			stdout: decodeStdio(result.stdout),
			stderr: decodeStdio(result.stderr)
		}
	} catch (e) {
		const err = e as ExecFileFailure

		return {
			code: typeof err.code === "number" ? err.code : null,
			stdout: decodeStdio(err.stdout),
			stderr: decodeStdio(err.stderr)
		}
	}
}

/**
 * Resolve after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * The WinFSP runtime DLL name cgofuse dlopens for a given Node `process.arch` (x64 → x64, arm64 → a64, ia32 → x86). The
 * old code hardcoded `winfsp-x64.dll`, so detection ALWAYS failed on Windows ARM64 (which ships `winfsp-a64.dll`).
 *
 * @param {string} arch
 * @returns {string}
 */
function winfspDllName(arch: string): string {
	switch (arch) {
		case "arm64": {
			return "winfsp-a64.dll"
		}

		case "ia32": {
			return "winfsp-x86.dll"
		}

		default: {
			return "winfsp-x64.dll"
		}
	}
}

/**
 * Parse the `InstallDir` REG_SZ value out of `reg query` stdout. The value may contain spaces, so we capture the rest of
 * the line after the `REG_SZ` type token.
 *
 * @param {string} stdout
 * @returns {(string | null)}
 */
function parseRegInstallDir(stdout: string): string | null {
	for (const line of stdout.split(/\r?\n/)) {
		const match = line.match(/InstallDir\s+REG_SZ\s+(.+)$/i)

		if (match && match[1]) {
			const value = match[1].trim()

			if (value.length > 0) {
				return value
			}
		}
	}

	return null
}

/**
 * Whether `binDir` contains any `winfsp-*.dll` (the registry-less fallback presence check).
 *
 * @async
 * @param {string} binDir
 * @returns {Promise<boolean>}
 */
async function dirHasWinFSPDll(binDir: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(binDir)

		return entries.some(name => /^winfsp-.*\.dll$/i.test(name))
	} catch {
		return false
	}
}

/**
 * Whether the given `/etc/hosts` contents already map `Filen` to `127.0.0.1` on a non-comment line. Mirrors the grep ERE
 * the FUSE-T installer uses, so the JS check and the shell append stay consistent (idempotency).
 *
 * @param {string} contents
 * @returns {boolean}
 */
function hostsHasFilenEntry(contents: string): boolean {
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim()

		if (line.length === 0 || line.startsWith("#")) {
			continue
		}

		if (/^127\.0\.0\.1\s+.*\bFilen\b/.test(line)) {
			return true
		}
	}

	return false
}

/**
 * Escape a value for embedding inside an AppleScript double-quoted string literal (backslashes first, then quotes).
 *
 * @param {string} value
 * @returns {string}
 */
function appleScriptQuote(value: string): string {
	// String.fromCharCode(34) is the double-quote character. Building it this way keeps every string literal in this file
	// double-quoted (eslint quotes:double) while avoiding an escaped quote that Prettier would otherwise flip to single quotes.
	const quote = String.fromCharCode(34)

	return quote + value.replace(/\\/g, "\\\\").replace(/"/g, "\\" + quote) + quote
}

/**
 * Single-quote a value for a POSIX `/bin/sh` command (the `'\''` idiom for embedded single quotes).
 *
 * @param {string} value
 * @returns {string}
 */
function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * Detect WinFSP on Windows, mirroring how rclone's cgofuse layer finds it so detect() and the actual mount never disagree.
 *
 * Primary: read `HKLM\SOFTWARE\WinFsp` `InstallDir` from BOTH the 64-bit and 32-bit registry views (`/reg:64` and
 * `/reg:32`), parse the REG_SZ value, then verify `<InstallDir>\bin\winfsp-{x64|a64|x86}.dll` chosen by `process.arch`.
 * Fallback: glob `winfsp-*.dll` under the well-known `Program Files (x86)` / `%ProgramFiles%` bin directories. Returns
 * false on any non-Windows platform. (Fixes the old ARM64 miss + the stderr-rejection false negatives.)
 *
 * @export
 * @async
 * @returns {Promise<boolean>}
 */
export async function isWinFSPInstalled(): Promise<boolean> {
	if (process.platform !== "win32") {
		return false
	}

	const dllName = winfspDllName(process.arch)

	for (const view of ["/reg:64", "/reg:32"]) {
		const result = await runProbe("reg", ["query", "HKLM\\SOFTWARE\\WinFsp", "/v", "InstallDir", view])

		if (result.code !== 0) {
			continue
		}

		const installDir = parseRegInstallDir(result.stdout)

		if (!installDir) {
			continue
		}

		if (await fs.pathExists(pathModule.join(installDir, "bin", dllName))) {
			return true
		}
	}

	const fallbackBinDirs = [
		pathModule.join("C:\\Program Files (x86)", "WinFsp", "bin"),
		pathModule.join(process.env.ProgramFiles ?? "C:\\Program Files", "WinFsp", "bin")
	]

	for (const binDir of fallbackBinDirs) {
		if (await dirHasWinFSPDll(binDir)) {
			return true
		}
	}

	return false
}

/**
 * Detect macFUSE on macOS. True if ANY of the well-known dylibs/bundle exist
 * (`/usr/local/lib/libfuse.2.dylib` for v4+, `/usr/local/lib/libosxfuse.2.dylib` for older, or
 * `/Library/Filesystems/macfuse.fs`), or a `pkgutil` receipt matches `io.macfuse` / `com.github.osxfuse`. Returns false on
 * any non-macOS platform.
 *
 * @export
 * @async
 * @returns {Promise<boolean>}
 */
export async function isMacFUSEInstalled(): Promise<boolean> {
	if (process.platform !== "darwin") {
		return false
	}

	const knownPaths = ["/usr/local/lib/libfuse.2.dylib", "/usr/local/lib/libosxfuse.2.dylib", "/Library/Filesystems/macfuse.fs"]

	for (const candidate of knownPaths) {
		if (await fs.pathExists(candidate)) {
			return true
		}
	}

	const pkgs = await runProbe("pkgutil", ["--pkgs"])

	if (pkgs.code === 0 && /io\.macfuse|com\.github\.osxfuse/i.test(pkgs.stdout)) {
		return true
	}

	return false
}

/**
 * Detect FUSE-T on macOS by the ONE artifact that actually matters at mount time: `/usr/local/lib/libfuse-t.dylib` — the
 * symlink FUSE-T's pkg postinstall creates and the exact path rclone's cgofuse dlopens (confirmed in rclone's embedded
 * FUSE-T notes). `fs.pathExists` follows the symlink, so a dangling link (its versioned target removed) correctly reads
 * as absent.
 *
 * Deliberately does NOT fall back to a `pkgutil` receipt: a receipt outlives an uninstall (files removed, receipt left
 * behind), so trusting one made us report FUSE-T as present and skip the auto-install while the mount was actually broken
 * ("cgofuse: cannot find FUSE"). Returns false on any non-macOS platform.
 *
 * @export
 * @async
 * @returns {Promise<boolean>}
 */
export async function isFUSETInstalledOnMacOS(): Promise<boolean> {
	if (process.platform !== "darwin") {
		return false
	}

	return fs.pathExists("/usr/local/lib/libfuse-t.dylib")
}

/**
 * The installed FUSE-T version (e.g. "1.2.7"), read from the target of the `/usr/local/lib/libfuse-t.dylib` symlink that
 * FUSE-T's postinstall creates (`libfuse-t.dylib -> libfuse-t-<version>.dylib`). This reflects the ACTUAL installed
 * library, unlike a `pkgutil` receipt which can be stale after an uninstall/upgrade (and which the presence check no
 * longer trusts either). Returns null when the symlink is absent or its target doesn't encode a version. macOS only.
 *
 * @export
 * @async
 * @returns {Promise<string | null>}
 */
export async function installedFuseTVersion(): Promise<string | null> {
	if (process.platform !== "darwin") {
		return null
	}

	try {
		const target = await fs.readlink("/usr/local/lib/libfuse-t.dylib")
		const match = pathModule.basename(target).match(/^libfuse-t-([\d.]+)\.dylib$/)

		return match && match[1] ? match[1] : null
	} catch {
		// No symlink (FUSE-T not installed), or it isn't a symlink — either way there's no version to report.
		return null
	}
}

/**
 * Compare two dotted version strings numerically (e.g. "1.2.6" vs "1.2.7"), returning a negative, zero or positive number.
 * Each component's leading integer is used (a non-numeric part like "1.2.0b" parses as 0) and missing trailing components
 * count as 0, so this only decides same-line ordering - good enough to gate a same-product upgrade.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareDottedVersions(a: string, b: string): number {
	const pa = a.split(".")
	const pb = b.split(".")
	const len = Math.max(pa.length, pb.length)

	for (let i = 0; i < len; i++) {
		const na = parseInt(pa[i] ?? "0", 10)
		const nb = parseInt(pb[i] ?? "0", 10)
		const va = Number.isNaN(na) ? 0 : na
		const vb = Number.isNaN(nb) ? 0 : nb

		if (va !== vb) {
			return va < vb ? -1 : 1
		}
	}

	return 0
}

/**
 * Extract the bundled FUSE-T version from its installer filename ("fuse-t-macos-installer-1.2.7.pkg" -> "1.2.7"), or null
 * when the filename doesn't match the expected shape.
 *
 * @param {string} pkgPath
 * @returns {(string | null)}
 */
function parseBundledFuseTVersion(pkgPath: string): string | null {
	const match = pathModule.basename(pkgPath).match(/^fuse-t-macos-installer-(.+)\.pkg$/i)

	return match && match[1] ? match[1] : null
}

/**
 * Detect FUSE3 on Linux. rclone performs unprivileged mounts through the `fusermount3` setuid helper, so the presence of
 * THAT binary — not merely the libfuse3 shared object — is the real gate: a box that has `libfuse3` but no `fusermount3`
 * (e.g. the library pulled in transitively without the `fuse3` utils package) cannot actually mount, and accepting it
 * would turn the clean "install fuse3" message into a confusing mount failure. We probe `fusermount3` PATH-independently —
 * `which fusermount3` first, then the well-known absolute locations — because a desktop GUI process frequently starts
 * with a minimal PATH that omits the dir it lives in. A bare `fusermount` (FUSE v2) is intentionally NOT accepted. Returns
 * false on any non-Linux platform.
 *
 * @export
 * @async
 * @returns {Promise<boolean>}
 */
export async function isFUSE3InstalledOnLinux(): Promise<boolean> {
	if (process.platform !== "linux") {
		return false
	}

	const which = await runProbe("which", ["fusermount3"])

	if (which.code === 0 && which.stdout.trim().length > 0) {
		return true
	}

	for (const candidate of ["/usr/bin/fusermount3", "/bin/fusermount3", "/usr/local/bin/fusermount3", "/sbin/fusermount3"]) {
		if (await fs.pathExists(candidate)) {
			return true
		}
	}

	return false
}

/**
 * Run the bundled WinFSP MSI through one elevated, silent msiexec via PowerShell, gating success on the MSI exit code and
 * then re-running {@link isWinFSPInstalled}.
 *
 * `Start-Process msiexec.exe -ArgumentList '/i','"<msi>"','/qn','/norestart','/l*v','"<log>"' -Verb RunAs -PassThru -Wait`
 * propagates the real MSI exit code via `exit $p.ExitCode` (the old code's `-Wait` without `-PassThru` swallowed it, so a
 * failed install looked like success). A declined UAC prompt makes `Start-Process` throw; we catch that and surface it as
 * exit 1602. Success = exit code {0, 3010, 1641, 1638}; 1618 (another install in progress) is retried up to 3× with
 * backoff; 1602 (UAC declined), 1603 (fatal) and anything else throw a clear error.
 *
 * @export
 * @async
 * @param {string} msiPath Absolute path to the WinFSP `.msi`.
 * @returns {Promise<void>}
 */
export async function installWinFSP(msiPath: string): Promise<void> {
	if (process.platform !== "win32") {
		throw new Error("WinFSP can only be installed on Windows.")
	}

	if (!(await fs.pathExists(msiPath))) {
		throw new Error(`WinFSP installer not found: ${msiPath}`)
	}

	const logPath = pathModule.join(os.tmpdir(), `winfsp-install-${Date.now()}.log`)
	const escapedMsi = msiPath.replace(/'/g, "''")
	const escapedLog = logPath.replace(/'/g, "''")
	const psScript = [
		"$ErrorActionPreference = 'Stop'",
		"try {",
		`$p = Start-Process msiexec.exe -ArgumentList '/i','"${escapedMsi}"','/qn','/norestart','/l*v','"${escapedLog}"' -Verb RunAs -PassThru -Wait`,
		"exit $p.ExitCode",
		"} catch {",
		"exit 1602",
		"}"
	].join("\n")

	const maxAttempts = 3

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const result = await runProbe("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript], 600000)
		const code = result.code

		// 0 = success, 3010/1641 = success but a reboot is required, 1638 = this (or newer) version already installed.
		if (code === 0 || code === 3010 || code === 1641 || code === 1638) {
			break
		}

		// 1618 = another installation is already in progress; back off and retry.
		if (code === 1618 && attempt < maxAttempts) {
			await sleep(attempt * 3000)

			continue
		}

		if (code === 1602) {
			throw new Error("WinFSP installation was cancelled (UAC declined / user exit). msiexec exit code 1602.")
		}

		if (code === 1603) {
			throw new Error(`WinFSP installation failed fatally (msiexec exit code 1603). See log: ${logPath}`)
		}

		if (code === 1618) {
			throw new Error("WinFSP installation could not start: another installation is still in progress (msiexec exit code 1618).")
		}

		throw new Error(`WinFSP installation failed (msiexec exit code ${String(code)}). See log: ${logPath}`)
	}

	if (!(await isWinFSPInstalled())) {
		throw new Error("WinFSP installer reported success but WinFSP is still not detected.")
	}
}

/**
 * Install FUSE-T on macOS with a SINGLE elevated `osascript` prompt that both runs the bundled pkg installer AND
 * idempotently adds the `127.0.0.1 Filen` entry FUSE-T's `-o location=Filen` mount needs (spec §6.2/§8.2).
 *
 * `do shell script "<installer> && { <grep> || <printf >> /etc/hosts>; }" with administrator privileges` runs both under
 * one authorization. The hosts line is only appended when no non-comment line already maps `127.0.0.1 … Filen`. Success is
 * gated on the osascript exit code (non-zero = the install failed or the prompt was declined → throw), then
 * {@link isFUSETInstalledOnMacOS} is re-run.
 *
 * @export
 * @async
 * @param {string} pkgPath Absolute path to the FUSE-T `.pkg`.
 * @returns {Promise<void>}
 */
export async function installFuseT(pkgPath: string): Promise<void> {
	if (process.platform !== "darwin") {
		throw new Error("FUSE-T can only be installed on macOS.")
	}

	if (!(await fs.pathExists(pkgPath))) {
		throw new Error(`FUSE-T installer not found: ${pkgPath}`)
	}

	const installerCmd = `/usr/sbin/installer -pkg ${shellSingleQuote(pkgPath)} -target /`
	const hostsCmd =
		"{ /usr/bin/grep -qE '^[[:space:]]*127\\.0\\.0\\.1[[:space:]].*\\bFilen\\b' /etc/hosts || " +
		"printf '127.0.0.1 Filen\\n' >> /etc/hosts; }"
	const osaScript = `do shell script ${appleScriptQuote(`${installerCmd} && ${hostsCmd}`)} with administrator privileges`

	const result = await runProbe("osascript", ["-e", osaScript], 600000)

	if (result.code !== 0) {
		const detail = result.stderr.trim().length > 0 ? ` ${result.stderr.trim()}` : ""

		throw new Error(`FUSE-T installation failed or was cancelled (osascript exit code ${String(result.code)}).${detail}`)
	}

	if (!(await isFUSETInstalledOnMacOS())) {
		throw new Error("FUSE-T installer reported success but FUSE-T is still not detected.")
	}
}

/**
 * Whether `/etc/hosts` already maps `Filen` to `127.0.0.1` (macOS only). Lets callers decide both whether to skip the
 * elevated hosts prompt and — per spec §8.2 — whether the FUSE-T `-o location=Filen` mount argument is safe to pass (omit
 * it when the entry is absent and cannot be written, rather than mount with an unresolvable name). Returns false on any
 * non-macOS platform or when `/etc/hosts` cannot be read.
 *
 * @export
 * @async
 * @returns {Promise<boolean>}
 */
export async function ensureHostsFilenEntry(): Promise<boolean> {
	if (process.platform !== "darwin") {
		return false
	}

	try {
		return hostsHasFilenEntry(await fs.readFile("/etc/hosts", "utf-8"))
	} catch {
		return false
	}
}

/**
 * Per-distro instructions for installing FUSE3 on Linux. FUSE3 is never auto-installed (root + distro-specific), so this
 * is surfaced to the user instead.
 *
 * @export
 * @returns {string}
 */
export function linuxFuse3InstallInstructions(): string {
	return [
		"FUSE3 is required to mount the network drive but is not installed.",
		"Install it with your distribution's package manager, then restart Filen:",
		"",
		"  Debian / Ubuntu:        sudo apt install fuse3",
		"  Fedora / RHEL / CentOS:  sudo dnf install fuse3",
		"  Arch / Manjaro:          sudo pacman -S fuse3",
		"  openSUSE:                sudo zypper install fuse3",
		"  Alpine:                  sudo apk add fuse3"
	].join("\n")
}

/**
 * Ensure the FUSE layer rclone's mount needs is present for the current platform, optionally installing it, then REQUIRE
 * it — throwing if it is still absent (spec D9/§8):
 *
 * - **Windows:** if WinFSP is missing and `tryInstall` + `winfspMsiPath` are provided, install it; then require it.
 * - **macOS:** if NEITHER macFUSE NOR FUSE-T is present and `tryInstall` + `fuseTPkgPath` are provided, install FUSE-T;
 *   then require macFUSE-or-FUSE-T. macFUSE is never auto-installed (kext). When FUSE-T is the active layer (no macFUSE)
 *   and the installed FUSE-T is older than the bundled `fuseTPkgPath`, upgrade it — best-effort, never blocking the mount.
 * - **Linux:** require FUSE3; if absent, throw an Error whose message includes {@link linuxFuse3InstallInstructions}.
 *   FUSE3 is never auto-installed.
 *
 * @export
 * @async
 * @param {{ winfspMsiPath?: string; fuseTPkgPath?: string; tryInstall: boolean; logger?: (level: string, message: string) => void }} options
 * @returns {Promise<void>}
 */
export async function ensureDriveDependencies(options: {
	winfspMsiPath?: string
	fuseTPkgPath?: string
	tryInstall: boolean
	logger?: (level: string, message: string) => void
}): Promise<void> {
	if (process.platform === "win32") {
		if (!(await isWinFSPInstalled()) && options.tryInstall && options.winfspMsiPath) {
			await installWinFSP(options.winfspMsiPath)
		}

		if (!(await isWinFSPInstalled())) {
			throw new Error("WinFSP is required for the network drive but is not installed.")
		}

		return
	}

	if (process.platform === "darwin") {
		const hasMacFUSE = await isMacFUSEInstalled()
		const fuseTInstalled = await isFUSETInstalledOnMacOS()

		if (!hasMacFUSE && !fuseTInstalled && options.tryInstall && options.fuseTPkgPath) {
			await installFuseT(options.fuseTPkgPath)
		} else if (fuseTInstalled && !hasMacFUSE && options.tryInstall && options.fuseTPkgPath) {
			// FUSE-T is the active FUSE layer (no macFUSE): upgrade it to the bundled version when the installed one is
			// older. Best-effort — never blocks the mount. If either version can't be read, or the elevated install is
			// declined/fails, we log and carry on with the existing (older, still-working) FUSE-T. macFUSE users are
			// left untouched, and a re-mount simply re-attempts the upgrade next time.
			const bundledVersion = parseBundledFuseTVersion(options.fuseTPkgPath)
			const currentVersion = await installedFuseTVersion()

			if (bundledVersion && currentVersion && compareDottedVersions(currentVersion, bundledVersion) < 0) {
				options.logger?.("info", `FUSE-T ${currentVersion} is older than bundled ${bundledVersion}, upgrading`)

				try {
					await installFuseT(options.fuseTPkgPath)

					options.logger?.("info", `FUSE-T upgraded to ${bundledVersion}`)
				} catch (e) {
					options.logger?.(
						"warn",
						`FUSE-T upgrade to ${bundledVersion} failed, keeping ${currentVersion}: ${
							e instanceof Error ? e.message : String(e)
						}`
					)
				}
			} else if (!bundledVersion || !currentVersion) {
				// Can't compare versions (unparseable bundled filename, or an installed FUSE-T with no readable receipt) —
				// skip the upgrade rather than guess. Logged so a future silent no-op (e.g. a renamed bundled pkg) is visible.
				options.logger?.(
					"info",
					`Skipping FUSE-T upgrade check (bundled=${bundledVersion ?? "unknown"}, installed=${currentVersion ?? "unknown"})`
				)
			}
		}

		if (!(await isMacFUSEInstalled()) && !(await isFUSETInstalledOnMacOS())) {
			throw new Error("A FUSE layer is required for the network drive on macOS. Install macFUSE or FUSE-T.")
		}

		return
	}

	if (process.platform === "linux") {
		if (!(await isFUSE3InstalledOnLinux())) {
			throw new Error(linuxFuse3InstallInstructions())
		}

		return
	}

	throw new Error(`Unsupported platform for the network drive: ${process.platform}`)
}
