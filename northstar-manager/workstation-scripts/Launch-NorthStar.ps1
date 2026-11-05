param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$installRoot = $PSScriptRoot
$readyFile = Join-Path $installRoot 'production-ready.json'
if (-not (Test-Path -LiteralPath $readyFile)) {
    throw 'NorthStar server migration is not complete. The live data and tunnel must be verified before this launcher can start production.'
}
$ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
if ($ready.verified -ne $true) { throw 'NorthStar migration verification is still pending.' }
$healthUrl = 'http://127.0.0.1:4180/api/health'
$healthy = $false
try { $healthy = (Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3).database.ok -eq $true } catch {}
if (-not $healthy) {
    & (Join-Path $installRoot 'Manage-NorthStar.ps1') -Action launch
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 2
        try { $healthy = (Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3).database.ok -eq $true } catch {}
    } until ($healthy -or (Get-Date) -gt $deadline)
    if (-not $healthy) { throw 'NorthStar did not become healthy. Check northstar-local\data\northstar-backend.err.log.' }
}
if (-not $NoBrowser) { Start-Process 'https://ops.northstarenergy.ca/' }
