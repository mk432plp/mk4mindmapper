param(
  [string]$InstallDir = "$env:LOCALAPPDATA\MK4MindMapper"
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $InstallDir -Recurse -Force -Exclude ".git"

$shell = New-Object -ComObject WScript.Shell
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "MK4 MindMapper.lnk"
$startMenuDir = Join-Path ([Environment]::GetFolderPath("Programs")) "MK4 MindMapper"
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
$startShortcut = Join-Path $startMenuDir "MK4 MindMapper.lnk"

foreach ($shortcutPath in @($desktopShortcut, $startShortcut)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$InstallDir\scripts\start.ps1`""
  $shortcut.WorkingDirectory = $InstallDir
  $shortcut.IconLocation = "$InstallDir\assets\icon.svg"
  $shortcut.Description = "Launch MK4 MindMapper"
  $shortcut.Save()
}

Write-Host "MK4 MindMapper installed to $InstallDir"
Write-Host "Shortcuts created on the Desktop and Start Menu."
