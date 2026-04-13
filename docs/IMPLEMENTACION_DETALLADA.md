# Implementación detallada: ONPE Scraper + Proyección Electoral

## 1. Objetivo del proyecto

Este proyecto construye un pipeline reproducible para:

1. Obtener datos reales de ONPE (elección presidencial) por región y extranjero.
2. Construir proyecciones al 100% de votos emitidos.
3. Generar escenarios (`conservador`, `base`, `optimista`).
4. Publicar un frontend con visualizaciones del último snapshot y su tendencia.
5. Exportar resultados en JSON, Markdown tabular y gráfico.

Fuente principal:

- `https://resultadoelectoral.onpe.gob.pe/main/presidenciales`

---

## 2. Evolución de la solución (contexto de decisiones)

Durante la implementación hubo varios ajustes clave:

1. **Primera versión**: scraping por DOM con Playwright, intentando leer región a región.
2. **Problema detectado**: ONPE cambiaba estructura UI y, en algunos contextos, devolvía assets JS/CSS inválidos o respuesta inconsistente.
3. **Corrección intermedia**: se forzó ejecución con navegador local real (`--headed --browser-channel msedge`) y anti-automation flags.
4. **Problema funcional importante**: `actas_pct` quedaba desalineado al leer desde DOM, especialmente bajo render asíncrono.
5. **Corrección final robusta**: migrar extracción de `actas_pct` y votos por región al **backend oficial ONPE** (`presentacion-backend`) por ubigeo.

Resultado: el pipeline actual usa datos live ONPE con consultas determinísticas por región + extranjero, y elimina dependencia frágil del texto visual para la métrica crítica de actas contabilizadas.

---

## 3. Arquitectura actual

Paquete principal: `election_counter`

Módulos:

1. `election_counter/cli.py`
   - Orquesta modos `scrape`, `project`, `report`, `full`.
2. `election_counter/scraper.py`
   - Ejecuta Playwright con navegador local.
   - Consume backend ONPE por `fetch` dentro del contexto del navegador.
   - Construye `raw_region_results.json`.
3. `election_counter/projection.py`
   - Calcula proyección base al 100%.
   - Construye escenarios con variación sobre top candidatos.
4. `election_counter/reporting.py`
   - Genera `projection_summary.md`.
   - Genera `table.md` (escenarios con % proyectado).
   - Genera gráfico PNG del escenario base.
5. `election_counter/parsers.py`
   - Parsea insumos locales (`padron.md`, `regiones.md`) para complementar cálculos.
6. `election_counter/utils.py`
   - Normalización de nombres, parseos numéricos, redondeo con cierre de totales.

Frontend:

1. `frontend/index.html`
   - Estructura principal del dashboard y selector de modos del Top 6.
2. `frontend/app.js`
   - Carga snapshots publicados, renderiza gráficos y paneles.
3. `frontend/projection-modes.js`
   - Servicio de proyección del frontend para `Interpolación` y `VOTO RURAL`.
4. `frontend/style.css`
   - Estilos del dashboard.

---

## 4. Flujo de scraping real ONPE (modo actual)

### 4.1 Inicio de sesión de scraping

Se abre navegador con Playwright (Edge/Chrome local recomendado):

- `headless=False` cuando se usa `--headed`
- `channel=msedge` o `chrome`
- `--disable-blink-features=AutomationControlled`
- User-Agent de navegador desktop

### 4.2 Descubrimiento de IDs de proceso/elección

Se consulta:

1. `/presentacion-backend/proceso/proceso-electoral-activo`
2. `/presentacion-backend/proceso/{idProceso}/elecciones`

Se identifica `idEleccion` de presidencial (fallback al primero si no hay match explícito).

### 4.3 Extracción por región (determinística por ubigeo)

Para cada departamento (desde `data/regiones.md`) se consulta:

1. Totales región:
   - `/presentacion-backend/resumen-general/totales?idAmbitoGeografico=1&idEleccion={idEleccion}&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento={ubigeo}`
2. Participantes región:
   - `/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&ubigeoNivel1={ubigeo}&idEleccion={idEleccion}`

### 4.4 Extracción de extranjero

Se consulta:

1. Totales extranjero:
   - `/presentacion-backend/resumen-general/totales?idAmbitoGeografico=2&idEleccion={idEleccion}&tipoFiltro=ambito_geografico`
2. Participantes extranjero:
   - `/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ambito_geografico&idAmbitoGeografico=2&idEleccion={idEleccion}`

### 4.5 Campo crítico corregido: `actas_pct`

