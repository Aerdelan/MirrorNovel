; Replace the builder's unbounded cmd/tasklist checks. The helper only touches
; the chosen installation and its registered predecessor, never another copy.
!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customCheckAppRunning
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  InitPluginsDir
  SetDetailsPrint both
  SetDetailsView show
  DetailPrint "Checking the installed application (15-second response timeout)..."
  File /oname=$PLUGINSDIR\mirrornovel-process-guard.ps1 "${BUILD_RESOURCES_DIR}\installer-process-guard.ps1"
  StrCpy $R2 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
    StrCpy $R2 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  nsExec::ExecToStack /TIMEOUT=15000 '"$R2" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\mirrornovel-process-guard.ps1" -InstallDirectory "$INSTDIR" -PreviousDirectory "$R3" -ExecutableName "${APP_EXECUTABLE_FILENAME}" -Mode Check -LogFile "$TEMP\MirrorNovel-install.log"'
  Pop $R0
  Pop $R1
  DetailPrint "$R1"
  ${If} $R0 == 2
    ${If} ${Silent}
      SetErrorLevel 2
      Quit
    ${EndIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "MirrorNovel is still running, possibly in the system tray.$\r$\nSave your edits before continuing. Setup will close only the version being replaced.$\r$\n$\r$\nContinue?" /SD IDCANCEL IDOK +3
      SetErrorLevel 2
      Quit
    DetailPrint "Closing the previous application (15-second response timeout)..."
    nsExec::ExecToStack /TIMEOUT=15000 '"$R2" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\mirrornovel-process-guard.ps1" -InstallDirectory "$INSTDIR" -PreviousDirectory "$R3" -ExecutableName "${APP_EXECUTABLE_FILENAME}" -Mode Close -LogFile "$TEMP\MirrorNovel-install.log"'
    Pop $R0
    Pop $R1
    DetailPrint "$R1"
  ${EndIf}
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Setup could not safely finish checking or closing MirrorNovel.$\r$\nExit MirrorNovel from its tray menu and retry.$\r$\nLog: $TEMP\MirrorNovel-install.log$\r$\nResult: $R0" /SD IDOK
    SetErrorLevel 3
    Quit
  ${EndIf}
  DetailPrint "Replacing the previous version and writing application files..."
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customInstall
  DetailPrint "Application files and shortcuts installed successfully."
  FileOpen $R0 "$TEMP\MirrorNovel-install.log" a
  FileWrite $R0 "Installation completed: ${VERSION}$\r$\n"
  FileClose $R0
  ClearErrors
!macroend

; The upstream failure handler opens a message box even during /S upgrades.
; The old uninstaller runs hidden, so a locked file can look like a frozen
; progress page. Fail explicitly instead, and keep old files for a retry.
!macro mnCheckUninstallResult
  ${If} ${Errors}
  ${OrIf} $R0 != 0
    DetailPrint "Previous-version cleanup failed (code $R0). Close applications holding installed files, then retry."
    FileOpen $R2 "$TEMP\MirrorNovel-install.log" a
    FileWrite $R2 "Previous-version cleanup failed (code $R0). Installation stopped; retry after releasing file locks.$\r$\n"
    FileClose $R2
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "The previous installation could not be replaced.$\r$\nClose MirrorNovel and programs holding files in its installation directory, then retry.$\r$\nYour application data has not been deleted.$\r$\nSee the visible installation details and $TEMP\MirrorNovel-install.log." /SD IDOK
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro mnCheckUninstallResult
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro mnCheckUninstallResult
!macroend
