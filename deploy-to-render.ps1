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

$ghUser = (gh api user -q .login 2>$null)
if (-not $ghUser) { $ghUser = 'WEI' }
git config user.name $ghUser
git config user.email "$ghUser@users.noreply.github.com"

git add .
git status --short

$msg = 'Deploy to Render'
$hasHead = git rev-parse HEAD 2>$null
if (-not $hasHead) {
  git commit -m $msg
} elseif (git status --porcelain) {
  git commit -m $msg
}

if (-not (git rev-parse HEAD 2>$null)) {
  Write-Error '沒有任何 commit'
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  $repoExists = gh repo view lineage-manage 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host '倉庫已存在，連接遠端並推送...'
    git remote add origin "https://github.com/$ghUser/lineage-manage.git"
  } else {
    Write-Host '建立 GitHub 私人倉庫 lineage-manage ...'
    gh repo create lineage-manage --private --source=. --remote=origin
    if ($LASTEXITCODE -ne 0) { throw '建立倉庫失敗' }
  }
}

Write-Host '推送到 GitHub ...'
git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host '一般推送失敗，嘗試覆蓋遠端...'
  git push -u origin main --force
}
if ($LASTEXITCODE -ne 0) { throw '推送失敗' }

Write-Host @"

✅ 程式碼已推送到 GitHub。

接下來在 Render 部署（瀏覽器會自動開啟）：
1. 用 GitHub 登入 Render
2. New + → Blueprint → 選 lineage-manage
3. 點 Apply，等 3~5 分鐘
4. 複製網址，結尾加 /login.html

"@

Start-Process "https://dashboard.render.com/blueprint/new"
