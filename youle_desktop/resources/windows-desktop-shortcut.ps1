param(
  [ValidateSet('Snapshot','Install','Recover','Restore','Disable','Status')][string]$Action = 'Status',
  [ValidateSet('CurrentUser','AllUsers')][string]$Scope = 'CurrentUser',
  [string]$InstallDir,
  [string]$SnapshotFile,
  [switch]$OptOut
)

# The installer and packaged application use the same policy and native writer.
# No taskbar or Start Menu links are read, changed, or unpinned here.
$ErrorActionPreference = 'Stop'
$script:HaoloAppId = 'local.haolo.desktop'
$script:HaoloInstallKey = 'Software\d4c2c60d-33e6-5907-bc77-3ad20bbc60d5'
# Outside electron-builder's install key: old uninstallers delete that entire key on update.
$script:HaoloStateKey = 'Software\HaoLo\DesktopShortcut\d4c2c60d-33e6-5907-bc77-3ad20bbc60d5'

function Initialize-HaoloShellLink {
  if ('Haolo.ShortcutNative' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Principal;
namespace Haolo {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr data, int flags);
    void GetIDList(out IntPtr id); void SetIDList(IntPtr id);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetHotkey(out short key); void SetHotkey(short key);
    void GetShowCmd(out int cmd); void SetShowCmd(int cmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string text, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string text, int reserved);
    void Resolve(IntPtr window, int flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string text);
  }
  [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Sequential)] struct PropVariant { public ushort type, r1, r2, r3; public IntPtr value; public int tail; }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  interface IPropertyStore {
    void GetCount(out uint count); void GetAt(uint index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
    void SetValue(ref PropertyKey key, ref PropVariant value); void Commit();
  }
  public class ShortcutInfo { public string Target, Icon, AppId; public int IconIndex; }
  public static class ShortcutNative {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
    [DllImport("shell32.dll")] static extern void SHChangeNotify(uint change, uint flags, IntPtr one, IntPtr two);
    [DllImport("wtsapi32.dll", EntryPoint="WTSQuerySessionInformationW", ExactSpelling=true)]
    static extern bool QuerySession(IntPtr server, int session, int info, out IntPtr buffer, out uint length);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
    static string SessionText(int info) {
      IntPtr buffer = IntPtr.Zero; uint length;
      try { return QuerySession(IntPtr.Zero, -1, info, out buffer, out length) ? Marshal.PtrToStringUni(buffer) : ""; }
      finally { if (buffer != IntPtr.Zero) WTSFreeMemory(buffer); }
    }
    public static string InteractiveSid() {
      string user = SessionText(5), domain = SessionText(7);
      if (String.IsNullOrEmpty(user)) return "";
      return new NTAccount(domain, user).Translate(typeof(SecurityIdentifier)).Value;
    }
    static PropertyKey AppIdKey() { return new PropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = 5 }; }
    public static ShortcutInfo Read(string path) {
      object obj = new ShellLink();
      try {
        ((IPersistFile)obj).Load(path, 0);
        var link = (IShellLinkW)obj; var target = new StringBuilder(32768); var icon = new StringBuilder(32768); int index;
        link.GetPath(target, target.Capacity, IntPtr.Zero, 4); link.GetIconLocation(icon, icon.Capacity, out index);
        var key = AppIdKey(); PropVariant value; ((IPropertyStore)obj).GetValue(ref key, out value);
        string appId;
        try { appId = value.type == 31 ? Marshal.PtrToStringUni(value.value) : ""; } finally { PropVariantClear(ref value); }
        return new ShortcutInfo { Target = target.ToString(), Icon = icon.ToString(), IconIndex = index, AppId = appId };
      } finally { Marshal.FinalReleaseComObject(obj); }
    }
    public static void Write(string path, string target, string icon, string appId) {
      object obj = new ShellLink();
      try {
        var link = (IShellLinkW)obj; link.SetPath(target); link.SetWorkingDirectory(Path.GetDirectoryName(target));
        link.SetArguments(""); link.SetDescription("HaoLo"); link.SetIconLocation(icon, 0); link.SetShowCmd(1);
        var key = AppIdKey(); var value = new PropVariant { type = 31, value = Marshal.StringToCoTaskMemUni(appId) };
        try { ((IPropertyStore)obj).SetValue(ref key, ref value); ((IPropertyStore)obj).Commit(); } finally { PropVariantClear(ref value); }
        ((IPersistFile)obj).Save(path, true);
      } finally { Marshal.FinalReleaseComObject(obj); }
    }
    public static void Refresh() { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); }
  }
}
'@
}

