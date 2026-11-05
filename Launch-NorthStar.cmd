@echo off
setlocal
cd /d "%~dp0"
title NorthStar Operator Console
python.exe "%~dp0scripts\seed-demo-data.py"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-northstar.ps1" -LocalOnly -DemoLogin
endlocal
