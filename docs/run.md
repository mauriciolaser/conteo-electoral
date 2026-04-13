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

El frontend publicado consume:

- `history_index.json`
- `raw_history/<timestamp>/raw_region_results.json`

Y hoy muestra tres modos en `Top 6 Nacional`:

- `Procesamiento Actual`: votos válidos ya procesados del último snapshot.
- `Interpolación`: proyección lineal al 100% por región según `actas_pct`.
- `VOTO RURAL`: proyección especulativa que solo afecta el `Top 6 Nacional`, sesga el crecimiento pendiente en regiones pro-Sánchez y mantiene el mismo total válido nacional de la interpolación base.

```bash
python -m election_counter --mode deploy-frontend
```

---

### Run individual de backend

Scrape de ONPE → snapshot → proyección → publicación FTP de datos.

```bash
python -m election_counter --mode full --headed --browser-channel msedge
```

---

### Cron de backend cada 10 minutos

Arranca el loop: corre el run individual y sube datos cada 10 minutos. Si falla, reintenta en 60 segundos.

```bat
scripts\start_pipeline.bat
```

Para registrarlo como tarea de Windows (corre aunque no haya ventana abierta):

```powershell
schtasks /create /tn "ElectionCounter10m" /sc minute /mo 10 /tr "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Set-Location 'C:\Experimental\election-counter'; python -m election_counter --mode full --headed --browser-channel msedge\"" /f
```

Ver estado:

```powershell
schtasks /query /tn "ElectionCounter10m" /v /fo list
```

Eliminar:

```powershell
schtasks /delete /tn "ElectionCounter10m" /f
```

---

### Deploy desde GitHub Actions (remoto)

El workflow `.github/workflows/deploy-frontend.yml` hace build + FTP deploy automáticamente.

**Trigger único (directo):** push a `main` cuando cambian archivos en `frontend/`, `scripts/build_frontend.py` o `election_counter/publish.py`.

**Secrets requeridos en GitHub** (`Settings → Secrets and variables → Actions`):

| Secret | Descripción |
|---|---|
| `FTP_USER` | Usuario FTP |
| `FTP_HOST` | Host / IP del servidor FTP |
| `FTP_PASSWORD` | Contraseña FTP |
| `DEPLOY_FRONTEND` | Ruta FTP destino (ej. `perulainen.com/conteo`) |
| `BASE_URL` | URL HTTP del sitio (ej. `https://www.perulainen.com/conteo`) |
| `GA_ID` | Google Analytics ID (opcional) |

---

## 4) Variables de entorno (.env)

```env
FTP_HOST=...
FTP_USER=...
FTP_PASSWORD=...
DEPLOY_FRONTEND=perulainen.com/conteo   # ruta FTP — frontend + datos
BASE_URL=https://www.perulainen.com/conteo  # URL HTTP del mismo directorio
GA_ID=G-XXXXXXXXXX  # opcional, se inyecta en frontend/dist/index.html al deploy
```

---

## 5) Parámetros útiles

- `--top-n 6`: cantidad de candidatos top en charts (default actual)
- `--margin 0.05`: margen para escenarios conservador/optimista
- `--no-publish`: desactiva el upload FTP dentro de `full`
- `--allow-fallback`: habilita fallback sintético si ONPE no carga
