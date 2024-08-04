!define WINFSP_INSTALLER "winfsp-2.1.24051.msi"

!macro winfspInstall
  SetOutPath "$INSTDIR"
  File "build\\${WINFSP_INSTALLER}"
  
  ; Check if WinFsp is already installed by looking for the InstallDir registry key
  ReadRegStr $0 HKLM "SOFTWARE\\WinFsp" "InstallDir"
  ${If} $0 == ""
    ; Check if WinFsp is installed under Wow6432Node for 32-bit installations on 64-bit systems
    ReadRegStr $0 HKLM "SOFTWARE\\Wow6432Node\\WinFsp" "InstallDir"
  ${EndIf}

  ${If} $0 == ""
    ExecWait '"$SYSDIR\\msiexec.exe" /i "$INSTDIR\\${WINFSP_INSTALLER}" /quiet /norestart' $1
    DetailPrint "WinFsp installation attempt exit code: $1"
    ; Log the error but do not show any dialogs
    ${If} $1 != 0
      DetailPrint "WinFsp installation failed with exit code $1. Continuing with the main installation."
    ${EndIf}
  ${Else}
    DetailPrint "WinFsp is already installed at $0"
  ${EndIf}
!macroend

Function winfspInstall
  !insertmacro winfspInstall
FunctionEnd
