[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'NorthStar Control Room backend'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdministrator) {
    throw 'Open PowerShell as Administrator, then run this script again.'
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT60S'
$runAs = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Limited

Set-ScheduledTask `
    -TaskName $taskName `
    -Trigger $trigger `
    -Principal $runAs | Out-Null

$updated = Get-ScheduledTask -TaskName $taskName
$bootTrigger = @($updated.Triggers) | Where-Object {
    $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger'
}

if (-not $bootTrigger) {
    throw 'The task update returned without installing an at-startup trigger.'
}

[pscustomobject]@{
    TaskName = $updated.TaskName
    State = $updated.State
    Trigger = $bootTrigger.CimClass.CimClassName
    Delay = $bootTrigger.Delay
    LogonType = $updated.Principal.LogonType
    RunLevel = $updated.Principal.RunLevel
}