function Get-HaoloSid { return [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
function Get-HaoloInteractiveSid {
  # A manually elevated per-user installer can otherwise target an administrator's
  # desktop instead of the person using the interactive session.
  try { Initialize-HaoloShellLink; return [Haolo.ShortcutNative]::InteractiveSid() } catch { }
  return ''
}
function Get-HaoloDesktop([string]$scopeName) {
  # Windows resolves redirection/OneDrive here; never guess USERPROFILE\Desktop.
  if ($scopeName -eq 'AllUsers') { return [Environment]::GetFolderPath('CommonDesktopDirectory') }
  return [Environment]::GetFolderPath('DesktopDirectory')
}
function Open-HaoloRegistry([string]$scopeName) {
  $hive = if ($scopeName -eq 'AllUsers') { [Microsoft.Win32.RegistryHive]::LocalMachine } else { [Microsoft.Win32.RegistryHive]::CurrentUser }
  return [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
}
function Read-HaoloInstallDir([string]$scopeName) {
  $root = Open-HaoloRegistry $scopeName
  try { $key = $root.OpenSubKey($script:HaoloInstallKey); if (!$key) { return '' }; try { return [string]$key.GetValue('InstallLocation','') } finally { $key.Dispose() } } finally { $root.Dispose() }
}
function Read-HaoloShortcutState([string]$scopeName) {
  $root = Open-HaoloRegistry $scopeName
  try {
    $key = $root.OpenSubKey($script:HaoloStateKey)
    if (!$key) { return $null }
    try { $json = [string]$key.GetValue('State',''); if (!$json) { return $null }; return ConvertFrom-Json $json } finally { $key.Dispose() }
  } finally { $root.Dispose() }
}
function Write-HaoloShortcutState([string]$scopeName, $state) {
  $root = Open-HaoloRegistry $scopeName
  try { $key = $root.CreateSubKey($script:HaoloStateKey); try { $key.SetValue('State',($state | ConvertTo-Json -Compress -Depth 8)); $key.Flush() } finally { $key.Dispose() } } finally { $root.Dispose() }
}
function Test-HaoloPathEqual([string]$one,[string]$two) {
  if (!$one -or !$two) { return $false }
  return [string]::Equals([IO.Path]::GetFullPath($one).TrimEnd('\'),[IO.Path]::GetFullPath($two).TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)
}
function Test-HaoloStateBinding($state,[string]$scopeName,[string]$directory) {
  return $null -ne $state -and $state.Schema -eq 1 -and $state.Scope -eq $scopeName -and
    ($scopeName -eq 'AllUsers' -or $state.Sid -eq (Get-HaoloSid)) -and (Test-HaoloPathEqual $state.InstallDir $directory)
}
function Read-HaoloLink([string]$linkPath) {
  if (!(Test-Path -LiteralPath $linkPath -PathType Leaf)) { return $null }
  try { Initialize-HaoloShellLink; return [Haolo.ShortcutNative]::Read($linkPath) } catch { return $null }
}
function Test-HaoloOwnedLink($link,[string]$directory) {
  if (!$link) { return $false }
  return $link.AppId -eq $script:HaoloAppId -or ($directory -and (Test-HaoloPathEqual $link.Target (Join-Path $directory 'haolo_desktop.exe')))
}
function Get-HaoloShortcutSnapshot {
  $entries = @()
  foreach ($scopeName in @('CurrentUser','AllUsers')) {
    $directory = Read-HaoloInstallDir $scopeName
    $installed = [bool]($directory -and (Test-Path -LiteralPath (Join-Path $directory 'haolo_desktop.exe') -PathType Leaf))
    $desktopPath = Get-HaoloDesktop $scopeName
    $links = @()
    if ($desktopPath) {
      foreach ($name in @('HaoLo',([string][char]0x597d+[char]0x54af))) {
        $linkPath = Join-Path $desktopPath ($name+'.lnk')
        if (Test-HaoloOwnedLink (Read-HaoloLink $linkPath) $directory) { $links += $linkPath }
      }
    }
    $entries += [pscustomobject]@{ Scope=$scopeName; InstallDir=$directory; Installed=$installed; Links=$links; State=(Read-HaoloShortcutState $scopeName) }
  }
  return [pscustomobject]@{ Schema=1; Sid=(Get-HaoloSid); InteractiveSid=(Get-HaoloInteractiveSid); Entries=$entries }
}
function Get-HaoloShortcutDecision($snapshot,[string]$scopeName,[bool]$optOutValue,[string]$directory='') {
  if ($optOutValue) { return 'opted-out' }
  if (!$snapshot -or $snapshot.Schema -ne 1 -or $snapshot.Sid -ne (Get-HaoloSid)) { throw 'Installation snapshot is missing or belongs to another account.' }
  if ($scopeName -eq 'CurrentUser' -and $snapshot.InteractiveSid -and $snapshot.InteractiveSid -ne $snapshot.Sid) { throw 'Install for the account using this desktop, or select installation for all users.' }
  $entry = @($snapshot.Entries | Where-Object Scope -eq $scopeName)[0]
  if (!$entry) { throw 'Installation scope snapshot is missing.' }
  $desktopPath = Get-HaoloDesktop $scopeName
  $linkPath = if ($desktopPath) { Join-Path $desktopPath 'HaoLo.lnk' } else { '' }
  if ($linkPath -and (Test-HaoloOwnedLink (Read-HaoloLink $linkPath) $entry.InstallDir)) { return 'existing' }
  # Snapshot is evidence of the previous install, not reusable authorization.
  # Re-read the state under our mutex: startup or an earlier Retry may already
  # have consumed a pending/fresh creation while the installer UI was open.
  $stateDirectory = if ($entry.InstallDir) { $entry.InstallDir } else { $entry.State.InstallDir }
  $liveState = Read-HaoloShortcutState $scopeName
  $liveBound = (Test-HaoloStateBinding $liveState $scopeName $stateDirectory) -or (Test-HaoloStateBinding $liveState $scopeName $directory)
  if ($liveBound -and $liveState.Status -ne 'pending') { return 'preserved-absent' }
  # A previously observed current-name link must never fall back to creation.
  if (@($entry.Links | Where-Object { [IO.Path]::GetFileName($_) -eq 'HaoLo.lnk' }).Count -gt 0) { return 'preserved-absent' }
  if ($liveBound -and $liveState.Status -eq 'pending') { return 'pending' }
  if (Test-HaoloStateBinding $entry.State $scopeName $stateDirectory) { return 'preserved-absent' }
  # Legacy links may be renamed only while they still exist, with no recorded
  # deletion/opt-out. A failed rename must not create a second link.
  if ($desktopPath) {
    $legacyPath = Join-Path $desktopPath (([string][char]0x597d+[char]0x54af)+'.lnk')
    if ((@($entry.Links) -contains $legacyPath) -and (Test-HaoloOwnedLink (Read-HaoloLink $legacyPath) $entry.InstallDir)) { return 'legacy' }
  }
  if (@($entry.Links).Count -gt 0) { return 'preserved-absent' }
  if (@($snapshot.Entries | Where-Object Installed).Count -gt 0) { return 'preserved-absent' }
  return 'fresh'
}
function New-HaoloShortcutState([string]$scopeName,[string]$directory,[string]$status,[string]$reason='') {
  return [pscustomobject]@{ Schema=1; Scope=$scopeName; Sid=(Get-HaoloSid); InstallDir=[IO.Path]::GetFullPath($directory); Status=$status; Reason=$reason; UpdatedUtc=[DateTime]::UtcNow.ToString('o') }
}
function Publish-HaoloDesktopLink([string]$temporary,[string]$linkPath,[bool]$replaceExisting) {
  # Replace fails if the user deleted the destination. Never retry it as Move.
  if ($replaceExisting) { [IO.File]::Replace($temporary,$linkPath,$null) } else { [IO.File]::Move($temporary,$linkPath) }
}
function Write-HaoloDesktopLink([string]$scopeName,[string]$directory,[string]$mode='fresh') {
  $desktopPath = Get-HaoloDesktop $scopeName
  if (!$desktopPath -or !(Test-Path -LiteralPath $desktopPath -PathType Container)) { throw 'The Windows desktop folder is unavailable.' }
  $target = Join-Path $directory 'haolo_desktop.exe'
  if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw 'The installed HaoLo executable is unavailable.' }
  $linkPath = Join-Path $desktopPath 'HaoLo.lnk'
  if ($mode -eq 'legacy' -and !(Test-Path -LiteralPath $linkPath)) {
    $legacyPath = Join-Path $desktopPath (([string][char]0x597d+[char]0x54af)+'.lnk')
    if (!(Test-Path -LiteralPath $legacyPath)) { return $null }
    if (!(Test-HaoloOwnedLink (Read-HaoloLink $legacyPath) $directory)) { throw 'The legacy desktop shortcut is not readable or does not belong to HaoLo.' }
    try { [IO.File]::Move($legacyPath,$linkPath) }
    catch { if (!(Test-Path -LiteralPath $legacyPath) -and !(Test-Path -LiteralPath $linkPath)) { return $null }; throw }
  }
  $replaceExisting = [bool](Test-Path -LiteralPath $linkPath)
  if ($mode -in @('existing','legacy') -and !$replaceExisting) { return $null }
  if ((Test-Path -LiteralPath $linkPath) -and !(Test-HaoloOwnedLink (Read-HaoloLink $linkPath) $directory)) { throw 'An unrelated or unreadable HaoLo.lnk already exists; it was not overwritten.' }
  $icon = Join-Path $directory 'resources\haolo-logo.ico'
  if (!(Test-Path -LiteralPath $icon -PathType Leaf)) { $icon = $target }
  $old = Read-HaoloLink $linkPath
  if ($old -and (Test-HaoloPathEqual $old.Target $target) -and (Test-HaoloPathEqual $old.Icon $icon) -and $old.AppId -eq $script:HaoloAppId -and $old.IconIndex -eq 0) { return $linkPath }
  $temporary = Join-Path $desktopPath ('.HaoLo-'+[guid]::NewGuid().ToString('N')+'.lnk')
  $published = $false
  try {
    Initialize-HaoloShellLink
    [Haolo.ShortcutNative]::Write($temporary,$target,$icon,$script:HaoloAppId)
    $check = [Haolo.ShortcutNative]::Read($temporary)
    if (!(Test-HaoloPathEqual $check.Target $target) -or !(Test-HaoloPathEqual $check.Icon $icon) -or $check.AppId -ne $script:HaoloAppId -or $check.IconIndex -ne 0) { throw 'Desktop shortcut validation failed.' }
    try { Publish-HaoloDesktopLink $temporary $linkPath $replaceExisting }
    catch { if ($replaceExisting -and !(Test-Path -LiteralPath $linkPath)) { return $null }; throw }
    $published = $true
    $check = [Haolo.ShortcutNative]::Read($linkPath)
    if (!(Test-HaoloPathEqual $check.Target $target) -or $check.AppId -ne $script:HaoloAppId) { throw 'Published desktop shortcut validation failed.' }
    [Haolo.ShortcutNative]::Refresh()
    return $linkPath
  } catch {
    if ($published) { $_.Exception.Data['HaoloShortcutPublished'] = $true }
    throw
  } finally { if (Test-Path -LiteralPath $temporary -PathType Leaf) { [IO.File]::Delete($temporary) } }
}
function Ensure-HaoloDesktopShortcut([string]$scopeName,[string]$directory,[string]$reason) {
  if ($reason -in @('preserved-absent','opted-out')) {
    Write-HaoloShortcutState $scopeName (New-HaoloShortcutState $scopeName $directory $reason)
    return [pscustomobject]@{ Status=$reason; Scope=$scopeName }
  }
  # Consume authorization BEFORE writing the link. An interrupted/failed state
  # acknowledgement must never leave a replayable pending record after success.
  Write-HaoloShortcutState $scopeName (New-HaoloShortcutState $scopeName $directory 'attempting' $reason)
  $lastError = ''; $ambiguousWrite = $false
  for ($attempt=0; $attempt -lt 3; $attempt++) {
    try {
      $linkPath = Write-HaoloDesktopLink $scopeName $directory $reason
      $lastError = ''; break
    } catch {
      $lastError=$_.Exception.Message
      if ($_.Exception.Data['HaoloShortcutPublished']) { $ambiguousWrite = $true; break }
      if ($attempt -lt 2) { Start-Sleep -Milliseconds 250 }
    }
  }
  # A state acknowledgement failure must not be retried as a link creation.
  # Keep this outside the writer's retry loop, like the verified acknowledgement.
  if (!$lastError -and !$linkPath) {
    Write-HaoloShortcutState $scopeName (New-HaoloShortcutState $scopeName $directory 'preserved-absent')
    return [pscustomobject]@{ Status='preserved-absent'; Scope=$scopeName }
  }
  if ($lastError) {
    # If a link appeared despite an ambiguous write failure, don't authorize
    # future recreation: the user could subsequently delete that link.
    $desktopPath = Get-HaoloDesktop $scopeName
    $hasLink = $desktopPath -and (Test-Path -LiteralPath (Join-Path $desktopPath 'HaoLo.lnk'))
    $status = if (!$ambiguousWrite -and !$hasLink -and $reason -in @('fresh','pending','explicit')) { 'pending' } else { 'attention' }
    Write-HaoloShortcutState $scopeName (New-HaoloShortcutState $scopeName $directory $status $lastError)
    return [pscustomobject]@{ Status=$status; Scope=$scopeName; Error=$lastError }
  }
  Write-HaoloShortcutState $scopeName (New-HaoloShortcutState $scopeName $directory 'verified')
  return [pscustomobject]@{ Status='verified'; Scope=$scopeName; Path=$linkPath }
}
function Invoke-HaoloShortcutAction {
  if ($Action -eq 'Snapshot') {
    Get-HaoloShortcutSnapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $SnapshotFile -Encoding UTF8
    return [pscustomobject]@{ Status='snapshot' }
  }
  if (!$InstallDir) { throw 'An installation directory is required.' }
  if ($Action -eq 'Install') {
    $snapshot = Get-Content -LiteralPath $SnapshotFile -Raw | ConvertFrom-Json
    $reason = Get-HaoloShortcutDecision $snapshot $Scope ([bool]$OptOut) $InstallDir
    $result = Ensure-HaoloDesktopShortcut $Scope $InstallDir $reason
    if ($result.Status -eq 'verified') {
      # Finish a legacy-name migration even when the user does not launch the app
      # after installation. Only remove a link captured as ours in the same scope.
      $entry = @($snapshot.Entries | Where-Object Scope -eq $Scope)[0]
      foreach ($oldLink in @($entry.Links)) {
        if (!(Test-HaoloPathEqual $oldLink $result.Path) -and (Test-HaoloOwnedLink (Read-HaoloLink $oldLink) $entry.InstallDir)) {
          try { [IO.File]::Delete($oldLink) } catch { }
        }
      }
    }
    return $result
  }
  if ($Action -eq 'Restore') {
    $publicDesktop = Get-HaoloDesktop 'AllUsers'
    if ($publicDesktop) {
      $publicLinkPath = Join-Path $publicDesktop 'HaoLo.lnk'
      $publicLink = Read-HaoloLink $publicLinkPath
      if ($publicLink -and $publicLink.AppId -eq $script:HaoloAppId -and (Test-HaoloPathEqual $publicLink.Target (Join-Path $InstallDir 'haolo_desktop.exe'))) {
        Write-HaoloShortcutState 'CurrentUser' (New-HaoloShortcutState 'CurrentUser' $InstallDir 'verified')
        return [pscustomobject]@{ Status='verified'; Scope='AllUsers'; Path=$publicLinkPath }
      }
    }
    return Ensure-HaoloDesktopShortcut 'CurrentUser' $InstallDir 'explicit'
  }
  if ($Action -eq 'Disable') {
    Write-HaoloShortcutState 'CurrentUser' (New-HaoloShortcutState 'CurrentUser' $InstallDir 'opted-out')
    $linkPath = Join-Path (Get-HaoloDesktop 'CurrentUser') 'HaoLo.lnk'
    if (Test-HaoloOwnedLink (Read-HaoloLink $linkPath) $InstallDir) { [IO.File]::Delete($linkPath); [Haolo.ShortcutNative]::Refresh() }
    return [pscustomobject]@{ Status='opted-out' }
  }
  foreach ($scopeName in @('CurrentUser','AllUsers')) {
    $state = Read-HaoloShortcutState $scopeName
    if (!(Test-HaoloStateBinding $state $scopeName $InstallDir)) { continue }
    if ($Action -eq 'Recover' -and $state.Status -eq 'pending') { return Ensure-HaoloDesktopShortcut $scopeName $InstallDir 'pending' }
    # A per-user explicit choice also wins over a leftover machine-wide failure.
    return [pscustomobject]@{ Status='unchanged' }
  }
  return [pscustomobject]@{ Status='unchanged' }
}

# Dot-sourcing defines the native adapter/policy for isolated tests, without I/O.
if ($MyInvocation.InvocationName -eq '.') { return }
function Write-HaoloShortcutDiagnostic($result) {
  try {
    $logDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HaoLo\logs'
    [IO.Directory]::CreateDirectory($logDirectory) | Out-Null
    $logPath = Join-Path $logDirectory 'desktop-shortcut.jsonl'
    # Keep this diagnostic bounded and independent from credentials/chat logs.
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 262144) { [IO.File]::WriteAllText($logPath,'') }
    $line = [ordered]@{ Time=[DateTime]::UtcNow.ToString('o'); Action=$Action; Scope=$Scope; Sid=(Get-HaoloSid); InstallDir=$InstallDir; Result=$result } | ConvertTo-Json -Compress -Depth 8
    [IO.File]::AppendAllText($logPath,($line+[Environment]::NewLine),[Text.Encoding]::UTF8)
  } catch { }
}
$mutex = $null; $locked = $false
try {
  $mutex = New-Object Threading.Mutex($false, 'Global\HaoloDesktopShortcut-d4c2c60d-33e6-5907-bc77-3ad20bbc60d5')
  try { $locked = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (!$locked) { throw 'Desktop shortcut operation is already running.' }
  $result = Invoke-HaoloShortcutAction
  Write-HaoloShortcutDiagnostic $result
  $result | ConvertTo-Json -Compress -Depth 12
  if ($result.Status -in @('pending','attention')) { exit 2 }
} catch {
  $result = [pscustomobject]@{ Status='error'; Error=$_.Exception.Message }
  Write-HaoloShortcutDiagnostic $result
  $result | ConvertTo-Json -Compress
  exit 3
} finally { if ($locked) { $mutex.ReleaseMutex() }; if ($mutex) { $mutex.Dispose() } }
