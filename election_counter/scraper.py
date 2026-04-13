from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from election_counter.parsers import (
    parse_actas_pct_from_votantes,
    parse_padron,
    parse_partidos_from_votantes,
    parse_partidos_snapshot,
    parse_regiones,
)
from election_counter.utils import normalize_name

SOURCE_URL = "https://resultadoelectoral.onpe.gob.pe/main/presidenciales"


def scrape_onpe(
    data_dir: Path,
    source_url: str = SOURCE_URL,
    *,
    headed: bool = True,
    browser_channel: str | None = None,
    user_data_dir: Path | None = None,
    allow_fallback: bool = False,
) -> dict[str, object]:
    warnings: list[str] = []
    live = _scrape_live(
        source_url,
        warnings,
        data_dir=data_dir,
        headed=headed,
        browser_channel=browser_channel,
        user_data_dir=user_data_dir,
    )
    if live["regions"]:
        return live
    if not allow_fallback:
        joined = " | ".join(warnings) if warnings else "No se pudo obtener data por región."
        raise RuntimeError(
            "Scraping ONPE real falló y fallback está deshabilitado. "
            f"Detalle: {joined}"
        )
    warnings.append(
        "No se pudo extraer por región desde ONPE en esta ejecución. "
        "Se usa fallback sintético a partir de snapshots locales."
    )
    return _build_fallback_snapshot(data_dir, source_url, warnings)


def _scrape_live(
    source_url: str,
    warnings: list[str],
    *,
    data_dir: Path,
    headed: bool,
    browser_channel: str | None,
    user_data_dir: Path | None,
) -> dict[str, object]:
    assets_failed = False
    regions: list[dict[str, object]] = []
    actas_pct = 0.0

    try:
        with sync_playwright() as p:
            if user_data_dir:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(user_data_dir),
                    headless=not headed,
                    channel=browser_channel,
                    viewport={"width": 1440, "height": 1000},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/123.0.0.0 Safari/537.36"
                    ),
                    args=["--disable-blink-features=AutomationControlled"],
                )
                page = context.new_page()
                close_ctx = True
            else:
                browser = p.chromium.launch(
                    headless=not headed,
                    channel=browser_channel,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                page = browser.new_page(
                    viewport={"width": 1440, "height": 1000},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/123.0.0.0 Safari/537.36"
                    ),
                )
                close_ctx = False

            page.goto(source_url, wait_until="networkidle", timeout=120000)

            scripts_ok = _verify_script_assets(page)
            if not scripts_ok:
                assets_failed = True
                warnings.append("ONPE devolvió recursos JS/CSS inválidos en esta ejecución.")

            regions, actas_pct = _fetch_regions_from_backend(page, data_dir)
            party_logos = _extract_party_logo_map(page)
            if close_ctx:
                context.close()
            else:
                browser.close()
    except PlaywrightTimeoutError as exc:
        warnings.append(f"Timeout en scraping ONPE: {exc}")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Error en scraping ONPE: {exc}")

    return {
        "metadata": {
            "source_url": source_url,
            "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
            "actas_pct_global": actas_pct,
            "mode": "live",
            "warnings": warnings,
            "party_logos": party_logos if "party_logos" in locals() else {},
        },
        "regions": regions,
    }


