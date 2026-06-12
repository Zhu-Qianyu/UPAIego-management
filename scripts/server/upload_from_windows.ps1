# Run in PowerShell on Windows from repo root.
# Requires: OpenSSH (scp/ssh), and password or SSH key for ubuntu@146.56.200.250
param(
  [string]$ServerIp = "146.56.200.250",
  [string]$User = "ubuntu",
  [string]$SupabaseDocker = "C:\temp\supabase\docker"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path "$SupabaseDocker\.env.example")) {
  Write-Host "Missing $SupabaseDocker\.env.example"
  Write-Host "Clone first: git clone --depth 1 https://ghproxy.net/https://github.com/supabase/supabase.git C:\temp\supabase"
  exit 1
}

Write-Host "==> mkdir on server"
ssh "${User}@${ServerIp}" "mkdir -p ~/supabase"

Write-Host "==> upload docker folder (may take a few minutes)"
scp -r "$SupabaseDocker" "${User}@${ServerIp}:~/supabase/"

Write-Host "==> upload bootstrap script"
scp "$PSScriptRoot\bootstrap_supabase_on_cvm.sh" "${User}@${ServerIp}:~/bootstrap_supabase_on_cvm.sh"

if (Test-Path "schema.sql") {
  Write-Host "==> upload schema.sql"
  scp schema.sql "${User}@${ServerIp}:~/schema.sql"
}
if (Test-Path "data.sql") {
  Write-Host "==> upload data.sql"
  scp data.sql "${User}@${ServerIp}:~/data.sql"
}

Write-Host ""
Write-Host "Done. On server run:"
Write-Host "  bash ~/bootstrap_supabase_on_cvm.sh"
