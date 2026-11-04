@echo off
setlocal
set "MPPY=%USERPROFILE%\.mirrorphone-control\venv\Scripts\python.exe"
if not exist "%MPPY%" (
 echo Ejecuta primero 1 - Preparar Windows.cmd.
 pause
 exit /b 1
)
"%MPPY%" "%~dp0control_wifi.py" check
pause
