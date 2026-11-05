$ErrorActionPreference = 'Stop'
$voiceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$voiceEnvironment = Join-Path $voiceRoot 'data\voice-engine'
$voicePython = Join-Path $voiceEnvironment 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $voicePython)) {
    python -m venv $voiceEnvironment
    if ($LASTEXITCODE -ne 0) { throw 'Could not create local transcription environment' }
}
& $voicePython -m pip install 'faster-whisper==1.2.1'
if ($LASTEXITCODE -ne 0) { throw 'Transcription dependency installation failed' }
& $voicePython (Join-Path $voiceRoot 'scripts\voice-transcribe-local.py') --prepare
if ($LASTEXITCODE -ne 0) { throw 'Transcription model download failed' }
Set-Content -LiteralPath (Join-Path $voiceRoot 'data\voice-local.enabled') -Value 'local English CPU transcription'
Write-Host 'Ready. Launch with start-northstar-voice.ps1 after stopping the existing backend.'
