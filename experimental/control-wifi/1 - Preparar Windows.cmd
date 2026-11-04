@echo off
setlocal
set "MPROOT=%USERPROFILE%\.mirrorphone-control"
py -3 -c "import sys;assert sys.version_info>=(3,10)" >nul 2>&1
if errorlevel 1 (
 echo Instala Python 3.12 o posterior desde https://www.python.org/downloads/windows/
 echo Incluye Python Launcher durante la instalacion. Despues vuelve a abrir este archivo.
 pause
 exit /b 1
)
if not exist "%MPROOT%\venv\Scripts\python.exe" py -3 -m venv "%MPROOT%\venv"
if errorlevel 1 goto failed
"%MPROOT%\venv\Scripts\python.exe" -m pip install "pymobiledevice3==11.33.1"
if errorlevel 1 goto failed
echo Preparado. Ahora abre 2 - Emparejar por WiFi.cmd.
pause
exit /b 0
:failed
echo No se pudo preparar Python. Revisa la conexion y la instalacion de Python.
pause
exit /b 1
