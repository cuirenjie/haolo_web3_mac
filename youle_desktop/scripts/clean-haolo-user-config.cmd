@echo off
setlocal EnableExtensions
title Haolo User Config Cleaner
set "HAOLO_CLEANER_SCRIPT=%~f0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$content = Get-Content -LiteralPath $env:HAOLO_CLEANER_SCRIPT -Raw; $marker = '### POWER' + 'SHELL ###'; $parts = $content -split [regex]::Escape($marker), 2; if ($parts.Count -lt 2) { throw 'PowerShell section missing.' }; $block = [ScriptBlock]::Create($parts[1]); & $block"
set "CLEAN_RESULT=%ERRORLEVEL%"

echo.
pause
exit /b %CLEAN_RESULT%

### POWERSHELL ###
$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$logPath = Join-Path $env:TEMP "haolo-user-config-cleaner-$stamp.log"
$defaultApiBaseUrl = "https://haolo.com"
$criticalStateRelativePaths = @(
  "haolo-session.json",
  "haolo-api-skills.log",
  "default-haolo-ai\auth.json",
  "Local State",
  "Preferences"
)

function Write-Log($message) {
  Write-Host $message
  try {
    Add-Content -LiteralPath $logPath -Value $message -Encoding UTF8
  } catch {}
}

