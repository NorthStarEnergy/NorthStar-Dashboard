param(
    [int]$Port = 4180,
    [switch]$StartBackend
)

$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"
$routes = @(
    '/northstar-clean.html',
    '/api/health',
    '/api/outages',
    '/api/uwpc',
    '/api/sites',
    '/api/library',
    '/api/maximo',
    '/api/chat/rooms',
    '/api/chat/status',
    '/api/dispatch/apiroq',
    '/api/readiness',
    '/api/assets',
    '/api/schematics'
)

$process = $null
if ($StartBackend) {
    # The isolated verifier selects a free port and owns only disposable storage.
    python "$PSScriptRoot\verify-release.py"
    if ($LASTEXITCODE -ne 0) { throw 'Isolated release verification failed.' }
    return
}

try {
    foreach ($route in $routes) {
        $response = Invoke-WebRequest -Uri "$base$route" -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -ne 200) { throw "$route returned $($response.StatusCode)" }
        Write-Output ("PASS`t{0}`t{1} bytes" -f $route, $response.Content.Length)
    }
    Write-Output 'NorthStar operator runtime smoke test passed.'
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
