$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Start-Process -FilePath node -ArgumentList 'server/index.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Start-Sleep -Seconds 2
Write-Host 'Server started at http://localhost:3000/login.html'
