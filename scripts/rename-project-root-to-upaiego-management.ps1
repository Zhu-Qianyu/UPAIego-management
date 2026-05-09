# Renames the repository root folder from cyber-cap-management -> upaiego-management.
# Close Cursor/VS Code and any terminals whose cwd is inside this folder, then run:
#   powershell -ExecutionPolicy Bypass -File .\scripts\rename-project-root-to-upaiego-management.ps1
# Or from File Explorer: right-click this file -> Run with PowerShell.

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$leaf = Split-Path $repoRoot -Leaf
if ($leaf -ne "cyber-cap-management") {
  Write-Host "Current folder is '$leaf', not 'cyber-cap-management'. No rename performed."
  exit 0
}
$parent = Split-Path $repoRoot -Parent
Set-Location $parent
Rename-Item -LiteralPath "cyber-cap-management" -NewName "upaiego-management"
Write-Host "OK: $parent\upaiego-management"
Write-Host "Reopen the project from that path."
