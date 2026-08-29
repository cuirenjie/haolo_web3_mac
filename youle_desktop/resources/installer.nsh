!define MUI_DIRECTORYPAGE_VERIFYONLEAVE

# Older Haolo clients launched downloaded installers without --updated. Treat an
# existing per-user installation as an update so electron-builder passes
# --keep-shortcuts to the old uninstaller and preserves taskbar pins. Keep the
# uninstaller's own isUpdated behavior parameter-only.
!ifndef BUILD_UNINSTALLER
  !macro _haoloIsUpdated _a _b _t _f
    ${StdUtils.TestParameter} $R9 "updated"
    StrCmp "$R9" "true" `${_t}` 0
    ReadRegStr $R9 HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp "$R9" "" `${_f}` `${_t}`
  !macroend

  !undef isUpdated
  !define isUpdated `"" haoloIsUpdated ""`
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

  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      !insertmacro haoloRefreshShortcut "$newDesktopLink"
    ${endIf}
  !endif
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.haolo.chrome"
  Delete "$APPDATA\haolo_desktop\chrome-native-host\com.haolo.chrome.json"
  RMDir "$APPDATA\haolo_desktop\chrome-native-host"
!macroend
