param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$ReleaseNotesPath,
  [string]$SupportBundlePath = "",
  [string]$KeyPath = "",
  [string]$ResultPath = "",
  [string]$BaseUrl = "https://haolo.com",
  [switch]$ForceUpdate,
  [string]$MinSupportedVersion = "",
  [switch]$Publish
)
$ErrorActionPreference = "Stop"
if ($BaseUrl.TrimEnd('/') -ne 'https://haolo.com') { throw 'Windows publication uses https://haolo.com without redirects.' }
$repo = Split-Path -Parent $PSScriptRoot
$publishArgs = @((Join-Path $repo 'tools/publish-support-release.mjs'), '--platform', 'windows', '--artifact', $InstallerPath,
  '--version', $Version, '--notes', $ReleaseNotesPath)
if ($SupportBundlePath) { $publishArgs += @('--bundle', $SupportBundlePath) }
if ($ResultPath) { $publishArgs += @('--result', $ResultPath) }
if ($ForceUpdate) { $publishArgs += '--force-update' }
if ($MinSupportedVersion) { $publishArgs += @('--min-supported-version', $MinSupportedVersion) }
$previousKey = $env:HAOLO_APP_UPDATE_ADMIN_KEY
try {
  if ($Publish) {
    if (!$KeyPath -and !$previousKey) { $KeyPath = Join-Path $env:USERPROFILE '.codex/secrets/haolo-app-update-key.txt' }
    if ($KeyPath) {
      $value = (Get-Content -Raw -Encoding UTF8 -LiteralPath $KeyPath).Trim()
      $env:HAOLO_APP_UPDATE_ADMIN_KEY = $value -replace '^(?:HAOLO_)?APP_UPDATE_ADMIN_KEY\s*=\s*', ''
      $value = $null
    }
    if (!$env:HAOLO_APP_UPDATE_ADMIN_KEY) { throw 'Missing publication key' }
    $publishArgs += '--publish'
  }
  & node @publishArgs
  if ($LASTEXITCODE -ne 0) { throw "Windows publication validation failed (exit $LASTEXITCODE). Inspect the saved response before retrying." }
} finally { $env:HAOLO_APP_UPDATE_ADMIN_KEY = $previousKey }
