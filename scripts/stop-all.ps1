$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
npx --yes pm2 stop ecosystem.config.js
npx --yes pm2 status