def _fetch_regions_from_backend(page, data_dir: Path) -> tuple[list[dict[str, object]], float]:
    regiones = parse_regiones(data_dir / "regiones.md")

    proceso = _fetch_backend_json(page, "/presentacion-backend/proceso/proceso-electoral-activo")
    id_proceso = int((proceso.get("data") or {}).get("idProcesoElectoral") or 2)
    elecciones = _fetch_backend_json(page, f"/presentacion-backend/proceso/{id_proceso}/elecciones")
    ele_data = elecciones.get("data") or []
    id_eleccion = 10
    for e in ele_data:
        t = str(e.get("tipoEleccion", "")).upper()
        if "PRESID" in t:
            id_eleccion = int(e.get("idEleccion") or 10)
            break
    if ele_data and id_eleccion == 10:
        id_eleccion = int(ele_data[0].get("idEleccion") or 10)

    global_tot = _fetch_backend_json(
        page,
        f"/presentacion-backend/resumen-general/totales?idEleccion={id_eleccion}&tipoFiltro=eleccion",
    )
    actas_global = float((global_tot.get("data") or {}).get("actasContabilizadas") or 0.0)

    out_regions: list[dict[str, object]] = []
    for reg in regiones:
        ubigeo = reg["ubigeo"]
        nombre = reg["nombre"]
        tot = _fetch_backend_json(
            page,
            (
                "/presentacion-backend/resumen-general/totales"
                f"?idAmbitoGeografico=1&idEleccion={id_eleccion}&tipoFiltro=ubigeo_nivel_01"
                f"&idUbigeoDepartamento={ubigeo}"
            ),
        )
        parts = _fetch_backend_json(
            page,
            (
                "/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre"
                f"?tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&ubigeoNivel1={ubigeo}&idEleccion={id_eleccion}"
            ),
        )
        out_regions.append(_build_region_from_backend(nombre, tot, parts))

    # Extranjero
    tot_ext = _fetch_backend_json(
        page,
        (
            "/presentacion-backend/resumen-general/totales"
            f"?idAmbitoGeografico=2&idEleccion={id_eleccion}&tipoFiltro=ambito_geografico"
        ),
    )
    part_ext = _fetch_backend_json(
        page,
        (
            "/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre"
            f"?tipoFiltro=ambito_geografico&idAmbitoGeografico=2&idEleccion={id_eleccion}"
        ),
    )
    out_regions.append(_build_region_from_backend("PERUANOS EN EL EXTRANJERO", tot_ext, part_ext))

    return out_regions, actas_global


def _fetch_backend_json(page, rel_url: str) -> dict[str, object]:
    js = """async (u) => {
      const r = await fetch(u, {headers: {'accept': 'application/json, text/plain, */*'}});
      return await r.json();
    }"""
    data = page.evaluate(js, rel_url)
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

    # Ajuste conservador si faltan votos por redondeo.
    diff = emitidos - sum_votes
    if diff > 0:
        partidos.append({"nombre": "AJUSTE", "votos": diff, "es_blanco_o_nulo": False})

    return {
        "region": region_name,
        "actas_pct": actas,
        "emitidos_actual": emitidos,
        "partidos": partidos,
        "source": "onpe_live_backend",
    }


def _verify_script_assets(page) -> bool:
    script_srcs = page.eval_on_selector_all(
        "script[type='module'][src]",
        "els => els.map(e => e.getAttribute('src'))",
    )
    if not script_srcs:
        return False
    for src in script_srcs:
        result = page.evaluate(
            """async (s) => {
                const u = new URL(s, window.location.origin).toString();
                const r = await fetch(u, {method: 'GET'});
                const ct = (r.headers.get('content-type') || '').toLowerCase();
                return {ok: r.ok, ct};
            }""",
            src,
        )
        if not result.get("ok"):
            return False
        ct = result.get("ct", "")
        if "javascript" not in ct and "ecmascript" not in ct:
            return False
    return True


def _extract_actas_pct(text: str) -> float:
    import re

    m = re.search(r"Actas contabilizadas\s*([\d.,]+)\s*%", text, flags=re.IGNORECASE)
    if not m:
        return 0.0
    return float(m.group(1).replace(",", "."))


def _extract_region_result(page, region_name: str, default_actas_pct: float) -> dict[str, object]:
    from election_counter.utils import parse_int

    actas_pct = _extract_current_region_actas_pct(page, default_actas_pct)
    partidos: list[dict[str, object]] = []
    rows = page.locator("section.desplegable.full article.candidato")
    for i in range(rows.count()):
        row = rows.nth(i)
        party_node = row.locator(".nombre p")
        party_name = party_node.first.inner_text().strip() if party_node.count() else ""
        if not party_name:
            continue
        vote_node = row.locator(".titulo_votos_totales__num2")
        votes = parse_int(vote_node.first.inner_text() if vote_node.count() else "0")
        partidos.append({"nombre": party_name, "votos": votes, "es_blanco_o_nulo": False})

    for label in ["VOTOS EN BLANCO", "VOTOS NULOS"]:
        node = page.locator(f"section.votos-sincandidato h3:has-text('{label}')")
        if node.count():
            article = node.first.locator("xpath=ancestor::article[1]")
            vote_node = article.locator(".titulo_votos_totales__num2")
            votes = parse_int(vote_node.first.inner_text() if vote_node.count() else "0")
            partidos.append({"nombre": label, "votos": votes, "es_blanco_o_nulo": True})

    emitidos = 0
    total_em = page.locator("p.titulo_votos_totales:has-text('Votos emitidos')")
    if total_em.count():
        emitidos = parse_int(total_em.first.inner_text())
    if emitidos == 0:
        emitidos = sum(p["votos"] for p in partidos)

    return {
        "region": region_name,
        "actas_pct": actas_pct,
        "emitidos_actual": emitidos,
        "partidos": partidos,
        "source": "onpe_live",
    }


