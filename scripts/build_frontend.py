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
from pathlib import Path


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
    if dist.exists():
        shutil.rmtree(dist)
    dist.mkdir(parents=True, exist_ok=True)
    for item in src.rglob("*"):
        if item == dist or dist in item.parents:
            continue
        rel = item.relative_to(src)
        target = dist / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
    print(f"[build] copiado frontend/* -> {dist}")

    app_src = (src / "app.js").read_text(encoding="utf-8")
    app_out = app_src.replace('__BASE_URL__', f'"{base_url}"')
    (dist / "app.js").write_text(app_out, encoding="utf-8")
    print(f"[build] app.js -> BASE_URL={base_url}")

    ga_id = env.get("GA_ID", "").strip()
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

    print(f"[build] dist listo en: {dist}")


if __name__ == "__main__":
    build()
