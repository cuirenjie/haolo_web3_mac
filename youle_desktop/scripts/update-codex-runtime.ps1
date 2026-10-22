param(
  [Parameter(Mandatory=$true)][string]$CandidateDir,
  [Parameter(Mandatory=$true)][string]$AssetEvidence,
  [Parameter(Mandatory=$true)][string]$Version,
  [string]$RuntimeDir = (Join-Path $PSScriptRoot "..\resources\bin"),
  [Parameter(Mandatory=$true)][string]$BackupDir
)
$ErrorActionPreference = "Stop"
$candidate = (Resolve-Path -LiteralPath $CandidateDir).Path
$target = (Resolve-Path -LiteralPath $RuntimeDir).Path
$evidence = Get-Content -LiteralPath $AssetEvidence -Raw | ConvertFrom-Json
$zipPath = Join-Path (Split-Path -Parent $AssetEvidence) $evidence.name
$digest = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ("sha256:$digest" -ne $evidence.digest) { throw "Release asset digest mismatch" }
if ($evidence.browser_download_url -ne "https://github.com/openai/codex/releases/download/rust-v$Version/codex-x86_64-pc-windows-msvc.exe.zip") { throw "Unexpected release provenance" }
# Re-extract the authenticated archive; do not trust a modified staging folder.
$cleanCandidate = Join-Path (Split-Path -Parent $AssetEvidence) ("verified-" + [guid]::NewGuid())
Expand-Archive -LiteralPath $zipPath -DestinationPath $cleanCandidate
$candidate = (Resolve-Path -LiteralPath $cleanCandidate).Path
$main = Join-Path $candidate "codex-x86_64-pc-windows-msvc.exe"
if ((& $main --version | Out-String).Trim() -ne "codex-cli $Version") { throw "Candidate version mismatch" }
$signedNames = @("codex-x86_64-pc-windows-msvc.exe","codex-code-mode-host.exe","codex-command-runner.exe","codex-windows-sandbox-setup.exe")
foreach ($name in $signedNames) {
  $sig = Get-AuthenticodeSignature -LiteralPath (Join-Path $candidate $name)
  if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "OpenAI") { throw "Invalid OpenAI signature: $name" }
}
if (Test-Path -LiteralPath $BackupDir) { throw "Backup directory must be new" }
New-Item -ItemType Directory -Path $BackupDir | Out-Null
$old = Get-Content -LiteralPath (Join-Path $target "codex-runtime.json") -Raw | ConvertFrom-Json
foreach ($file in @($old.files) + @(@{name="codex-runtime.json"})) {
  $backupPath = Join-Path $BackupDir $file.name
  New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $target $file.name) -Destination $backupPath
}
$entries = @()
$writtenNames = @()
try {
foreach ($file in Get-ChildItem -LiteralPath $candidate -Recurse -File) {
  $sourceName = [IO.Path]::GetRelativePath($candidate, $file.FullName).Replace("\","/")
  $name = if ($sourceName -eq "codex-x86_64-pc-windows-msvc.exe") { "haolo_ai.exe" } else { $sourceName }
  $out = Join-Path $target $name
  $writtenNames += $name
  New-Item -ItemType Directory -Path (Split-Path -Parent $out) -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $out -Force
  if ($name -eq "codex-package.json") {
    $package = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
    $package.entrypoint = "haolo_ai.exe"
    $package | ConvertTo-Json | Set-Content -LiteralPath $out -Encoding utf8
  }
  $entries += @{
    name=$name; sourceName=$sourceName
    sha256=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLowerInvariant()
    signedByOpenAI=($file.Name -in $signedNames)
  }
}
@{
  version=$Version; releaseTag="rust-v$Version"
  releaseUrl="https://github.com/openai/codex/releases/tag/rust-v$Version"
  sourceAsset=$evidence.name; sourceAssetSha256=$digest
  files=@($entries | Sort-Object name)
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $target "codex-runtime.json") -Encoding utf8
& (Join-Path $PSScriptRoot "verify-codex-runtime.ps1") -RuntimeDir $target
} catch {
  $failure = $_
  $oldNames = @($old.files | ForEach-Object { $_.name })
  foreach ($writtenName in $writtenNames) {
    if ($writtenName -notin $oldNames) {
      $newPath = [IO.Path]::GetFullPath((Join-Path $target $writtenName))
      if (!$newPath.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe rollback path" }
      Remove-Item -LiteralPath $newPath -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($file in @($old.files) + @(@{name="codex-runtime.json"})) {
    Copy-Item -LiteralPath (Join-Path $BackupDir $file.name) -Destination (Join-Path $target $file.name) -Force
  }
  throw $failure
}
