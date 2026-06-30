@echo off
chcp 65001 >nul
title 天堂M血盟管理 - 一鍵部署到 Render
cd /d "%~dp0"

echo.
echo ========================================
echo   天堂M血盟管理系統 - 一鍵部署
echo ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 未安裝 Git
  echo 請先安裝：https://git-scm.com/download/win
  echo 安裝後重新雙擊此檔案
  pause
  exit /b 1
)

where gh >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 未安裝 GitHub CLI
  echo 請先安裝：https://cli.github.com/
  echo 安裝後重新雙檔此檔案
  pause
  exit /b 1
)

echo.
echo [1/5] 備份雲端資料並準備部署快照...
set BACKUP_OK=0
if exist backup-config.json (
  powershell -ExecutionPolicy Bypass -File "%~dp0backup-cloud.ps1" -Quiet
  if not errorlevel 1 set BACKUP_OK=1
)
if "%BACKUP_OK%"=="0" (
  if exist server\data\store.json (
    copy /Y server\data\store.json server\data\store.production.json >nul
    echo       已使用本機 store.json 作為部署資料快照
    set BACKUP_OK=1
  ) else (
    echo       [注意] 無法備份雲端且本機無資料，部署後可能使用空白初始資料
    echo       建議先設定 backup-config.json 並執行「備份雲端資料.bat」
  )
) else (
  echo       雲端資料已同步到 store.production.json
)

echo.
echo [2/5] 檢查 GitHub 登入狀態...
gh auth status >nul 2>&1
if errorlevel 1 (
  echo.
  echo 請在跳出的視窗登入 GitHub（只需做一次）
  gh auth login -w -p https
  if errorlevel 1 (
    echo [錯誤] GitHub 登入失敗
    pause
    exit /b 1
  )
)
echo       GitHub 已登入 OK

echo.
echo [3/5] 上傳程式到 GitHub...
if not exist .git git init -b main >nul 2>&1

echo       設定本機 Git 身分（僅此專案）...
for /f "delims=" %%i in ('gh api user -q .login 2^>nul') do set GH_USER=%%i
if not defined GH_USER set GH_USER=WEI
git config user.name "%GH_USER%"
git config user.email "%GH_USER%@users.noreply.github.com"

git add -A
git add -f server\data\store.production.json 2>nul
git diff --cached --quiet
if not errorlevel 1 (
  echo       沒有新變更，略過 commit
) else (
  git commit -m "Deploy to Render"
  if errorlevel 1 (
    echo [錯誤] 建立 commit 失敗
    pause
    exit /b 1
  )
)

git rev-parse HEAD >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 沒有任何 commit，請確認專案檔案存在
  pause
  exit /b 1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  gh repo view lineage-manage >nul 2>&1
  if not errorlevel 1 (
    echo       倉庫已存在，連接遠端並推送...
    git remote add origin https://github.com/%GH_USER%/lineage-manage.git
  ) else (
    echo       建立私人倉庫 lineage-manage ...
    gh repo create lineage-manage --private --source=. --remote=origin
    if errorlevel 1 (
      echo [錯誤] 建立倉庫失敗
      pause
      exit /b 1
    )
  )
)

echo       推送到 GitHub...
git push -u origin main
if errorlevel 1 (
  echo       一般推送失敗，嘗試覆蓋遠端...
  git push -u origin main --force
)
if errorlevel 1 (
  echo [錯誤] 上傳 GitHub 失敗
  pause
  exit /b 1
)

for /f "delims=" %%i in ('git remote get-url origin') do set REPO_URL=%%i
echo       已上傳：%REPO_URL%

echo.
echo [4/5] Render 將自動重新部署（約 3~5 分鐘）...
echo.
echo 資料快照 store.production.json 已隨程式上傳，
echo 部署完成後會自動還原，無需手動執行還原腳本。
echo.
start https://dashboard.render.com/

echo.
echo [5/5] 完成！
echo.
echo 部署成功後網址類似：
echo   https://lineage-manage-xxxx.onrender.com/login.html
echo.
echo 預設管理員：帳號 極致  密碼 love0227
echo 上線後請立刻修改密碼！
echo.
pause
