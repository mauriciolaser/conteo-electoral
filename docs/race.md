# Race

## Resumen

`frontend/race/` renderiza la carrera visual entre Roberto Sánchez y López Aliaga en un `canvas` 2D.

La vista:

- consume porcentajes desde `/api/v1/race/latest`
- tiene fallback a `/api/v1/dashboard/latest`
- tiene fallback final a `frontend/race/dummy.json`
- se publica como parte del build estático en `frontend/dist/race/`

No usa PIXI.js. El render actual es `CanvasRenderingContext2D`.

## Archivos importantes

- [frontend/race/race.js](c:\perulainen\conteo-electoral\frontend\race\race.js): lógica principal de render, animación, separación y logs de desarrollo
- [frontend/race/index.html](c:\perulainen\conteo-electoral\frontend\race\index.html): contenedor del canvas
- [frontend/race/style.css](c:\perulainen\conteo-electoral\frontend\race\style.css): estilos de la vista
- [scripts/build_frontend.py](c:\perulainen\conteo-electoral\scripts\build_frontend.py): build que inyecta flags y copia `frontend/` a `frontend/dist/`
- [.github/workflows/deploy-frontend.yml](c:\perulainen\conteo-electoral\.github\workflows\deploy-frontend.yml): deploy de producción por GitHub Actions

## Flujo de datos

El orden de lectura es:

1. `../api/v1/race/latest`
2. `../api/v1/dashboard/latest`
3. `./dummy.json`

`race.js` intenta primero leer `latest.pct_sanchez` y `latest.pct_lopez_aliaga` desde `race/latest`.

Si eso falla:

- intenta reconstruir porcentajes desde un snapshot de `dashboard/latest`
- y si eso también falla, usa `dummy.json`

El build genera `frontend/dist/race/dummy.json` desde el snapshot más reciente en `outputs/raw_history/`.

## Build flags

El build inyecta dos placeholders en `race.js`:

- `__RACE_MODE__`
- `__RACE_IS_DEV__`

Esos valores se inyectan desde [scripts/build_frontend.py](c:\perulainen\conteo-electoral\scripts\build_frontend.py).

### Variables soportadas

```env
RACE_MODE=default
DEV=false
```

### `RACE_MODE`

Valores soportados:

- `default`
- `finish`

Si falta o viene vacío, cae en `default`.

Si viene otro valor, el build falla.

### `DEV`

Activa logging de diagnóstico solo para builds de desarrollo.

Valores interpretados como `true`:

- `1`
- `true`
- `yes`
- `on`
- `dev`
- `development`

En cualquier otro caso se inyecta `false`.

## Modos visuales

La configuración vive dentro de `RACE_MODES` en [frontend/race/race.js](c:\perulainen\conteo-electoral\frontend\race\race.js).

### `default`

Características:

- fondo con parallax activado
- separación lineal
- sprites originales

Sprites:

- Sánchez: `./assets/sanchez-sheet.png`
- Porky: `./assets/porky-sheet.png`

Métricas:

- Sánchez: `11` frames, `256x171`
- Porky: `13` frames, `256x170`

Separación:

- `separationModel: "linear"`
- `pxPerHundredthPp: 0.5`

Interpretación:

- cada `0.01` punto porcentual agrega `0.5 px`
- cada `1%` agrega `50 px`

### `finish`

Características:

- parallax desactivado
- sprites alternativos
- separación visual mucho más agresiva
- separación logarítmica con mínimo visible

Sprites:

- Sánchez: `./assets/sanchez_jumping_sheet.png`
- Porky: `./assets/porky_crying_sheet.png`

Métricas:

- Sánchez: `13` frames, `170x170`
- Porky: `18` frames, `170x170`

Separación:

- `separationModel: "logarithmic"`
- `minSeparationPx: 100`
- `logSeparationScale: 50`

Interpretación:

- si la diferencia es `0`, no hay separación extra
- si la diferencia es mayor que `0`, arranca en un mínimo visual de `100 px`
- a partir de ahí crece con una curva `log1p(...)`

Fórmula actual:

```js
const diffHundredths = diffPctPoints / 0.01;
return minSeparationPx + Math.log1p(diffHundredths) * logSeparationScale;
```

