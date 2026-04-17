# election-counter

Pipeline de scraping y proyección electoral ONPE con Python + Playwright.

También incluye un frontend estático que consume `/api/v1/*` y snapshots crudos para mostrar:

- `Procesamiento Actual`: votos válidos ya contabilizados.
- `Interpolación`: proyección nacional lineal al 100% usando el último snapshot.
- `VOTO RURAL`: modo especulativo del Top 6 Nacional que redistribuye el crecimiento pendiente en hasta 10 regiones donde Roberto Sánchez va primero, conservando los totales válidos proyectados.

Guía de uso: `docs/run.md`.
Documentación detallada: `docs/IMPLEMENTACION_DETALLADA.md`.
