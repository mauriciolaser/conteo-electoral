from __future__ import annotations

import csv
import re
from pathlib import Path

from election_counter.utils import normalize_name, parse_float, parse_int


def parse_padron(path: Path) -> dict[str, int]:
    rows = path.read_text(encoding="utf-8").splitlines()
    data_lines = [line for line in rows if "," in line and not line.lower().startswith("region,electores")]
    out: dict[str, int] = {}
    for row in csv.reader(data_lines):
        if len(row) != 2:
            continue
        region, electores = row
        out[normalize_name(region)] = parse_int(electores)
    return out


def parse_regiones(path: Path) -> list[dict[str, str]]:
    text = path.read_text(encoding="utf-8")
    matches = re.findall(r'\{ubigeo:\s*"([^"]+)",\s*nombre:\s*"([^"]+)"\}', text)
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for ubigeo, nombre in matches:
        if ubigeo in seen:
            continue
        seen.add(ubigeo)
        out.append({"ubigeo": ubigeo, "nombre": nombre})
    return out


def parse_partidos_snapshot(path: Path) -> list[dict[str, object]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    out: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for raw in lines:
        line = raw.strip()
        if line.startswith("nombreAgrupacionPolitica"):
            if current:
                out.append(current)
            current = {"nombre": line.split(":")[-1].strip().strip('"')}
        elif current and line.startswith("codigoAgrupacionPolitica"):
            current["codigo"] = line.split(":")[-1].strip().strip('"')
        elif current and line.startswith("porcentajeVotosEmitidos"):
            current["pct_emitidos"] = parse_float(line.split(":")[-1])
        elif current and line.startswith("porcentajeVotosValidos"):
            current["pct_validos"] = parse_float(line.split(":")[-1])
        elif current and line.startswith("totalVotosValidos"):
            current["total_votos_validos"] = parse_int(line.split(":")[-1])
    if current:
        out.append(current)
    return out


def parse_actas_pct_from_votantes(path: Path) -> float:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"Actas contabilizadas.*?<b>\s*([\d.,]+)\s*%</b>", text, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return 0.0
    return parse_float(m.group(1))


def parse_partidos_from_votantes(path: Path) -> list[dict[str, object]]:
    text = path.read_text(encoding="utf-8")
    out: list[dict[str, object]] = []
    # Bloques de partidos con cantidad de votos.
    patt = re.compile(
        r'<section[^>]*class="desplegable full"[\s\S]*?<p[^>]*>\s*([^<]+?)\s*</p>[\s\S]*?Cantidad de votos:\s*</span><span[^>]*>\s*([\d,]+)\s*</span>',
        flags=re.IGNORECASE,
    )
    seen: set[str] = set()
    for m in patt.finditer(text):
        party = m.group(1).strip()
        votes = parse_int(m.group(2))
        key = normalize_name(party)
        if not party or key in seen:
            continue
        seen.add(key)
        out.append({"nombre": party, "votos": votes, "es_blanco_o_nulo": False})

    # Blancos y nulos.
    for label in ["VOTOS EN BLANCO", "VOTOS NULOS"]:
        m = re.search(
            rf"<h3>\s*{re.escape(label)}\s*</h3>[\s\S]*?titulo_votos_totales__num2\">\s*([\d,]+)\s*<",
            text,
            flags=re.IGNORECASE,
        )
        if m:
            out.append(
                {
                    "nombre": label,
                    "votos": parse_int(m.group(1)),
                    "es_blanco_o_nulo": True,
                }
            )
    return out
