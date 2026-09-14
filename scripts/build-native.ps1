# Builds the SysGlance native helpers using the .NET Framework compiler that
# ships with Windows. No SDK, no npm native modules, no external toolchain.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }
$src = Join-Path $root 'src\native\trayblur\SysGlanceTrayBlur.cs'
$out = Join-Path $root 'src\native\trayblur\SysGlanceTrayBlur.exe'
& $csc /nologo /target:exe /optimize+ "/out:$out" "$src"
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Host "built: $out"
