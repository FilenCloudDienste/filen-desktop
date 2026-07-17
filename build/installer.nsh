!define WINFSP_INSTALLER "winfsp-2.2.26112.msi"

RequestExecutionLevel admin

!macro customInit
  ; electron-builder's multiUser.nsh only upgrades the default install dir to $PROGRAMFILES64 under
  ; "!ifdef APP_64", and the arm64-only installer defines APP_ARM64 instead - so on Windows-on-ARM the
  ; x86 NSIS stub's $PROGRAMFILES ("C:\Program Files (x86)") wins and fresh installs land in the wrong
  ; root. Correct exactly that default: only when the machine is native ARM64 AND $INSTDIR still equals
  ; the wrong default (which preserves /D= overrides and registry-recorded install locations, and lets
  ; an existing (x86) install migrate cleanly on its next update since the old copy is uninstalled via
  ; the registry path first). No-op for the x64 and universal installers, whose APP_64 branch already
  ; picked $PROGRAMFILES64. Upstream bug, still present in electron-builder master.
  ${If} ${IsNativeARM64}
    ${If} $INSTDIR == "$PROGRAMFILES\${APP_FILENAME}"
      StrCpy $INSTDIR "$PROGRAMFILES64\${APP_FILENAME}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
    ; Always run the bundled WinFSP MSI and let msiexec decide from the installed state: fresh-install when absent,
    ; in-place major-upgrade when an older version is present, and a silent no-op/repair when the bundled version is
    ; already installed. This runs only during (un)install - elevated, with the app not running and no Filen mount
    ; active - the same safe context as a fresh install; /norestart defers any rare required reboot. Simpler and more
    ; robust than gating on the WinFSP registry version (so the CVE fix always reaches existing users on update).
    File /oname=$PLUGINSDIR\\${WINFSP_INSTALLER} "${BUILD_RESOURCES_DIR}\\..\\bin\\deps\\${WINFSP_INSTALLER}"

    ExecWait '"msiexec.exe" /i "$PLUGINSDIR\\${WINFSP_INSTALLER}" /qn /norestart' $2
  ${EndIf}
!macroend
