# Offline asset preparation only. Source files are supplied locally, never fetched at runtime.
# See apps/web/public/boards/PROVENANCE.md for source URLs, licenses and SHA-256 pins.
param([Parameter(Mandatory=$true)][string]$OakSource,
      [Parameter(Mandatory=$true)][string]$TableSource,
      [string]$OutputDirectory = 'apps/web/public/boards')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$parameters = [Drawing.Imaging.EncoderParameters]::new(1)
$parameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality, [long]88)
$recipes = @(
  @{ Name='natural-light-v3'; Source=$OakSource; Mid=@(224,204,170); Contrast=0.85 },
  @{ Name='natural-dark-v3'; Source=$TableSource; Mid=@(126,88,58); Contrast=1.10 },
  @{ Name='golden-light-v3'; Source=$OakSource; Mid=@(237,211,161); Contrast=0.85 },
  @{ Name='golden-dark-v3'; Source=$TableSource; Mid=@(159,112,59); Contrast=1.05 }
)
foreach ($recipe in $recipes) {
  $source = [Drawing.Image]::FromFile((Resolve-Path $recipe.Source))
  $bitmap = [Drawing.Bitmap]::new(512,512)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($source,0,0,512,512)
  $graphics.Dispose(); $source.Dispose()
  # Retain the photographed fibers/pores and tonal variation, with a bounded color
  # treatment for reliable piece contrast. No generated grain, noise or new knots.
  $sum=0.0
  for($y=0;$y -lt 512;$y++) { for($x=0;$x -lt 512;$x++) {
    $p=$bitmap.GetPixel($x,$y); $sum += 0.2126*$p.R+0.7152*$p.G+0.0722*$p.B
  }}
  $mean=$sum/(512*512)
  for($y=0;$y -lt 512;$y++) { for($x=0;$x -lt 512;$x++) {
    $p=$bitmap.GetPixel($x,$y)
    $delta=(0.2126*$p.R+0.7152*$p.G+0.0722*$p.B-$mean)*$recipe.Contrast
    $channels=@($recipe.Mid | ForEach-Object { [int][Math]::Clamp($_+$delta,0,255) })
    $bitmap.SetPixel($x,$y,[Drawing.Color]::FromArgb($channels[0],$channels[1],$channels[2]))
  }}
  $bitmap.Save((Join-Path (Resolve-Path $OutputDirectory) ($recipe.Name+'.jpg')),$codec,$parameters)
  $bitmap.Dispose()
}
$parameters.Dispose()
