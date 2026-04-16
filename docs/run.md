# Ejecución de la app (scraping real ONPE + proyección)

## 1) Requisitos

- Python 3.10+
- Dependencias del proyecto instaladas
- Navegador local (Chrome o Edge recomendado)
- Playwright con browsers instalados

## 2) Instalación

```bash
pip install -e .
python -m playwright install chromium
```

## 3) Comandos operativos

### Deploy del frontend

Sube el frontend a `DEPLOY_FRONTEND` vía FTP.
`frontend/` es la fuente en desarrollo y `frontend/dist/` se regenera automáticamente en runtime durante el deploy (no se edita manualmente).

El frontend publicado consume en modo nuevo:

- `/api/v1/dashboard/summary`
- `/api/v1/dashboard/latest`
- `/api/v1/race/latest`
- `/api/v1/timelapse/series`

Y mantiene fallback temporal a `history_bundle.json` del pipeline legacy.

Y hoy muestra tres modos en `Top 6 Nacional`:

- `Procesamiento Actual`: votos válidos ya procesados del último snapshot.
- `Interpolación`: proyección lineal al 100% por región según `actas_pct`.
- `VOTO RURAL`: proyección especulativa que solo afecta el `Top 6 Nacional`, sesga el crecimiento pendiente en regiones pro-Sánchez y mantiene el mismo total válido nacional de la interpolación base.

```bash
python -m election_counter --mode deploy-frontend
```

Con archivo de entorno explícito (recomendado para STAGING):

```bash
python -m election_counter --mode deploy-frontend --env-file .env.staging
```

---

### Run individual de backend

Scrape de ONPE → snapshot → proyección → publicación FTP de datos.

```bash
python -m election_counter --mode full --headed --browser-channel msedge
```

Con entorno STAGING:

```bash
python -m election_counter --mode full --headed --browser-channel msedge --env-file .env.staging
```

---

### Cron de backend cada 30 minutos

Arranca el loop: corre el run individual y sube datos cada 30 minutos. Si falla, reintenta en 60 segundos.

```bat
scripts\start_pipeline.bat
```

Para registrarlo como tarea de Windows (corre aunque no haya ventana abierta):

```powershell
schtasks /create /tn "ElectionCounter30m" /sc minute /mo 30 /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""Set-Location 'C:\Experimental\election-counter'; python -m election_counter --mode full --headed --browser-channel msedge""" /f
```

Ver estado:

```powershell
schtasks /query /tn "ElectionCounter30m" /v /fo list
```

Eliminar:

```powershell
schtasks /delete /tn "ElectionCounter30m" /f
```

---

### Backend como servicio en VPS

La forma recomendada para el VPS es `systemd` con timer cada 30 minutos.
Ver `docs/vps-backend.md` para el comando, archivos de servicio y pasos de instalación.

---

### Deploy desde GitHub Actions (remoto)

El workflow `.github/workflows/deploy-frontend.yml` (`Frontend Deploy`) hace build + FTP deploy automáticamente.
Para STAGING existe `.github/workflows/deploy-staging.yml` (`Staging Deploy`), con defaults de shadow mode habilitados.

**Trigger automático:** push a `main` cuando cambian archivos en `frontend/`, `scripts/build_frontend.py` o `election_counter/publish.py`.

**Deploy manual (comando único recomendado, PowerShell):**

```powershell
gh workflow run deploy-frontend.yml --repo mauriciolaser/conteo-electoral; Start-Sleep -Seconds 2; $id = gh run list --repo mauriciolaser/conteo-electoral --workflow "Frontend Deploy" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'; gh run watch $id --repo mauriciolaser/conteo-electoral --exit-status
```

**Secrets requeridos en GitHub** (`Settings → Secrets and variables → Actions`):

| Secret | Descripción |
|---|---|
| `FTP_USER` | Usuario FTP |
| `FTP_HOST` | Host / IP del servidor FTP |
| `FTP_PASSWORD` | Contraseña FTP |
| `DEPLOY_FRONTEND` | Ruta FTP destino (ej. `perulainen.com/conteo`) |
| `BASE_URL` | URL HTTP del sitio (ej. `https://www.perulainen.com/conteo`) |
| `GA_ID` | Google Analytics ID (opcional) |
| `PUBLISH_LEGACY` | Publica `raw_history` + `history_bundle` + `history_index` (default `true`) |
| `PUBLISH_API_SHADOW` | Publica artefactos API nuevos en paralelo (default `false`) |
| `API_DEPLOY_PATH` | Ruta FTP destino para API shadow (ej. `perulainen.com/conteo/api`) |
| `API_FTP_HOST` | Host FTP alternativo para API (opcional, fallback `FTP_HOST`) |
| `API_FTP_USER` | Usuario FTP alternativo API (opcional) |
| `API_FTP_PASSWORD` | Password FTP alternativo API (opcional) |
| `API_FTP_PORT` | Puerto FTP alternativo API (opcional, fallback `FTP_PORT`) |

---

### Deploy STAGING desde GitHub Actions

Workflow: `.github/workflows/deploy-staging.yml`

- Trigger automático: push a rama `staging`.
- Trigger manual: `workflow_dispatch` (opcionalmente intenta `--mode publish` si existe `outputs/raw_history` en el job).
- Construye `.env.staging` desde Secrets/Variables y ejecuta:
  - `python scripts/build_frontend.py --env-file .env.staging`
  - `python -m election_counter --mode deploy-frontend --env-file .env.staging`

