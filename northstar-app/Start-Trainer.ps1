param(
    [int]$Port = 43192,
    [string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'NorthStar\TwinIroquoisTrainer')
)
$ErrorActionPreference = 'Stop'
$candidates = @(
    (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'),
    (Join-Path $env:USERPROFILE 'NorthStar\runtime\Scripts\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Temp\opencode\shelf-northstar-tests\Scripts\python.exe')
)
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand) { $candidates += $pythonCommand.Source }
$trainerPython = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $trainerPython) { throw 'Python 3.10 or newer is required. Install Python, then run this launcher again.' }
Write-Host "Open http://127.0.0.1:$Port/ after the server starts. Ctrl+C stops this isolated trainer."
& $trainerPython (Join-Path $PSScriptRoot 'scripts\run-switching-trainer.py') --port $Port --data-root $DataRoot
exit $LASTEXITCODE
