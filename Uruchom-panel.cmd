@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto error
)
.venv\Scripts\python.exe -c "import serial" >nul 2>&1
if errorlevel 1 (
  .venv\Scripts\python.exe -m pip install -r requirements.txt
  if errorlevel 1 goto error
)
start "" http://127.0.0.1:8765
.venv\Scripts\python.exe tools\control_panel.py
pause
exit /b
:error
echo Nie udalo sie uruchomic panelu. Sprawdz instalacje Pythona i polaczenie z internetem.
pause
