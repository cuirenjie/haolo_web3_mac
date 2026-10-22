param([string]$Root)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../resources/windows-desktop-shortcut.ps1')
$script:NativeWriter = ${function:Write-HaoloDesktopLink}
$script:NativePublisher = ${function:Publish-HaoloDesktopLink}
# Exercise the actual local session API without printing account information.
Initialize-HaoloShellLink
$nativeSessionSid = [Haolo.ShortcutNative]::InteractiveSid()
if ($nativeSessionSid -and $nativeSessionSid -notmatch '^S-1-') { throw 'Invalid native session SID' }
$script:States=@{}; $script:InstallDirs=@{}; $script:Folders=@{}
function Get-HaoloSid { 'S-1-5-21-haolo-test' }
function Get-HaoloInteractiveSid { Get-HaoloSid }
function Get-HaoloDesktop([string]$scopeName) { $script:Folders[$scopeName] }
function Read-HaoloInstallDir([string]$scopeName) { $script:InstallDirs[$scopeName] }
function Read-HaoloShortcutState([string]$scopeName) { $script:States[$scopeName] }
function Write-HaoloShortcutState([string]$scopeName,$state) { $script:States[$scopeName] = $state | ConvertTo-Json | ConvertFrom-Json }
$script:MemoryWriter = ${function:Write-HaoloShortcutState}
$script:Count=0
function Assert($condition,[string]$message) { if (!$condition) { throw $message } }
function Get-LinkBytes([string]$linkPath) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($linkPath)) }
function Reset-Fixture {
  $script:States=@{}; $script:InstallDirs=@{}; $script:Folders=@{}
  $fixture=Join-Path $Root ([guid]::NewGuid().ToString('N'))
  $script:Directory=Join-Path $fixture '安装目录 with spaces'
  [IO.Directory]::CreateDirectory($script:Directory) | Out-Null
  [IO.File]::WriteAllText((Join-Path $script:Directory 'haolo_desktop.exe'),'dummy target; never executed')
  foreach ($scopeName in @('CurrentUser','AllUsers')) {
    $script:Folders[$scopeName]=Join-Path $fixture ($scopeName+' 重定向桌面')
    [IO.Directory]::CreateDirectory($script:Folders[$scopeName]) | Out-Null
  }
  Set-Item Function:\Write-HaoloDesktopLink $script:NativeWriter
  Set-Item Function:\Publish-HaoloDesktopLink $script:NativePublisher
  Set-Item Function:\Write-HaoloShortcutState $script:MemoryWriter
  $script:Action='Recover'; $script:InstallDir=$script:Directory
  $script:Link=Join-Path $script:Folders.CurrentUser 'HaoLo.lnk'
}
function Case([string]$name,[scriptblock]$body) { Reset-Fixture; & $body; $script:Count++; Write-Output ('PASS '+$name) }

