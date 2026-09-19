param(
  [Parameter(Mandatory=$true)][string]$Target,
  [string]$ExpectedThumbprint = ''
)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $Target
if ($signature.Status -ne 'Valid') { throw "Authenticode verification failed: $($signature.Status)" }
$certificate = $signature.SignerCertificate
if (!$certificate -or !$signature.TimeStamperCertificate) { throw 'A trusted signer and timestamp are required' }
if ($ExpectedThumbprint -and $certificate.Thumbprint -ne $ExpectedThumbprint) { throw 'Unexpected code-signing certificate' }
$policies = ($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.32' } | ForEach-Object { $_.Format($false) }) -join ' '
if ($policies -notmatch '2\.23\.140\.1\.3\b') { throw 'The certificate does not contain the EV code-signing policy' }
# Inspect the actual Authenticode digest, not the certificate issuer's algorithm.
Add-Type -AssemblyName System.Security
$bytes = [System.IO.File]::ReadAllBytes($Target)
$pe = [BitConverter]::ToInt32($bytes, 60)
$optional = $pe + 24
$magic = [BitConverter]::ToUInt16($bytes, $optional)
$directories = if ($magic -eq 0x20b) { $optional + 112 } elseif ($magic -eq 0x10b) { $optional + 96 } else { throw 'Unsupported PE format' }
$offset = [BitConverter]::ToUInt32($bytes, $directories + 32)
$length = [BitConverter]::ToUInt32($bytes, $offset)
if ($offset -eq 0 -or $length -lt 8 -or $offset + $length -gt $bytes.Length) { throw 'Invalid Authenticode certificate table' }
$cms = New-Object System.Security.Cryptography.Pkcs.SignedCms
$cms.Decode([byte[]]$bytes[($offset + 8)..($offset + $length - 1)])
if ($cms.SignerInfos.Count -ne 1 -or $cms.SignerInfos[0].DigestAlgorithm.Value -ne '2.16.840.1.101.3.4.2.1') { throw 'The file must use a SHA-256 signature' }
[ordered]@{
  status = [string]$signature.Status
  subject = $certificate.Subject
  thumbprint = $certificate.Thumbprint
  issuer = $certificate.Issuer
  notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o')
  timestampSubject = $signature.TimeStamperCertificate.Subject
  evCodeSigning = $true
  digest = 'sha256'
} | ConvertTo-Json -Compress
