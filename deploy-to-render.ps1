# 一鍵推送到 GitHub（Render 會從 GitHub 自動部署）
# 用法：在 PowerShell 執行 .\deploy-to-render.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error '請先安裝 Git：https://git-scm.com/download/win'
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error '請先安裝 GitHub CLI：https://cli.github.com/ 並執行 gh auth login'
}

if (-not (Test-Path .git)) {
  git init
  git branch -M main
}

# 僅設定此專案的本機 Git 身分（不修改全域設定）
$ghUser = (gh api user -q .login 2>$null)
if (-not $ghUser) { $ghUser = 'WEI' }
git config user.name $ghUser
git config user.email "$ghUser@users.noreply.github.com"

git add .
git status --short

$msg = "Prepare Render deployment"
$existing = git log -1 --format=%s 2>$null
if ($LASTEXITCODE -ne 0) {
  git commit -m $msg
} else {
  $dirty = git status --porcelain
  if ($dirty) { git commit -m $msg }
}

$remote = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n建立 GitHub 私人倉庫 lineage-manage ..."
  gh repo create lineage-manage --private --source=. --remote=origin --push
} else {
  Write-Host "`n推送到 GitHub ..."
  git push -u origin main
}

Write-Host @"

✅ 程式碼已推送到 GitHub。

接下來在 Render 部署（瀏覽器會自動開啟）：
1. 用 GitHub 登入 Render
2. New + → Blueprint → 選 lineage-manage
3. 點 Apply，等 3~5 分鐘
4. 複製網址，結尾加 /login.html

"@

Start-Process "https://dashboard.render.com/blueprint/new"
