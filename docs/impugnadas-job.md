# Job: JNE/JEE e impugnadas (scraper)

Documentación del trabajo alineado a `planning/jne.md` y `planning/impugnadas.md`. **Implementación aplicada** en el repositorio (ver checklist abajo).

## Restricción ONPE

- Probar y consumir ONPE con **Playwright headed** (`headed=True`), misma sesión que abre `/main/presidenciales`.
- No usar `curl` ni headless solo contra producción ONPE como verdad de referencia.

## Código añadido o modificado

| Pieza | Rol |
|--------|-----|
| [`election_counter/onpe_region_extras.py`](../election_counter/onpe_region_extras.py) | `jee_summary_from_totales`, `impugnadas_summary_from_row`, `enrich_region_onpe_totales`, helpers de fallback vacíos. |
| [`election_counter/scraper.py`](../election_counter/scraper.py) | `ubigeo` por región, enriquecimiento tras `totales`+participantes; `metadata.resumen_jee_nacional` desde `totales` nacional; fallback con `jee` / `impugnadas`. |
| [`vps/scraper_vps.py`](../vps/scraper_vps.py) | Misma lógica que el scraper local. |
| [`election_counter/publish.py`](../election_counter/publish.py) | `_minify_snapshot` conserva `ubigeo`, `jee`, `impugnadas` por región y `resumen_jee_nacional` en metadata si existe. |
| [`tests/test_onpe_region_extras.py`](../tests/test_onpe_region_extras.py) | Pruebas de prorrateo JEE y señales impugnadas. |
| [`tests/test_projection.py`](../tests/test_projection.py) | Región con claves extra no rompe la proyección. |

## Formato JSON por región (`raw_region_results.json`)

Cada elemento de `regions[]` incluye además de lo existente:

- **`ubigeo`**: código departamento (p. ej. `"140000"` para Lima); ausente en extranjero.
- **`jee`** (planning/jne.md):
  - `enviadas_jee_actas`, `pendientes_jee_actas`: desde `totales.data`.
  - `total_mesas_o_actas`: primera clave conocida entre `totalMesas`, `mesasTotales`, etc.; si no hay, `enviadasJee + pendientesJee` cuando esa suma es mayor que cero (denominador mínimo).
  - `votos_revision_jne`, `votos_pendientes_contar`: `round(totalVotosEmitidos * actas_jee / total_mesas_o_actas)` cuando hay denominador.
  - `prorrateo`: descripción corta del cálculo (`sin_total_mesas` si no hubo denominador).
- **`impugnadas`** (planning/impugnadas.md):
  - `sanchez_lidera_sobre_renovacion`: Juntos por el Perú vs Renovación Popular en esa región.
  - `es_lima_departamento`: `ubigeo == "140000"`.
  - `mesas_impugnadas`, `votos_impugnados`: si en `totales` existe alguna clave que contenga `impugn` y sea numérica; si no, `0` y `fuente_agregado: sin_campo_en_totales`.

**`metadata.resumen_jee_nacional`**: mismo bloque `jee` aplicado al payload de `totales` con `tipoFiltro=eleccion` (ámbito nacional).

## Tests

```bash
python -m unittest discover -s tests -p "test_*.py" -q
```

## Frontend (`planning/impugnadas.md`)

- Sección **Proyección Frente a Frente (Top 2)** debajo del bloque de pendientes, en la misma sección que el iframe de carrera: modos **ACTUAL | SIMPLE | VOTO RURAL | IMPUGN. RURAL | IMPUGN. LIMA** y gráfico de barras (`frontend/index.html`, `frontend/app.js`, `frontend/projection-modes.js`, `frontend/style.css`).

## Estado

- [x] Código aplicado en el repositorio
- [x] Tests `unittest` OK
- [x] Panel duelo Top 2 en frontend
- [ ] Scrape real verificado con navegador headed contra ONPE (pendiente en tu máquina / VPS)
