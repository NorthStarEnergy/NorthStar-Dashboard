# Run once as administrator. Launchers refuse to run until migration is verified.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$windowsPrincipal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $windowsPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from Administrator PowerShell.'
}
$root = 'C:\Users\User\NorthStar'
$userId = "$env:COMPUTERNAME\User"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$tasks = @(
    @{Name='NorthStar Control Room backend'; Script='Run-NorthStar-Backend.ps1'},
    @{Name='NorthStar Games Web'; Script='Run-NorthStar-Games.ps1'},
    @{Name='NorthStar Tunnel'; Script='Run-NorthStar-Connector.ps1'}
)
foreach ($item in $tasks) {
    $script = Join-Path $root $item.Script
    if (-not (Test-Path -LiteralPath $script)) { throw "Missing launcher: $script" }
    $existing = Get-ScheduledTask -TaskName $item.Name -ErrorAction SilentlyContinue
    if ($existing) { throw "Task already exists; inspect before replacing: $($item.Name)" }
}
foreach ($item in $tasks) {
    $script = Join-Path $root $item.Script
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $script + '"'
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $root
    Register-ScheduledTask -TaskName $item.Name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Description 'NorthStar production server on this PC' | Out-Null
}
Write-Output 'NorthStar startup tasks installed. No task was started; launchers remain gated by migration verification.'
