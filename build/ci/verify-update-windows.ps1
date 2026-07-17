# Auto-update end-to-end check on a real runner of the target arch.
#
# Installs the candidate build (universal installer - what deployed clients ran), then serves the
# REAL latest.yml back to it with only the version rewritten to 9.9.9, from a loopback feed. The app
# runs with FILEN_E2E_UPDATER=1 (loopback feed + auto-confirmed install, one-shot via
# FILEN_E2E_ONCE_FILE - see src/lib/updater.ts). Because the feed carries the production manifest
# shape, the app's own findFile/arch selection picks the same installer real 6.8.x clients get
# (the arch-specific exe); the universal is covered by verify-install. Success means the production
# pipeline ran end to end: check -> arch selection -> download -> sha512 verify -> elevate.exe ->
# silent NSIS reinstall (--updated --force-run) -> auto-relaunch.
#
# Swap detection: NSIS may preserve payload mtimes, so a canary file planted in the install dir is
# the primary signal - the update's uninstall-then-reinstall removes it. Relaunch: a new Filen
# process appears after the canary vanishes.
#
# Usage: verify-update-windows.ps1 -Arch x64|arm64   (artifacts expected in .\prod)

param(
    [Parameter(Mandatory = $true)][ValidateSet("x64", "arm64")][string]$Arch
)

$ErrorActionPreference = "Stop"
$InstallDir = "C:\Program Files\Filen"
$FeedPort = 8123
$LogFile = Join-Path $env:APPDATA "@filen\logs\desktop.log"

. "$PSScriptRoot\win-common.ps1"

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if (Test-Path $LogFile) {
        Write-Host "--- desktop.log updater lines ---"
        Select-String -Path $LogFile -Pattern "updater|Update|Installing" | Select-Object -Last 40 | ForEach-Object { Write-Host $_.Line }
    }
    Write-Diagnostics
    exit 1
}

# 1. Ensure the candidate build is installed (universal - the fleet's installer).
if (-not (Test-Path (Join-Path $InstallDir "Filen.exe"))) {
    Invoke-SilentInstall "prod\Filen_win.exe" ${function:Fail}
}

# 2. Loopback feed: the REAL manifest with version rewritten to 9.9.9, plus every exe it lists.
$feedDir = Join-Path $env:TEMP "filen-update-feed"
if (Test-Path $feedDir) { Remove-Item -Recurse -Force $feedDir }
New-Item -ItemType Directory -Path $feedDir | Out-Null
(Get-Content "prod\latest.yml" -Raw) -replace "(?m)^version:.*$", "version: 9.9.9" | Out-File -FilePath (Join-Path $feedDir "latest.yml") -Encoding ascii
foreach ($exe in @("Filen_win.exe", "Filen_win_x64.exe", "Filen_win_arm64.exe")) {
    Copy-Item "prod\$exe" (Join-Path $feedDir $exe)
}

$python = Get-PythonCommand
$serverCmd = $python + @("-m", "http.server", "$FeedPort", "--bind", "127.0.0.1", "--directory", $feedDir)
$server = Start-Process -FilePath $serverCmd[0] -ArgumentList $serverCmd[1..($serverCmd.Count - 1)] -PassThru -WindowStyle Hidden

try {
    # Feed readiness - a dead server must fail here, not as a misleading timeout later.
    $ready = $false
    foreach ($i in 1..10) {
        try {
            $null = Invoke-WebRequest -Uri "http://127.0.0.1:$FeedPort/latest.yml" -UseBasicParsing -TimeoutSec 3
            $ready = $true
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    if (-not $ready) { Fail "loopback feed server did not become ready on port $FeedPort" }

    if (Test-Path $LogFile) { Remove-Item -Force $LogFile }
    $exePath = Join-Path $InstallDir "Filen.exe"
    $canary = Join-Path $InstallDir "resources\e2e-canary"
    Set-Content -Path $canary -Value "e2e"
    $onceFile = Join-Path $env:TEMP "filen-e2e-once"
    if (Test-Path $onceFile) { Remove-Item -Force $onceFile }

    # 3. Launch the installed app in E2E updater mode.
    $env:FILEN_E2E_UPDATER = "1"
    $env:FILEN_E2E_UPDATE_FEED = "http://127.0.0.1:$FeedPort/"
    $env:FILEN_E2E_ONCE_FILE = $onceFile
    $launchTime = Get-Date
    $app = Start-Process -FilePath $exePath -PassThru
    $env:FILEN_E2E_UPDATER = $null
    $env:FILEN_E2E_UPDATE_FEED = $null
    $env:FILEN_E2E_ONCE_FILE = $null

    # E2E engagement must be provable early - otherwise a rejected feed override silently checks the
    # production CDN and burns the whole timeout.
    $engaged = $false
    foreach ($i in 1..12) {
        Start-Sleep -Seconds 5
        if ((Test-Path $LogFile) -and (Select-String -Path $LogFile -Pattern "Updater E2E mode enabled" -Quiet)) {
            $engaged = $true
            break
        }
    }
    if (-not $engaged) { Fail "E2E feed override did not engage within 60s" }

    # 4. Wait for the full cycle: download -> installUpdate -> app exits -> NSIS reinstall (canary
    #    removed by uninstallOldVersion) -> --force-run relaunch.
    $deadline = (Get-Date).AddMinutes(15)
    $reinstalled = $false
    $relaunched = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        if (-not $reinstalled) {
            if ((-not (Test-Path $canary)) -and (Test-Path $exePath)) {
                $reinstalled = $true
                Write-Host "Canary removed - update installer reinstalled the app"
            }
        } else {
            $running = Get-Process -Name "Filen" -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt $launchTime -and $_.Id -ne $app.Id }
            if ($running) {
                $relaunched = $true
                Write-Host "App relaunched after update (pid $($running[0].Id))"
                break
            }
        }
    }

    if (-not $reinstalled) { Fail "update installer never reinstalled the app (canary still present) within the timeout" }
    if (-not $relaunched) { Fail "app did not relaunch after the update installer ran" }

    $log = Get-Content $LogFile -Raw
    if ($log -notmatch "Update downloaded") { Fail "desktop.log has no 'Update downloaded' entry" }
    if ($log -notmatch "Installing update") { Fail "desktop.log has no 'Installing update' entry" }
    # 6.8.x findFile arch-prefers, so the arch-specific installer must be the one downloaded.
    if ($log -notmatch [regex]::Escape("Filen_win_$Arch.exe")) {
        Fail "desktop.log never mentions Filen_win_$Arch.exe - the updater selected a different installer than real $Arch clients would"
    }

    # 5. Post-update: wait for installer processes to finish, then re-assert the full installation
    #    (arch, signature, completeness) - an update that lays down a wrong-arch or truncated payload
    #    must fail here.
    Get-Process -Name "Filen" -ErrorAction SilentlyContinue | Stop-Process -Force
    foreach ($i in 1..24) {
        $busy = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "Filen_win*" -or $_.Name -eq "elevate" }
        if (-not $busy) { break }
        Start-Sleep -Seconds 5
    }
    Start-Sleep -Seconds 2
    Assert-Installation "post-update" $Arch ${function:Fail}

    Write-Host "verify-update-windows PASSED for $Arch"
} finally {
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "Filen" -or $_.Name -like "Filen_win*" -or $_.Name -eq "elevate" } | Stop-Process -Force -ErrorAction SilentlyContinue
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
