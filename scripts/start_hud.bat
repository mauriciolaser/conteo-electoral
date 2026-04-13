@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

echo Iniciando HUD en http://0.0.0.0:8080
echo Cierra esta ventana para detenerlo.

python -m election_counter --mode serve --host 0.0.0.0 --port 8080

