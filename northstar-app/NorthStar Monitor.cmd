@echo off
setlocal
set "monitor=https://ops.northstarenergy.ca/northstar-v1.html?nsStatusWindow=1#overview"
for %%B in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if exist "%%~B" (
    start "" "%%~B" "--app=%monitor%" --start-maximized
    exit /b
  )
)
start "" "%monitor%"
