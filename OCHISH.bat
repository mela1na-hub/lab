@echo off
cd /d "%~dp0"
echo Starting website...
start "Website Server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8766/"
echo Opened http://127.0.0.1:8766/
