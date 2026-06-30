# 從雲端下載資料到本機
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$configPath = Join-Path $PSScriptRoot 'backup-config.json'
if (-not (Test-Path $configPath)) {
  Write-Host '[錯誤] 找不到 backup-config.json'
  Write-Host '請複製 backup-config.example.json 為 backup-config.json 並填入帳號密碼'
  pause
  exit 1
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$baseUrl = $config.url.TrimEnd('/')
$account = $config.account
$password = $config.password

if (-not $account -or -not $password -or $password -match '請改成') {
  Write-Host '[錯誤] 請在 backup-config.json 設定正確的帳號與密碼'
  pause
  exit 1
}

Write-Host "連線到 $baseUrl ..."

$loginBody = @{ account = $account; password = $password } | ConvertTo-Json
try {
  $login = Invoke-RestMethod -Uri "$baseUrl/api/login" -Method POST -Body $loginBody -ContentType 'application/json; charset=utf-8'
} catch {
  Write-Host '[錯誤] 登入失敗，請確認網址、帳號、密碼（雲端若休眠請等 30~60 秒再試）'
  Write-Host $_.Exception.Message
  pause
  exit 1
}

$headers = @{ Authorization = "Bearer $($login.token)" }
try {
  $backup = Invoke-RestMethod -Uri "$baseUrl/api/admin/backup" -Headers $headers -Method GET
} catch {
  Write-Host '[錯誤] 備份失敗，請確認帳號為最高管理員 (super_admin)'
  Write-Host $_.Exception.Message
  pause
  exit 1
}

$dataDir = Join-Path $PSScriptRoot 'server\data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$storePath = Join-Path $dataDir 'store.json'
$productionPath = Join-Path $dataDir 'store.production.json'
$archivePath = Join-Path $dataDir "store.cloud-$stamp.json"
$backupWrapPath = Join-Path $dataDir "backup-$stamp.json"

$storeJson = $backup.store | ConvertTo-Json -Depth 30
$backup | ConvertTo-Json -Depth 30 | Set-Content -Path $backupWrapPath -Encoding UTF8
$storeJson | Set-Content -Path $storePath -Encoding UTF8
$storeJson | Set-Content -Path $productionPath -Encoding UTF8
$storeJson | Set-Content -Path $archivePath -Encoding UTF8

Write-Host ''
Write-Host '✅ 雲端資料已下載到本機：'
Write-Host "   $storePath"
Write-Host "   $productionPath （下次部署會自動帶上雲端）"
Write-Host "   $archivePath"
Write-Host "   匯出時間：$($backup.exportedAt)"
Write-Host ''
Write-Host '下次執行「一鍵部署.bat」時，資料會隨程式一起上傳並自動還原。'
if (-not $Quiet) { pause }
