# Deploy scene-ai-agent + optional SQL migration to CVM from Windows.
param(
  [string]$ServerIp = "146.56.200.250",
  [string]$User = "ubuntu",
  [string]$SshKey = "$env:USERPROFILE\.ssh\id_ed25519_tencent",
  [switch]$SkipSql
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

Write-Host "==> Sync repo to server (git pull or scp function files)"
ssh @SshArgs "${User}@${ServerIp}" "mkdir -p ~/upaiego-management"
scp @ScpArgs -r "$RepoRoot\supabase\functions\scene-ai-agent" "${User}@${ServerIp}:~/upaiego-management/supabase/functions/"
scp @ScpArgs "$RepoRoot\scripts\server\deploy_scene_ai_agent.sh" "${User}@${ServerIp}:~/deploy_scene_ai_agent.sh"

if (-not $SkipSql) {
  scp @ScpArgs "$RepoRoot\docs\AGENT_CHAT_UPDATE_MIGRATION.sql" "${User}@${ServerIp}:~/AGENT_CHAT_UPDATE_MIGRATION.sql"
}

Write-Host "==> Apply chat UPDATE migration (if needed)"
if (-not $SkipSql) {
  ssh @SshArgs "${User}@${ServerIp}" @"
cd ~/supabase/docker
sudo docker-compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ~/AGENT_CHAT_UPDATE_MIGRATION.sql || true
"@
}

Write-Host "==> Deploy edge function"
ssh @SshArgs "${User}@${ServerIp}" "chmod +x ~/deploy_scene_ai_agent.sh && bash ~/deploy_scene_ai_agent.sh ~/upaiego-management"

Write-Host "Done."
