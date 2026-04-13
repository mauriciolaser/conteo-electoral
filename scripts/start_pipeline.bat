@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

echo Iniciando pipeline cada 30 minutos...
echo Cierra esta ventana para detenerlo.

:loop
echo [%date% %time%] Ejecutando: python -m election_counter --mode full --headed --browser-channel msedge
python -m election_counter --mode full --headed --browser-channel msedge
if errorlevel 1 (
  echo [%date% %time%] Pipeline termino con error. Reintentando en 60 segundos...
  timeout /t 60 /nobreak >nul
) else (
  echo [%date% %time%] Pipeline OK. Proxima ejecucion en 1800 segundos...
  timeout /t 1800 /nobreak >nul
)
goto loop
