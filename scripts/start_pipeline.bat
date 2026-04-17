@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

echo Iniciando pipeline cada 5 minutos...
echo Cierra esta ventana para detenerlo.

:loop
echo [%date% %time%] Ejecutando: python -m election_counter --mode full --headed --browser-channel msedge
python -m election_counter --mode full --headed --browser-channel msedge
if errorlevel 1 goto after_error
echo [%date% %time%] Pipeline OK. Proxima ejecucion en 300 segundos ^(5 minutos^)...
timeout /t 300 /nobreak >nul
goto loop

:after_error
echo [%date% %time%] Pipeline termino con error. Reintentando en 60 segundos...
timeout /t 60 /nobreak >nul
goto loop
