# API de datos electorales

## Objetivo

Reducir carga y transferencia al frontend separando:

- artefactos históricos pesados (`history_bundle.json`, `raw_history`) para compatibilidad,
- artefactos API compactos (`/api/v1/*`) para consumo principal.

La publicación se controla por flags de entorno y puede correr en paralelo (legacy + API shadow).

## Arquitectura actual

1. El pipeline Python genera snapshots en `outputs/raw_history`.
2. `publish_raw_history()` filtra snapshots por bucket de 30 min.
3. Si `PUBLISH_LEGACY=true`, publica:
   - `history_bundle.json`
   - `history_index.json`
   - `raw_history/...`
4. Si `PUBLISH_API_SHADOW=true`, genera artefactos en `outputs/api/v1/*` y los sube al destino API.
5. `frontend/api/index.php` expone `/conteo/api/v1/*` como proxy público estable.

## Endpoints API v1

Los artefactos publicados por el pipeline son:

- `/api/v1/dashboard/summary`  
  Serie compacta para gráficas del dashboard.
- `/api/v1/dashboard/latest`  
  Último snapshot mínimo con metadata + regiones/partidos.
- `/api/v1/race/latest`  
  Porcentajes calculados para la vista race.
- `/api/v1/timelapse/series`  
  Serie temporal directa para timelapse.
- `/api/v1/meta/health`  
  Metadata de generación y conteos de snapshots.

## Variables de entorno clave

- `PUBLISH_LEGACY`  
  `true|false`. Controla publicación legacy.
- `PUBLISH_API_SHADOW`  
  `true|false`. Controla publicación API nueva.
- `API_DEPLOY_PATH`  
  Ruta FTP destino de artefactos API (`.../api`).
- `API_FTP_HOST`, `API_FTP_USER`, `API_FTP_PASSWORD`, `API_FTP_PORT`  
  Credenciales FTP de API (opcionales, fallback a `FTP_*`).
- `CONTEO_API_ORIGIN_BASE`  
  Origen remoto del proxy PHP (`frontend/api/index.php`).
- `CONTEO_API_TIMEOUT_SECONDS`  
  Timeout del proxy.

## Aislamiento STAGING recomendado

Para garantizar que STAGING no sobreescriba artefactos de producción:

```env
API_DEPLOY_PATH=api-elecciones.perulainen.com/staging/conteo/api
CONTEO_API_ORIGIN_BASE=https://api-elecciones.perulainen.com/staging/conteo/api
```

Con esto:

- STAGING publica y lee desde un namespace propio (`/staging/...`).
- Producción puede seguir en `api-elecciones.perulainen.com/conteo/api`.
- El endpoint público no cambia (`/conteo/api/v1/*`), solo cambia el origen interno del proxy.

## Modos de operación

### 1) Producción legacy + shadow

```env
PUBLISH_LEGACY=true
PUBLISH_API_SHADOW=true
```

Permite validar API nueva sin perder respaldo legacy.

### 2) Solo API (sin legacy)

```env
PUBLISH_LEGACY=false
PUBLISH_API_SHADOW=true
```

Útil para deploys rápidos de artefactos API en STAGING.

### 3) Solo legacy

```env
PUBLISH_LEGACY=true
PUBLISH_API_SHADOW=false
```

Modo de rollback inmediato.

## Comandos útiles

Publicar datos usando entorno explícito:

```bash
python -m election_counter --mode publish --env-file .env.staging
```

Deploy frontend usando entorno explícito:

```bash
python -m election_counter --mode deploy-frontend --env-file .env.staging
```

## Validación mínima

1. Verificar endpoint de salud:
   - `/conteo/api/v1/meta/health`
2. Verificar dashboard:
   - `/conteo/api/v1/dashboard/summary`
   - `/conteo/api/v1/dashboard/latest`
3. Verificar compatibilidad:
   - `/conteo/history_bundle.json`
4. Comparar timestamp más reciente entre legacy y API.

## Promoción a API definitiva (sin romper servicios)

1. Mantener estable el contrato público `/conteo/api/v1/*`.
2. Cambiar solo variables de infraestructura:
   - `API_DEPLOY_PATH`
   - `CONTEO_API_ORIGIN_BASE`
3. Re-publicar con `--mode publish`.
4. Verificar `meta/health` y endpoints funcionales.

No requiere cambios en frontend ni en la forma de los payloads.
