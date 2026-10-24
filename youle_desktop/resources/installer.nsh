!define MUI_DIRECTORYPAGE_VERIFYONLEAVE

# Older Haolo clients launched downloaded installers without --updated. Treat an
# existing per-user or all-users installation as an update so electron-builder passes
# --keep-shortcuts to the old uninstaller and preserves taskbar pins. Keep the
# uninstaller's own isUpdated behavior parameter-only.
!ifndef BUILD_UNINSTALLER
  !macro _haoloIsUpdated _a _b _t _f
    ${StdUtils.TestParameter} $R9 "updated"
    StrCmp "$R9" "true" `${_t}` 0
    ReadRegStr $R9 HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp "$R9" "" 0 `${_t}`
    ReadRegStr $R9 HKEY_LOCAL_MACHINE "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp "$R9" "" `${_f}` `${_t}`
  !macroend

  !undef isUpdated
  !define isUpdated `"" haoloIsUpdated ""`

  # Manage only desktop links ourselves. Keep electron-builder's update /
  # --keep-shortcuts / uninstaller taskbar behavior unchanged. The uninstaller
  # is deliberately compiled WITHOUT this additional define.
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    !define HAOLO_MANAGE_DESKTOP_SHORTCUT
    !define DO_NOT_CREATE_DESKTOP_SHORTCUT
  !endif
  !define /ifndef HAOLO_SHORTCUT_SCRIPT "${__FILEDIR__}\windows-desktop-shortcut.ps1"
  Var haoloShortcutExit
  Var haoloShortcutOutput
  Var haoloShortcutOptOut
  LangString haoloShortcutFailure 1033 "HaoLo is installed, but its desktop shortcut could not be verified. Check the desktop folder permissions and the installation account. Retry to try again, or Cancel to finish with shortcut setup incomplete. You can create it later in Settings."
  LangString haoloShortcutFailure 1042 "HaoLo가 설치되었지만 바탕 화면 바로 가기를 만들거나 확인하지 못했습니다. 바탕 화면 폴더의 권한과 설치 계정을 확인하세요. 다시 시도하거나 취소를 눌러 설치를 마칠 수 있습니다. 바로 가기는 나중에 설정에서 다시 만들 수 있습니다."
  LangString haoloShortcutFailure 2052 "HaoLo 已安装，但桌面快捷方式未能创建或验证。请检查桌面目录权限，以及安装账户是否为您日常使用的账户。点击重试再次尝试；点击取消将结束安装，快捷方式问题仍需处理，之后可在设置中重试。"
  LangString haoloShortcutFailure 1028 "HaoLo 已安裝，但桌面捷徑未能建立或驗證。請檢查桌面目錄權限，以及安裝帳戶是否為您日常使用的帳戶。點擊重試再次嘗試；點擊取消將結束安裝，捷徑問題仍需處理，之後可在設定中重試。"

  !macro customInit
    !ifdef HAOLO_MANAGE_DESKTOP_SHORTCUT
      InitPluginsDir
      File /oname=$PLUGINSDIR\haolo-shortcut.ps1 "${HAOLO_SHORTCUT_SCRIPT}"
      # Snapshot both scopes before any uninstall or registryAddInstallInfo.
      # The elevated inner installer takes its own snapshot before it mutates anything.
      nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\haolo-shortcut.ps1" -Action Snapshot -SnapshotFile "$PLUGINSDIR\haolo-shortcut-before.json"'
      Pop $haoloShortcutExit
      Pop $haoloShortcutOutput
      # An unavailable snapshot is NOT assumed to be a fresh installation.
      # Install will report it and will never recreate a possibly user-deleted link.
    !endif
  !macroend
!endif

Function haoloNormalizeInstallDir
  Push $0
  Push $1

  StrLen $0 "$INSTDIR"
  StrCmp $0 "2" haolo_drive_root_without_slash 0
  StrCmp $0 "3" haolo_drive_root_with_slash haolo_done_normalize_install_dir

  haolo_drive_root_without_slash:
    StrCpy $1 "$INSTDIR" 1 1
    StrCmp $1 ":" 0 haolo_done_normalize_install_dir
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    Goto haolo_done_normalize_install_dir

  haolo_drive_root_with_slash:
    StrCpy $1 "$INSTDIR" 1 1
    StrCmp $1 ":" 0 haolo_done_normalize_install_dir
    StrCpy $1 "$INSTDIR" 1 2
    StrCmp $1 "\" 0 haolo_done_normalize_install_dir
    StrCpy $INSTDIR "$INSTDIR${APP_FILENAME}"

  haolo_done_normalize_install_dir:
  Pop $1
  Pop $0
FunctionEnd

Function .onVerifyInstDir
  Call haoloNormalizeInstallDir
FunctionEnd

!macro haoloRefreshShortcut linkPath
  IfFileExists "$appExe" 0 +5
  IfFileExists "${linkPath}" 0 +4
    CreateShortCut "${linkPath}" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "${linkPath}" "${APP_ID}"
!macroend

!macro customInstall
  # Start the freshly installed executable directly instead of going through a shortcut.
  # This keeps first launch working even if Windows preserves or resolves a stale .lnk.
  IfFileExists "$appExe" 0 +2
    StrCpy $launchLink "$appExe"

  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    !insertmacro haoloRefreshShortcut "$newStartMenuLink"
  !endif

  !ifdef HAOLO_MANAGE_DESKTOP_SHORTCUT
    StrCpy $haoloShortcutOptOut ""
    ${if} ${isNoDesktopShortcut}
      StrCpy $haoloShortcutOptOut "-OptOut"
    ${endif}
    haolo_shortcut_retry:
      StrCpy $0 "CurrentUser"
      ${if} $installMode == "all"
        StrCpy $0 "AllUsers"
      ${endif}
      nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\haolo-shortcut.ps1" -Action Install -Scope "$0" -InstallDir "$INSTDIR" -SnapshotFile "$PLUGINSDIR\haolo-shortcut-before.json" $haoloShortcutOptOut'
      Pop $haoloShortcutExit
      Pop $haoloShortcutOutput
      ${if} $haoloShortcutExit != "0"
        DetailPrint "HaoLo desktop shortcut: $haoloShortcutOutput"
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(haoloShortcutFailure)" /SD IDCANCEL IDRETRY haolo_shortcut_retry
        # Silent installs also expose the incomplete shortcut result to callers.
        SetErrorLevel 2
      ${else}
        SetErrorLevel 0
      ${endif}
  !endif
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHELL_CONTEXT "Software\HaoLo\DesktopShortcut\${APP_GUID}"
  ${endif}
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.haolo.chrome"
  Delete "$APPDATA\haolo_desktop\chrome-native-host\com.haolo.chrome.json"
  RMDir "$APPDATA\haolo_desktop\chrome-native-host"
!macroend
