from __future__ import annotations

import re
import unicodedata


def normalize_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"\s+", " ", s).strip().upper()
    return s


def parse_int(value: str, default: int = 0) -> int:
    if value is None:
        return default
    m = re.findall(r"\d+", str(value))
    if not m:
        return default
    return int("".join(m))


def parse_float(value: str, default: float = 0.0) -> float:
    if value is None:
        return default
    s = str(value).strip().replace("%", "")
    s = s.replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return default
    try:
        return float(m.group(0))
    except ValueError:
        return default


def round_shares_to_total(values: dict[str, float], target_total: int) -> dict[str, int]:
    if target_total <= 0:
        return {k: 0 for k in values}
    floors: dict[str, int] = {}
    remainders: list[tuple[str, float]] = []
    running = 0
    for key, val in values.items():
        floored = int(val)
        floors[key] = floored
        running += floored
        remainders.append((key, val - floored))
    diff = target_total - running
    remainders.sort(key=lambda x: x[1], reverse=True)
    for i in range(max(diff, 0)):
        floors[remainders[i % len(remainders)][0]] += 1
    return floors
