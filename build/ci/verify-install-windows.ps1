# Install-check for the Windows NSIS artifacts on a real runner of the target arch.
#
# Verifies, for both the arch-specific installer and the universal Filen_win.exe:
#   - silent install (/S) succeeds and Filen.exe exists afterwards
#   - EVERY file from the corresponding Filen_win_<arch>.zip (the raw app dir) landed in the
#     install dir with the right size - catches silent payload-extraction failures like the
#     v3.0.50 arm64 incident (7z ARM64 filter vs the old nsis7z.dll decoder)
#   - the installed Filen.exe has the expected PE machine type and a valid Authenticode signature
#   - the installed version matches package.json
#   - latest.yml's sizes/hashes match the artifacts (deployed clients trust this manifest)
#
# Usage: verify-install-windows.ps1 -Arch x64|arm64   (artifacts expected in .\prod)

param(
    [Parameter(Mandatory = $true)][ValidateSet("x64", "arm64")][string]$Arch
)

$ErrorActionPreference = "Stop"
$InstallDir = "C:\Program Files\Filen"

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

function Get-PEMachine([string]$Path) {
    $fs = [System.IO.File]::OpenRead($Path)
    try {
        $br = New-Object System.IO.BinaryReader($fs)
        $null = $fs.Seek(0x3C, "Begin")
        $peOffset = $br.ReadUInt32()
        $null = $fs.Seek($peOffset + 4, "Begin")
        $machine = $br.ReadUInt16()
    } finally {
        $fs.Close()
    }
    switch ($machine) {
        0xAA64 { return "arm64" }
        0x8664 { return "x64" }
        default { return ("0x{0:X4}" -f $machine) }
    }
}

function Invoke-SilentInstall([string]$Installer) {
    Write-Host "Installing $Installer silently..."
    $p = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
    if ($p.ExitCode -ne 0) {
        Fail "$Installer exited with code $($p.ExitCode)"
    }
}

function Invoke-SilentUninstall {
    $uninstaller = Join-Path $InstallDir "Uninstall Filen.exe"
    if (-not (Test-Path $uninstaller)) {
        return
    }
    Write-Host "Uninstalling silently..."
    # _?= makes the NSIS uninstaller run in place instead of relaunching a temp copy, so -Wait is reliable.
    $p = Start-Process -FilePath $uninstaller -ArgumentList "/S", "_?=$InstallDir" -PassThru -Wait
    if ($p.ExitCode -ne 0) {
        Fail "uninstaller exited with code $($p.ExitCode)"
    }
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
    }
}

function Assert-Installation([string]$Source) {
    $exe = Join-Path $InstallDir "Filen.exe"
    if (-not (Test-Path $exe)) {
        Fail "[$Source] $exe does not exist after install - payload was not extracted"
    }

    $machine = Get-PEMachine $exe
    if ($machine -ne $Arch) {
        Fail "[$Source] installed Filen.exe is $machine, expected $Arch"
    }

    $sig = Get-AuthenticodeSignature $exe
    if ($sig.Status -ne "Valid") {
        Fail "[$Source] Filen.exe Authenticode signature is $($sig.Status), expected Valid"
    }

    $expectedVersion = node -p "require('./package.json').version"
    $productVersion = (Get-Item $exe).VersionInfo.ProductVersion
    if ($productVersion -ne $expectedVersion) {
        Fail "[$Source] installed ProductVersion is $productVersion, expected $expectedVersion"
    }

    # Completeness: every file of the raw app dir (the zip artifact) must exist in the install
    # dir with the same size. A silently skipped extraction block shows up right here.
    $refDir = Join-Path $env:TEMP "filen-ref-$Arch"
    if (-not (Test-Path (Join-Path $refDir "Filen.exe"))) {
        if (Test-Path $refDir) { Remove-Item -Recurse -Force $refDir }
        Expand-Archive -Path "prod\Filen_win_$Arch.zip" -DestinationPath $refDir
    }

    $missing = 0
    foreach ($ref in (Get-ChildItem -Recurse -File $refDir)) {
        $relative = $ref.FullName.Substring($refDir.Length + 1)
        $installed = Join-Path $InstallDir $relative
        if (-not (Test-Path $installed)) {
            Write-Host "MISSING: $relative"
            $missing++
        } elseif ((Get-Item $installed).Length -ne $ref.Length) {
            Write-Host "SIZE MISMATCH: $relative (expected $($ref.Length), got $((Get-Item $installed).Length))"
            $missing++
        }
    }
    if ($missing -gt 0) {
        Fail "[$Source] $missing file(s) from the app payload are missing or truncated in $InstallDir"
    }

    $fileCount = (Get-ChildItem -Recurse -File $refDir).Count
    Write-Host "OK [$Source]: Filen.exe $machine v$productVersion, signature Valid, all $fileCount payload files present"
}

# 1. Feed manifest sanity - deployed clients trust latest.yml blindly.
python build\ci\check-feed.py prod\latest.yml prod
if ($LASTEXITCODE -ne 0) { Fail "latest.yml feed check failed" }

# 2. Arch-specific installer.
Invoke-SilentUninstall
Invoke-SilentInstall "prod\Filen_win_$Arch.exe"
Assert-Installation "Filen_win_$Arch.exe"

# 3. Universal installer - must pick the native arch payload on this runner (the exact code
#    path deployed auto-updaters execute, since latest.yml lists Filen_win.exe first).
Invoke-SilentUninstall
Invoke-SilentInstall "prod\Filen_win.exe"
Assert-Installation "Filen_win.exe"

Write-Host "verify-install-windows PASSED for $Arch"
