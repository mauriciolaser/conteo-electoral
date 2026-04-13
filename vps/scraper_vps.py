from __future__ import annotations

"""VPS-oriented scraper that prefers ONPE backend JSON over frontend rendering."""

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from election_counter.parsers import parse_regiones
from election_counter.utils import normalize_name

SOURCE_URL = "https://resultadoelectoral.onpe.gob.pe/main/presidenciales"


def scrape_onpe_vps(
    data_dir: Path,
    source_url: str = SOURCE_URL,
    *,
    headed: bool = True,
    browser_channel: str | None = None,
    user_data_dir: Path | None = None,
    allow_fallback: bool = False,
    executable_path: str | None = None,
) -> dict[str, object]:
    warnings: list[str] = []
    live = _scrape_live_vps(
        source_url,
        warnings,
        data_dir=data_dir,
        headed=headed,
        browser_channel=browser_channel,
        user_data_dir=user_data_dir,
        executable_path=executable_path,
    )
    if live["regions"]:
        return live
    detail = " | ".join(warnings) if warnings else "No se pudo obtener data por región."
    warnings.append(f"ONPE no devolvió JSON utilizable en VPS: {detail}")
    return {
        "metadata": {
            "source_url": source_url,
            "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
            "actas_pct_global": 0.0,
            "mode": "fallback_vps",
            "warnings": warnings,
        },
        "regions": [],
    }


def _scrape_live_vps(
    source_url: str,
    warnings: list[str],
    *,
    data_dir: Path,
    headed: bool,
    browser_channel: str | None,
    user_data_dir: Path | None,
    executable_path: str | None,
) -> dict[str, object]:
    regions: list[dict[str, object]] = []
    actas_pct = 0.0
    party_logos: dict[str, str] = {}

    try:
        with sync_playwright() as p:
            launch_kwargs: dict[str, object] = {
                "headless": not headed,
                "args": [
                    "--disable-blink-features=AutomationControlled",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                    "--disable-extensions",
                    "--disable-sync",
                    "--disable-features=Translate,OptimizationHints,PaintHolding",
                ],
            }
            if executable_path:
                launch_kwargs["executable_path"] = executable_path
            elif browser_channel:
                launch_kwargs["channel"] = browser_channel

            context_kwargs = _build_context_kwargs()
            if user_data_dir:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(user_data_dir),
                    **launch_kwargs,
                    **context_kwargs,
                )
                page = context.new_page()
                request_context = context.request
                close_ctx = True
            else:
                browser = p.chromium.launch(**launch_kwargs)
                browser_context = browser.new_context(**context_kwargs)
                page = browser_context.new_page()
                request_context = browser_context.request
                close_ctx = False

            try:
                page.goto(source_url, wait_until="domcontentloaded", timeout=120000)
                regions, actas_pct = _fetch_regions_from_backend(request_context, data_dir)
                party_logos = _extract_party_logo_map(page)
            finally:
                if close_ctx:
                    context.close()
                else:
                    browser.close()
    except PlaywrightTimeoutError as exc:
        warnings.append(f"Timeout en scraping VPS: {exc}")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Error en scraping VPS: {exc}")

    return {
        "metadata": {
            "source_url": source_url,
            "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
            "actas_pct_global": actas_pct,
            "mode": "live_vps",
            "warnings": warnings,
            "party_logos": party_logos,
        },
        "regions": regions,
    }


def _build_context_kwargs() -> dict[str, object]:
    return {
        "locale": "es-PE",
        "timezone_id": "America/Lima",
        "viewport": {"width": 1920, "height": 1080},
        "screen": {"width": 1920, "height": 1080},
        "extra_http_headers": {"accept-language": "es-PE,es;q=0.9,en;q=0.8"},
        "geolocation": {"latitude": -12.0464, "longitude": -77.0428},
        "permissions": ["geolocation"],
        "color_scheme": "light",
        "reduced_motion": "no-preference",
        "has_touch": False,
        "is_mobile": False,
        "device_scale_factor": 1,
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/123.0.0.0 Safari/537.36"
        ),
    }


