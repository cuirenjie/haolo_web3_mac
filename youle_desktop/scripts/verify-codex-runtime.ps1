param(
  [string]$RuntimeDir = (Join-Path $PSScriptRoot "..\resources\bin")
)

$ErrorActionPreference = "Stop"
$runtimeDirPath = (Resolve-Path -LiteralPath $RuntimeDir).Path
$manifestPath = Join-Path $runtimeDirPath "codex-runtime.json"
if (!(Test-Path -LiteralPath $manifestPath)) {
  throw "Missing Codex runtime manifest: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (!$manifest.version -or !$manifest.files) {
  throw "Invalid Codex runtime manifest: $manifestPath"
}

foreach ($file in $manifest.files) {
  $filePath = Join-Path $runtimeDirPath $file.name
  if (!(Test-Path -LiteralPath $filePath)) {
    throw "Missing Codex runtime file: $filePath"
  }

  $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $expectedHash = [string]$file.sha256
  if ($actualHash -ne $expectedHash.ToLowerInvariant()) {
    throw "SHA-256 mismatch for $($file.name): expected $expectedHash, got $actualHash"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $filePath
  if ($signature.Status -ne "Valid") {
    throw "Invalid Authenticode signature for $($file.name): $($signature.Status) $($signature.StatusMessage)"
  }
  if ($signature.SignerCertificate.Subject -notmatch "OpenAI") {
    throw "Unexpected signer for $($file.name): $($signature.SignerCertificate.Subject)"
  }
}

$mainBinary = Join-Path $runtimeDirPath "haolo_ai.exe"
$versionOutput = (& $mainBinary --version | Out-String).Trim()
$expectedVersionOutput = "codex-cli $($manifest.version)"
if ($LASTEXITCODE -ne 0 -or $versionOutput -ne $expectedVersionOutput) {
  throw "Unexpected Codex version output: expected '$expectedVersionOutput', got '$versionOutput'"
}

Write-Host "Verified Codex runtime $($manifest.version): $($manifest.files.Count) signed files and matching SHA-256 hashes."
