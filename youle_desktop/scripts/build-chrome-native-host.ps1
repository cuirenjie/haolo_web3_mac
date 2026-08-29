param(
  [string]$OutputPath = "resources/bin/haolo-chrome-native-host.exe"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot "native/haolo-chrome-host/Program.cs"
$resolvedOutput = Join-Path $repoRoot $OutputPath
$outputDir = Split-Path -Parent $resolvedOutput
$candidates = @(
  (Join-Path $env:WINDIR "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET/Framework/v4.0.30319/csc.exe")
)
$compiler = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) {
  throw "The .NET Framework C# compiler was not found."
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Chrome Native Host source is missing: $sourcePath"
}
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
& $compiler /nologo /target:exe /optimize+ /platform:x64 /out:$resolvedOutput /reference:System.Web.Extensions.dll $sourcePath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $resolvedOutput -PathType Leaf)) {
  throw "Chrome Native Host compilation failed."
}
Write-Output $resolvedOutput
