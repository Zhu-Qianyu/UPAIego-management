# 一次性配置：让本机 Cursor 能免密 scp/ssh 到 CVM
# 在 Windows PowerShell 执行本脚本后，按提示在 SSH 里粘贴一行命令。

$ServerIp = "146.56.200.250"
$User = "ubuntu"
$Key = "$env:USERPROFILE\.ssh\id_ed25519_tencent"

if (-not (Test-Path "$Key.pub")) {
  ssh-keygen -t ed25519 -f $Key -N '""' -q
}

$pub = Get-Content "$Key.pub" -Raw
Write-Host ""
Write-Host "=== 1) 先 SSH 登录服务器（会要密码）==="
Write-Host "ssh $User@$ServerIp"
Write-Host ""
Write-Host "=== 2) 在服务器里粘贴下面整行 ==="
Write-Host "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$($pub.Trim())' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
Write-Host ""
Write-Host "=== 3) 回到 Windows 测试（不应再要密码）==="
Write-Host "ssh -i `"$Key`" $User@$ServerIp `"echo ok`""
Write-Host ""
Write-Host "=== 4) 上传并部署 ==="
Write-Host "powershell -ExecutionPolicy Bypass -File scripts\server\upload_from_windows.ps1"
