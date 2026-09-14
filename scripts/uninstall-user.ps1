<# Removes the per-user install created by scripts\install-user.ps1. #>
$ErrorActionPreference = 'SilentlyContinue'
Get-Process SysGlance | Stop-Process -Force
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\SysGlance.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SysGlance.lnk') -Force
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SysGlance' -Recurse -Force
Start-Sleep -Milliseconds 800
Remove-Item (Join-Path $env:LOCALAPPDATA 'Programs\SysGlance') -Recurse -Force
Write-Host 'SysGlance desinstalado.'