Case 'fresh installation creates a real Unicode-path link with target/icon/AppUserModelID' {
  $snapshot=Get-HaoloShortcutSnapshot
  Assert ((Get-HaoloShortcutDecision $snapshot CurrentUser $false) -eq 'fresh') 'fresh classification'
  $result=Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh
  $link=Read-HaoloLink $script:Link
  Assert ($result.Status -eq 'verified') 'verified result'
  Assert (Test-HaoloPathEqual $link.Target (Join-Path $script:Directory 'haolo_desktop.exe')) 'target'
  Assert ($link.AppId -eq 'local.haolo.desktop') 'AUMI'
  Assert ($script:States.CurrentUser.Status -eq 'verified') 'durable verification'
}
Case 'normal update keeps a valid link byte-for-byte and never touches taskbar sentinel' {
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh | Out-Null
  $script:InstallDirs.CurrentUser=$script:Directory
  $before=Get-LinkBytes $script:Link
  $taskbar=Join-Path $Root 'TaskBar-user-pin.lnk'; [IO.File]::WriteAllText($taskbar,'pinned sentinel')
  $snapshot=Get-HaoloShortcutSnapshot
  Assert ((Get-HaoloShortcutDecision $snapshot CurrentUser $false) -eq 'existing') 'update existing'
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory existing | Out-Null
  Assert ((Get-LinkBytes $script:Link) -eq $before) 'link changed unnecessarily'
  Assert ([IO.File]::ReadAllText($taskbar) -eq 'pinned sentinel') 'taskbar changed'
}
Case 'manual deletion after successful first install survives startup AND update' {
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh | Out-Null
  $script:InstallDirs.CurrentUser=$script:Directory
  [IO.File]::Delete($script:Link)
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'startup recreated deleted link'
  $decision=Get-HaoloShortcutDecision (Get-HaoloShortcutSnapshot) CurrentUser $false
  Assert ($decision -eq 'preserved-absent') 'update lost deletion intent'
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory $decision | Out-Null
  Assert (!(Test-Path -LiteralPath $script:Link)) 'deleted link recreated'
}
Case 'legacy upgrade without a marker preserves a missing shortcut' {
  $script:InstallDirs.CurrentUser=$script:Directory
  Assert ((Get-HaoloShortcutDecision (Get-HaoloShortcutSnapshot) CurrentUser $false) -eq 'preserved-absent') 'legacy deletion'
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'legacy startup'
}
Case 'stale registry with missing old executable is fresh' {
  $script:InstallDirs.CurrentUser=Join-Path $Root 'nonexistent-old-install'
  Assert ((Get-HaoloShortcutDecision (Get-HaoloShortcutSnapshot) CurrentUser $false) -eq 'fresh') 'registry alone considered installed'
}
Case 'recorded deletion or opt-out survives an interrupted upgrade losing old installation evidence' {
  [IO.File]::Delete((Join-Path $script:Directory 'haolo_desktop.exe'))
  foreach ($status in @('verified','attempting','attention','preserved-absent','opted-out')) {
    $script:States.CurrentUser=New-HaoloShortcutState CurrentUser $script:Directory $status
    $script:InstallDirs.CurrentUser=$script:Directory
    Assert ((Get-HaoloShortcutDecision (Get-HaoloShortcutSnapshot) CurrentUser $false) -eq 'preserved-absent') ('lost executable reset '+$status)
    $script:InstallDirs=@{}
    Assert ((Get-HaoloShortcutDecision (Get-HaoloShortcutSnapshot) CurrentUser $false) -eq 'preserved-absent') ('lost registry reset '+$status)
  }
}
Case 'pending first-install failure recovers and cannot recreate a later user deletion' {
  $original=$script:Folders.CurrentUser; $script:Folders.CurrentUser=Join-Path $Root 'missing-desktop'
  Assert ((Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh).Status -eq 'pending') 'failure not retained'
  $script:Folders.CurrentUser=$original
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'verified') 'recovery failed'
  [IO.File]::Delete($script:Link)
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'recovery replayed'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'deleted recovered link recreated'
}
Case 'pending state survives simulated old uninstaller deleting installation records' {
  $script:States.CurrentUser=New-HaoloShortcutState CurrentUser $script:Directory pending
  $script:InstallDirs.CurrentUser=$script:Directory
  $snapshot=Get-HaoloShortcutSnapshot
  $script:InstallDirs=@{}
  Assert ((Get-HaoloShortcutDecision $snapshot CurrentUser $false) -eq 'pending') 'snapshot lost pending'
  Assert ((Ensure-HaoloDesktopShortcut CurrentUser $script:Directory pending).Status -eq 'verified') 'pending update failed'
}
Case 'opt out cancels pending and suppresses startup restoration' {
  $script:States.CurrentUser=New-HaoloShortcutState CurrentUser $script:Directory pending
  $decision=Get-HaoloShortcutDecision (Get-HaoloShortcutSnapshot) CurrentUser $true
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory $decision | Out-Null
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'opt-out recovered'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'opt-out link created'
}
Case 'all-users fresh install writes only the public desktop' {
  Ensure-HaoloDesktopShortcut AllUsers $script:Directory fresh | Out-Null
  Assert (Test-Path -LiteralPath (Join-Path $script:Folders.AllUsers 'HaoLo.lnk')) 'public link missing'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'duplicate user link'
}
Case 'user scope upgrade of all-users installation is not mistaken for fresh' {
  $script:InstallDirs.AllUsers=$script:Directory
  Assert ((Get-HaoloShortcutDecision (Get-HaoloShortcutSnapshot) CurrentUser $false) -eq 'preserved-absent') 'cross scope deletion lost'
}
Case 'wrong user or installation binding cannot trigger recovery' {
  $state=New-HaoloShortcutState CurrentUser $script:Directory pending
  $state.Sid='another-user'; $script:States.CurrentUser=$state
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'wrong SID recovered'
  $state.Sid=Get-HaoloSid; $state.InstallDir=Join-Path $Root 'another-install'
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'wrong install recovered'
}
Case 'per-user install under a different interactive account is reported' {
  $snapshot=Get-HaoloShortcutSnapshot; $snapshot.InteractiveSid='another-account'
  $caught=$false; try { Get-HaoloShortcutDecision $snapshot CurrentUser $false | Out-Null } catch { $caught=$true }
  Assert $caught 'account mismatch ignored'
  Assert ((Get-HaoloShortcutDecision $snapshot AllUsers $false) -eq 'fresh') 'all-users unnecessarily rejected'
}
Case 'failed state acknowledgement after link creation cannot authorize future resurrection' {
  function Write-HaoloShortcutState([string]$scopeName,$state) {
    if ($state.Status -eq 'verified') { throw 'injected state acknowledgement failure' }
    & $script:MemoryWriter $scopeName $state
  }
  $caught=$false; try { Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh | Out-Null } catch { $caught=$true }
  Assert $caught 'fault not reached'
  Assert ($script:States.CurrentUser.Status -eq 'attempting') 'replayable pending state left'
  Assert (Test-Path -LiteralPath $script:Link) 'link was not created'
  [IO.File]::Delete($script:Link)
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'ambiguous attempt replayed'
}
Case 'failure to persist attempt prevents creation' {
  function Write-HaoloShortcutState([string]$scopeName,$state) { throw 'injected access denied' }
  $caught=$false; try { Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh | Out-Null } catch { $caught=$true }
  Assert $caught 'access failure ignored'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'created without durable intent consumption'
}
Case 'bounded retries recover transient failures' {
  $script:Attempts=0
  function Write-HaoloDesktopLink([string]$scopeName,[string]$directory) {
    $script:Attempts++; if ($script:Attempts -lt 3) { throw 'injected temporary lock' }; & $script:NativeWriter $scopeName $directory
  }
  Assert ((Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh).Status -eq 'verified') 'retry failed'
  Assert ($script:Attempts -eq 3) 'retry count'
}
Case 'unrelated shortcut is preserved and never treated as a successful app link' {
  Initialize-HaoloShellLink
  [Haolo.ShortcutNative]::Write($script:Link,'C:\Windows\notepad.exe','C:\Windows\notepad.exe','another.app')
  $before=Get-LinkBytes $script:Link
  Assert ((Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh).Status -eq 'attention') 'unrelated conflict ignored'
  Assert ((Get-LinkBytes $script:Link) -eq $before) 'unrelated shortcut overwritten'
}
Case 'locked existing link is preserved and does not become a missing-link repair authorization' {
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh | Out-Null
  $newDir=Join-Path $Root 'moved-install'; [IO.Directory]::CreateDirectory($newDir) | Out-Null
  [IO.File]::WriteAllText((Join-Path $newDir 'haolo_desktop.exe'),'dummy')
  $handle=[IO.File]::Open($script:Link,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  try { Assert ((Ensure-HaoloDesktopShortcut CurrentUser $newDir existing).Status -eq 'attention') 'locked link ignored' } finally { $handle.Dispose() }
  Assert (Test-Path -LiteralPath $script:Link) 'locked link deleted'
}
Case 'explicit restore and disable do not leave auto-repair authorization' {
  $script:Action='Restore'; Assert ((Invoke-HaoloShortcutAction).Status -eq 'verified') 'manual restore failed'
  $script:Action='Disable'; Assert ((Invoke-HaoloShortcutAction).Status -eq 'opted-out') 'manual disable failed'
  $script:Action='Recover'; Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'disabled link restored'
}
Case 'manual restore reuses a valid public shortcut without creating a duplicate' {
  Ensure-HaoloDesktopShortcut AllUsers $script:Directory fresh | Out-Null
  $script:Action='Restore'; Assert ((Invoke-HaoloShortcutAction).Scope -eq 'AllUsers') 'public shortcut not reused'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'duplicate current-user shortcut'
}
Case 'per-user opt out suppresses a leftover machine-wide pending repair' {
  $script:States.AllUsers=New-HaoloShortcutState AllUsers $script:Directory pending
  $script:States.CurrentUser=New-HaoloShortcutState CurrentUser $script:Directory opted-out
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'user choice overridden'
  Assert (!(Test-Path -LiteralPath (Join-Path $script:Folders.AllUsers 'HaoLo.lnk'))) 'public pending restored despite opt out'
}
Case 'legacy desktop name is migrated at install completion without app startup' {
  $script:InstallDirs.CurrentUser=$script:Directory
  $legacy=Join-Path $script:Folders.CurrentUser (([string][char]0x597d+[char]0x54af)+'.lnk')
  Initialize-HaoloShellLink
  [Haolo.ShortcutNative]::Write($legacy,(Join-Path $script:Directory 'haolo_desktop.exe'),(Join-Path $script:Directory 'haolo_desktop.exe'),'local.haolo.desktop')
  $snapshot=Get-HaoloShortcutSnapshot
  $script:SnapshotFile=Join-Path $Root 'legacy-snapshot.json'; $snapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $script:SnapshotFile -Encoding UTF8
  $script:Action='Install'; $script:Scope='CurrentUser'; $script:OptOut=$false
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'verified') 'migration failed'
  Assert (Test-Path -LiteralPath $script:Link) 'new link missing'
  Assert (!(Test-Path -LiteralPath $legacy)) 'duplicate legacy link'
}
Case 'an update to a different directory preserves a previously absent link' {
  $script:InstallDirs.CurrentUser=$script:Directory
  $snapshot=Get-HaoloShortcutSnapshot
  $newDir=Join-Path $Root 'new-destination'; [IO.Directory]::CreateDirectory($newDir) | Out-Null
  [IO.File]::WriteAllText((Join-Path $newDir 'haolo_desktop.exe'),'dummy')
  $decision=Get-HaoloShortcutDecision $snapshot CurrentUser $false
  Ensure-HaoloDesktopShortcut CurrentUser $newDir $decision | Out-Null
  Assert (!(Test-Path -LiteralPath $script:Link)) 'changed directory resurrected deleted link'
}
function Save-InstallSnapshot {
  $script:SnapshotFile=Join-Path $Root 'installation-snapshot.json'
  Get-HaoloShortcutSnapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $script:SnapshotFile -Encoding UTF8
  $script:Action='Install'; $script:OptOut=$false
}
Case 'deleting an existing shortcut after installer initialization is preserved in both scopes' {
  foreach ($scopeName in @('CurrentUser','AllUsers')) {
    Reset-Fixture
    $script:Scope=$scopeName; $script:InstallDirs[$scopeName]=$script:Directory
    Ensure-HaoloDesktopShortcut $scopeName $script:Directory fresh | Out-Null
    Save-InstallSnapshot
    $link=Join-Path $script:Folders[$scopeName] 'HaoLo.lnk'; [IO.File]::Delete($link)
    Assert ((Invoke-HaoloShortcutAction).Status -eq 'preserved-absent') 'stale existing snapshot recreated link'
    Assert (!(Test-Path -LiteralPath $link)) 'deleted link reappeared'
  }
}
Case 'consumed pending authorization is not replayed from an older installer snapshot' {
  foreach ($scopeName in @('CurrentUser','AllUsers')) {
    Reset-Fixture
    $script:Scope=$scopeName; $script:InstallDirs[$scopeName]=$script:Directory
    $script:States[$scopeName]=New-HaoloShortcutState $scopeName $script:Directory pending
    Save-InstallSnapshot
    $script:Action='Recover'; Assert ((Invoke-HaoloShortcutAction).Status -eq 'verified') 'setup recovery failed'
    $link=Join-Path $script:Folders[$scopeName] 'HaoLo.lnk'; [IO.File]::Delete($link)
    $script:Action='Install'
    Assert ((Invoke-HaoloShortcutAction).Status -eq 'preserved-absent') 'consumed pending replayed'
    Assert (!(Test-Path -LiteralPath $link)) 'deleted recovered link reappeared'
  }
}
Case 'reusing a fresh installation snapshot cannot undo deletion after successful creation' {
  $script:Scope='CurrentUser'; Save-InstallSnapshot
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'verified') 'fresh install failed'
  [IO.File]::Delete($script:Link)
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'preserved-absent') 'fresh snapshot replayed'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'fresh replay created link'
}
Case 'legacy leftovers cannot override recorded deletion or opt-out on update' {
  foreach ($scopeName in @('CurrentUser','AllUsers')) {
    foreach ($status in @('verified','preserved-absent','opted-out','attempting','attention')) {
      Reset-Fixture
      $script:Scope=$scopeName; $script:InstallDirs[$scopeName]=$script:Directory
      $script:States[$scopeName]=New-HaoloShortcutState $scopeName $script:Directory $status
      $legacy=Join-Path $script:Folders[$scopeName] (([string][char]0x597d+[char]0x54af)+'.lnk')
      [Haolo.ShortcutNative]::Write($legacy,(Join-Path $script:Directory 'haolo_desktop.exe'),(Join-Path $script:Directory 'haolo_desktop.exe'),'local.haolo.desktop')
      Save-InstallSnapshot
      Assert ((Invoke-HaoloShortcutAction).Status -eq 'preserved-absent') ('legacy overrode '+$status)
      Assert (!(Test-Path -LiteralPath (Join-Path $script:Folders[$scopeName] 'HaoLo.lnk'))) 'legacy recreated deleted current name'
    }
  }
}
Case 'deleting a legacy shortcut during installation does not create its new name' {
  $script:Scope='CurrentUser'; $script:InstallDirs.CurrentUser=$script:Directory
  $legacy=Join-Path $script:Folders.CurrentUser (([string][char]0x597d+[char]0x54af)+'.lnk')
  [Haolo.ShortcutNative]::Write($legacy,(Join-Path $script:Directory 'haolo_desktop.exe'),(Join-Path $script:Directory 'haolo_desktop.exe'),'local.haolo.desktop')
  Save-InstallSnapshot
  [IO.File]::Delete($legacy)
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'preserved-absent') 'deleted legacy migrated'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'legacy deletion recreated'
}
Case 'deletion at atomic replacement never falls back to creation or retry' {
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh | Out-Null
  $nextDir=Join-Path $Root 'next-install'; [IO.Directory]::CreateDirectory($nextDir) | Out-Null
  [IO.File]::WriteAllText((Join-Path $nextDir 'haolo_desktop.exe'),'dummy')
  $script:PublishCalls=0
  function Publish-HaoloDesktopLink([string]$temporary,[string]$linkPath,[bool]$replaceExisting) {
    $script:PublishCalls++
    Assert $replaceExisting 'existing update requested creation'
    [IO.File]::Delete($linkPath)
    & $script:NativePublisher $temporary $linkPath $replaceExisting
  }
  Assert ((Ensure-HaoloDesktopShortcut CurrentUser $nextDir existing).Status -eq 'preserved-absent') 'replacement recreated missing link'
  Assert ($script:PublishCalls -eq 1) 'replacement retried after deletion'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'atomic replacement undid deletion'
}
Case 'deletion just after publication cannot authorize a retry or future recovery' {
  $script:PublishCalls=0
  function Publish-HaoloDesktopLink([string]$temporary,[string]$linkPath,[bool]$replaceExisting) {
    $script:PublishCalls++
    & $script:NativePublisher $temporary $linkPath $replaceExisting
    [IO.File]::Delete($linkPath)
  }
  Assert ((Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh).Status -eq 'attention') 'ambiguous publication was replayable'
  Assert ($script:PublishCalls -eq 1) 'published creation was retried'
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'unchanged') 'ambiguous publication recovered'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'published deletion undone'
}
Case 'locked legacy migration never creates a duplicate or replays after deletion' {
  $script:Scope='CurrentUser'; $script:InstallDirs.CurrentUser=$script:Directory
  $legacy=Join-Path $script:Folders.CurrentUser (([string][char]0x597d+[char]0x54af)+'.lnk')
  [Haolo.ShortcutNative]::Write($legacy,(Join-Path $script:Directory 'haolo_desktop.exe'),(Join-Path $script:Directory 'haolo_desktop.exe'),'local.haolo.desktop')
  Save-InstallSnapshot
  $handle=[IO.File]::Open($legacy,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  try {
    Assert ((Ensure-HaoloDesktopShortcut CurrentUser $script:Directory legacy).Status -eq 'attention') 'locked migration ignored'
    Assert (!(Test-Path -LiteralPath $script:Link)) 'locked migration created duplicate'
  } finally { $handle.Dispose() }
  [IO.File]::Delete($legacy)
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'preserved-absent') 'failed migration replayed'
}
Case 'removed live pending state cannot be replayed from the snapshot' {
  $script:Scope='CurrentUser'; $script:InstallDirs.CurrentUser=$script:Directory
  $script:States.CurrentUser=New-HaoloShortcutState CurrentUser $script:Directory pending
  Save-InstallSnapshot
  $script:States=@{}
  Assert ((Invoke-HaoloShortcutAction).Status -eq 'preserved-absent') 'removed pending replayed'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'removed authorization created link'
}
Case 'failed deletion acknowledgement does not retry a pending writer as creation' {
  Ensure-HaoloDesktopShortcut CurrentUser $script:Directory fresh | Out-Null
  $nextDir=Join-Path $Root 'next-pending-install'; [IO.Directory]::CreateDirectory($nextDir) | Out-Null
  [IO.File]::WriteAllText((Join-Path $nextDir 'haolo_desktop.exe'),'dummy')
  $script:PublishCalls=0
  function Publish-HaoloDesktopLink([string]$temporary,[string]$linkPath,[bool]$replaceExisting) {
    $script:PublishCalls++; [IO.File]::Delete($linkPath)
    & $script:NativePublisher $temporary $linkPath $replaceExisting
  }
  function Write-HaoloShortcutState([string]$scopeName,$state) {
    if ($state.Status -eq 'preserved-absent') { throw 'injected deletion acknowledgement failure' }
    & $script:MemoryWriter $scopeName $state
  }
  $caught=$false; try { Ensure-HaoloDesktopShortcut CurrentUser $nextDir pending | Out-Null } catch { $caught=$true }
  Assert $caught 'failed acknowledgement was not reported'
  Assert ($script:PublishCalls -eq 1) 'failed acknowledgement retried creation'
  Assert (!(Test-Path -LiteralPath $script:Link)) 'failed acknowledgement resurrected link'
  Assert ($script:States.CurrentUser.Status -eq 'attempting') 'failed acknowledgement remained replayable'
}
Write-Output ('PASSED '+$script:Count+' cases')
