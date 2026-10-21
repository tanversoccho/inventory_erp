@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Creating project virtual environment...
  python -m venv .venv
  if errorlevel 1 (
    echo Could not create .venv. Ensure the working Python installation is on PATH.
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  pause
  exit /b 1
)
".venv\Scripts\python.exe" server.py %*
pause
