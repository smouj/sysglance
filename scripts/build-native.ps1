# Builds the SysGlance native shell helper with the .NET Framework compiler that
# ships with Windows. No SDK, no Visual Studio, no npm native modules.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-native.ps1
#   -> src\native\shell\SysGlanceShellHelper.exe   (not committed; see .gitignore)
#
# From a WSL checkout, run it through Windows interop:
#   /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
#     -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }
$src = Join-Path $root 'src\native\shell\SysGlanceShellHelper.cs'
$out = Join-Path $root 'src\native\shell\SysGlanceShellHelper.exe'
& $csc /nologo /target:exe /optimize+ "/out:$out" "$src"
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Host "built: $out"
