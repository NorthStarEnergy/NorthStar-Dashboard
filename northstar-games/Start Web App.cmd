@echo off
cd /d "%~dp0"
python -m poker_study.web --port 4185
pause