def _extract_current_region_actas_pct(page, default_actas_pct: float) -> float:
    import re

    # Selector estricto del porcentaje de "Actas contabilizadas" en versión desktop.
    b = page.locator("app-seccion-actas-resumen .version-pc .infoprincipal-detalle span b")
    if b.count() > 0:
        try:
            txt = b.first.inner_text()
            m = re.search(r"([\d.,]+)\s*%", txt)
            if m:
                return float(m.group(1).replace(",", "."))
        except Exception:  # noqa: BLE001
            pass

    # Fallback móvil, también específico.
    mobile = page.locator("app-seccion-actas-resumen .version-movil .datos_resumen")
    if mobile.count() > 0:
        try:
            txt = mobile.first.inner_text()
            m = re.search(r"([\d.,]+)\s*%", txt)
            if m:
                return float(m.group(1).replace(",", "."))
        except Exception:  # noqa: BLE001
            pass

    # Último fallback: buscar bloque con la frase exacta.
    block = page.locator("app-seccion-actas-resumen .infoprincipal-detalle")
    if block.count() > 0:
        try:
            txt = block.first.inner_text()
            m = re.search(r"Actas contabilizadas\\s*([\\d.,]+)\\s*%", txt, flags=re.IGNORECASE)
            if m:
                return float(m.group(1).replace(",", "."))
        except Exception:  # noqa: BLE001
            pass
    return default_actas_pct


def _extract_all_regions(page, actas_pct: float) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    region_select = page.locator("mat-select[formcontrolname='region']")
    if region_select.count() == 0:
        # Fallback para versiones antiguas con selector directo de departamento.
        dep_select = page.locator("mat-select[formcontrolname='department']")
        if dep_select.count() == 0:
            return out
        dep_options = _get_mat_options(page, "department")
        for dep in dep_options:
            if _is_placeholder(dep):
                continue
            _select_mat_option(page, "department", dep)
            _wait_region_load(page, timeout_ms=10000)
            reg = _extract_region_result(page, dep, actas_pct)
            if reg["partidos"]:
                out.append(reg)
        return out

    region_options = _get_mat_options(page, "region")
    # 1) Perú -> recorrer departamentos.
    if any(_norm_text(x) == "PERU" for x in region_options):
        _select_mat_option(page, "region", "PERÚ")
        _wait_region_load(page, timeout_ms=10000)
        dep_select = page.locator("mat-select[formcontrolname='department']")
        if dep_select.count() > 0:
            dep_options = _get_mat_options(page, "department")
            for dep in dep_options:
                if _is_placeholder(dep):
                    continue
                _select_mat_option(page, "department", dep)
                _wait_region_load(page, timeout_ms=10000)
                reg = _extract_region_result(page, dep, actas_pct)
                if reg["partidos"]:
                    out.append(reg)
        else:
            reg = _extract_region_result(page, "PERÚ", actas_pct)
            if reg["partidos"]:
                out.append(reg)

    # 2) Extranjero agregado.
    if any(_norm_text(x) == "EXTRANJERO" for x in region_options):
        _select_mat_option(page, "region", "EXTRANJERO")
        _wait_region_load(page, timeout_ms=10000)
        reg = _extract_region_result(page, "PERUANOS EN EL EXTRANJERO", actas_pct)
        if reg["partidos"]:
            out.append(reg)

    return out


def _get_mat_options(page, formcontrolname: str) -> list[str]:
    _close_overlays(page)
    sel = page.locator(f"mat-select[formcontrolname='{formcontrolname}']")
    if sel.count() == 0:
        return []
    sel.first.click()
    page.wait_for_selector("mat-option", timeout=10000)
    options = page.locator("mat-option .mdc-list-item__primary-text").all_inner_texts()
    _close_overlays(page)
    return [o.strip() for o in options if o and o.strip()]


