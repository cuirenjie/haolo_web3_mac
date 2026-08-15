param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath,
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$workspacePath = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "trading-alert-soak.mjs"
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw "Node runtime is missing: $NodePath"
}
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
  throw "Trading Alert soak script is missing: $scriptPath"
}

$workspaceFullPath = [System.IO.Path]::GetFullPath($workspacePath)
$outputPath = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $workspaceFullPath ".tmp\trading-alert-soak-24h"
}
$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceFullPath ".tmp"))
if (-not $outputPath.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Soak output must stay inside the workspace .tmp directory"
}

New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$launcherStatePath = Join-Path $outputPath "task-launcher.json"
$runningStatePath = Join-Path $outputPath "current.json"

function Test-SoakProcessOwner {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $false }
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  return $null -ne $owner -and [string]$owner.CommandLine -like "*trading-alert-soak.mjs*"
}

function Save-InterruptedRun {
  if (-not (Test-Path -LiteralPath $runningStatePath -PathType Leaf)) { return }
  try {
    $previous = Get-Content -LiteralPath $runningStatePath -Raw | ConvertFrom-Json
    if ([string]$previous.status -ne "running" -or (Test-SoakProcessOwner -ProcessId ([int]$previous.processId))) { return }

    $archiveStem = if ($previous.runId) { [string]$previous.runId } else { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss-fffZ") }
    $archivePath = Join-Path $outputPath "$archiveStem.interrupted.json"
    $previous.status = "interrupted"
    $previous.endedAt = if ($previous.checkpointedAt) { [string]$previous.checkpointedAt } else { (Get-Date).ToUniversalTime().ToString("o") }
    $previous | Add-Member -NotePropertyName interruption -NotePropertyValue ([ordered]@{
      detectedAt = (Get-Date).ToUniversalTime().ToString("o")
      reason = "previous soak process is no longer running"
      resumePolicy = "restart_full_24h"
    }) -Force
    $temporaryArchivePath = "$archivePath.$PID.tmp"
    $previous | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $temporaryArchivePath -Encoding utf8
    Move-Item -LiteralPath $temporaryArchivePath -Destination $archivePath -Force

    if (Test-Path -LiteralPath $launcherStatePath -PathType Leaf) {
      $launcherArchivePath = Join-Path $outputPath "$archiveStem.launcher.interrupted.json"
      Copy-Item -LiteralPath $launcherStatePath -Destination $launcherArchivePath -Force
    }
  } catch {
    throw "Unable to preserve the interrupted soak report: $($_.Exception.Message)"
  }
}

Save-InterruptedRun

function Test-CompletedSoakRun {
  if (-not (Test-Path -LiteralPath $runningStatePath -PathType Leaf)) { return $false }
  try {
    $report = Get-Content -LiteralPath $runningStatePath -Raw | ConvertFrom-Json
    $requiredDurationMs = [double]$report.options.durationMs
    return [string]$report.status -eq "passed" -and $requiredDurationMs -ge 86400000 -and [double]$report.elapsedMs -ge $requiredDurationMs
  } catch {
    return $false
  }
}

if (Test-CompletedSoakRun) {
  [ordered]@{
    schemaVersion = 1
    status = "passed"
    launcherProcessId = $PID
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    endedAt = (Get-Date).ToUniversalTime().ToString("o")
    exitCode = 0
    nodePath = $NodePath
    outputDirectory = $outputPath
    note = "existing completed 24-hour report preserved for assessment"
  } | ConvertTo-Json | Set-Content -LiteralPath $launcherStatePath -Encoding utf8
  exit 0
}

if (-not ("HaoloSoakPowerGuard" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class HaoloSoakPowerGuard {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint flags);
}
"@
}
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
$powerGuardActive = [HaoloSoakPowerGuard]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) -ne 0
if (-not $powerGuardActive) {
  throw "Unable to prevent automatic system sleep during the 24-hour soak"
}

$launcherState = [ordered]@{
  schemaVersion = 1
  status = "running"
  launcherProcessId = $PID
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  endedAt = $null
  exitCode = $null
  nodePath = $NodePath
  outputDirectory = $outputPath
}
$launcherState | ConvertTo-Json | Set-Content -LiteralPath $launcherStatePath -Encoding utf8

Push-Location $workspaceFullPath
try {
  & $NodePath --expose-gc $scriptPath `
    --provider hyperliquid `
    --market HYPERLIQUID:PERPETUAL:BTC `
    --interval 1m `
    --duration-ms 86400000 `
    --sample-ms 60000 `
    --alerts 100 `
    --output $outputPath
  $exitCode = $LASTEXITCODE
  $launcherState.status = if ($exitCode -eq 0) { "passed" } else { "failed" }
  $launcherState.exitCode = $exitCode
} catch {
  $launcherState.status = "failed"
  $launcherState.exitCode = 1
  $launcherState.error = $_.Exception.Message
} finally {
  Pop-Location
  [void][HaoloSoakPowerGuard]::SetThreadExecutionState($ES_CONTINUOUS)
  $launcherState.endedAt = (Get-Date).ToUniversalTime().ToString("o")
  $launcherState | ConvertTo-Json | Set-Content -LiteralPath $launcherStatePath -Encoding utf8
}

exit ([int]$launcherState.exitCode)