`actas_pct` se toma de:

- `data.actasContabilizadas` del endpoint `resumen-general/totales` para cada región/extranjero.

Esto evitó errores de lectura por DOM asíncrono.

### 4.6 Estructura de salida raw

Archivo: `outputs/raw_region_results.json`

Campos relevantes:

1. `metadata`
   - `source_url`
   - `extracted_at_utc`
   - `actas_pct_global`
   - `mode: live`
   - `warnings`
   - `party_logos`
2. `regions[]`
   - `region`
   - `actas_pct`
   - `emitidos_actual`
   - `partidos[]` (`nombre`, `votos`, `es_blanco_o_nulo`)
   - `source: onpe_live_backend`

---

## 5. Lógica de proyección

### 5.1 Datos de entrada

1. `raw_region_results.json` (live ONPE).
2. `data/padron.md` (electores por región).

### 5.2 Proyección base (si todo sigue así)

Para cada región:

1. `emitidos_actual` viene de ONPE.
2. `actas_pct` viene de ONPE.
3. Se estima:
   - `estimado_emitidos_final = emitidos_actual / (actas_pct / 100)`
4. Se limita por padrón regional si existe.
5. Se mantiene distribución actual de votos:
   - `share_partido = votos_actuales_partido / emitidos_actual`
   - `votos_proyectados_base = share_partido * estimado_emitidos_final`
6. Se redondea con cierre exacto al total regional.

### 5.3 Agregación

Se agregan resultados en:

1. `nacional` (sin extranjero)
2. `extranjero`
3. `nacional_mas_extranjero`

### 5.4 Escenarios de variación

1. `base`: sin ajuste.
2. `conservador`: margen negativo sobre top `N` candidatos.
3. `optimista`: margen positivo sobre top `N` candidatos.

Parámetros:

- `--margin` (default `0.05`)
- `--top-n` (default `5`)

Luego se renormaliza para mantener total emitido del escenario.

---

## 6. Frontend y modos de visualización

### 6.1 Fuente de datos del frontend

El frontend no consume `outputs/projection.json` para el Top 6 principal.

Consume:

1. `history_index.json`
2. `raw_history/<timestamp>/raw_region_results.json`

Con eso reconstruye en cliente:

1. votos actuales nacionales,
2. tendencia temporal,
3. interpolación nacional,
4. modo especulativo `VOTO RURAL`.

### 6.2 Modos del Top 6 Nacional

El gráfico principal del frontend tiene tres modos:

1. `Procesamiento Actual`
   - Suma votos válidos actuales del último snapshot.
2. `Interpolación`
   - Proyecta cada región al 100% según `actas_pct`, manteniendo la distribución observada.
3. `VOTO RURAL`
   - Mantiene el mismo total válido nacional de la interpolación base,
   - pero redistribuye solo el crecimiento pendiente en regiones donde Roberto Sánchez ya lidera.

### 6.3 Lógica matemática de `VOTO RURAL`

El modo `VOTO RURAL` es intencionalmente especulativo, pero conserva restricciones matemáticas para evitar resultados imposibles.

Reglas:

1. Se detectan regiones elegibles donde el líder actual por votos válidos es `JUNTOS POR EL PERÚ`.
2. Se ordenan por votos actuales de Roberto Sánchez y se toman hasta 10.
3. Si hay menos de 10, se usan todas las disponibles.
4. Si no hay ninguna, el modo cae a la interpolación base.

Para cada región elegible:

1. Se calcula la proyección base al 100% igual que en `Interpolación`.
2. No se alteran los votos ya contados.
3. Solo se redistribuye el crecimiento pendiente entre partidos válidos.
4. Blancos, nulos, impugnados y `AJUSTE` quedan congelados en la proyección base.

Fórmula conceptual:

1. `crecimiento_base = max(votos_proyectados_base - votos_actuales, 0)`
2. `crecimiento_ponderado = crecimiento_base * multiplicador`
3. El crecimiento pendiente válido regional se renormaliza con esos pesos.
4. `votos_finales_rural = votos_actuales + crecimiento_renormalizado`

Con esto se garantiza que:

1. ningún partido tenga votos negativos,
2. los votos ya observados no bajen,
3. el total válido regional y nacional coincida con la interpolación base.

### 6.4 Tiers y multiplicadores del modo rural

Los tiers se definen dinámicamente por ranking regional actual entre votos válidos:

1. Tier especial Sánchez:
   - `JUNTOS POR EL PERÚ`
   - multiplicador `1.45`
