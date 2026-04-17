@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

echo Iniciando pipeline cada 5 minutos...
echo Flujo: scrape ^+ process ^+ publish-api ^(sin deploy-raw^).
echo Cierra esta ventana para detenerlo.

set "PIPELINE_CMD=python -m election_counter --mode full --headed --browser-channel msedge"

:loop
echo [%date% %time%] Ejecutando: %PIPELINE_CMD%
%PIPELINE_CMD%
if errorlevel 1 goto after_error
echo [%date% %time%] Pipeline OK. Proxima ejecucion en 300 segundos ^(5 minutos^)...
timeout /t 300 /nobreak >nul
goto loop

:after_error
echo [%date% %time%] Pipeline termino con error. Reintentando en 60 segundos...
timeout /t 60 /nobreak >nul
goto loop
