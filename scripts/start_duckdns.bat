@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0.."

if not exist ".env" (
  echo [ERROR] No existe .env en %cd%
  exit /b 1
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
  if not "%%~A"=="" (
    set "key=%%~A"
    set "val=%%~B"
    set "val=!val:"=!"
    set "!key!=!val!"
  )
)

if not defined DUCK_DOMAIN (
  echo [ERROR] Falta DUCK_DOMAIN en .env
  exit /b 1
)
if not defined DUCK_TOKEN (
  echo [ERROR] Falta DUCK_TOKEN en .env
  exit /b 1
)
if not defined DUCK_IP (
  echo [ERROR] Falta DUCK_IP en .env
  exit /b 1
)

set "duck_domain=%DUCK_DOMAIN%"
set "duck_domain=%duck_domain:https://=%"
set "duck_domain=%duck_domain:http://=%"
for /f "tokens=1 delims=/" %%D in ("%duck_domain%") do set "duck_domain=%%D"
set "duck_domain=%duck_domain:.duckdns.org=%"

if "%duck_domain%"=="" (
  echo [ERROR] DUCK_DOMAIN no es valido. Usa subdominio o URL DuckDNS.
  exit /b 1
)

echo Iniciando updater DuckDNS para dominio: %duck_domain%.duckdns.org
echo Cierra esta ventana para detenerlo.

:loop
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://www.duckdns.org/update?domains=%duck_domain%&token='+$env:DUCK_TOKEN+'&ip='+$env:DUCK_IP; try { $r=Invoke-RestMethod -Method Get -Uri $u; Write-Host ('['+(Get-Date -Format s)+'] DuckDNS: '+$r) } catch { Write-Host ('['+(Get-Date -Format s)+'] DuckDNS error: '+$_.Exception.Message) }"
timeout /t 300 /nobreak >nul
goto loop