Ejemplos aproximados en `finish`:

- `0.01%` -> `134.66 px`
- `0.05%` -> `189.59 px`
- `0.1106%` -> `224.49 px`
- `1.00%` -> `330.76 px`

## Cómo se calcula la posición

Cada candidato tiene:

- `pct`
- `posX`
- `frame`

`updateTargets()`:

1. calcula la diferencia absoluta entre ambos porcentajes
2. calcula la separación deseada en píxeles
3. la limita al ancho disponible del canvas
4. coloca al líder a la derecha y al rezagado a la izquierda

La separación total se limita con:

```js
const drawW = Math.max(PORKY.w, SANCHEZ.w) * SPRITE_DRAW_SCALE;
const maxSeparationPx = canvas.width - drawW;
const separationPx = Math.min(desiredPx, maxSeparationPx);
```

Esto evita que los personajes se salgan del canvas.

## Render

El loop principal vive en `startLoop()`.

Comportamiento:

- avanza frames a `10 FPS`
- actualiza offsets de capas solo si el modo tiene `parallaxEnabled: true`
- dibuja capas del fondo
- dibuja candidatos en orden para respetar profundidad visual
- dibuja capas frontales

### Parallax

Capas:

- `back`
- `fence`
- `track`
- `front`

En `default`, cada capa acumula desplazamiento según su velocidad.

En `finish`, las capas se siguen dibujando pero los offsets no avanzan, así que el fondo queda estático.

## Logs de desarrollo

Cuando `DEV=true`, `race.js` imprime logs en consola con prefijo:

```text
[race][dev]
```

Se loguea:

- tabla con coordenadas de Sánchez
- tabla con coordenadas de Porky
- distancia entre centros en píxeles
- distancia entre sprites en píxeles
- separación deseada calculada
- diferencia de votos en puntos porcentuales
- modo y modelo de separación

Campos por personaje:

- `candidate`
- `pct`
- `centerX`
- `centerY`
- `drawX`
- `drawY`
- `width`
- `height`

Campos del resumen:

- `centerGapPx`
- `spriteGapPx`
- `desiredSeparationPx`
- `voteDiffPctPoints`
- `separationModel`
- `mode`

Los logs no spamean cada frame. Se usa `lastDebugSnapshot` para imprimir solo cuando cambian los valores relevantes.

## Build local

Build normal:

```powershell
python scripts/build_frontend.py --env-file .env
```

Build `finish` con logs de desarrollo:

```env
RACE_MODE=finish
DEV=true
```

```powershell
python scripts/build_frontend.py --env-file .env
```

Servir localmente:

```powershell
cd frontend/dist
python -m http.server 8000
```

URLs útiles:

- `http://localhost:8000/`
- `http://localhost:8000/race/`

## Deploy de producción

El workflow [deploy-frontend.yml](c:\perulainen\conteo-electoral\.github\workflows\deploy-frontend.yml) crea `.env` desde GitHub Secrets.

Actualmente usa:

- `FTP_USER`
- `FTP_HOST`
- `FTP_PASSWORD`
- `DEPLOY_FRONTEND`
- `BASE_URL`
- `RACE_MODE`
- `GA_ID`

`RACE_MODE` ya está conectado al workflow y puede controlarse desde GitHub Secrets.

Producción hoy puede desplegar `finish` solo cambiando el secret:

```text
RACE_MODE=finish
```

## Ajustes futuros

Si quieres retocar el comportamiento sin cambiar la arquitectura:

### Para `default`

- ajustar `pxPerHundredthPp`

### Para `finish`

- ajustar `minSeparationPx`
- ajustar `logSeparationScale`

Regla práctica:

- subir `minSeparationPx` aumenta cuánto “respiran” diferencias muy pequeñas
- subir `logSeparationScale` hace crecer más rápido la curva completa

## Notas importantes

- `race` no depende de cambios en el shape del JSON para alternar modos
- el modo es una decisión de build, no de runtime
- el debug `DEV` solo debe usarse en builds locales o entornos controlados
- aunque en conversación se mencionó PIXI, la implementación real no usa PIXI sino canvas 2D