function Get-FullTrimmedPath($pathValue) {
  return [System.IO.Path]::GetFullPath($pathValue).TrimEnd("\")
}

function To-LongPath($pathValue) {
  $full = [System.IO.Path]::GetFullPath($pathValue)
  if ($full.StartsWith("\\?\")) { return $full }
  if ($full.StartsWith("\\")) { return "\\?\UNC\" + $full.Substring(2) }
  return "\\?\" + $full
}

function Unique-Path($pathValue) {
  if (!(Test-Path -LiteralPath $pathValue)) { return $pathValue }
  for ($i = 1; $i -lt 1000; $i += 1) {
    $candidate = "$pathValue-$i"
    if (!(Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return "$pathValue-$([guid]::NewGuid().ToString('N'))"
}

function Test-PathExists($pathValue) {
  if (!$pathValue) { return $false }
  try {
    if (Test-Path -LiteralPath $pathValue) { return $true }
  } catch {}
  try {
    return [System.IO.File]::Exists($pathValue) -or [System.IO.Directory]::Exists($pathValue)
  } catch {}
  return $false
}

function Test-SafeTarget($target) {
  try {
    $targetFull = Get-FullTrimmedPath $target
    $roots = @($env:APPDATA, $env:LOCALAPPDATA) | Where-Object { $_ } | ForEach-Object {
      Get-FullTrimmedPath $_
    }
    $legacyName = [string]([char]0x597D) + [string]([char]0x54AF)
    $mojibakeLegacyName = [string]([char]0x00E5) + [string]([char]0x00A5) + [string]([char]0x00BD) + [string]([char]0x00E5) + [string]([char]0x2019) + [string]([char]0x00AF)
    $allowedLeaves = @("haolo_desktop", "haolo_desktop-updater", $legacyName, $mojibakeLegacyName)
    $leaf = Split-Path -Leaf $targetFull
    if ($allowedLeaves -notcontains $leaf) { return $false }
    foreach ($root in $roots) {
      if ($targetFull.StartsWith($root + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
      }
    }
  } catch {}
  return $false
}

function Test-IsDirectory($pathValue) {
  $item = Get-Item -LiteralPath $pathValue -Force -ErrorAction SilentlyContinue
  return [bool]($item -and $item.PSIsContainer)
}

function Clear-ItemAttributes($pathValue) {
  $clearMask = [System.IO.FileAttributes]::ReadOnly -bor [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System
  $paths = New-Object System.Collections.Generic.List[string]
  $paths.Add($pathValue)

  if (Test-IsDirectory $pathValue) {
    try {
      Get-ChildItem -LiteralPath $pathValue -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $paths.Add($_.FullName)
      }
    } catch {}
  }

  for ($i = $paths.Count - 1; $i -ge 0; $i -= 1) {
    try {
      $item = Get-Item -LiteralPath $paths[$i] -Force -ErrorAction Stop
      $item.Attributes = $item.Attributes -band (-bnot $clearMask)
    } catch {}
  }
}

function Mirror-EmptyDirectory($pathValue) {
  if (!(Test-IsDirectory $pathValue)) { return }
  $emptyDir = Join-Path $env:TEMP "haolo-empty-$([guid]::NewGuid().ToString('N'))"
  try {
    New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
    & robocopy $emptyDir $pathValue /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  } catch {} finally {
    try { Remove-Item -LiteralPath $emptyDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Remove-DirectoryChildrenBestEffort($pathValue, $depth = 0) {
  if (!(Test-IsDirectory $pathValue) -or $depth -gt 80) { return }

  $children = @()
  try {
    $children = @(Get-ChildItem -LiteralPath $pathValue -Force -ErrorAction SilentlyContinue)
  } catch {}

  foreach ($child in $children) {
    $childPath = $null
    try { $childPath = $child.FullName } catch {}
    if (!$childPath) { continue }

    $isContainer = $false
    $isReparsePoint = $false
    try {
      $isContainer = [bool]$child.PSIsContainer
      $isReparsePoint = [bool]($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    } catch {}

    if ($isContainer -and !$isReparsePoint) {
      Remove-DirectoryChildrenBestEffort $childPath ($depth + 1)
      try { Remove-Item -LiteralPath $childPath -Force -ErrorAction SilentlyContinue } catch {}
      if (Test-PathExists $childPath) {
        try { [System.IO.Directory]::Delete((To-LongPath $childPath), $false) } catch {}
      }
    } else {
      try { Remove-Item -LiteralPath $childPath -Force -ErrorAction SilentlyContinue } catch {}
      if (Test-PathExists $childPath) {
        try {
          $item = Get-Item -LiteralPath $childPath -Force -ErrorAction Stop
          $item.Attributes = $item.Attributes -band (-bnot ([System.IO.FileAttributes]::ReadOnly -bor [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System))
          Remove-Item -LiteralPath $childPath -Force -ErrorAction SilentlyContinue
        } catch {}
      }
    }
  }
}

function Stop-HaoloProcesses($matchRoots) {
  if ($env:HAOLO_CLEANER_SKIP_PROCESS_STOP -eq "1") {
    Write-Log "Skipping process stop because HAOLO_CLEANER_SKIP_PROCESS_STOP=1."
    return 0
  }

  $protectedPids = New-Object 'System.Collections.Generic.HashSet[int]'
  try {
    $currentPid = [int]$PID
    while ($currentPid -gt 0 -and !$protectedPids.Contains($currentPid)) {
      [void]$protectedPids.Add($currentPid)
      $currentProc = Get-CimInstance Win32_Process -Filter "ProcessId=$currentPid" -ErrorAction SilentlyContinue
      if (!$currentProc -or !$currentProc.ParentProcessId) { break }
      $currentPid = [int]$currentProc.ParentProcessId
    }
  } catch {
    [void]$protectedPids.Add([int]$PID)
  }

  $names = @("haolo_desktop", "haolo_ai")
  $fragments = New-Object System.Collections.Generic.List[string]

  foreach ($root in @($matchRoots)) {
    if (!$root) { continue }
    try {
      $full = Get-FullTrimmedPath $root
      if ($full) { $fragments.Add($full.ToLowerInvariant()) }
    } catch {}
  }

  foreach ($fragment in @("haolo_desktop", "haolo_desktop-updater", "haolo-ai-home", "haolo_desktop-runtime")) {
    $fragments.Add($fragment)
  }

  $legacyName = ([string]([char]0x597D) + [string]([char]0x54AF)).ToLowerInvariant()
  $mojibakeLegacyName = ([string]([char]0x00E5) + [string]([char]0x00A5) + [string]([char]0x00BD) + [string]([char]0x00E5) + [string]([char]0x2019) + [string]([char]0x00AF)).ToLowerInvariant()
  $fragments.Add($legacyName)
  $fragments.Add($mojibakeLegacyName)

  $stopped = 0
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  foreach ($proc in $processes) {
    $procId = [int]$proc.ProcessId
    if ($protectedPids.Contains($procId)) { continue }

    $name = [string]$proc.Name
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($name).ToLowerInvariant()
    $haystack = (([string]$proc.ExecutablePath) + "`n" + ([string]$proc.CommandLine)).ToLowerInvariant()
    $matches = $names -contains $baseName
    if (!$matches) {
      foreach ($fragment in $fragments) {
        if ($fragment -and $haystack.Contains($fragment)) {
          $matches = $true
          break
        }
      }
    }
    if (!$matches) { continue }

    try {
      Write-Log "Stopping process: $name PID=$procId"
      Stop-Process -Id $procId -Force -ErrorAction Stop
      $stopped += 1
    } catch {
      try {
        & taskkill.exe /PID $procId /T /F | Out-Null
        $stopped += 1
      } catch {}
    }
  }

  if ($stopped -gt 0) {
    Start-Sleep -Milliseconds 1200
  }
  return $stopped
}

function Remove-PathBestEffort($pathValue) {
  if (!(Test-PathExists $pathValue)) { return $true }

  $lastError = $null
  for ($attempt = 1; $attempt -le 8; $attempt += 1) {
    if ($attempt -gt 1) {
      Stop-HaoloProcesses @($pathValue, $script:CleanupTargets) | Out-Null
    }
    Clear-ItemAttributes $pathValue

    try {
      Remove-Item -LiteralPath $pathValue -Recurse -Force -ErrorAction Stop
    } catch {
      $lastError = $_.Exception.Message
    }
    if (!(Test-PathExists $pathValue)) { return $true }

    if (Test-IsDirectory $pathValue) {
      try {
        [System.IO.Directory]::Delete((To-LongPath $pathValue), $true)
      } catch {
        $lastError = $_.Exception.Message
      }
      if (!(Test-PathExists $pathValue)) { return $true }

      Mirror-EmptyDirectory $pathValue
      try {
        Remove-Item -LiteralPath $pathValue -Recurse -Force -ErrorAction Stop
      } catch {
        $lastError = $_.Exception.Message
      }
      if (!(Test-PathExists $pathValue)) { return $true }

      Remove-DirectoryChildrenBestEffort $pathValue
      try {
        Remove-Item -LiteralPath $pathValue -Force -ErrorAction Stop
      } catch {
        $lastError = $_.Exception.Message
      }
      if (!(Test-PathExists $pathValue)) { return $true }

      try {
        [System.IO.Directory]::Delete((To-LongPath $pathValue), $false)
      } catch {
        $lastError = $_.Exception.Message
      }
      if (!(Test-PathExists $pathValue)) { return $true }
    }

    Start-Sleep -Milliseconds ([Math]::Min(2000, 250 * $attempt))
  }

  if ($lastError) {
    Write-Log "Delete still blocked: $pathValue - $lastError"
  }
  return !(Test-PathExists $pathValue)
}

function Reset-SessionFile($targetFull) {
  $sessionPath = Join-Path $targetFull "haolo-session.json"
  if (!(Test-PathExists $targetFull)) { return $true }
  if (!(Test-PathExists $sessionPath)) { return $true }

  $resetSession = [ordered]@{
    baseUrl = $defaultApiBaseUrl
    token = $null
    modelApiKey = $null
    modelBaseUrl = $null
    modelKeys = @()
    profile = $null
    deviceId = $null
  }

  try {
    Clear-ItemAttributes $sessionPath
    Set-Content -LiteralPath $sessionPath -Value (($resetSession | ConvertTo-Json -Depth 5) + "`n") -Encoding UTF8 -Force
    Write-Log "Reset session file: $sessionPath"
    return $true
  } catch {
    Write-Log "Session reset failed: $sessionPath - $($_.Exception.Message)"
  }
  return $false
}

function Clear-CriticalState($targetFull) {
  if (!(Test-PathExists $targetFull)) { return $true }

  $ok = $true
  foreach ($relativePath in $criticalStateRelativePaths) {
    $pathValue = Join-Path $targetFull $relativePath
    if (!(Test-PathExists $pathValue)) { continue }
    if (Remove-PathBestEffort $pathValue) {
      Write-Log "Removed state: $pathValue"
    } else {
      $ok = $false
      Write-Log "State remains: $pathValue"
    }
  }

  if (!(Reset-SessionFile $targetFull)) {
    $ok = $false
  }
  return $ok
}

function Clean-Target($target) {
  if (!(Test-SafeTarget $target)) {
    Write-Log "Skipped unsafe path: $target"
    return "failed"
  }
  if (!(Test-PathExists $target)) {
    Write-Log "Not found: $target"
    return "missing"
  }

  $targetFull = Get-FullTrimmedPath $target
  $parent = Split-Path -Parent $targetFull
  $leaf = Split-Path -Leaf $targetFull
  $quarantine = Unique-Path (Join-Path $parent "$leaf.cleanup-$stamp")
  $stateCleared = Clear-CriticalState $targetFull

  try {
    Rename-Item -LiteralPath $targetFull -NewName (Split-Path -Leaf $quarantine) -Force -ErrorAction Stop
    Write-Log "Quarantined: $targetFull -> $quarantine"
  } catch {
    Write-Log "Rename blocked, closing related processes and retrying: $targetFull - $($_.Exception.Message)"
    Stop-HaoloProcesses @($targetFull, $script:CleanupTargets) | Out-Null
    Start-Sleep -Milliseconds 1200
    try {
      Rename-Item -LiteralPath $targetFull -NewName (Split-Path -Leaf $quarantine) -Force -ErrorAction Stop
      Write-Log "Quarantined after process stop: $targetFull -> $quarantine"
    } catch {
      Write-Log "Rename failed, trying direct delete: $targetFull - $($_.Exception.Message)"
    }
  }

  if (Test-Path -LiteralPath $quarantine) {
    if (!(Test-Path -LiteralPath $targetFull)) {
      if (Remove-PathBestEffort $quarantine) {
        Write-Log "Removed quarantined copy: $quarantine"
        return "removed"
      }
      Write-Log "Quarantined copy remains, but Haolo will not use it: $quarantine"
      return "quarantined"
    }
  } else {
    if (Remove-PathBestEffort $targetFull) {
      Write-Log "Removed: $targetFull"
      return "removed"
    }
    if ($stateCleared -or (Clear-CriticalState $targetFull)) {
      Write-Log "Partial cleanup complete. Login/session state was cleared; leftover cache can be ignored: $targetFull"
      return "partial"
    }
    Write-Log "Failed:  $targetFull"
    return "failed"
  }

  if ($stateCleared -or (Clear-CriticalState $targetFull)) {
    Write-Log "Partial cleanup complete. Login/session state was cleared; leftover cache can be ignored: $targetFull"
    return "partial"
  }
  Write-Log "Failed:  $targetFull"
  return "failed"
}

Write-Host ""
Write-Host "Haolo User Config Cleaner"
Write-Host "========================="
Write-Host ""
Write-Host "This tool removes Haolo configuration/cache data for the current Windows user."
Write-Host "It does NOT uninstall Haolo and does NOT remove the installed application files."
Write-Host ""
Write-Host "Data to remove:"
Write-Host "  - %APPDATA%\haolo_desktop"
Write-Host "  - legacy Haolo display-name folder under %APPDATA%"
Write-Host "  - %LOCALAPPDATA%\haolo_desktop"
Write-Host "  - %LOCALAPPDATA%\haolo_desktop-updater"
Write-Host ""
Write-Host "This will clean login/session/cache/local app settings for this user."
Write-Host "Log file: $logPath"
Write-Host ""

if ($env:HAOLO_CLEANER_ASSUME_YES -eq "1") {
  $answer = "Y"
  Write-Host "Continue? [Y/N] Y"
} else {
  $answer = Read-Host "Continue? [Y/N]"
}
if ($answer -notmatch "^[Yy]$") {
  Write-Host ""
  Write-Host "Cancelled. No files were removed."
  exit 1
}

$legacyName = [string]([char]0x597D) + [string]([char]0x54AF)
$mojibakeLegacyName = [string]([char]0x00E5) + [string]([char]0x00A5) + [string]([char]0x00BD) + [string]([char]0x00E5) + [string]([char]0x2019) + [string]([char]0x00AF)
$targets = @()
if ($env:APPDATA) {
  $targets += Join-Path $env:APPDATA "haolo_desktop"
  $targets += Join-Path $env:APPDATA $legacyName
  $targets += Join-Path $env:APPDATA $mojibakeLegacyName
}
if ($env:LOCALAPPDATA) {
  $targets += Join-Path $env:LOCALAPPDATA "haolo_desktop"
  $targets += Join-Path $env:LOCALAPPDATA "haolo_desktop-updater"
}
$script:CleanupTargets = @($targets | Select-Object -Unique)

Write-Host ""
Write-Log "Closing running Haolo processes..."
Stop-HaoloProcesses $script:CleanupTargets | Out-Null

Write-Host ""
Write-Log "Removing user configuration folders..."
$removed = 0
$quarantined = 0
$partial = 0
$failed = 0
foreach ($target in $script:CleanupTargets) {
  $result = Clean-Target $target
  if ($result -eq "removed") { $removed += 1 }
  elseif ($result -eq "quarantined") { $quarantined += 1 }
  elseif ($result -eq "partial") { $partial += 1 }
  elseif ($result -eq "failed") { $failed += 1 }
}

Write-Host ""
Write-Log "Done. Removed=$removed, Quarantined=$quarantined, Partial=$partial, Failed=$failed"
Write-Log "Log file: $logPath"

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Cleanup finished with errors. Please close Haolo and run this script again."
  exit 2
}

Write-Host ""
if ($partial -gt 0) {
  Write-Host "Haolo login/session cleanup completed. Some leftover cache could not be removed, but it will not keep the old login/API settings."
} else {
  Write-Host "Haolo user configuration cleanup completed."
}
exit 0
