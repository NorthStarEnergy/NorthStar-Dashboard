if ($PSVersionTable.PSVersion.Major -lt 7) {
    & 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile -File $PSCommandPath
    exit $LASTEXITCODE
}
$ErrorActionPreference = 'Stop'
$readyFile = Join-Path $PSScriptRoot 'production-ready.json'
if (-not (Test-Path -LiteralPath $readyFile)) { throw 'Production migration is not verified.' }
$ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
if ($ready.verified -ne $true -or $ready.connectorEnabled -ne $true) { throw 'Production migration is not verified.' }
$binary = Join-Path $PSScriptRoot 'tools\cloudflared.exe'
$tokenFile = Join-Path $PSScriptRoot 'connector\token'
$logFile = Join-Path $PSScriptRoot 'connector\cloudflared.log'
if (-not (Test-Path -LiteralPath $tokenFile)) { throw 'Connector token is missing.' }
& $binary tunnel --no-autoupdate --logfile $logFile run --token-file $tokenFile
exit $LASTEXITCODE
