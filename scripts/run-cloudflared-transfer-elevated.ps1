param()

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$python = 'C:\Users\Ryan1\AppData\Local\Programs\Python\Python313\python.exe'
$helper = Join-Path $PSScriptRoot 'prepare-cloudflared-transfer.py'
$key = Join-Path $project 'outputs\pc-migration-20261019\new-pc-public-key.pem'
$log = Join-Path $project 'outputs\pc-migration-20261019\cloudflared-transfer-elevated.log'

try {
    & $python $helper '--recipient-public-key' $key *>&1 | Out-File -LiteralPath $log -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Connector helper exited with code $LASTEXITCODE." }
} catch {
    $_ | Out-String | Out-File -LiteralPath $log -Encoding utf8 -Append
    exit 1
}
