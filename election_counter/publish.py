from __future__ import annotations

import json
import os
from datetime import datetime
from ftplib import FTP
from io import BytesIO
from pathlib import Path


def publish_frontend(project_root: Path, env_path: Path | None = None) -> None:
    """Regenera frontend/dist en runtime desde frontend/ y lo sube a DEPLOY_FRONTEND."""
    import sys
    sys.path.insert(0, str(project_root / "scripts"))
    try:
        from build_frontend import build as _build  # type: ignore[import]
        _build(project_root=project_root)
    except Exception as exc:
        print(f"[publish] frontend build error: {exc}")
        return

    env = _load_env_file(env_path or project_root / ".env")
    dist_dir = project_root / "frontend" / "dist"
    if not dist_dir.exists():
        print(f"[publish] frontend dist no existe: {dist_dir}")
        return

    dest = env.get("DEPLOY_FRONTEND", "").strip()
    if not dest:
        print("[publish] DEPLOY_FRONTEND no definido en .env — deploy omitido")
        return

    print(f"[publish] conectando FTP a {env.get('FTP_HOST', '?')}...")
    ftp = _ftp_connect(env)
    print("[publish] FTP conectado")
    base = _to_remote_dir(dest)
    all_files = [item for item in sorted(dist_dir.rglob("*")) if not item.is_dir()]
    total = len(all_files)
    uploaded = skipped = 0
    try:
        for i, item in enumerate(all_files, 1):
            rel = item.relative_to(dist_dir).as_posix()
            remote = f"{base}/{rel}" if base else rel
            print(f"[publish] ({i}/{total}) {rel}")
            if _ftp_upload(ftp, item, remote):
                uploaded += 1
            else:
                skipped += 1
    finally:
        ftp.quit()

    print(f"[publish] frontend OK: {uploaded} subidos, {skipped} sin cambios -> {base}")


def publish_raw_history(output_dir: Path, env_path: Path | None = None) -> None:
    """Sube raw_history/ e history_bundle.json bajo DEPLOY_FRONTEND en el servidor.

    Estructura publicada:
      <BASE_URL>/raw_history/<timestamp>/raw_region_results.json  ← archivos individuales
      <BASE_URL>/history_bundle.json                              ← bundle consolidado (nuevo)
      <BASE_URL>/history_index.json                               ← índice legacy (compatibilidad)

    El cliente usa history_bundle.json como fuente primaria: un único request
    trae todos los snapshots filtrados (uno por bucket de 30 min), eliminando
    la tormenta de requests paralelos que causaba errores 429.

    history_index.json se mantiene para compatibilidad con clientes antiguos
    que puedan estar cacheados en el navegador.
    """
    env = _load_env_file(env_path or Path(".env"))
    local_history_root = output_dir / "raw_history"
    if not local_history_root.exists():
        print(f"[publish] omitido: no existe {local_history_root}")
        return

    dest = env.get("DEPLOY_FRONTEND", "").strip()
    if not dest:
        print("[publish] DEPLOY_FRONTEND no definido en .env — raw_history omitido")
        return

    ftp = _ftp_connect(env)
    base = _to_remote_dir(dest)
    remote_root = f"{base}/raw_history" if base else "raw_history"
    uploaded = skipped = 0
    try:
        for item in sorted(local_history_root.rglob("*")):
            if item.is_dir():
                continue
            rel = item.relative_to(local_history_root).as_posix()
            if _ftp_upload(ftp, item, f"{remote_root}/{rel}"):
                uploaded += 1
            else:
                skipped += 1

        # Calcular timestamps filtrados (un snapshot por bucket de 30 min)
        all_timestamps = sorted(
            d.name
            for d in local_history_root.iterdir()
            if d.is_dir() and (d / "raw_region_results.json").exists()
        )
        timestamps = _filter_half_hour_timestamps(all_timestamps)

        # ── history_bundle.json ───────────────────────────────────────────────
        # Archivo consolidado: contiene todos los payloads filtrados en un solo
        # objeto JSON. El cliente hace 1 request en lugar de N.
        # Estructura: { "snapshots": [ <payload>, ... ] }  (orden cronológico)
        snapshots_data = []
        for ts in timestamps:
            snapshot_file = local_history_root / ts / "raw_region_results.json"
            try:
                payload = json.loads(snapshot_file.read_text(encoding="utf-8"))
                snapshots_data.append(payload)
            except Exception as exc:
                print(f"[publish] advertencia: no se pudo leer {snapshot_file}: {exc}")
        bundle_bytes = json.dumps({"snapshots": snapshots_data}, ensure_ascii=False).encode("utf-8")
        bundle_remote = f"{base}/history_bundle.json" if base else "history_bundle.json"
        _ftp_upload_bytes(ftp, bundle_bytes, bundle_remote)

        # Guardar copia local en output_dir para inspección
        local_bundle = output_dir / "history_bundle.json"
        local_bundle.write_bytes(bundle_bytes)

        # ── history_index.json (legacy) ───────────────────────────────────────
        # Se mantiene para que clientes con versiones anteriores cacheadas en el
        # navegador no queden rotos. Puede eliminarse en el futuro.
        index_bytes = json.dumps({"timestamps": timestamps}, ensure_ascii=False).encode("utf-8")
        _ftp_upload_bytes(ftp, index_bytes, f"{base}/history_index.json" if base else "history_index.json")
    finally:
        ftp.quit()

    print(f"[publish] raw_history OK: {uploaded} subidos, {skipped} sin cambios -> {remote_root}")
    print(f"[publish] history_bundle.json: {len(snapshots_data)}/{len(all_timestamps)} snapshots ({len(bundle_bytes):,} bytes)")
    print(f"[publish] history_index.json: {len(timestamps)}/{len(all_timestamps)} snapshots (legacy)")


