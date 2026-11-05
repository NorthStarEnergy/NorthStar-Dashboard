$ErrorActionPreference = 'Stop'
$readyFile = Join-Path $PSScriptRoot 'production-ready.json'
if (-not (Test-Path -LiteralPath $readyFile)) { throw 'Production migration is not verified.' }
$ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
if ($ready.gamesVerified -ne $true) {
    throw 'NorthStar Games migration is not verified.'
}
$app = Join-Path $PSScriptRoot 'games'
$python = Join-Path $PSScriptRoot 'games-runtime\Scripts\python.exe'
Set-Location -LiteralPath $app
& $python (Join-Path $app 'start_games_background.py') --port 4185
exit $LASTEXITCODE
