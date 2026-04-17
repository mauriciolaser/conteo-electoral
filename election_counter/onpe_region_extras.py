"""Campos extra por región desde totales ONPE (JEE/JNE) y señales para escenarios de impugnadas."""

from __future__ import annotations

from election_counter.utils import normalize_name

_TOTAL_MESAS_KEYS: tuple[str, ...] = (
    "totalMesas",
    "mesasTotales",
    "mesasTotal",
    "totalActas",
    "actasTotales",
    "mesasInstaladas",
    "totalMesasInstaladas",
    "cantidadMesas",
    "nroMesas",
    "mesas",
)


def _as_int(value: object) -> int:
    if value is None:
        return 0
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def _total_mesas_from_totales(tot: dict[str, object]) -> int | None:
    """Total de mesas/actas para prorrateo. No usa actasContabilizadas: en ONPE suele ser porcentaje, no conteo."""
    for key in _TOTAL_MESAS_KEYS:
        if key not in tot:
            continue
        v = tot.get(key)
        try:
            n = int(round(float(v)))
            if n > 0:
                return n
        except (TypeError, ValueError):
            continue
    env = _as_int(tot.get("enviadasJee"))
    pen = _as_int(tot.get("pendientesJee"))
    if env + pen > 0:
        return max(env + pen, 1)
    return None


def sanchez_leads_vs_renovacion(partidos: list[dict[str, object]]) -> bool:
    """True si Juntos por el Perú supera a Renovación Popular en votos válidos de la fila."""
    by_norm: dict[str, int] = {}
    for p in partidos:
        if not isinstance(p, dict):
            continue
        if p.get("es_blanco_o_nulo"):
            continue
        name = str(p.get("nombre", "")).strip()
        if not name or normalize_name(name) == normalize_name("AJUSTE"):
            continue
        by_norm[normalize_name(name)] = int(p.get("votos", 0) or 0)

    sj = by_norm.get(normalize_name("JUNTOS POR EL PERÚ"), 0) or by_norm.get(
        normalize_name("JUNTOS POR EL PERU"), 0
    )
    rp = by_norm.get(normalize_name("RENOVACIÓN POPULAR"), 0) or by_norm.get(
        normalize_name("RENOVACION POPULAR"), 0
    )
    if sj == 0 and rp == 0:
        return False
    return sj > rp


def jee_summary_from_totales(tot: dict[str, object]) -> dict[str, object]:
    """Bloque JEE/JNE alineado a planning/jne.md (totales por región)."""
    env = _as_int(tot.get("enviadasJee"))
    pen = _as_int(tot.get("pendientesJee"))
    emitidos = _as_int(tot.get("totalVotosEmitidos"))
    mesas_total = _total_mesas_from_totales(tot)

    votos_revision = 0
    votos_pendientes = 0
    prorrateo = "sin_total_mesas"
    if mesas_total and mesas_total > 0 and emitidos >= 0:
        votos_revision = int(round(emitidos * env / mesas_total))
        votos_pendientes = int(round(emitidos * pen / mesas_total))
        prorrateo = "totalVotosEmitidos_por_acta_sobre_total_mesas"

    return {
        "enviadas_jee_actas": env,
        "pendientes_jee_actas": pen,
        "total_mesas_o_actas": mesas_total,
        "votos_revision_jne": votos_revision,
        "votos_pendientes_contar": votos_pendientes,
        "prorrateo": prorrateo,
    }


def impugnadas_summary_from_row(
    *,
    region_name: str,
    ubigeo: str | None,
    partidos: list[dict[str, object]],
    tot: dict[str, object],
) -> dict[str, object]:
    """Señales para planning/impugnadas.md (escenarios rural / Lima)."""
    jee = jee_summary_from_totales(tot)
    votos_revision_jne = _as_int(jee.get("votos_revision_jne"))
    votos_pendientes_contar = _as_int(jee.get("votos_pendientes_contar"))
    has_jee_votes = (votos_revision_jne > 0) or (votos_pendientes_contar > 0)
    return {
        "region": region_name,
        "ubigeo_departamento": ubigeo,
        "sanchez_lidera_sobre_renovacion": sanchez_leads_vs_renovacion(partidos),
        "es_lima_departamento": ubigeo == "140000",
        # Impugnadas para proyección: usar votos en revisión JNE.
        "mesas_impugnadas": 0,
        "votos_impugnados": votos_revision_jne,
        # Exponer también pendientes (no impugnados) porque son relevantes para análisis.
        "votos_pendientes_contar": votos_pendientes_contar,
        "fuente_agregado": "jee_totales_onpe" if has_jee_votes else "jee_sin_datos",
    }


def enrich_region_onpe_totales(
    row: dict[str, object],
    totales_payload: dict[str, object],
    *,
    ubigeo: str | None,
) -> dict[str, object]:
    tot = totales_payload.get("data") if isinstance(totales_payload.get("data"), dict) else {}
    out = dict(row)
    if ubigeo is not None:
        out["ubigeo"] = ubigeo
    out["jee"] = jee_summary_from_totales(tot)
    out["impugnadas"] = impugnadas_summary_from_row(
        region_name=str(out.get("region", "")),
        ubigeo=ubigeo,
        partidos=list(out.get("partidos", []) or []),
        tot=tot,
    )
    return out


def empty_jee_block() -> dict[str, object]:
    return {
        "enviadas_jee_actas": 0,
        "pendientes_jee_actas": 0,
        "total_mesas_o_actas": None,
        "votos_revision_jne": 0,
        "votos_pendientes_contar": 0,
        "prorrateo": "fallback_sin_onpe",
    }


def empty_impugnadas_block(
    *,
    region_name: str,
    ubigeo: str | None,
    partidos: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "region": region_name,
        "ubigeo_departamento": ubigeo,
        "sanchez_lidera_sobre_renovacion": sanchez_leads_vs_renovacion(partidos),
        "es_lima_departamento": ubigeo == "140000",
        "mesas_impugnadas": 0,
        "votos_impugnados": 0,
        "votos_pendientes_contar": 0,
        "fuente_agregado": "fallback_sin_onpe",
    }
