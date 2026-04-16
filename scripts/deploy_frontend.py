"""
Un solo paso: regenera frontend/dist desde el .env e instala por FTP.

Equivale a ejecutar build_frontend y luego deploy-frontend, pero el módulo
election_counter ya corre el build dentro de publish_frontend (un solo build).
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build de frontend/dist + deploy FTP (--env-file igual que deploy-frontend)."
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Ruta al .env (rutas relativas respecto al directorio actual)",
    )
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parent.parent
    env_path = Path(args.env_file)

    from election_counter.publish import publish_frontend

    publish_frontend(project_root, env_path=env_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
