# Draws the launcher icons, the Android TV banner and the Play Store icon from the JBP Capital logo
# (white on transparent) as a gold logo on the obsidian background of the app.
# Run: powershell -ExecutionPolicy Bypass -File apps\android\scripts\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$logo = [System.Drawing.Image]::FromFile((Join-Path $here 'jbp-capital-logo.png'))
$res = Join-Path $here '..\app\src\main\res'
$background = [System.Drawing.ColorTranslator]::FromHtml('#131313')
$gold = [System.Drawing.ColorTranslator]::FromHtml('#e9c349')
$text = [System.Drawing.ColorTranslator]::FromHtml('#e2e2e2')

# White pixels become gold; transparency stays.
$matrix = New-Object System.Drawing.Imaging.ColorMatrix
$matrix.Matrix00 = $gold.R / 255; $matrix.Matrix11 = $gold.G / 255; $matrix.Matrix22 = $gold.B / 255
$matrix.Matrix33 = 1; $matrix.Matrix44 = 1
$goldTint = New-Object System.Drawing.Imaging.ImageAttributes
$goldTint.SetColorMatrix($matrix)

function New-Canvas([int]$width, [int]$height) {
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = 'HighQuality'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear($background)
    return @($bitmap, $g)
}

function Draw-Logo($g, [double]$x, [double]$y, [double]$height) {
    $width = $height * $logo.Width / $logo.Height
    $rect = New-Object System.Drawing.Rectangle ([int]$x), ([int]$y), ([int]$width), ([int]$height)
    $g.DrawImage($logo, $rect, 0, 0, $logo.Width, $logo.Height, [System.Drawing.GraphicsUnit]::Pixel, $goldTint)
    return $width
}

function Save($bitmap, $g, [string]$path) {
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bitmap.Dispose()
    Write-Host "wrote $path"
}

function Icon([int]$size, [string]$path, [switch]$Rounded) {
    $bitmap, $g = New-Canvas $size $size
    if ($Rounded) {
        # Legacy launcher icons: a rounded square, so launchers without masks do not show a hard block.
        $g.Clear([System.Drawing.Color]::Transparent)
        $r = $size * 0.2
        $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
        $shape.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $shape.AddArc($size - 2 * $r - 1, 0, 2 * $r, 2 * $r, 270, 90)
        $shape.AddArc($size - 2 * $r - 1, $size - 2 * $r - 1, 2 * $r, 2 * $r, 0, 90); $shape.AddArc(0, $size - 2 * $r - 1, 2 * $r, 2 * $r, 90, 90)
        $shape.CloseFigure()
        $g.FillPath((New-Object System.Drawing.SolidBrush $background), $shape)
    }
    $height = $size * 0.5
    $width = $height * $logo.Width / $logo.Height
    [void](Draw-Logo $g (($size - $width) / 2) (($size - $height) / 2) $height)
    Save $bitmap $g $path
}

$densities = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($d in $densities.Keys) { Icon $densities[$d] (Join-Path $res "mipmap-$d\ic_launcher.png") -Rounded }

# Adaptive icon (Android 8+): the logo on a transparent 108 dp layer, inside the 66 dp safe zone.
$bitmap, $g = New-Canvas 432 432
$g.Clear([System.Drawing.Color]::Transparent)
$h = 432 * 0.3
$w = $h * $logo.Width / $logo.Height
[void](Draw-Logo $g ((432 - $w) / 2) ((432 - $h) / 2) $h)
Save $bitmap $g (Join-Path $res 'drawable-nodpi\ic_launcher_foreground.png')

# Play Store listing icon (512 × 512) and feature graphic (1024 × 500) are kept next to the store texts.
$store = Join-Path $here '..\..\..\docs\android'
Icon 512 (Join-Path $store 'icon-512.png')

function Banner([int]$width, [int]$height, [string]$path, [double]$titleSize) {
    $bitmap, $g = New-Canvas $width $height
    $logoHeight = $height * 0.46
    $pad = $height * 0.12
    $logoWidth = Draw-Logo $g $pad (($height - $logoHeight) / 2) $logoHeight
    $left = $pad * 1.8 + $logoWidth
    # The logo already says JBP Capital; the name is not written out again.
    $title = New-Object System.Drawing.Font 'Segoe UI Semibold', $titleSize, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawString('Portfolio', $title, (New-Object System.Drawing.SolidBrush $text), $left, ($height / 2 - $titleSize * 1.2))
    $g.DrawString('Viewer', $title, (New-Object System.Drawing.SolidBrush $text), $left, ($height / 2 - $titleSize * 0.1))
    Save $bitmap $g $path
}

# Android TV home screen banner: 320 × 180 at xhdpi.
Banner 320 180 (Join-Path $res 'drawable-xhdpi\banner.png') 30
Banner 1024 500 (Join-Path $store 'feature-graphic.png') 104

$logo.Dispose()
