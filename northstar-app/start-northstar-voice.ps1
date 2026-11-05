param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$voiceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$voicePython = Join-Path $voiceRoot 'data\voice-engine\Scripts\python.exe'
$voiceAdapter = Join-Path $voiceRoot 'scripts\voice-transcribe-local.py'
if (-not (Test-Path -LiteralPath $voicePython)) {
    throw 'Run scripts\setup-voice-local.ps1 first.'
}
$env:NORTHSTAR_VOICE_ENGINE = 'command'
$env:NORTHSTAR_VOICE_COMMAND = '"' + $voicePython + '" "' + $voiceAdapter + '" "{file}"'
& (Join-Path $voiceRoot 'start-northstar.ps1') -DemoLogin -NoBrowser:$NoBrowser