# ── helpers ──────────────────────────────────────────────────────────────────

def _filter_half_hour_timestamps(timestamps: list[str]) -> list[str]:
    """Devuelve un snapshot por bucket de 30 minutos (el más reciente de cada ventana).

    Formato esperado: YYYYMMDD_HHMMSS (ej. 20260414_114625).
    Timestamps que no coincidan con el formato se descartan.
    """
    buckets: dict[int, str] = {}
    for ts in timestamps:
        try:
            dt = datetime.strptime(ts, "%Y%m%d_%H%M%S")
        except ValueError:
            continue
        # Bucket = minutos totales desde epoch redondeados a 30
        bucket = int(dt.timestamp()) // 1800
        # Conservar el más reciente dentro del bucket
        if bucket not in buckets or ts > buckets[bucket]:
            buckets[bucket] = ts
    return sorted(buckets.values())


def _ftp_connect(env: dict[str, str]) -> FTP:
    host = env.get("FTP_HOST", "").strip()
    user = env.get("FTP_USER", "").strip()
    password = env.get("FTP_PASSWORD", "").strip()
    port = int(env.get("FTP_PORT", "21").strip() or "21")
    if not all([host, user, password]):
        raise RuntimeError("FTP_HOST, FTP_USER y FTP_PASSWORD deben estar definidos en .env")
    ftp = FTP()
    ftp.connect(host=host, port=port, timeout=30)
    ftp.login(user=user, passwd=password)
    return ftp


def _ftp_remote_size(ftp: FTP, remote: str) -> int | None:
    """Devuelve el tamaño del archivo remoto, o None si no existe."""
    try:
        return ftp.size(remote)
    except Exception:  # noqa: BLE001
        return None


def _ftp_upload(ftp: FTP, local: Path, remote: str) -> bool:
    """Sube local a remote solo si el tamaño difiere. Devuelve True si subió."""
    local_size = local.stat().st_size
    remote_size = _ftp_remote_size(ftp, remote)
    if remote_size == local_size:
        print(f"[ftp]   skip {remote!r} ({local_size} bytes, sin cambios)")
        return False
    print(f"[ftp]   ensure_parent {remote!r}...")
    _ftp_ensure_parent(ftp, remote)
    parent, name = remote.rsplit("/", 1) if "/" in remote else ("", remote)
    cwd = ftp.pwd()
    try:
        if parent:
            ftp.cwd(parent)
        print(f"[ftp]   STOR {name!r} ({local_size} bytes, remoto era {remote_size})...")
        with local.open("rb") as fh:
            ftp.storbinary(f"STOR {name}", fh)
        print(f"[ftp]   OK {name!r}")
    finally:
        ftp.cwd(cwd)
    return True


def _ftp_upload_bytes(ftp: FTP, data: bytes, remote: str) -> None:
    _ftp_ensure_parent(ftp, remote)
    parent, name = remote.rsplit("/", 1) if "/" in remote else ("", remote)
    cwd = ftp.pwd()
    try:
        if parent:
            ftp.cwd(parent)
        ftp.storbinary(f"STOR {name}", BytesIO(data))
    finally:
        ftp.cwd(cwd)


def _ftp_ensure_parent(ftp: FTP, remote: str) -> None:
    parent = remote.rsplit("/", 1)[0] if "/" in remote else ""
    if not parent:
        return
    cwd = ftp.pwd()
    try:
        for part in [p for p in parent.split("/") if p]:
            try:
                ftp.cwd(part)
            except Exception:  # noqa: BLE001
                ftp.mkd(part)
                ftp.cwd(part)
    finally:
        ftp.cwd(cwd)


def _to_remote_dir(destination: str) -> str:
    return destination.strip().replace("\\", "/").strip("/")


def _load_env_file(path: Path) -> dict[str, str]:
    loaded: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key:
                loaded[key] = value
    for key, value in os.environ.items():
        loaded[key] = value
    return loaded
