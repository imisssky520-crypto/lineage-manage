# 把本機資料還原到雲端（部署後執行）
# 用法：powershell -File restore-cloud.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$configPath = Join-Path $PSScriptRoot 'backup-config.json'
$storePath = Join-Path $PSScriptRoot 'server\data\store.json'

if (-not (Test-Path $configPath)) {
  Write-Host '[錯誤] 找不到 backup-config.json'
  pause
  exit 1
}
if (-not (Test-Path $storePath)) {
  Write-Host '[錯誤] 找不到 server\data\store.json，請先執行 backup-cloud.ps1'
  pause
  exit 1
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$baseUrl = $config.url.TrimEnd('/')
$account = $config.account
$password = $config.password
$store = Get-Content $storePath -Raw | ConvertFrom-Json

Write-Host "還原資料到 $baseUrl ..."

$loginBody = @{ account = $account; password = $password } | ConvertTo-Json
try {
  $login = Invoke-RestMethod -Uri "$baseUrl/api/login" -Method POST -Body $loginBody -ContentType 'application/json; charset=utf-8'
} catch {
  Write-Host '[錯誤] 登入失敗（若剛部署請等 Render 顯示 Live 後再試）'
  pause
  exit 1
}

$headers = @{ Authorization = "Bearer $($login.token)" }
$body = @{ store = $store } | ConvertTo-Json -Depth 30
try {
  $result = Invoke-RestMethod -Uri "$baseUrl/api/admin/restore" -Method POST -Headers $headers -Body $body -ContentType 'application/json; charset=utf-8'
} catch {
  Write-Host '[錯誤] 還原失敗（請確認已部署含備份 API 的最新版本）'
  Write-Host $_.Exception.Message
  pause
  exit 1
}

Write-Host ''
Write-Host "✅ $($result.message)"
Write-Host '請重新整理網頁確認資料。'
pause
