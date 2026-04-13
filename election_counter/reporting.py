from __future__ import annotations

import json
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen

from election_counter.utils import normalize_name


PARTY_COLOR_OVERRIDES: tuple[tuple[str, str], ...] = (
    ("RENOVACION POPULAR", "#0057b8"),  # Lopez Aliaga / azul
    ("LOPEZ ALIAGA", "#0057b8"),        # azul
    ("FUERZA POPULAR", "#ff8c00"),      # Keiko / naranja
    ("KEIKO", "#ff8c00"),               # naranja
    ("PARTIDO CIVICO OBRAS", "#006400"),  # verde oscuro
    ("OBRAS", "#006400"),               # verde oscuro
    ("JUNTOS POR EL PERU", "#32cd32"),  # verde limon
    ("PARTIDO DEL BUEN GOBIERNO", "#ffd700"),  # amarillo
    ("BUEN GOBIERNO", "#ffd700"),       # amarillo
    ("PARTIDO PAIS PARA TODOS", "#000000"),  # negro
    ("PAIS PARA TODOS", "#000000"),     # negro
)


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_raw_history_snapshot(
    raw_payload: dict[str, object],
    history_root: Path,
) -> Path:
    meta = raw_payload.get("metadata", {}) or {}
    extracted = str(meta.get("extracted_at_utc", "")).strip()
    ts_label = _timestamp_label(extracted)
    target_dir = history_root / ts_label
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / "raw_region_results.json"
    target_path.write_text(json.dumps(raw_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return target_path


def build_markdown_summary(projection: dict[str, object]) -> str:
    md = []
    meta = projection.get("metadata", {})
    totals = projection.get("totals", {})
    scenarios = projection.get("scenarios", {})

    md.append("# Proyección Electoral ONPE")
    md.append("")
    md.append(f"- Fuente: {meta.get('source_url', '')}")
    md.append(f"- Extraído (UTC): {meta.get('extracted_at_utc', '')}")
    md.append(f"- Proyectado (UTC): {meta.get('projected_at_utc', '')}")
    md.append(f"- Actas contabilizadas global: {meta.get('actas_pct_global', 0):.3f}%")
    md.append(f"- Margen escenarios: {meta.get('margin', 0):.3%}")
    md.append("")

    nat = totals.get("nacional", {})
    ext = totals.get("extranjero", {})
    nat_ext = totals.get("nacional_mas_extranjero", {})
    md.append("## Totales Estimados")
    md.append("")
    md.append(f"- Nacional: {nat.get('emitidos_estimados', 0):,} votos emitidos estimados")
    md.append(f"- Extranjero: {ext.get('emitidos_estimados', 0):,} votos emitidos estimados")
    md.append(f"- Nacional + Extranjero: {nat_ext.get('emitidos_estimados', 0):,} votos emitidos estimados")
    md.append("")

    md.append("## Top 10 - Escenario Base (Nacional + Extranjero)")
    md.append("")
    base_parties = scenarios.get("base", {}).get("partidos", [])[:10]
    for i, p in enumerate(base_parties, start=1):
        md.append(f"{i}. {p.get('nombre', '')}: {int(p.get('votos', 0)):,}")
    md.append("")

    md.append("## Escenarios")
    md.append("")
    for key in ["conservador", "base", "optimista"]:
        sc = scenarios.get(key, {})
        parties = sc.get("partidos", [])[:5]
        margin = sc.get("margen", 0)
        md.append(f"### {key.capitalize()} (margen {margin:+.2%})")
        for i, p in enumerate(parties, start=1):
            md.append(f"{i}. {p.get('nombre', '')}: {int(p.get('votos', 0)):,}")
        md.append("")

    warnings = meta.get("warnings", []) or []
    if warnings:
        md.append("## Warnings")
        md.append("")
        for w in warnings:
            md.append(f"- {w}")
        md.append("")

    return "\n".join(md).strip() + "\n"


def build_scenarios_table_markdown(projection: dict[str, object]) -> str:
    scenarios = projection.get("scenarios", {})
    md: list[str] = []
    md.append("# Tabla de Escenarios (Proyección al 100%)")
    md.append("")
    md.append("Porcentaje calculado sobre votos emitidos proyectados nacionales + extranjero.")
    md.append("")
    for key in ["conservador", "base", "optimista"]:
        sc = scenarios.get(key, {})
        margin = sc.get("margen", 0.0)
        parties = sc.get("partidos", [])
        candidates = [p for p in parties if not _is_blank_or_null(str(p.get("nombre", "")))]
        md.append(f"## Escenario {key.capitalize()} ({margin:+.2%})")
        md.append("")
        md.append("| Candidato / Lista | Votos proyectados | % total proyectado |")
        md.append("|---|---:|---:|")
        for p in candidates:
            votos = int(p.get("votos", 0))
            pct = float(p.get("porcentaje_emitidos", 0.0))
            md.append(f"| {p.get('nombre','')} | {votos:,} | {pct:.3f}% |")
        md.append("")
    return "\n".join(md).strip() + "\n"


def _is_blank_or_null(name: str) -> bool:
    n = normalize_name(name)
    return "BLANCO" in n or "NULO" in n


def build_base_scenario_chart(projection: dict[str, object], output_path: Path) -> None:
    import matplotlib.pyplot as plt
    from PIL import Image

    meta = projection.get("metadata", {})
    source_url = str(meta.get("source_url", "https://resultadoelectoral.onpe.gob.pe/main/presidenciales"))
    party_logos: dict[str, str] = meta.get("party_logos", {}) or {}
    base_rows = projection.get("scenarios", {}).get("base", {}).get("partidos", []) or []
    candidates = [r for r in base_rows if not _is_blank_or_null(str(r.get("nombre", "")))]
    candidates.sort(key=lambda x: int(x.get("votos", 0)), reverse=True)

    labels = [str(r.get("nombre", "")) for r in candidates]
    pcts = [float(r.get("porcentaje_emitidos", 0.0)) for r in candidates]

    palette = [
        "#1f77b4",
        "#ff7f0e",
        "#2ca02c",
        "#d62728",
        "#9467bd",
        "#8c564b",
        "#e377c2",
        "#7f7f7f",
        "#bcbd22",
        "#17becf",
    ]

    colors = []
    for idx, party in enumerate(labels):
        color = _party_color_override(party)
        if not color:
            logo = party_logos.get(party, "")
            if logo:
                full_logo = urljoin(source_url, logo)
                color = _dominant_color_from_image(full_logo, Image)
            else:
                color = ""
        if not color:
            color = palette[idx % len(palette)]
        colors.append(color)

    height = max(9, int(len(labels) * 0.38))
    fig, ax = plt.subplots(figsize=(14, height))
    y = list(range(len(labels)))[::-1]
    bars = ax.barh(y, pcts, color=colors, edgecolor="#1f1f1f", linewidth=0.3)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=8)
    ax.set_xlabel("% del total proyectado (Escenario Base)")
    ax.set_title("Proyección Escenario Base - Candidatos (colores de logos oficiales ONPE)")
    ax.grid(axis="x", alpha=0.25)

    for bar, pct in zip(bars, pcts):
        ax.text(
            bar.get_width() + 0.05,
            bar.get_y() + bar.get_height() / 2,
            f"{pct:.2f}%",
            va="center",
            fontsize=7,
        )

    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def build_national_trend_chart(history_root: Path, output_path: Path, top_n: int = 5) -> None:
    import matplotlib.pyplot as plt

    snapshots = _load_history_snapshots(history_root)
    if len(snapshots) < 2:
        return

    latest_totals = snapshots[-1]["totals"]
    top_candidates = [
        name
        for name, _ in sorted(latest_totals.items(), key=lambda kv: kv[1], reverse=True)
        if not _is_special_bucket(name)
    ][:top_n]
    if not top_candidates:
        return

    xs = [s["dt"] for s in snapshots]
    fig, ax = plt.subplots(figsize=(14, 7))
    for name in top_candidates:
        ys = [s["totals"].get(name, 0) for s in snapshots]
        line_kwargs = {"marker": "o", "linewidth": 2, "label": name}
        fixed_color = _party_color_override(name)
        if fixed_color:
            line_kwargs["color"] = fixed_color
        ax.plot(xs, ys, **line_kwargs)

    ax.set_title("Tendencia nacional por timestamp (votos contabilizados)")
    ax.set_xlabel("Timestamp de extracción")
    ax.set_ylabel("Votos contabilizados")
    ax.grid(alpha=0.25)
    ax.legend(fontsize=8, ncol=2)
    fig.autofmt_xdate()
    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def _dominant_color_from_image(url: str, image_mod) -> str:
    try:
        with urlopen(url, timeout=20) as resp:
            data = resp.read()
        img = image_mod.open(BytesIO(data)).convert("RGB").resize((64, 64))
        pixels = list(img.getdata())
        # Excluir tonos casi blancos y casi negros para evitar fondos.
        filtered = [
            p
            for p in pixels
            if not (p[0] > 240 and p[1] > 240 and p[2] > 240)
            and not (p[0] < 20 and p[1] < 20 and p[2] < 20)
        ]
        if not filtered:
            filtered = pixels
        # Cuantización simple por bins para estabilidad.
        bins: dict[tuple[int, int, int], int] = {}
        for r, g, b in filtered:
            key = (int(r / 16) * 16, int(g / 16) * 16, int(b / 16) * 16)
            bins[key] = bins.get(key, 0) + 1
        (r, g, b), _ = max(bins.items(), key=lambda kv: kv[1])
        # Evitar devolver un azul institucional único para todo cuando no aporta contraste.
        if (r, g, b) == (0, 48, 112) or (r, g, b) == (0, 64, 112):
            return ""
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:  # noqa: BLE001
        return ""


def _party_color_override(name: str) -> str:
    n = normalize_name(name)
    for token, color in PARTY_COLOR_OVERRIDES:
        if token in n:
            return color
    return ""


def _timestamp_label(extracted_at_utc: str) -> str:
    try:
        dt = datetime.fromisoformat(extracted_at_utc.replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        dt = datetime.utcnow()
    return dt.strftime("%Y%m%d_%H%M%S")


def _load_history_snapshots(history_root: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if not history_root.exists():
        return rows
    for d in sorted(p for p in history_root.iterdir() if p.is_dir()):
        f = d / "raw_region_results.json"
        if not f.exists():
            continue
        try:
            payload = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        meta = payload.get("metadata", {}) or {}
        ts = str(meta.get("extracted_at_utc", "")).strip()
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            # fallback: parse folder name
            try:
                dt = datetime.strptime(d.name, "%Y%m%d_%H%M%S")
            except Exception:  # noqa: BLE001
                continue

        totals: dict[str, int] = {}
        for r in payload.get("regions", []) or []:
            for p in r.get("partidos", []) or []:
                name = str(p.get("nombre", "")).strip()
                if not name:
                    continue
                totals[name] = totals.get(name, 0) + int(p.get("votos", 0) or 0)
        rows.append({"dt": dt, "totals": totals})
    rows.sort(key=lambda x: x["dt"])
    return rows


def _is_special_bucket(name: str) -> bool:
    n = normalize_name(name)
    return (
        "BLANCO" in n
        or "NULO" in n
        or "VICIADO" in n
        or "IMPUGN" in n
        or n == "AJUSTE"
    )
