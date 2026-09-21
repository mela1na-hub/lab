@echo off
cd /d "%~dp0"
if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Created .env from .env.example. Set SESSION_SECRET, then run OCHISH.bat again.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing npm packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Install Node.js 20+ first.
    pause
    exit /b 1
  )
)
echo Starting website...
start "Website Server" /min cmd /c "npm start"
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:3000/"
echo.
echo Site: http://127.0.0.1:3000/
echo SQLite file: data\app.sqlite. See docs/DEPLOY.md
echo.
