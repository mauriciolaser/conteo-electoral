@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

echo Desplegando frontend...
python -m election_counter --mode deploy-frontend
if errorlevel 1 (
  echo [ERROR] Deploy fallido.
  exit /b 1
)
echo [OK] Deploy completado.
