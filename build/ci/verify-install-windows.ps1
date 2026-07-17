# Install-check for the Windows NSIS artifacts on a real runner of the target arch.
#
# Verifies, for both the arch-specific installer and the universal Filen_win.exe:
#   - silent install (/S) succeeds, Filen.exe exists at the canonical per-machine location
#     (C:\Program Files\Filen - the arm64-only installer used to land in Program Files (x86)
#     until build/installer.nsh customInit; this assert keeps that fixed)
#   - EVERY file from the corresponding Filen_win_<arch>.zip landed with the right size
#     (catches silent payload-extraction failures like the v3.0.50 arm64 incident)
#   - PE machine type, Authenticode, product version, elevate.exe + app-update.yml presence
#     and feed URL, Add/Remove Programs entry, WinFSP outcome
#   - the silent uninstaller actually removes the install and its registry entry
#   - latest.yml matches the artifacts AND the file-set/ordering contract deployed clients
#     rely on (legacy 6.x clients take files[0]; 6.8.x clients arch-match)
#
# Usage: verify-install-windows.ps1 -Arch x64|arm64   (artifacts expected in .\prod)

param(
    [Parameter(Mandatory = $true)][ValidateSet("x64", "arm64")][string]$Arch
)

$ErrorActionPreference = "Stop"
$InstallDir = "C:\Program Files\Filen"

. "$PSScriptRoot\win-common.ps1"

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    Write-Diagnostics
    exit 1
}

# 1. Feed manifest sanity + client-selection contract.
$expectedVersion = node -p "require('./package.json').version"
$cmd = @(Get-PythonCommand) + @(
    "build\ci\check-feed.py", "prod\latest.yml", "prod",
    "--expect", "Filen_win.exe", "--expect", "Filen_win_x64.exe", "--expect", "Filen_win_arm64.exe",
    "--first-url", "Filen_win.exe", "--expect-version", $expectedVersion, "--require-admin-rights"
)
& $cmd[0] $cmd[1..($cmd.Count - 1)]
if ($LASTEXITCODE -ne 0) { Fail "latest.yml feed check failed" }

# 2. Arch-specific installer (what 6.8.x auto-updaters download for this arch).
Invoke-SilentUninstall ${function:Fail}
Invoke-SilentInstall "prod\Filen_win_$Arch.exe" ${function:Fail}
Assert-Installation "Filen_win_$Arch.exe" $Arch ${function:Fail}

# 3. Uninstaller must genuinely clean up (asserted inside Invoke-SilentUninstall).
Invoke-SilentUninstall ${function:Fail}

# 4. Universal installer - must pick the native arch payload on this runner (what legacy
#    6.x auto-updaters and the website download run).
Invoke-SilentInstall "prod\Filen_win.exe" ${function:Fail}
Assert-Installation "Filen_win.exe" $Arch ${function:Fail}

Write-Host "verify-install-windows PASSED for $Arch"
