param([Parameter(Mandatory=$true)][ValidateSet('launch','restart','stop')][string]$Action)
$ErrorActionPreference = 'Stop'
$readyFile = Join-Path $PSScriptRoot 'production-ready.json'
if (-not (Test-Path -LiteralPath $readyFile)) { throw 'Server migration is still in progress.' }
$ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
if ($ready.verified -ne $true) { throw 'Server migration is still in progress.' }
$taskName = 'NorthStar Control Room backend'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$worker = Join-Path $PSScriptRoot 'Run-NorthStar-Backend.ps1'
if ($task.Actions.Arguments -notlike ('*"' + $worker + '"*')) {
    throw 'The registered server task does not match this installation.'
}
if ($Action -in @('stop','restart')) {
    Stop-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $listening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4180 -State Listen -ErrorAction SilentlyContinue
    } until (-not $listening -or (Get-Date) -gt $deadline)
    if ($listening) { throw 'Server has not stopped. No unrelated process was terminated.' }
}
if ($Action -in @('launch','restart')) {
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddSeconds(90)
    $healthy = $false
    do {
        Start-Sleep -Seconds 2
        try { $healthy = (Invoke-RestMethod 'http://127.0.0.1:4180/api/health' -TimeoutSec 3).database.ok -eq $true } catch {}
    } until ($healthy -or (Get-Date) -gt $deadline)
    if (-not $healthy) { throw 'Server did not become healthy. Check its startup log.' }
}
Write-Output ('NorthStar server action completed: ' + $Action)
