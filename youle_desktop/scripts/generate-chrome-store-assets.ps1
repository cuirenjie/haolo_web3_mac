param(
  [string]$ScreenshotRoot = ".tmp\chrome-smoke"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceIconPath = Join-Path $repoRoot "src\renderer\assets\haolo-app-avatar.png"
$screenshotRootPath = Join-Path $repoRoot $ScreenshotRoot
$extensionIconRoot = Join-Path $repoRoot "extensions\haolo-chrome\icons"
$storeAssetRoot = Join-Path $repoRoot "docs\chrome-web-store\assets"

New-Item -ItemType Directory -Force -Path $extensionIconRoot, $storeAssetRoot | Out-Null

function New-RoundedPath {
  param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Canvas {
  param([int]$Width, [int]$Height)
  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Png {
  param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Resize-Png {
  param([string]$Source, [string]$Destination, [int]$Size)
  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  $canvas = New-Canvas -Width $Size -Height $Size
  try {
    $canvas.Graphics.Clear([System.Drawing.Color]::Transparent)
    $canvas.Graphics.DrawImage($sourceImage, 0, 0, $Size, $Size)
    Save-Png -Bitmap $canvas.Bitmap -Path $Destination
  } finally {
    $canvas.Graphics.Dispose()
    $canvas.Bitmap.Dispose()
    $sourceImage.Dispose()
  }
}

function Draw-ImageCard {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [System.Drawing.Color]$Fill,
    [System.Drawing.Color]$Border,
    [float]$Radius = 24
  )
  $shadowPath = New-RoundedPath -X ($X + 8) -Y ($Y + 12) -Width $Width -Height $Height -Radius $Radius
  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(45, 20, 37, 71))
  $cardPath = New-RoundedPath -X $X -Y $Y -Width $Width -Height $Height -Radius $Radius
  $fillBrush = [System.Drawing.SolidBrush]::new($Fill)
  $borderPen = [System.Drawing.Pen]::new($Border, 2)
  try {
    $Graphics.FillPath($shadowBrush, $shadowPath)
    $Graphics.FillPath($fillBrush, $cardPath)
    $Graphics.DrawPath($borderPen, $cardPath)
    $scale = [Math]::Min(($Width - 28) / $Image.Width, ($Height - 28) / $Image.Height)
    $drawWidth = $Image.Width * $scale
    $drawHeight = $Image.Height * $scale
    $drawX = $X + (($Width - $drawWidth) / 2)
    $drawY = $Y + (($Height - $drawHeight) / 2)
    $Graphics.SetClip($cardPath)
    $Graphics.DrawImage($Image, $drawX, $drawY, $drawWidth, $drawHeight)
    $Graphics.ResetClip()
  } finally {
    $shadowPath.Dispose()
    $shadowBrush.Dispose()
    $cardPath.Dispose()
    $fillBrush.Dispose()
    $borderPen.Dispose()
  }
}

function Draw-Text {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Text,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Size,
    [System.Drawing.FontStyle]$Style,
    [System.Drawing.Color]$Color
  )
  $font = [System.Drawing.Font]::new("Microsoft YaHei UI", $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = [System.Drawing.SolidBrush]::new($Color)
  $format = [System.Drawing.StringFormat]::new()
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
  try {
    $Graphics.DrawString($Text, $font, $brush, [System.Drawing.RectangleF]::new($X, $Y, $Width, $Height), $format)
  } finally {
    $format.Dispose()
    $brush.Dispose()
    $font.Dispose()
  }
}

function New-StoreScreenshot {
  param([string]$Source, [string]$Destination, [bool]$Dark)
  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  $canvas = New-Canvas -Width 1280 -Height 800
  try {
    $start = if ($Dark) { [System.Drawing.Color]::FromArgb(255, 13, 17, 25) } else { [System.Drawing.Color]::FromArgb(255, 232, 242, 255) }
    $finish = if ($Dark) { [System.Drawing.Color]::FromArgb(255, 36, 31, 58) } else { [System.Drawing.Color]::FromArgb(255, 251, 253, 255) }
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, 1280, 800), $start, $finish, 24.0)
    try { $canvas.Graphics.FillRectangle($gradient, 0, 0, 1280, 800) } finally { $gradient.Dispose() }
    $titleColor = if ($Dark) { [System.Drawing.Color]::FromArgb(255, 248, 250, 252) } else { [System.Drawing.Color]::FromArgb(255, 14, 31, 64) }
    $bodyColor = if ($Dark) { [System.Drawing.Color]::FromArgb(255, 187, 198, 216) } else { [System.Drawing.Color]::FromArgb(255, 67, 85, 116) }
    Draw-Text $canvas.Graphics "Haolo for Chrome" 58 76 575 90 52 ([System.Drawing.FontStyle]::Bold) $titleColor
    Draw-Text $canvas.Graphics "Let Codex work in the Chrome session you already trust." 62 174 545 96 27 ([System.Drawing.FontStyle]::Regular) $bodyColor
    Draw-Text $canvas.Graphics "- Read only after site approval`n- Verify every browser action`n- Confirm sends, posts, deletes and uploads`n- Pause instantly when you take over" 66 300 540 275 23 ([System.Drawing.FontStyle]::Regular) $bodyColor
    $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 38, 111, 247))
    try { $canvas.Graphics.FillRectangle($accentBrush, 64, 635, 170, 8) } finally { $accentBrush.Dispose() }
    Draw-Text $canvas.Graphics "Local bridge | least privilege | clear recovery" 64 660 550 52 19 ([System.Drawing.FontStyle]::Bold) $bodyColor
    $cardFill = if ($Dark) { [System.Drawing.Color]::FromArgb(255, 25, 29, 37) } else { [System.Drawing.Color]::White }
    $cardBorder = if ($Dark) { [System.Drawing.Color]::FromArgb(255, 61, 69, 84) } else { [System.Drawing.Color]::FromArgb(255, 205, 218, 238) }
    Draw-ImageCard $canvas.Graphics $sourceImage 690 38 520 724 $cardFill $cardBorder 28
    Save-Png -Bitmap $canvas.Bitmap -Path $Destination
  } finally {
    $canvas.Graphics.Dispose()
    $canvas.Bitmap.Dispose()
    $sourceImage.Dispose()
  }
}

