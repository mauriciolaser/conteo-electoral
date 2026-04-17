# Ejecución de la app (scraping ONPE + API + RAW)

## Requisitos

- Python 3.10+
- Dependencias instaladas
- Playwright con navegador instalado

```bash
pip install -e .
python -m playwright install chromium
```

## Comandos principales

### 1) Scrape local (sin FTP)

```bash
python -m election_counter --mode scrape
```

Salida:

- `outputs/raw_region_results.json`
- `outputs/raw_history/<timestamp>/raw_region_results.json`

### 2) Publicar API (`/api/v1/*`)

```bash
python -m election_counter --mode publish-api --env-file .env
```

Publica:

- `v1/dashboard/summary.json`
- `v1/dashboard/latest.json`
- `v1/race/latest.json`
- `v1/timelapse/series.json`
- `v1/meta/health.json`

### 3) Deploy RAW a FTP_RAW

```bash
python -m election_counter --mode deploy-raw --env-file .env
```

Publica:

- `raw_history/...`
- `raw_bundle.json`

### 4) Flujo completo recomendado

```bash
python -m election_counter --mode full --headed --browser-channel msedge --env-file .env
```

`full` hace: scrape + project + report + `publish-api`  
`full` no hace `deploy-raw`.

## Deploy frontend

```bash
python -m election_counter --mode deploy-frontend --env-file .env
```

### Deploy frontend vía GitHub Actions (manual)

```powershell
gh workflow run deploy-frontend.yml --repo mauriciolaser/conteo-electoral; Start-Sleep -Seconds 2; $id = gh run list --repo mauriciolaser/conteo-electoral --workflow "Frontend Deploy" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'; gh run watch $id --repo mauriciolaser/conteo-electoral --exit-status
```

Este comando:

1. Dispara manualmente el workflow `deploy-frontend.yml` en GitHub Actions.
2. Espera 2 segundos para que el run quede registrado.
3. Obtiene el `databaseId` del último run del workflow `Frontend Deploy` con evento `workflow_dispatch`.
4. Espera a que termine y devuelve estado de éxito/error (`--exit-status`).

Nota: no pegues `python ...` en la misma línea sin `;` después de `--exit-status`.

## Variables `.env`

```env
# Frontend deploy
FTP_HOST=...
FTP_USER=...
FTP_PASSWORD=...
FTP_PORT=21
DEPLOY_FRONTEND=perulainen.com/conteo
BASE_URL=https://www.perulainen.com/conteo
GA_ID=G-XXXXXXXXXX

# API publish
API_DEPLOY_PATH=api-elecciones.perulainen.com/conteo/api
API_FTP_HOST=...
API_FTP_USER=...
API_FTP_PASSWORD=...
API_FTP_PORT=21

# RAW deploy
FTP_RAW_PATH=raw-elecciones-data
FTP_RAW_HOST=...
FTP_RAW_USER=...
FTP_RAW_PASSWORD=...
FTP_RAW_PORT=21

# Proxy público /conteo/api (frontend/api/index.php)
CONTEO_API_ORIGIN_BASE=https://api-elecciones.perulainen.com/conteo/api
CONTEO_API_TIMEOUT_SECONDS=6
```

## Parámetros útiles

- `--no-publish`: desactiva publish automático dentro de `full`.
- `--allow-fallback`: habilita fallback sintético si ONPE no carga.
- `--env-file .env.staging`: ejecuta con entorno staging.
