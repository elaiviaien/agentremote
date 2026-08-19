$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path (Join-Path $Root 'dist\server\index.js'))) {
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null

npx --yes pm2 describe agentremote-hub | Out-Null
if ($LASTEXITCODE -ne 0) {
  npx --yes pm2 start ecosystem.config.js
} else {
  npx --yes pm2 reload ecosystem.config.js --update-env
}

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx --yes pm2 save
npx --yes pm2 status