def _select_mat_option(page, formcontrolname: str, option_text: str) -> None:
    _close_overlays(page)
    sel = page.locator(f"mat-select[formcontrolname='{formcontrolname}']")
    if sel.count() == 0:
        return
    sel.first.click()
    page.wait_for_selector("mat-option", timeout=10000)
    page.locator(f"mat-option:has-text('{option_text}')").first.click()
    _wait_selected_value(page, formcontrolname, option_text, timeout_ms=10000)
    _close_overlays(page)


def _is_placeholder(text: str) -> bool:
    n = _norm_text(text)
    return n in {"TODOS", "PERU", "EXTRANJERO", "REGION", "PROVINCIA", "DISTRITO"}


def _norm_text(text: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.upper().strip()


def _wait_selected_value(page, formcontrolname: str, expected: str, timeout_ms: int = 10000) -> None:
    import time

    expected_norm = _norm_text(expected)
    sel = page.locator(f"mat-select[formcontrolname='{formcontrolname}']")
    if sel.count() == 0:
        return
    end = time.time() + (timeout_ms / 1000)
    while time.time() < end:
        try:
            txt = sel.first.inner_text().strip()
            if expected_norm in _norm_text(txt):
                return
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(150)


def _close_overlays(page) -> None:
    # Cierra paneles overlay de Angular Material para evitar intercepción de clicks.
    try:
        page.keyboard.press("Escape")
    except Exception:  # noqa: BLE001
        pass


def _extract_party_logo_map(page) -> dict[str, str]:
    rows = page.evaluate(
        """() => {
            const cards=[...document.querySelectorAll('section.desplegable.full article.candidato')];
            return cards.map(c => {
                const p = c.querySelector('.nombre p');
                const logo = c.querySelector('.cont-info app-img .img img[alt=\"partidos\"], .cont-info .partido-logo img');
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
    try:
        page.locator("body").click(position={"x": 5, "y": 5}, timeout=1000)
    except Exception:  # noqa: BLE001
        pass


def _wait_region_load(page, timeout_ms: int = 10000) -> None:
    """Espera a que termine la carga al cambiar región, con timeout fijo por región."""
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:  # noqa: BLE001
        # Si networkidle no llega, continuamos y dejamos que la extracción valide contenido.
        pass
    try:
        page.wait_for_selector("section.desplegable.full article.candidato", timeout=timeout_ms)
    except Exception:  # noqa: BLE001
        pass


def _build_fallback_snapshot(data_dir: Path, source_url: str, warnings: list[str]) -> dict[str, object]:
    padron = parse_padron(data_dir / "padron.md")
    regiones = parse_regiones(data_dir / "regiones.md")
    partidos = parse_partidos_snapshot(data_dir / "partidos.md")
    partidos_votantes = parse_partidos_from_votantes(data_dir / "votantes.md")
    actas_pct = parse_actas_pct_from_votantes(data_dir / "votantes.md")

    progress_ratio = 0.4015  # derivado del plan: 27,325,432 total vs 16,358,290 faltante
    emitidos_ratio = 0.62

    valid_candidates = [p for p in partidos if not _is_blank_or_null(str(p.get("nombre", "")))]
    valid_total = sum(int(p.get("total_votos_validos", 0)) for p in valid_candidates if p.get("total_votos_validos"))
    valid_shares: list[dict[str, object]]
    if valid_total > 0:
        valid_shares = [
            {"nombre": str(p["nombre"]), "share": int(p.get("total_votos_validos", 0)) / valid_total}
            for p in valid_candidates
            if int(p.get("total_votos_validos", 0)) > 0
        ]
    else:
        candidates_from_votantes = [p for p in partidos_votantes if not p.get("es_blanco_o_nulo")]
        fallback_total = sum(int(p.get("votos", 0)) for p in candidates_from_votantes)
        if fallback_total > 0:
            valid_shares = [
                {"nombre": str(p["nombre"]), "share": int(p.get("votos", 0)) / fallback_total}
                for p in candidates_from_votantes
            ]
        else:
            valid_shares = [{"nombre": "SIN DATOS", "share": 1.0}]

    pct_blanco = _find_pct_emitidos(partidos, "VOTOS EN BLANCO", 0.0)
    pct_nulo = _find_pct_emitidos(partidos, "VOTOS NULOS", 0.0)
    if pct_blanco <= 0.0 or pct_nulo <= 0.0:
        votantes_tot = {normalize_name(str(p.get("nombre", ""))): int(p.get("votos", 0)) for p in partidos_votantes}
        b = votantes_tot.get(normalize_name("VOTOS EN BLANCO"), 0)
        n = votantes_tot.get(normalize_name("VOTOS NULOS"), 0)
        tot = sum(votantes_tot.values()) or 1
        if pct_blanco <= 0.0:
            pct_blanco = (b / tot) * 100.0
        if pct_nulo <= 0.0:
            pct_nulo = (n / tot) * 100.0
    if pct_blanco <= 0.0:
        pct_blanco = 15.309
    if pct_nulo <= 0.0:
        pct_nulo = 6.744

    padron_by_region = {normalize_name(name): count for name, count in padron.items()}
    out_regions: list[dict[str, object]] = []
    for r in regiones:
        reg = r["nombre"]
        norm = normalize_name(reg)
        padron_region = padron_by_region.get(norm, 0)
        if padron_region <= 0:
            continue
        emitidos_final = int(round(padron_region * emitidos_ratio))
        emitidos_actual = int(round(emitidos_final * progress_ratio))
        blancos = int(round(emitidos_actual * (pct_blanco / 100.0)))
        nulos = int(round(emitidos_actual * (pct_nulo / 100.0)))
        valid_pool = max(emitidos_actual - blancos - nulos, 0)

        part_rows = []
        for p in valid_shares:
            votes = int(round(valid_pool * p["share"]))
            part_rows.append({"nombre": p["nombre"], "votos": votes, "es_blanco_o_nulo": False})
        part_rows.append({"nombre": "VOTOS EN BLANCO", "votos": blancos, "es_blanco_o_nulo": True})
        part_rows.append({"nombre": "VOTOS NULOS", "votos": nulos, "es_blanco_o_nulo": True})

        out_regions.append(
            {
                "region": reg,
                "actas_pct": actas_pct,
                "emitidos_actual": emitidos_actual,
                "partidos": part_rows,
                "source": "fallback_sintetico",
            }
        )

    # Si existe padrón extranjero, agregarlo incluso si no está en regiones.md.
    ext_norm = normalize_name("Peruanos en el extranjero")
    if ext_norm in padron_by_region:
        pad = padron_by_region[ext_norm]
        emitidos_final = int(round(pad * emitidos_ratio))
        emitidos_actual = int(round(emitidos_final * progress_ratio))
        blancos = int(round(emitidos_actual * (pct_blanco / 100.0)))
        nulos = int(round(emitidos_actual * (pct_nulo / 100.0)))
        valid_pool = max(emitidos_actual - blancos - nulos, 0)
        part_rows = []
        for p in valid_shares:
            votes = int(round(valid_pool * p["share"]))
            part_rows.append({"nombre": p["nombre"], "votos": votes, "es_blanco_o_nulo": False})
        part_rows.append({"nombre": "VOTOS EN BLANCO", "votos": blancos, "es_blanco_o_nulo": True})
        part_rows.append({"nombre": "VOTOS NULOS", "votos": nulos, "es_blanco_o_nulo": True})
        out_regions.append(
            {
                "region": "PERUANOS EN EL EXTRANJERO",
                "actas_pct": actas_pct,
                "emitidos_actual": emitidos_actual,
                "partidos": part_rows,
                "source": "fallback_sintetico",
            }
        )

    return {
        "metadata": {
            "source_url": source_url,
            "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
            "actas_pct_global": actas_pct,
            "mode": "fallback",
            "warnings": warnings,
        },
        "regions": out_regions,
    }


def _is_blank_or_null(name: str) -> bool:
    n = normalize_name(name)
    return "BLANCO" in n or "NULO" in n


def _find_pct_emitidos(partidos: list[dict[str, object]], label: str, default: float) -> float:
    target = normalize_name(label)
    for p in partidos:
        if normalize_name(str(p.get("nombre", ""))) == target:
            val = p.get("pct_emitidos")
            if isinstance(val, (float, int)):
                return float(val)
    return default