function New-PromoTile {
  param([int]$Width, [int]$Height, [string]$Destination)
  $icon = [System.Drawing.Image]::FromFile($sourceIconPath)
  $canvas = New-Canvas -Width $Width -Height $Height
  try {
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, $Width, $Height), [System.Drawing.Color]::FromArgb(255, 18, 99, 245), [System.Drawing.Color]::FromArgb(255, 113, 67, 226), 18.0)
    try { $canvas.Graphics.FillRectangle($gradient, 0, 0, $Width, $Height) } finally { $gradient.Dispose() }
    $iconSize = [Math]::Min($Height - 64, [Math]::Round($Width * 0.25))
    $canvas.Graphics.DrawImage($icon, 32, (($Height - $iconSize) / 2), $iconSize, $iconSize)
    $textX = 32 + $iconSize + 28
    Draw-Text $canvas.Graphics "Haolo for Chrome" $textX ($Height * 0.28) ($Width - $textX - 28) ($Height * 0.25) ([Math]::Max(24, $Height * 0.1)) ([System.Drawing.FontStyle]::Bold) ([System.Drawing.Color]::White)
    Draw-Text $canvas.Graphics "Codex in your signed-in browser" $textX ($Height * 0.54) ($Width - $textX - 28) ($Height * 0.2) ([Math]::Max(15, $Height * 0.048)) ([System.Drawing.FontStyle]::Regular) ([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
    Save-Png -Bitmap $canvas.Bitmap -Path $Destination
  } finally {
    $canvas.Graphics.Dispose()
    $canvas.Bitmap.Dispose()
    $icon.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $sourceIconPath)) { throw "Missing Haolo icon source: $sourceIconPath" }
foreach ($size in 16, 32, 48, 128) {
  Resize-Png -Source $sourceIconPath -Destination (Join-Path $extensionIconRoot "icon-$size.png") -Size $size
}
Copy-Item -LiteralPath (Join-Path $extensionIconRoot "icon-128.png") -Destination (Join-Path $storeAssetRoot "store-icon-128.png") -Force

$lightSource = Join-Path $screenshotRootPath "store-sidepanel-light.png"
$darkSource = Join-Path $screenshotRootPath "desktop-chrome-integration-dark.png"
if (-not (Test-Path -LiteralPath $lightSource) -or -not (Test-Path -LiteralPath $darkSource)) {
  throw "Run scripts/chrome-extension-smoke.mjs first so light and dark product screenshots exist."
}
New-StoreScreenshot -Source $lightSource -Destination (Join-Path $storeAssetRoot "screenshot-01-sidepanel-light-1280x800.png") -Dark $false
New-StoreScreenshot -Source $darkSource -Destination (Join-Path $storeAssetRoot "screenshot-02-approval-dark-1280x800.png") -Dark $true
New-PromoTile -Width 440 -Height 280 -Destination (Join-Path $storeAssetRoot "promo-small-440x280.png")
New-PromoTile -Width 1400 -Height 560 -Destination (Join-Path $storeAssetRoot "promo-marquee-1400x560.png")

Get-ChildItem -LiteralPath $extensionIconRoot, $storeAssetRoot -File | Select-Object FullName, Length
