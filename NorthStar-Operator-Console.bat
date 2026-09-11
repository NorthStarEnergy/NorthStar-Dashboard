@echo off
setlocal
cd /d "%~dp0"
title NorthStar Operator Console
echo Starting NorthStar dashboard...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-northstar.ps1" -LocalOnly -DemoLogin
if errorlevel 1 (
  echo.
  echo NorthStar stopped with an error. Keep this window open to read it.
  pause
)
endlocal
