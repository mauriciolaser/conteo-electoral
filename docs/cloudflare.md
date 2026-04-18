# Cloudflare Runbook (Conteo)

## Objetivo

Evitar errores de CORS por mezcla de host (`perulainen.com` vs `www.perulainen.com`) y garantizar un único dominio canónico para `conteo`.

## Estado esperado en producción

- Host canónico: `https://www.perulainen.com`
- Todo request a `https://perulainen.com/*` redirige a `https://www.perulainen.com/*` con `301`
- Frontend servido con `INJECTED_BASE_URL = "https://www.perulainen.com/conteo"`
- API pública consumida en `https://www.perulainen.com/conteo/api/v1/...`

## Configuración en Cloudflare (web)

1. Ir a `Websites > perulainen.com > Rules > Redirect Rules`.
2. Crear una regla (o editar existente):
   - Name: `perulainen_redirect`
   - Expression:
     - `http.host eq "perulainen.com"`
   - Action: `Dynamic redirect`
   - Target URL expression:
     - `concat("https://www.perulainen.com", http.request.uri.path)`
   - Preserve query string: `On`
   - Status code: `301`
3. Dejar esta regla por encima de otras redirects.

## Error conocido y corrección

Error que rompe rutas:

- Target inválido: `https://www.perulainen.com/${uri}`
- Resultado: navegador termina en `https://www.perulainen.com/$%7Buri%7D`

Corrección:

- Usar `Dynamic redirect` con expresión:
  - `concat("https://www.perulainen.com", http.request.uri.path)`

## Verificación rápida

Validar con navegador (Network + Console):

1. `https://perulainen.com/conteo/` debe responder `301` a `https://www.perulainen.com/conteo/`
2. `https://www.perulainen.com/conteo/` debe responder `200`
3. `app.js?v=...` en `www` debe contener:
   - `const INJECTED_BASE_URL = "https://www.perulainen.com/conteo";`
4. Requests API deben salir a:
   - `https://www.perulainen.com/conteo/api/v1/dashboard/summary`
   - `https://www.perulainen.com/conteo/api/v1/dashboard/latest`
5. No debe aparecer error CORS en consola.

## Cache y purga tras cambios

Después de tocar redirects o deploy de frontend:

1. `Caching > Configuration > Purge Cache`
2. Purga recomendada:
   - `https://perulainen.com/conteo/`
   - `https://www.perulainen.com/conteo/`
   - `https://perulainen.com/conteo/app.js?v=...`
   - `https://www.perulainen.com/conteo/app.js?v=...`

## Rollback rápido

Si una regla nueva rompe producción:

1. `Rules > Redirect Rules` -> deshabilitar regla nueva.
2. Purge cache.
3. Verificar acceso directo a `https://www.perulainen.com/conteo/`.
4. Re-crear la regla con la expresión correcta (no usar placeholders tipo `${uri}`).

## Nota de operación

Si algunos usuarios siguen viendo cifras antiguas tras el fix, normalmente es estado local del navegador (cache/redirect viejo). Validar en incógnito y forzar recarga (`Ctrl+F5`).
