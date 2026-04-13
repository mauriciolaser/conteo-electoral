from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone

from election_counter.utils import normalize_name, round_shares_to_total


def build_projection(raw: dict[str, object], padron: dict[str, int], margin: float = 0.05, top_n: int = 5) -> dict[str, object]:
    regions_in = raw.get("regions", [])
    metadata_in = raw.get("metadata", {})
    regions_out: list[dict[str, object]] = []

    base_party_totals: dict[str, int] = defaultdict(int)
    base_total_emitidos = 0
    extranjero_party_totals: dict[str, int] = defaultdict(int)
    extranjero_emitidos = 0

    for region in regions_in:
        region_name = str(region.get("region", "")).strip()
        norm = normalize_name(region_name)
        pad = padron.get(norm, 0)
        actas_pct = float(region.get("actas_pct", metadata_in.get("actas_pct_global", 0.0)) or 0.0)
        emitidos_actual = int(region.get("emitidos_actual", 0) or 0)
        partidos_in = region.get("partidos", [])

        estimated_emitidos = _estimate_emitidos_final(emitidos_actual, actas_pct, pad)
        base_votes = _project_base_votes(partidos_in, emitidos_actual, estimated_emitidos)

        region_party_rows = []
        for party_name, votes_base in base_votes.items():
            region_party_rows.append(
                {
                    "nombre": party_name,
                    "votos_actuales": _get_current_votes(partidos_in, party_name),
                    "votos_proyectados_base": votes_base,
                }
            )
            base_party_totals[party_name] += votes_base
        base_total_emitidos += estimated_emitidos

        if "EXTRANJERO" in norm:
            extranjero_emitidos += estimated_emitidos
            for k, v in base_votes.items():
                extranjero_party_totals[k] += v

        regions_out.append(
            {
                "region": region_name,
                "padron_electores": pad,
                "actas_pct": round(actas_pct, 3),
                "emitidos_actual": emitidos_actual,
                "estimado_emitidos_final": estimated_emitidos,
                "partidos": sorted(region_party_rows, key=lambda x: x["votos_proyectados_base"], reverse=True),
                "source": region.get("source", "unknown"),
            }
        )

    scenarios = _build_scenarios(base_party_totals, base_total_emitidos, margin, top_n)
    nacional_party_totals = dict(base_party_totals)
    nacional_emitidos = base_total_emitidos - extranjero_emitidos
    nacional_party_no_exterior = _subtract_totals(nacional_party_totals, extranjero_party_totals)

    output = {
        "metadata": {
            "source_url": metadata_in.get("source_url", ""),
            "extracted_at_utc": metadata_in.get("extracted_at_utc", datetime.now(timezone.utc).isoformat()),
            "projected_at_utc": datetime.now(timezone.utc).isoformat(),
            "actas_pct_global": float(metadata_in.get("actas_pct_global", 0.0) or 0.0),
            "margin": margin,
            "top_n": top_n,
            "warnings": metadata_in.get("warnings", []),
            "party_logos": metadata_in.get("party_logos", {}),
        },
        "regions": regions_out,
        "totals": {
            "nacional": {
                "emitidos_estimados": nacional_emitidos,
                "partidos": _to_party_list(nacional_party_no_exterior, nacional_emitidos),
            },
            "extranjero": {
                "emitidos_estimados": extranjero_emitidos,
                "partidos": _to_party_list(extranjero_party_totals, extranjero_emitidos),
            },
            "nacional_mas_extranjero": {
                "emitidos_estimados": base_total_emitidos,
                "partidos": _to_party_list(base_party_totals, base_total_emitidos),
            },
        },
        "scenarios": scenarios,
    }
    return output


def _estimate_emitidos_final(emitidos_actual: int, actas_pct: float, padron_region: int) -> int:
    if emitidos_actual <= 0:
        return 0
    estimated = emitidos_actual
    if actas_pct > 0:
        estimated = int(round(emitidos_actual / (actas_pct / 100.0)))
    if padron_region > 0:
        estimated = min(estimated, padron_region)
    return max(estimated, emitidos_actual)


def _project_base_votes(partidos: list[dict[str, object]], emitidos_actual: int, emitidos_final: int) -> dict[str, int]:
    current = {str(p.get("nombre", "")): int(p.get("votos", 0) or 0) for p in partidos if str(p.get("nombre", "")).strip()}
    if not current:
        return {}
    current_total = sum(current.values()) or max(emitidos_actual, 1)
    target_total = max(emitidos_final, current_total)
    scaled = {k: (v / current_total) * target_total for k, v in current.items()}
    return round_shares_to_total(scaled, target_total)


def _get_current_votes(partidos: list[dict[str, object]], party_name: str) -> int:
    for p in partidos:
        if str(p.get("nombre", "")) == party_name:
            return int(p.get("votos", 0) or 0)
    return 0


def _build_scenarios(base_party_totals: dict[str, int], total_emitidos: int, margin: float, top_n: int) -> dict[str, object]:
    base = deepcopy(base_party_totals)
    top = _top_candidate_parties(base, top_n)
    conservador = _apply_margin(base, top, -abs(margin), total_emitidos)
    optimista = _apply_margin(base, top, abs(margin), total_emitidos)
    return {
        "base": {"margen": 0.0, "partidos": _to_party_list(base, total_emitidos)},
        "conservador": {"margen": -abs(margin), "partidos": _to_party_list(conservador, total_emitidos)},
        "optimista": {"margen": abs(margin), "partidos": _to_party_list(optimista, total_emitidos)},
    }


def _top_candidate_parties(totals: dict[str, int], top_n: int) -> list[str]:
    candidates = [(k, v) for k, v in totals.items() if not _is_blank_or_null(k)]
    candidates.sort(key=lambda x: x[1], reverse=True)
    return [name for name, _ in candidates[: max(1, top_n)]]


def _apply_margin(base: dict[str, int], top_parties: list[str], margin: float, total_emitidos: int) -> dict[str, int]:
    adjusted = {k: float(v) for k, v in base.items()}
    fixed = {k: v for k, v in adjusted.items() if _is_blank_or_null(k)}
    candidates = {k: v for k, v in adjusted.items() if not _is_blank_or_null(k)}

    for name in top_parties:
        if name in candidates:
            candidates[name] = max(candidates[name] * (1.0 + margin), 0.0)

    target_candidates_total = max(total_emitidos - int(sum(fixed.values())), 0)
    current_candidates_sum = sum(candidates.values()) or 1.0
    scaled_candidates = {k: (v / current_candidates_sum) * target_candidates_total for k, v in candidates.items()}
    rounded_candidates = round_shares_to_total(scaled_candidates, target_candidates_total)
    merged = {**{k: int(v) for k, v in fixed.items()}, **rounded_candidates}
    return merged


def _to_party_list(totals: dict[str, int], total_emitidos: int | None = None) -> list[dict[str, object]]:
    denom = max(int(total_emitidos or 0), 1)
    rows = []
    for k, v in sorted(totals.items(), key=lambda x: x[1], reverse=True):
        vv = int(v)
        rows.append(
            {
                "nombre": k,
                "votos": vv,
                "porcentaje_emitidos": (vv / denom) * 100.0,
            }
        )
    return rows


def _subtract_totals(a: dict[str, int], b: dict[str, int]) -> dict[str, int]:
    out = {k: int(v) for k, v in a.items()}
    for k, v in b.items():
        out[k] = int(out.get(k, 0) - v)
    return {k: v for k, v in out.items() if v != 0}


def _is_blank_or_null(name: str) -> bool:
    n = normalize_name(name)
    return "BLANCO" in n or "NULO" in n