Secrets/variables sugeridos:

| Nombre | Uso |
|---|---|
| `STAGING_FTP_USER`, `STAGING_FTP_HOST`, `STAGING_FTP_PASSWORD` | FTP principal staging |
| `STAGING_DEPLOY_FRONTEND` | Destino FTP (`staging.perulainen.com/conteo`) |
| `STAGING_BASE_URL` | URL pública staging (`https://staging.perulainen.com/conteo`) |
| `STAGING_API_DEPLOY_PATH` | Ruta de artefactos API shadow (recomendado: `api-elecciones.perulainen.com/staging/conteo/api`) |
| `STAGING_API_FTP_*` | FTP alternativo API (opcional) |
| `STAGING_CONTEO_API_ORIGIN_BASE` | Origen del proxy API (recomendado: `https://api-elecciones.perulainen.com/staging/conteo/api`) |

---

### Solo deploy API en STAGING (sin frontend)

Si quieres publicar **solo artefactos API** y omitir legacy temporalmente:

```powershell
$env:PUBLISH_LEGACY="false"; $env:PUBLISH_API_SHADOW="true"; python -m election_counter --mode publish --env-file .env.staging
```

Nota: `PUBLISH_*` en variables de entorno sobreescribe temporalmente lo definido en `.env.staging`.

Rollback rápido (volver a legacy y apagar API shadow):

```powershell
$env:PUBLISH_LEGACY="true"; $env:PUBLISH_API_SHADOW="false"; python -m election_counter --mode publish --env-file .env.staging
```

---

## 4) Variables de entorno (.env)

```env
FTP_HOST=...
FTP_USER=...
FTP_PASSWORD=...
DEPLOY_FRONTEND=perulainen.com/conteo   # ruta FTP — frontend + datos
BASE_URL=https://www.perulainen.com/conteo  # URL HTTP del mismo directorio
GA_ID=G-XXXXXXXXXX  # opcional, se inyecta en frontend/dist/index.html al deploy
PUBLISH_LEGACY=true
PUBLISH_API_SHADOW=true
API_DEPLOY_PATH=perulainen.com/conteo/api
# opcional: usar otro host para artefactos API
# API_FTP_HOST=api-elecciones.perulainen.com
# API_FTP_USER=...
# API_FTP_PASSWORD=...
# API_FTP_PORT=21

# opcional: origen del proxy público /conteo/api (frontend/api/index.php)
CONTEO_API_ORIGIN_BASE=https://api-elecciones.perulainen.com/conteo/api
CONTEO_API_TIMEOUT_SECONDS=6
```

Ejemplo de `.env.staging`:

```env
FTP_HOST=...
FTP_USER=...
FTP_PASSWORD=...
DEPLOY_FRONTEND=staging.perulainen.com/conteo
BASE_URL=https://staging.perulainen.com/conteo
GA_ID=
PUBLISH_LEGACY=true
PUBLISH_API_SHADOW=true
API_DEPLOY_PATH=api-elecciones.perulainen.com/staging/conteo/api
CONTEO_API_ORIGIN_BASE=https://api-elecciones.perulainen.com/staging/conteo/api
```

---

## 5) Parámetros útiles

- `--top-n 6`: cantidad de candidatos top en charts (default actual)
- `--margin 0.05`: margen para escenarios conservador/optimista
- `--no-publish`: desactiva el upload FTP dentro de `full`
- `--allow-fallback`: habilita fallback sintético si ONPE no carga
- `--env-file .env.staging`: ejecuta deploy/publish con variables de STAGING

---

## 6) Runbook de validación y rollback (STAGING)

### Smoke tests mínimos

1. Sitio:
   - `https://staging.perulainen.com/conteo/`
2. Endpoints legacy:
   - `/conteo/history_bundle.json`
   - `/conteo/history_index.json`
3. Endpoints API nuevos:
   - `/conteo/api/v1/dashboard/summary`
   - `/conteo/api/v1/dashboard/latest`
   - `/conteo/api/v1/race/latest`
   - `/conteo/api/v1/timelapse/series`

### Consistencia legacy vs API

- Verificar que `latest.metadata.extracted_at_utc` (API) coincide con el último snapshot del bundle legacy.
- Comparar totales nacionales de `RENOVACION POPULAR` y `JUNTOS POR EL PERU` entre:
  - `history_bundle.json` (agregado en cliente o script)
  - `api/v1/dashboard/summary` último punto.
- Validar que `api/v1/race/latest` refleja los mismos porcentajes del último snapshot.

### Rollback inmediato

En `.env.staging`:

- Desactivar solo API shadow:
  - `PUBLISH_API_SHADOW=false`
  - `PUBLISH_LEGACY=true`
- Re-ejecutar publish:
  - `python -m election_counter --mode publish --env-file .env.staging`

Con eso el frontend sigue operativo por fallback legacy sin revertir código.

### Aislamiento recomendado para STAGING API

Para no tocar artefactos que pueda leer producción:

- `API_DEPLOY_PATH=api-elecciones.perulainen.com/staging/conteo/api`
- `CONTEO_API_ORIGIN_BASE=https://api-elecciones.perulainen.com/staging/conteo/api`

Promoción a API definitiva sin romper lógica/servicios:

- Mantén los mismos endpoints públicos (`/conteo/api/v1/*`).
- Cambia solo `CONTEO_API_ORIGIN_BASE` (y/o `API_DEPLOY_PATH`) al destino definitivo.
- No necesitas cambiar frontend ni contratos JSON.
