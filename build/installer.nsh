!define WINFSP_INSTALLER "winfsp-2.2.26112.msi"

RequestExecutionLevel admin

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
