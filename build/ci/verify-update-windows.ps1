# Auto-update end-to-end check on a real runner of the target arch.
#
# Installs the candidate build, then serves the candidate's UNIVERSAL installer back to it from a
# loopback feed that claims version 9.9.9 (electron-updater only compares the manifest version, so
# the same artifact can play the "next release"). The app runs with FILEN_E2E_UPDATER=1, which makes
# the updater use the loopback feed and confirm the install without a user click (see
# src/lib/updater.ts). Success means the real production pipeline ran end to end on this arch:
# check -> download -> sha512 verify -> elevate.exe -> silent NSIS reinstall -> relaunch.
#
# Usage: verify-update-windows.ps1 -Arch x64|arm64   (artifacts expected in .\prod)

param(
    [Parameter(Mandatory = $true)][ValidateSet("x64", "arm64")][string]$Arch
)

$ErrorActionPreference = "Stop"
$InstallDir = "C:\Program Files\Filen"
$FeedPort = 8123
$LogFile = Join-Path $env:APPDATA "@filen\logs\desktop.log"

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if (Test-Path $LogFile) {
        Write-Host "--- desktop.log tail ---"
        Get-Content $LogFile -Tail 40
    }
    exit 1
}

function Get-Sha512Base64([string]$Path) {
    $sha = [System.Security.Cryptography.SHA512]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $hash = $sha.ComputeHash($stream)
    } finally {
        $stream.Close()
    }
    return [Convert]::ToBase64String($hash)
}

# 1. Ensure the candidate build is installed.
if (-not (Test-Path (Join-Path $InstallDir "Filen.exe"))) {
    Write-Host "Installing candidate build first..."
    $p = Start-Process -FilePath "prod\Filen_win_$Arch.exe" -ArgumentList "/S" -PassThru -Wait
    if ($p.ExitCode -ne 0) {
        Fail "candidate install exited with code $($p.ExitCode)"
    }
}

# 2. Build the loopback feed: universal installer under its production name + a manifest claiming 9.9.9.
$feedDir = Join-Path $env:TEMP "filen-update-feed"
if (Test-Path $feedDir) { Remove-Item -Recurse -Force $feedDir }
New-Item -ItemType Directory -Path $feedDir | Out-Null
Copy-Item "prod\Filen_win.exe" (Join-Path $feedDir "Filen.exe.download")
Move-Item (Join-Path $feedDir "Filen.exe.download") (Join-Path $feedDir "Filen_win.exe")
$sha = Get-Sha512Base64 (Join-Path $feedDir "Filen_win.exe")
$size = (Get-Item (Join-Path $feedDir "Filen_win.exe")).Length
@"
version: 9.9.9
files:
  - url: Filen_win.exe
    sha512: $sha
    size: $size
    isAdminRightsRequired: true
path: Filen_win.exe
sha512: $sha
releaseDate: '2026-01-01T00:00:00.000Z'
"@ | Out-File -FilePath (Join-Path $feedDir "latest.yml") -Encoding ascii

$server = Start-Process -FilePath "python" -ArgumentList "-m", "http.server", "$FeedPort", "--bind", "127.0.0.1", "--directory", $feedDir -PassThru -WindowStyle Hidden

try {
    if (Test-Path $LogFile) { Remove-Item -Force $LogFile }
    $exePath = Join-Path $InstallDir "Filen.exe"
    $beforeWrite = (Get-Item $exePath).LastWriteTimeUtc

    # 3. Launch the installed app in E2E updater mode.
    $env:FILEN_E2E_UPDATER = "1"
    $env:FILEN_E2E_UPDATE_FEED = "http://127.0.0.1:$FeedPort/"
    $app = Start-Process -FilePath $exePath -PassThru
    $env:FILEN_E2E_UPDATER = $null
    $env:FILEN_E2E_UPDATE_FEED = $null

    # 4. Wait for the full cycle: download -> installUpdate -> app exits -> NSIS rewrites files -> relaunch.
    $deadline = (Get-Date).AddMinutes(8)
    $rewritten = $false
    $relaunched = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        if (-not $rewritten) {
            if ((Test-Path $exePath) -and ((Get-Item $exePath).LastWriteTimeUtc -gt $beforeWrite)) {
                $rewritten = $true
                Write-Host "Filen.exe was rewritten by the update installer"
            }
        } else {
            $running = Get-Process -Name "Filen" -ErrorAction SilentlyContinue
            if ($running) {
                $relaunched = $true
                Write-Host "App relaunched after update (pid $($running[0].Id))"
                break
            }
        }
    }

    if (-not $rewritten) { Fail "update installer never rewrote $exePath within the timeout" }
    if (-not $relaunched) { Fail "app did not relaunch after the update installer ran" }

    $log = Get-Content $LogFile -Raw
    if ($log -notmatch "Update downloaded") { Fail "desktop.log has no 'Update downloaded' entry" }
    if ($log -notmatch "Installing update") { Fail "desktop.log has no 'Installing update' entry" }

    # 5. Post-update completeness: the updated tree must contain every payload file.
    Get-Process -Name "Filen" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $refDir = Join-Path $env:TEMP "filen-ref-$Arch"
    if (-not (Test-Path (Join-Path $refDir "Filen.exe"))) {
        if (Test-Path $refDir) { Remove-Item -Recurse -Force $refDir }
        Expand-Archive -Path "prod\Filen_win_$Arch.zip" -DestinationPath $refDir
    }
    $missing = 0
    foreach ($ref in (Get-ChildItem -Recurse -File $refDir)) {
        $relative = $ref.FullName.Substring($refDir.Length + 1)
        if (-not (Test-Path (Join-Path $InstallDir $relative))) {
            Write-Host "MISSING AFTER UPDATE: $relative"
            $missing++
        }
    }
    if ($missing -gt 0) { Fail "$missing payload file(s) missing after the auto-update reinstall" }

    Write-Host "verify-update-windows PASSED for $Arch"
} finally {
    Get-Process -Name "Filen" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
