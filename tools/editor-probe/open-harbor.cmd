@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-harbor.ps1"
if errorlevel 1 pause
