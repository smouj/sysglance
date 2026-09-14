# SysGlance — accent algorithm cross-check (Windows side)
#
# Why this exists: the accent sampler in src/shell/taskbar.js averages a BGRA
# buffer produced by Electron's nativeImage. Electron cannot run headless in a
# WSL dev shell, so this script reconstructs the same buffer with System.Drawing
# (the in-box .NET imaging stack), writes it to a raw file, and computes the
# reference average with the same filter rules.
#
#   node scripts/verify-shell.js --pixels <OutFile> <width> <height>
#
# then returns the identical number if the Node implementation is correct.
# Verified input = the real wallpaper; nothing is modified.

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$MaxDim = 64
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $Path)) { throw "wallpaper not found: $Path" }

$src = [System.Drawing.Image]::FromFile($Path)
try {
  $scale = [Math]::Min($MaxDim / $src.Width, $MaxDim / $src.Height)
  $w = [Math]::Max(1, [int][Math]::Round($src.Width * $scale))
  $h = [Math]::Max(1, [int][Math]::Round($src.Height * $scale))

  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($src, 0, 0, $w, $h)
    } finally { $g.Dispose() }

    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $stride = $data.Stride
      $row = New-Object byte[] $stride
      # Compact to tightly packed w*4 BGRA rows (LockBits rows can be padded).
      $raw = New-Object byte[] ($w * 4 * $h)
      for ($y = 0; $y -lt $h; $y++) {
        [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($data.Scan0, $y * $stride), $row, 0, $w * 4)
        [Array]::Copy($row, 0, $raw, $y * $w * 4, $w * 4)
      }
    } finally { $bmp.UnlockBits($data) }
  } finally { $bmp.Dispose() }

  [System.IO.File]::WriteAllBytes($OutFile, $raw)

  # Same filter as averageAccentRgb(): A>=128, value>=0.12, saturation>=0.15,
  # not (value>=0.95 and saturation<0.2); fall back to all opaque pixels.
  # NOTE: PowerShell variable names are case-insensitive, so the pixel channels
  # must not be named $r/$g/$b — that would collide with the accumulators.
  $sumR = 0; $sumG = 0; $sumB = 0; $n = 0
  $allR = 0; $allG = 0; $allB = 0; $allN = 0
  for ($i = 0; $i -lt $raw.Length; $i += 4) {
    $pb = $raw[$i]; $pg = $raw[$i + 1]; $pr = $raw[$i + 2]; $pa = $raw[$i + 3]
    if ($pa -lt 128) { continue }
    $allR += $pr; $allG += $pg; $allB += $pb; $allN++
    $mx = [Math]::Max($pr, [Math]::Max($pg, $pb))
    $mn = [Math]::Min($pr, [Math]::Min($pg, $pb))
    $value = $mx / 255.0
    $sat = if ($mx -eq 0) { 0.0 } else { ($mx - $mn) / [double]$mx }
    if ($value -lt 0.12) { continue }
    if ($sat -lt 0.15) { continue }
    if ($value -ge 0.95 -and $sat -lt 0.2) { continue }
    $sumR += $pr; $sumG += $pg; $sumB += $pb; $n++
  }
  if ($n -eq 0 -and $allN -gt 0) { $sumR = $allR; $sumG = $allG; $sumB = $allB; $n = $allN }

  if ($n -eq 0) { Write-Output "reference=none" }
  else {
    $R2 = [int][Math]::Round($sumR / $n); $G2 = [int][Math]::Round($sumG / $n); $B2 = [int][Math]::Round($sumB / $n)
    $hex = '#{0:x2}{1:x2}{2:x2}' -f $R2, $G2, $B2
    Write-Output ("reference={0} r={1} g={2} b={3} kept={4} sampled={5}" -f $hex, $R2, $G2, $B2, $n, $allN)
  }
  Write-Output ("dump={0} width={1} height={2} bytes={3}" -f $OutFile, $w, $h, $raw.Length)
} finally { $src.Dispose() }
