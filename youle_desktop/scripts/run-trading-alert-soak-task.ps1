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
  $launcherState.endedAt = (Get-Date).ToUniversalTime().ToString("o")
  $launcherState | ConvertTo-Json | Set-Content -LiteralPath $launcherStatePath -Encoding utf8
}

exit ([int]$launcherState.exitCode)
