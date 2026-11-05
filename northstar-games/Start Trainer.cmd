@echo off
cd /d "%~dp0"
python -m poker_study play --hero 3 --seed %RANDOM% --output saved-hand.json
pause
