"""
build_frontend.py — genera frontend/dist en runtime desde frontend/

Uso:
    python scripts/build_frontend.py

`frontend/` es la fuente de verdad en desarrollo.
Este script recrea `frontend/dist/` en cada ejecución, copia todo el contenido
de `frontend/` (excepto `frontend/dist/`) e inyecta BASE_URL en app.js.
También inserta el snippet de Google Analytics en index.html si existe GA_ID.
"""
from __future__ import annotations

import os
import re
import shutil
import json
from pathlib import Path


def generate_race_dummy(root: Path, dist: Path) -> None:
    raw_history = root / "outputs" / "raw_history"
    if not raw_history.exists():
        print("[build] race/dummy.json: outputs/raw_history no existe, omito")
        return
    snapshots = sorted(
        (p for p in raw_history.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    source = next(
        (s / "raw_region_results.json" for s in snapshots
         if (s / "raw_region_results.json").exists()),
        None,
    )
    if source is None:
        print("[build] race/dummy.json: ningún snapshot con raw_region_results.json")
        return
    target_dir = dist / "race"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "dummy.json"
    shutil.copy2(source, target)
    print(f"[build] race/dummy.json <- {source.relative_to(root)}")


def load_env(env_path: Path) -> dict[str, str]:
    loaded: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            loaded[key.strip()] = value.strip().strip("'").strip('"')
    for k, v in os.environ.items():
        loaded[k] = v
    return loaded


def build_ga_snippet(ga_id: str) -> str:
    return (
        "<!-- Google tag (gtag.js) -->\n"
        f'<script async src="https://www.googletagmanager.com/gtag/js?id={ga_id}"></script>\n'
        "<script>\n"
        "  window.dataLayer = window.dataLayer || [];\n"
        "  function gtag(){dataLayer.push(arguments);}\n"
        "  gtag('js', new Date());\n"
        f"  gtag('config', '{ga_id}');\n"
        "</script>"
    )


def build(project_root: Path | None = None) -> None:
    root = project_root or Path(__file__).resolve().parent.parent
    env = load_env(root / ".env")

    # Acepta WEB_BASE_URL o BASE_URL (fallback)
    base_url = (
        env.get("WEB_BASE_URL", "").strip()
        or env.get("BASE_URL", "").strip()
    ).rstrip("/")
    if not base_url:
        raise ValueError(
            "BASE_URL (o WEB_BASE_URL) no está definida en .env.\n"
            "Añade una línea como:\n"
            "  BASE_URL=https://perulainen.com/conteo-elecciones"
        )

    src = root / "frontend"
    dist = src / "dist"

    print(f"[build] eliminando dist existente: {dist}")
    if dist.exists():
        shutil.rmtree(dist)
        print("[build] dist eliminado")
    dist.mkdir(parents=True, exist_ok=True)
    print("[build] dist/ creado, copiando archivos...")

    parties_src = src / "assets" / "partidos"
    items_to_copy = [
        item for item in src.rglob("*")
        if item != dist
        and dist not in item.parents
        and item != parties_src
        and parties_src not in item.parents
    ]
    print(f"[build] {len(items_to_copy)} entradas a copiar")
    for item in items_to_copy:
        rel = item.relative_to(src)
        target = dist / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            print(f"[build]   copiando {rel}")
            shutil.copy2(item, target)
    print(f"[build] copiado frontend/* -> {dist}")

    public_parties_src = src / "assets" / "partidos"
    public_parties_dist = dist / "partidos"
    if public_parties_src.exists():
        print(f"[build] copiando partidos: {public_parties_src} -> {public_parties_dist}")
        if public_parties_dist.exists():
            shutil.rmtree(public_parties_dist)
        shutil.copytree(public_parties_src, public_parties_dist)
        print(f"[build] partidos públicos -> {public_parties_dist}")

    print("[build] procesando app.js...")
    app_src = (src / "app.js").read_text(encoding="utf-8")
    # Reemplazo robusto:
    # - Si el placeholder está entre comillas ('__BASE_URL__' o "__BASE_URL__"),
    #   inyectamos un literal JSON válido (comillas y escapes correctos).
    # - Fallback para placeholder sin comillas.
    app_out, replaced_count = re.subn(
        r"""(['"])__BASE_URL__\1""",
        json.dumps(base_url),
        app_src,
        count=1,
    )
    if replaced_count == 0:
        app_out, replaced_count = re.subn(r"__BASE_URL__", base_url, app_src, count=1)
    if replaced_count == 0:
        raise ValueError("No se encontró placeholder __BASE_URL__ en frontend/app.js")
    (dist / "app.js").write_text(app_out, encoding="utf-8")
    print(f"[build] app.js -> BASE_URL={base_url}")

    ga_id = env.get("GA_ID", "").strip()
    print(f"[build] procesando index.html (GA_ID={'definido' if ga_id else 'no definido'})...")
    index_dist = dist / "index.html"
    index_src = index_dist.read_text(encoding="utf-8")
    if ga_id:
        snippet = build_ga_snippet(ga_id)
        if "<!-- __GA_SNIPPET__ -->" in index_src:
            index_out = index_src.replace("<!-- __GA_SNIPPET__ -->", snippet)
        else:
            index_out = re.sub(r"</head>", f"{snippet}\n</head>", index_src, count=1, flags=re.IGNORECASE)
        print(f"[build] index.html -> GA_ID={ga_id}")
    else:
        index_out = index_src.replace("<!-- __GA_SNIPPET__ -->", "")
        print("[build] index.html -> GA_ID no definido (sin analytics)")
    index_dist.write_text(index_out, encoding="utf-8")

    generate_race_dummy(root, dist)

    print(f"[build] dist listo en: {dist}")


if __name__ == "__main__":
    build()
