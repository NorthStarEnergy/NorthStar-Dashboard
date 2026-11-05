param(
    [string]$Config = "$PSScriptRoot\data\teams-watch.json",
    [ValidateSet('check','sign-in','once','watch')][string]$Mode = 'check',
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
& $Python "$PSScriptRoot\northstar_teams_watch.py" --config $Config "--$Mode"
exit $LASTEXITCODE
