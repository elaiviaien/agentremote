$ErrorActionPreference = 'Continue'
$TaskName = 'AgentRemote Cloud Hub'
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$vbsPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\AgentRemoteCloudHub.vbs'
if (Test-Path $vbsPath) {
  Remove-Item $vbsPath -Force
}
Write-Host "Removed AgentRemote Cloud Hub autostart."