def _fetch_regions_from_backend(request_context, data_dir: Path) -> tuple[list[dict[str, object]], float]:
    regiones = parse_regiones(data_dir / "regiones.md")
    proceso = _fetch_backend_json(request_context, SOURCE_URL, "/presentacion-backend/proceso/proceso-electoral-activo")
    id_proceso = int((proceso.get("data") or {}).get("idProcesoElectoral") or 2)
    elecciones = _fetch_backend_json(request_context, SOURCE_URL, f"/presentacion-backend/proceso/{id_proceso}/elecciones")
    ele_data = elecciones.get("data") or []
    id_eleccion = 10
    for e in ele_data:
        if "PRESID" in str(e.get("tipoEleccion", "")).upper():
            id_eleccion = int(e.get("idEleccion") or 10)
            break
    if ele_data and id_eleccion == 10:
        id_eleccion = int(ele_data[0].get("idEleccion") or 10)

    global_tot = _fetch_backend_json(
        request_context,
        SOURCE_URL,
        f"/presentacion-backend/resumen-general/totales?idEleccion={id_eleccion}&tipoFiltro=eleccion",
    )
    actas_global = float((global_tot.get("data") or {}).get("actasContabilizadas") or 0.0)

    out_regions: list[dict[str, object]] = []
    for reg in regiones:
        ubigeo = reg["ubigeo"]
        nombre = reg["nombre"]
        tot = _fetch_backend_json(
            request_context,
            SOURCE_URL,
            (
                "/presentacion-backend/resumen-general/totales"
                f"?idAmbitoGeografico=1&idEleccion={id_eleccion}&tipoFiltro=ubigeo_nivel_01"
                f"&idUbigeoDepartamento={ubigeo}"
            ),
        )
        parts = _fetch_backend_json(
            request_context,
            SOURCE_URL,
            (
                "/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre"
                f"?tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&ubigeoNivel1={ubigeo}&idEleccion={id_eleccion}"
            ),
        )
        out_regions.append(_build_region_from_backend(nombre, tot, parts))

    tot_ext = _fetch_backend_json(
        request_context,
        SOURCE_URL,
        (
            "/presentacion-backend/resumen-general/totales"
            f"?idAmbitoGeografico=2&idEleccion={id_eleccion}&tipoFiltro=ambito_geografico"
        ),
    )
    part_ext = _fetch_backend_json(
        request_context,
        SOURCE_URL,
        (
            "/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre"
            f"?tipoFiltro=ambito_geografico&idAmbitoGeografico=2&idEleccion={id_eleccion}"
        ),
    )
    out_regions.append(_build_region_from_backend("PERUANOS EN EL EXTRANJERO", tot_ext, part_ext))

    return out_regions, actas_global


def _fetch_backend_json(request_context, base_url: str, rel_url: str) -> dict[str, object]:
    url = urljoin(base_url, rel_url)
    resp = request_context.get(url, headers={"accept": "application/json, text/plain, */*"})
    if resp.status < 200 or resp.status >= 300:
        raise RuntimeError(f"HTTP {resp.status} en {url}")
    ct = (resp.headers.get("content-type") or "").lower()
    text = resp.text().strip()
    if "json" not in ct:
        raise RuntimeError(f"Content-Type no JSON en {url}: {ct or 'sin content-type'}")
    if text.startswith("<!doctype") or text.startswith("<html"):
        raise RuntimeError(f"Respuesta HTML inesperada en {url}")
    data = json.loads(text)
    return data if isinstance(data, dict) else {}


def _build_region_from_backend(
    region_name: str,
    totales_payload: dict[str, object],
    participantes_payload: dict[str, object],
) -> dict[str, object]:
    tot = totales_payload.get("data") or {}
    part_rows = participantes_payload.get("data") or []
    emitidos = int(round(float(tot.get("totalVotosEmitidos") or 0)))
    actas = float(tot.get("actasContabilizadas") or 0.0)

    partidos: list[dict[str, object]] = []
    sum_votes = 0
    for row in part_rows:
        party = str(row.get("nombreAgrupacionPolitica", "")).strip()
        if not party:
            continue
        votes = int(round(float(row.get("totalVotosValidos") or 0)))
        sum_votes += votes
        up = normalize_name(party)
        partidos.append(
            {
                "nombre": party,
                "votos": votes,
                "es_blanco_o_nulo": ("BLANCO" in up or "NULO" in up),
            }
        )

    diff = emitidos - sum_votes
    if diff > 0:
        partidos.append({"nombre": "AJUSTE", "votos": diff, "es_blanco_o_nulo": False})

    return {
        "region": region_name,
        "actas_pct": actas,
        "emitidos_actual": emitidos,
        "partidos": partidos,
        "source": "onpe_live_backend_vps",
    }


def _extract_party_logo_map(page) -> dict[str, str]:
    rows = page.evaluate(
        """() => {
            const cards=[...document.querySelectorAll('section.desplegable.full article.candidato')];
            return cards.map(c => {
                const p = c.querySelector('.nombre p');
                const logo = c.querySelector('.cont-info app-img .img img[alt="partidos"], .cont-info .partido-logo img');
                return {
                    party: p?.textContent?.trim() || '',
                    logo: logo?.getAttribute('src') || '',
                };
            });
        }"""
    )
    out: dict[str, str] = {}
    for row in rows:
        party = str(row.get("party", "")).strip()
        logo = str(row.get("logo", "")).strip()
        if party and logo and party not in out:
            out[party] = logo
    return out
