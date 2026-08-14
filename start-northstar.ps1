param(
    [switch]$NoBrowser,
    # Packet 19: run the operator console behind the demo sign-in instead of the
    # Cloudflare Access header. The credential is local runtime configuration —
    # create it once with `python scripts/setup-demo-auth.py`.
    [switch]$DemoLogin,
    # Local-only work: no tunnel, no public check-in origin. Combine with
    # -DemoLogin to exercise the sign-in on http://localhost:4180.
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendFile = Join-Path $projectRoot 'ieso_backend.py'
$operatorHost = if ($env:NORTHSTAR_OPERATOR_HOST) {
    $env:NORTHSTAR_OPERATOR_HOST
} else {
    'ops.northstarenergy.ca'
}
$dashboardUrl = if ($LocalOnly) {
    'http://localhost:4180/northstar-clean.html'
} else {
    "https://$operatorHost/northstar-clean.html"
}
$healthUrl = 'http://127.0.0.1:4180/api/health'
$port = 4180

Set-Location -LiteralPath $projectRoot

$ancestorProcessIds = @()
$processCursor = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
while ($processCursor -and $processCursor.ParentProcessId) {
    $ancestorProcessIds += [int]$processCursor.ParentProcessId
    $processCursor = Get-CimInstance Win32_Process `
        -Filter "ProcessId=$($processCursor.ParentProcessId)" -ErrorAction SilentlyContinue
}

function Get-NorthstarHealth {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 -UseBasicParsing
        if ($response.database.ok -eq $true) {
            $script:lastHealthError = $null
            return $response
        }
        $script:lastHealthError = 'The database health check did not pass.'
    } catch {
        $script:lastHealthError = $_.Exception.Message
        return $null
    }
    return $null
}

function Get-NorthstarProcesses {
    Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and $ancestorProcessIds -notcontains $_.ProcessId -and (
            ($_.Name -match '^(?:python|py)(?:\.exe)?$' -and $_.CommandLine -match 'ieso_backend\.py') -or
            ($_.Name -match '^powershell(?:\.exe)?$' -and $_.CommandLine -match 'start-northstar(?:-v[23])?\.ps1')
        )
    }
}

$backendSourceTime = (Get-Item -LiteralPath $backendFile).LastWriteTime
$northstarProcesses = @(Get-NorthstarProcesses)
$freshBackend = $northstarProcesses | Where-Object {
    $_.Name -match '^(?:python|py)' -and
    (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).StartTime -ge $backendSourceTime
} | Select-Object -First 1
$health = Get-NorthstarHealth

if ($health -and $freshBackend) {
    Write-Host 'NorthStar is already running. Opening the dashboard...'
    if (-not $NoBrowser) { Start-Process $dashboardUrl }
    return
}

if ($northstarProcesses.Count) {
    Write-Host 'Stopping an older NorthStar startup process...'
    foreach ($process in $northstarProcesses) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 800
}

$deadline = (Get-Date).AddSeconds(8)
do {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $listener) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if ($listener) {
    throw "Port $port is being used by another application. Close it and run NorthStar again."
}

$pythonLauncher = Get-Command python -ErrorAction SilentlyContinue
if ($pythonLauncher) {
    $pythonFile = $pythonLauncher.Source
    $pythonArguments = @('ieso_backend.py')
} else {
    $pythonLauncher = Get-Command py -ErrorAction Stop
    $pythonFile = $pythonLauncher.Source
    $pythonArguments = @('-3', 'ieso_backend.py')
}

$dataDirectory = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$stdoutLog = Join-Path $dataDirectory 'northstar-backend.out.log'
$stderrLog = Join-Path $dataDirectory 'northstar-backend.err.log'
$env:NORTHSTAR_PORT = [string]$port
$env:NORTHSTAR_BIND_HOST = '127.0.0.1'

# Public deployment settings. Both are safe to leave set for local-only use:
# the gate only engages when it is 'access' or 'demo', and the check-in origin
# is only consulted when generating QR placard links.
#   NORTHSTAR_OPERATOR_GATE   'access' requires the Cloudflare Access header on
#                             the roster, QR tokens and operational log; 'demo'
#                             requires the Packet 19 sign-in session instead.
#                             Set to 'off' to work on the dashboard without the
#                             tunnel.
#   NORTHSTAR_CHECKIN_ORIGIN  the hostname printed into QR codes — must be the
#                             public check-in host, never whichever origin the
#                             operator opened the generator from.
# This machine IS the production host: the tunnel publishes it, so the gate
# defaults ON. It previously defaulted to 'off', which meant any plain run of
# this script served the operator roster on the public check-in hostname — the
# 2026-08-11 audit caught exactly that. The backend now also refuses to start in
# that combination, so this default and that guard agree.
#
# Consequence to know: with the gate on, localhost:4180 cannot show the roster
# either, because cloudflared connects to localhost and the two are
# indistinguishable by address. Operators use ops.northstarenergy.ca.
# For local-only work, clear NORTHSTAR_CHECKIN_ORIGIN and set the gate to 'off'.
#
# -DemoLogin selects the third gate mode, 'demo': the operator hostname gets a
# real server-enforced sign-in (Packet 19) instead of trusting the Access
# header. It is a distinct mode, never 'off' — every operator route stays gated
# either way, and the public-hostname refusal is unchanged in all three modes.
if ($DemoLogin) {
    $demoCredential = Join-Path $projectRoot 'data\.northstar-demo-auth.json'
    if (-not (Test-Path -LiteralPath $demoCredential) -and -not $env:NORTHSTAR_DEMO_PASSWORD_HASH) {
        throw "No demo credential found at $demoCredential. Run 'python scripts/setup-demo-auth.py' first."
    }
    $env:NORTHSTAR_OPERATOR_GATE = 'demo'
}
if (-not $env:NORTHSTAR_OPERATOR_GATE) { $env:NORTHSTAR_OPERATOR_GATE = 'access' }
if ($LocalOnly) {
    # No tunnel in front: clearing the public origin is what lets the sign-in
    # and the dashboard work on localhost. Never do this on the production host
    # while checkin.northstarenergy.ca is published.
    $env:NORTHSTAR_CHECKIN_ORIGIN = ''
} elseif (-not $env:NORTHSTAR_CHECKIN_ORIGIN) {
    $env:NORTHSTAR_CHECKIN_ORIGIN = 'https://checkin.northstarenergy.ca'
}
if (-not $env:NORTHSTAR_OPERATOR_HOST) { $env:NORTHSTAR_OPERATOR_HOST = $operatorHost }

# The dashboard and the check-in page each call their own origin, so nothing
# needs cross-origin access. The default is '*', which let any website on the
# internet call the open worker routes from a visitor's browser — including
# DELETE /api/checkins/<id>, i.e. checking a worker out. Pin it.
if (-not $env:NORTHSTAR_ALLOWED_ORIGIN) { $env:NORTHSTAR_ALLOWED_ORIGIN = 'https://northstarenergy.ca,https://checkin.northstarenergy.ca' }

Write-Host 'Starting NorthStar core services...'
$backendProcess = Start-Process -FilePath $pythonFile -ArgumentList $pythonArguments `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

$readyDeadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    if ($backendProcess.HasExited) {
        $details = if (Test-Path $stderrLog) {
            (Get-Content $stderrLog -Tail 12 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
        } else { 'No backend error log was created.' }
        throw "NorthStar stopped during startup.`n$details"
    }
    $health = Get-NorthstarHealth
} while (-not $health -and (Get-Date) -lt $readyDeadline)

if (-not $health) {
    Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
    throw "NorthStar did not become ready within 30 seconds. Last health error: $lastHealthError"
}

Write-Host 'Core systems are ready. Live market and weather feeds may take another minute to warm up.'
if (-not $NoBrowser) { Start-Process $dashboardUrl }
