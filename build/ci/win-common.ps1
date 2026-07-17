# Shared helpers for the Windows verify scripts. Dot-source after defining $InstallDir.

function Get-PythonCommand {
    # windows-latest guarantees python on PATH; the windows-11-arm image may only expose the py launcher.
    if (Get-Command python -ErrorAction SilentlyContinue) { return @("python") }
    if (Get-Command py -ErrorAction SilentlyContinue) { return @("py", "-3") }
    throw "no python interpreter found on this runner"
}

function Write-Diagnostics {
    Write-Host "--- diagnostics ---"
    foreach ($dir in @($InstallDir, "C:\Program Files (x86)\Filen")) {
        if (Test-Path $dir) {
            $files = Get-ChildItem -Recurse -File $dir -ErrorAction SilentlyContinue
            Write-Host "${dir}: $($files.Count) file(s)"
            $files | Select-Object -First 15 | ForEach-Object { Write-Host "  $($_.FullName.Substring($dir.Length + 1)) ($($_.Length))" }
        } else {
            Write-Host "${dir}: does not exist"
        }
    }
    try {
        $mp = Get-MpComputerStatus -ErrorAction Stop
        Write-Host "Defender RealTimeProtectionEnabled: $($mp.RealTimeProtectionEnabled)"
        $threats = Get-MpThreatDetection -ErrorAction SilentlyContinue | Sort-Object InitialDetectionTime -Descending | Select-Object -First 5
        if ($threats) {
            Write-Host "Recent Defender detections:"
            $threats | ForEach-Object { Write-Host "  $($_.InitialDetectionTime) $($_.Resources -join ', ')" }
        } else {
            Write-Host "No Defender detections recorded"
        }
    } catch {
        Write-Host "Defender status unavailable: $_"
    }
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

function Get-FilenUninstallEntry {
    foreach ($root in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")) {
        $entry = Get-ChildItem $root -ErrorAction SilentlyContinue | Where-Object {
            (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -eq "Filen"
        } | Select-Object -First 1
        if ($entry) { return Get-ItemProperty $entry.PSPath }
    }
    return $null
}

function Invoke-SilentInstall([string]$Installer, [scriptblock]$OnFail) {
    Write-Host "Installing $Installer silently..."
    $p = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
    if ($p.ExitCode -ne 0) {
        & $OnFail "$Installer exited with code $($p.ExitCode)"
    }
}

function Invoke-SilentUninstall([scriptblock]$OnFail) {
    $uninstaller = Join-Path $InstallDir "Uninstall Filen.exe"
    if (-not (Test-Path $uninstaller)) {
        return
    }
    Write-Host "Uninstalling silently..."
    # _?= must reach NSIS UNQUOTED (its value runs to end-of-line and must not contain quotes), so the
    # command line is built raw - Start-Process would quote the space in "Program Files" and silently
    # break every Delete/RMDir inside the uninstaller.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $uninstaller
    $psi.Arguments = "/S _?=$InstallDir"
    $psi.UseShellExecute = $false
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) {
        & $OnFail "uninstaller exited with code $($proc.ExitCode)"
    }
    # The in-place uninstaller cannot delete its own exe; a leftover uninstaller alone is expected.
    $leftovers = @(Get-ChildItem -Recurse -File $InstallDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "Uninstall Filen.exe" })
    if ($leftovers.Count -gt 0) {
        Write-Host "Leftover files after uninstall:"
        $leftovers | Select-Object -First 10 | ForEach-Object { Write-Host "  $($_.FullName)" }
        & $OnFail "uninstaller left $($leftovers.Count) file(s) behind in $InstallDir"
    }
    if (Get-FilenUninstallEntry) {
        & $OnFail "uninstall registry entry still present after uninstall"
    }
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    }
}

function Assert-Installation([string]$Source, [string]$Arch, [scriptblock]$OnFail) {
    $exe = Join-Path $InstallDir "Filen.exe"
    if (-not (Test-Path $exe)) {
        & $OnFail "[$Source] $exe does not exist after install - payload was not extracted or landed elsewhere"
    }

    $machine = Get-PEMachine $exe
    if ($machine -ne $Arch) {
        & $OnFail "[$Source] installed Filen.exe is $machine, expected $Arch"
    }

    $sig = Get-AuthenticodeSignature $exe
    if ($sig.Status -ne "Valid") {
        & $OnFail "[$Source] Filen.exe Authenticode signature is $($sig.Status), expected Valid"
    }

    # rcedit pads the PE version resource to four parts, so 3.0.51 ships as ProductVersion 3.0.51.0.
    $expectedVersion = node -p "require('./package.json').version"
    $productVersion = (Get-Item $exe).VersionInfo.ProductVersion
    if ($productVersion -ne $expectedVersion -and $productVersion -ne "$expectedVersion.0") {
        & $OnFail "[$Source] installed ProductVersion is $productVersion, expected $expectedVersion"
    }

    # The updater cannot run without these two; they are covered by the zip diff only as long as the
    # nsis target builds before the zip target, so assert them explicitly.
    foreach ($required in @("resources\elevate.exe", "resources\app-update.yml")) {
        if (-not (Test-Path (Join-Path $InstallDir $required))) {
            & $OnFail "[$Source] $required missing from install"
        }
    }
    $feedConfig = Get-Content (Join-Path $InstallDir "resources\app-update.yml") -Raw
    if ($feedConfig -notmatch [regex]::Escape("https://cdn.filen.io/@filen/desktop/release/latest/")) {
        & $OnFail "[$Source] app-update.yml does not point at the production CDN feed"
    }
    if ($feedConfig -match "(?m)^channel:") {
        & $OnFail "[$Source] app-update.yml carries an unexpected channel key (would change the requested manifest filename)"
    }

    $entry = Get-FilenUninstallEntry
    if (-not $entry) {
        & $OnFail "[$Source] no Add/Remove Programs entry for Filen"
    }
    if ($entry.DisplayVersion -ne $expectedVersion) {
        & $OnFail "[$Source] Add/Remove Programs DisplayVersion is $($entry.DisplayVersion), expected $expectedVersion"
    }

    # WinFSP is installed by customInstall (build/installer.nsh) and the network-drive feature is dead
    # without it; the MSI's exit code is discarded there, so assert the outcome here.
    $winfsp = (Get-Service "WinFsp.Launcher" -ErrorAction SilentlyContinue) -or (Test-Path "HKLM:\SOFTWARE\WOW6432Node\WinFsp")
    if (-not $winfsp) {
        & $OnFail "[$Source] WinFSP is not installed after the installer ran (customInstall MSI failed silently)"
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
        & $OnFail "[$Source] $missing file(s) from the app payload are missing or truncated in $InstallDir"
    }

    $fileCount = (Get-ChildItem -Recurse -File $refDir).Count
    Write-Host "OK [$Source]: Filen.exe $machine v$productVersion, signature Valid, WinFSP present, registry entry sane, all $fileCount payload files present"
}
