@echo off
cd /d "%~dp0"

rem Off-machine backup of the check-in database. Backups are written to
rem data\backups\ on this PC either way; setting this copies each one to a
rem second location as well, so losing this PC does not lose the records.
rem Uncomment ONE line and set the path. A network share is preferred.
rem A failed mirror is reported and never blocks the local backup.
rem
rem set NORTHSTAR_BACKUP_MIRROR=\\fileserver\ops\northstar-backups
rem set NORTHSTAR_BACKUP_MIRROR=E:\northstar-backups
rem
rem Note: check-in records name workers, their employer, and optionally their
rem GPS location. Treat the mirror as staff personal data when choosing where
rem it goes; a personal cloud-sync folder is usually the wrong answer.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-northstar.ps1"
pause
