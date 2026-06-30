@echo off
cd /d C:\Users\WEI\Projects\lineage-manage
echo === DEPLOY START === > _deploy_log.txt
where git >> _deploy_log.txt 2>&1
where gh >> _deploy_log.txt 2>&1
gh auth status >> _deploy_log.txt 2>&1
if not exist .git (
  git init -b main >> _deploy_log.txt 2>&1
)
git add . >> _deploy_log.txt 2>&1
git status --short >> _deploy_log.txt 2>&1
git diff --cached --quiet
if errorlevel 1 git commit -m "Prepare Render deployment" >> _deploy_log.txt 2>&1
git remote get-url origin >> _deploy_log.txt 2>&1
if errorlevel 1 (
  gh repo create lineage-manage --private --source=. --remote=origin --push >> _deploy_log.txt 2>&1
) else (
  git push -u origin main >> _deploy_log.txt 2>&1
)
git remote get-url origin >> _deploy_log.txt 2>&1
echo === DEPLOY END === >> _deploy_log.txt
