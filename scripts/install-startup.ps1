$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot 'start-all.ps1'
$TaskName = 'AgentRemote Cloud Hub'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
$vbsPath = Join-Path $startupDir 'AgentRemoteCloudHub.vbs'
$vbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$StartScript""", 0, False
"@
Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII

Write-Host "Registered Windows logon autostart for AgentRemote Cloud Hub."
Write-Host "Task Scheduler: $TaskName"
Write-Host "Startup shortcut: $vbsPath"
Write-Host "Repo: $Root"
