if ($PSVersionTable.PSVersion.Major -lt 7) {
    & 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile -File $PSCommandPath
    exit $LASTEXITCODE
}
$ErrorActionPreference = 'Stop'
$readyFile = Join-Path $PSScriptRoot 'production-ready.json'
if (-not (Test-Path -LiteralPath $readyFile)) { throw 'Production migration is not verified.' }
$ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
if ($ready.verified -ne $true) { throw 'Production migration is not verified.' }
$env:PATH = (Join-Path $PSScriptRoot 'runtime\Scripts') + ';' + $env:PATH
$env:NORTHSTAR_BIND_HOST = '127.0.0.1'
$env:NORTHSTAR_PORT = '4180'
$env:NORTHSTAR_OPERATOR_HOST = 'ops.northstarenergy.ca'
$env:NORTHSTAR_CHECKIN_ORIGIN = 'https://checkin.northstarenergy.ca'
$env:NORTHSTAR_ALLOWED_ORIGIN = 'https://ops.northstarenergy.ca,https://northstarenergy.ca,https://checkin.northstarenergy.ca'
if ($ready.operatorGate -notin @('demo','access')) { throw 'A supported operator sign-in mode is required.' }
$env:NORTHSTAR_OPERATOR_GATE = $ready.operatorGate
$launcher = Join-Path $PSScriptRoot 'northstar-local\start-northstar.ps1'
& $launcher -NoBrowser -ServiceMode -DemoLogin:($ready.operatorGate -eq 'demo')
exit $LASTEXITCODE
