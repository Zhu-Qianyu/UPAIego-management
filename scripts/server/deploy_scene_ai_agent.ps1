# Deploy scene-ai-agent to CVM from Windows.
param(
  [string]$ServerIp = "146.56.200.250",
  [string]$User = "ubuntu",
  [string]$SshKey = "$env:USERPROFILE\.ssh\id_ed25519_tencent"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$SshArgs = @()
$ScpArgs = @()
if ($SshKey -and (Test-Path $SshKey)) {
  $SshArgs = @("-i", $SshKey)
  $ScpArgs = @("-i", $SshKey)
  Write-Host "==> Using SSH key $SshKey"
} else {
  Write-Host "==> No SSH key at $SshKey — will use default ssh agent/config"
}

Write-Host "==> Sync function files to server"
ssh @SshArgs "${User}@${ServerIp}" "mkdir -p ~/upaiego-management/supabase/functions"
scp @ScpArgs -r "$RepoRoot\supabase\functions\scene-ai-agent" "${User}@${ServerIp}:~/upaiego-management/supabase/functions/"
scp @ScpArgs "$RepoRoot\scripts\server\deploy_scene_ai_agent.sh" "${User}@${ServerIp}:~/deploy_scene_ai_agent.sh"

Write-Host "==> Deploy edge function"
ssh @SshArgs "${User}@${ServerIp}" "chmod +x ~/deploy_scene_ai_agent.sh && bash ~/deploy_scene_ai_agent.sh ~/upaiego-management"

Write-Host "Done."
