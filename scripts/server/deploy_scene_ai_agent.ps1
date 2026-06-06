# Deploy scene-ai-agent + optional SQL migration to CVM from Windows.
param(
  [string]$ServerIp = "146.56.200.250",
  [string]$User = "ubuntu",
  [switch]$SkipSql
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

Write-Host "==> Sync repo to server (git pull or scp function files)"
ssh "${User}@${ServerIp}" "mkdir -p ~/upaiego-management"
scp -r "$RepoRoot\supabase\functions\scene-ai-agent" "${User}@${ServerIp}:~/upaiego-management/supabase/functions/"
scp "$RepoRoot\scripts\server\deploy_scene_ai_agent.sh" "${User}@${ServerIp}:~/deploy_scene_ai_agent.sh"

if (-not $SkipSql) {
  scp "$RepoRoot\docs\AGENT_CHAT_UPDATE_MIGRATION.sql" "${User}@${ServerIp}:~/AGENT_CHAT_UPDATE_MIGRATION.sql"
}

Write-Host "==> Apply chat UPDATE migration (if needed)"
if (-not $SkipSql) {
  ssh "${User}@${ServerIp}" @"
cd ~/supabase/docker
sudo docker-compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ~/AGENT_CHAT_UPDATE_MIGRATION.sql || true
"@
}

Write-Host "==> Deploy edge function"
ssh "${User}@${ServerIp}" "chmod +x ~/deploy_scene_ai_agent.sh && bash ~/deploy_scene_ai_agent.sh ~/upaiego-management"

Write-Host "Done."
