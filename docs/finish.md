# Finish Mode

## Resumen

`finish` es una variante de build del frontend activada con:

```env
RACE_MODE=finish
```

El modo afecta dos áreas:

- `frontend/race/`
- el frontend principal en [frontend/app.js](c:\perulainen\conteo-electoral\frontend\app.js)

En `default`, todo vuelve al comportamiento original.

## Activación

El valor se define en el env file consumido por [scripts/build_frontend.py](c:\perulainen\conteo-electoral\scripts\build_frontend.py).

Ejemplo:

```env
RACE_MODE=finish
```

Durante el build, el script inyecta `RACE_MODE` en:

- [frontend/app.js](c:\perulainen\conteo-electoral\frontend\app.js)
- [frontend/race/race.js](c:\perulainen\conteo-electoral\frontend\race\race.js)

## Cambios en `frontend/race/`

El detalle completo del minijuego está en [docs/race.md](c:\perulainen\conteo-electoral\docs\race.md).

En resumen, `finish` aplica:

- fondo estático sin parallax
- sprites alternativos
- separación logarítmica entre candidatos
- offset vertical adicional para Porky

### Parámetros visuales actuales

- `separationModel: "logarithmic"`
- `minSeparationPx: 100`
- `logSeparationScale: 50`
- `porky.yOffsetPx: 10`

## Cambios en el frontend principal

La lógica se aplica en `app.js` con la bandera:

```js
const IS_FINISH_MODE = RACE_MODE === "finish";
```

Cuando `IS_FINISH_MODE` es `true`, se ejecuta `applyFinishModeFrontendTweaks()`.

### 1. Top 6 Nacional

En `finish`:

- se oculta el switch de pestañas `#main-chart-mode-switch`
- se fuerza `mainChartMode = "actual"`
- el gráfico muestra solo `PROCESAMIENTO ACTUAL`

En `default`:

- vuelven a mostrarse las pestañas
- el usuario puede alternar entre:
  - `PROCESAMIENTO ACTUAL`
  - `PROYECCION SIMPLE`
  - `PROYECCION VOTO RURAL`

### 2. Frente a Frente

En `finish`, la sección `Frente a Frente` se mueve para quedar inmediatamente debajo de `Top 3 Nacional`.

Reordenamiento:

- `#pending-votes-section` se reubica justo después de `#top3-section`

Este cambio es solo de runtime y solo aplica en `finish`. El HTML base no cambia de orden para `default`.

Además, en `finish` se oculta por completo la subsección de `Proyección e Impugnaciones`.

Elementos ocultos:

- `#ffe-duel-heading`
- `#ffe-duel-chart-note`
- `#ffe-projection-type-switch`
- `#ffe-imp-rural-controls`
- `#ffe-imp-lima-controls`
- `#ffe-imp-extranjero-controls`
- `#ffe-imp-resto-controls`
- `#ffe-duel-leader-badge`
- `#ffe-duel-chart-container`

Esto deja visible solo la parte “actual” del bloque `Frente a Frente`, incluyendo:

- iframe de la carrera
- votos actuales de ambos candidatos
- diferencia actual
- tarjetas de última hora
- bloques de votos pendientes por zona

Además, `renderFfeDuelChart()` sale temprano en `finish` y destruye cualquier instancia previa del gráfico para evitar render innecesario.

En `default`:

- reaparecen proyecciones, impugnaciones y su gráfico

### 3. Ritmo de Crecimiento por Hora

En `finish`:

- se oculta `#growth-rate-section`
- no se llama `renderGrowthRateChart()`

En `default`:

- vuelve a mostrarse y renderizarse normalmente

## Build local

Ejemplo de build `finish`:

```powershell
python scripts/build_frontend.py --env-file .env
```

Con `.env` así:

```env
BASE_URL=https://perulainen.com/conteo
RACE_MODE=finish
DEV=false
```

## Deploy

Producción puede activarlo desde GitHub Secrets con:

```text
RACE_MODE=finish
```

El workflow relevante es [deploy-frontend.yml](c:\perulainen\conteo-electoral\.github\workflows\deploy-frontend.yml).

## Regla de reversión

Para volver al comportamiento original en todo el frontend:

```env
RACE_MODE=default
```

O simplemente dejando vacío el valor, ya que el build hace fallback a `default`.
