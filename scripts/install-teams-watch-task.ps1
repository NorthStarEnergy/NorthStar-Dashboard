param(
    [string]$Config,
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Config) { $Config = Join-Path $projectRoot 'data\teams-watch.json' }
$Config = (Resolve-Path -LiteralPath $Config).Path
$pythonPath = (Get-Command $Python -ErrorAction Stop).Source
& $pythonPath (Join-Path $projectRoot 'northstar_teams_watch.py') --config $Config --check
if ($LASTEXITCODE -ne 0) { throw 'Watcher configuration is not ready.' }
& $pythonPath (Join-Path $projectRoot 'northstar_teams_watch.py') --config $Config --once
if ($LASTEXITCODE -ne 0) { throw 'Complete Microsoft sign-in and a successful scan before installing autostart.' }
$taskName = 'NorthStar Teams watcher'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'A watcher task already exists. Inspect it before replacing it.'
}
$launcher = Join-Path $projectRoot 'start-teams-watch.ps1'
$arguments = '-NoProfile -WindowStyle Hidden -File "{0}" -Config "{1}" -Python "{2}" -Mode watch' -f $launcher,$Config,$pythonPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
