# API de datos electorales

## Objetivo

Separar la operación en 3 rutinas independientes:

- `scrape`: genera y guarda `raw` local.
- `publish-api`: genera/publica solo artefactos API (`/api/v1/*`).
- `deploy-raw`: publica solo data cruda `raw` en `FTP_RAW`.

No se usa `history_index.json` ni flags `PUBLISH_*`.

## Artefactos y comandos

### 1) Scrape local

```bash
python -m election_counter --mode scrape
```

Genera:

- `outputs/raw_region_results.json`
- `outputs/raw_history/<timestamp>/raw_region_results.json`

### 2) Publicación API

```bash
python -m election_counter --mode publish-api --env-file .env
```

Genera y publica:

- `outputs/api/v1/dashboard/summary.json`
- `outputs/api/v1/dashboard/latest.json`
- `outputs/api/v1/race/latest.json`
- `outputs/api/v1/timelapse/series.json`
- `outputs/api/v1/meta/health.json`

### 3) Deploy RAW (FTP crudo)

```bash
python -m election_counter --mode deploy-raw --env-file .env
```

Publica:

- `<FTP_RAW_PATH>/raw_history/...`
- `<FTP_RAW_PATH>/raw_bundle.json`

Además deja copia local:

- `outputs/raw_bundle.json`

## Variables de entorno

### API

- `API_DEPLOY_PATH`
- `API_FTP_HOST`
- `API_FTP_USER`
- `API_FTP_PASSWORD`
- `API_FTP_PORT` (opcional, default `21`)

### RAW

- `FTP_RAW_PATH`
- `FTP_RAW_HOST`
- `FTP_RAW_USER`
- `FTP_RAW_PASSWORD`
- `FTP_RAW_PORT` (opcional, default `21`)

### Frontend proxy público

- `CONTEO_API_ORIGIN_BASE`
- `CONTEO_API_TIMEOUT_SECONDS`

## Flujo recomendado

```bash
python -m election_counter --mode full --env-file .env
```

`full` ejecuta scrape + project + report + `publish-api` (no deploy de raw).
