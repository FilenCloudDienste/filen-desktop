!define WINFSP_INSTALLER "winfsp-2.1.24255.msi"

RequestExecutionLevel admin

!macro customInstall
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
    ClearErrors
    ReadRegStr $1 HKCR "Installer\\Dependencies\\WinFsp" "Version"

    ${If} ${Errors}
      File /oname=$PLUGINSDIR\\${WINFSP_INSTALLER} "${BUILD_RESOURCES_DIR}\\${WINFSP_INSTALLER}"

      ExecWait '"msiexec.exe" /i "$PLUGINSDIR\\${WINFSP_INSTALLER}" /qn' $2
    ${EndIf}
  ${EndIf}
!macroend