2. `super potentes`:
   - puestos 2 y 3
   - multiplicador `1.10`
3. `normales`:
   - puestos 4 al 8
   - multiplicador `0.92`
4. `crecen lento`:
   - puesto 9 en adelante
   - multiplicador `0.72`

Al momento de implementación, el snapshot de referencia tenía 9 regiones elegibles, no 10.

---

## 7. Reportes y entregables

### 7.1 JSON principal

- `outputs/projection.json`

Incluye:

1. `metadata`
2. `regions[]` con proyección base por región
3. `totals`
4. `scenarios`

### 7.2 Resumen narrativo

- `outputs/projection_summary.md`

Contiene:

1. metadatos,
2. totales,
3. top del escenario base,
4. resumen de escenarios.

### 7.3 Tabla única de escenarios

- `table.md`

Para cada escenario:

1. candidato/lista,
2. votos proyectados,
3. `% total proyectado` sobre nacional + extranjero.

### 7.4 Gráfico escenario base

- `outputs/base_scenario_chart.png`

Características:

1. barras horizontales por candidato,
2. color estimado por logo oficial de partido (dominante del logo ONPE),
3. etiquetas de porcentaje.

---

## 8. Comandos operativos

### 8.1 Pipeline completo

```bash
python -m election_counter --mode full --headed --browser-channel msedge
```

### 8.2 Solo scraping

```bash
python -m election_counter --mode scrape --headed --browser-channel msedge
```

### 8.3 Solo proyección (desde raw existente)

```bash
python -m election_counter --mode project
```

### 8.4 Solo reportes

```bash
python -m election_counter --mode report
```

### 8.5 Fallback sintético (solo si se desea explícitamente)

```bash
python -m election_counter --mode full --allow-fallback
```

Por defecto, fallback está desactivado.

### 8.6 Programación automática cada 10 minutos (Windows PowerShell)

Crear tarea:

```powershell
schtasks /create /tn "ElectionCounter30m" /sc minute /mo 30 /tr "powershell -NoProfile -ExecutionPolicy Bypass -Command `"Set-Location 'C:\Experimental\election-counter'; python -m election_counter --mode full --headed --browser-channel msedge`"" /f
```

Ejecutar tarea al instante:

```powershell
schtasks /run /tn "ElectionCounter10m"
```

Si se usa `/rl HIGHEST` y aparece `Acceso denegado`, ejecutar PowerShell como Administrador o crear la tarea sin elevación.

---

## 9. Validaciones realizadas

1. Ejecución real `--mode full` completada.
2. Cobertura: 26 entradas (25 regiones + extranjero).
3. `actas_pct` corregido por región desde backend ONPE.
4. Verificación puntual:
   - `CUSCO = 39.016` (coincidente con referencia proporcionada).
5. Pruebas unitarias existentes:
   - `tests/test_projection.py` (escenarios y esquema básico).
6. Validación del frontend:
   - `VOTO RURAL` conserva el total válido nacional de la interpolación.
   - `VOTO RURAL` incrementa la proyección nacional de Roberto Sánchez en el snapshot de referencia.
   - el modo no falla si hay menos de 10 regiones elegibles.

---

## 10. Riesgos conocidos y mitigaciones

### Riesgo 1: cambios de endpoints ONPE

- Mitigación: extracción centralizada en funciones backend (`_fetch_regions_from_backend`).

### Riesgo 2: throttling o bloqueo temporal del sitio

- Mitigación: modo `headed` + navegador local real + posibilidad de reintentos manuales.

### Riesgo 3: diferencias por hora de actualización

- Mitigación: guardar `extracted_at_utc` y considerar que valores pueden variar minuto a minuto.

### Riesgo 4: lectura excesivamente literal del modo `VOTO RURAL`

- Mitigación: documentarlo explícitamente como modo especulativo de frontend, no como modelo estadístico oficial.

---

## 11. Archivos clave

1. `election_counter/scraper.py`
2. `election_counter/projection.py`
3. `election_counter/reporting.py`
4. `election_counter/cli.py`
5. `frontend/app.js`
6. `frontend/projection-modes.js`
7. `docs/run.md`
8. `table.md`
9. `outputs/projection.json`

---

## 12. Estado final

La solución queda operativa con:

1. scraping real ONPE,
2. `actas_pct` correcto por región/extranjero vía backend,
3. proyección completa con escenarios,
4. frontend con modos `Procesamiento Actual`, `Interpolación` y `VOTO RURAL`,
5. reportes y gráfico automatizados.
