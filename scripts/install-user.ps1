<#
  Per-user install of SysGlance, no administrator required.
  Same layout Electron apps use: %LOCALAPPDATA%\Programs\SysGlance, Start-menu and
  desktop shortcuts, and an entry in "Apps & features" with its own uninstaller.

  Usage:  pwsh -File scripts\install-user.ps1        (after: npm run build:win, or --dir)
#>
[CmdletBinding()]
param(
  [string]$From = (Join-Path $PSScriptRoot '..\dist\win-unpacked'),
  [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'

$dest = Join-Path $env:LOCALAPPDATA 'Programs\SysGlance'
$exe  = Join-Path $dest 'SysGlance.exe'

if (-not (Test-Path $From)) { throw "No encuentro el build en $From - ejecuta 'npm run build:win' o 'electron-builder --win dir'" }
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Copy-Item $From $dest -Recurse
Write-Host "instalado en: $dest"

$ws = New-Object -ComObject WScript.Shell
$dirs = @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'), [Environment]::GetFolderPath('Desktop'))
foreach ($d in $dirs) {
  $lnk = $ws.CreateShortcut((Join-Path $d 'SysGlance.lnk'))
  $lnk.TargetPath = $exe; $lnk.WorkingDirectory = $dest
  $lnk.Description = 'SysGlance - desktop control center'; $lnk.IconLocation = "$exe,0"; $lnk.Save()
}

$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SysGlance'
New-Item -Path $key -Force | Out-Null
$version = (Get-Content (Join-Path $dest 'resources\app\package.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json).version
if (-not $version) { $version = '0.0.0' }
$sizeKb = [int]((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
foreach ($kv in @{
  DisplayName = 'SysGlance'; DisplayVersion = $version; Publisher = 'smouj'
  InstallLocation = $dest; DisplayIcon = "$exe,0"
  UninstallString = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $dest 'resources\uninstall-user.ps1') + '"'
}.GetEnumerator()) { Set-ItemProperty $key -Name $kv.Key -Value $kv.Value }
Set-ItemProperty $key -Name NoModify -Value 1 -Type DWord
Set-ItemProperty $key -Name NoRepair -Value 1 -Type DWord
Set-ItemProperty $key -Name EstimatedSize -Value $sizeKb -Type DWord
Write-Host "registrado en Aplicaciones instaladas (v$version, $([math]::Round($sizeKb/1024,1)) MB)"

if (-not $NoLaunch) { Start-Process -FilePath $exe -WorkingDirectory $dest; Write-Host 'SysGlance lanzada.' }
