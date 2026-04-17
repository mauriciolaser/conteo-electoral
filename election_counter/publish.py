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

        _build(project_root=project_root, env_path=env_path or (project_root / ".env"))
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
    ftp = _ftp_connect(_build_ftp_env_from_prefix(env, prefix="FTP"))
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


def _default_project_env_path() -> Path:
    return Path(__file__).resolve().parent.parent / ".env"


def _prepare_snapshots(output_dir: Path) -> tuple[list[str], list[str], list[dict[str, object]]]:
    local_history_root = output_dir / "raw_history"
    if not local_history_root.exists():
        raise RuntimeError(f"[publish] omitido: no existe {local_history_root}")

    all_timestamps = sorted(
        d.name
        for d in local_history_root.iterdir()
        if d.is_dir() and (d / "raw_region_results.json").exists()
    )
    timestamps = _filter_half_hour_timestamps(all_timestamps)

    snapshots_data: list[dict[str, object]] = []
    for ts in timestamps:
        snapshot_file = local_history_root / ts / "raw_region_results.json"
        try:
            payload = json.loads(snapshot_file.read_text(encoding="utf-8"))
            snapshots_data.append(payload)
        except Exception as exc:
            print(f"[publish] advertencia: no se pudo leer {snapshot_file}: {exc}")
    return all_timestamps, timestamps, snapshots_data


def publish_api(output_dir: Path, env_path: Path | None = None) -> None:
    env = _load_env_file(env_path or _default_project_env_path())
    all_timestamps, timestamps, snapshots_data = _prepare_snapshots(output_dir)

    api_deploy_path = env.get("API_DEPLOY_PATH", "").strip()
    if not api_deploy_path:
        raise RuntimeError("API_DEPLOY_PATH debe estar definido en .env")

    artifacts = _build_api_artifacts(
        snapshots=snapshots_data,
        all_snapshots_count=len(all_timestamps),
        filtered_snapshots_count=len(timestamps),
    )
    local_api_root = output_dir / "api"
    _write_api_artifacts_to_disk(local_api_root, artifacts)

    ftp_env = _build_ftp_env_from_prefix(env, prefix="API_FTP")
    ftp = _ftp_connect(ftp_env)
    base = _to_remote_dir(api_deploy_path)
    try:
        for rel_path, data in artifacts.items():
            remote = f"{base}/{rel_path}" if base else rel_path
            _ftp_upload_bytes(ftp, data, remote)
    finally:
        ftp.quit()
    print(f"[publish-api] OK: {len(artifacts)} artefactos subidos -> {base}")


def deploy_raw_ftp(output_dir: Path, env_path: Path | None = None) -> None:
    env = _load_env_file(env_path or _default_project_env_path())
    all_timestamps, timestamps, snapshots_data = _prepare_snapshots(output_dir)

    raw_path = env.get("FTP_RAW_PATH", "").strip()
    if not raw_path:
        raise RuntimeError("FTP_RAW_PATH debe estar definido en .env")

    local_history_root = output_dir / "raw_history"
    ftp_env = _build_ftp_env_from_prefix(env, prefix="FTP_RAW")
    ftp = _ftp_connect(ftp_env)
    base = _to_remote_dir(raw_path)
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

        bundle_bytes = json.dumps({"snapshots": snapshots_data}, ensure_ascii=False).encode("utf-8")
        bundle_remote = f"{base}/raw_bundle.json" if base else "raw_bundle.json"
        _ftp_upload_bytes(ftp, bundle_bytes, bundle_remote)

        local_bundle = output_dir / "raw_bundle.json"
        local_bundle.write_bytes(bundle_bytes)
    finally:
        ftp.quit()

    print(f"[deploy-raw] raw_history OK: {uploaded} subidos, {skipped} sin cambios -> {remote_root}")
    print(f"[deploy-raw] raw_bundle.json: {len(snapshots_data)}/{len(all_timestamps)} snapshots")
    print(f"[deploy-raw] buckets de 30 min utilizados: {len(timestamps)}")


def _filter_half_hour_timestamps(timestamps: list[str]) -> list[str]:
    buckets: dict[int, str] = {}
    for ts in timestamps:
        try:
            dt = datetime.strptime(ts, "%Y%m%d_%H%M%S")
        except ValueError:
            continue
        bucket = int(dt.timestamp()) // 1800
        if bucket not in buckets or ts > buckets[bucket]:
            buckets[bucket] = ts
    return sorted(buckets.values())


def _build_api_artifacts(
    *,
    snapshots: list[dict[str, object]],
    all_snapshots_count: int,
    filtered_snapshots_count: int,
) -> dict[str, bytes]:
    summary_rows: list[dict[str, object]] = []
    timelapse_points: list[dict[str, object]] = []
    latest_payload: dict[str, object] | None = None
    latest_ts = float("-inf")
    race_latest = {
        "extracted_at_utc": "",
        "pct_sanchez": 0.0,
        "pct_lopez_aliaga": 0.0,
        "total_valid_votes": 0,
    }

    for payload in snapshots:
        ts = _snapshot_epoch_ms(payload)
        if ts is None:
            continue
        meta = payload.get("metadata", {}) or {}
        totals_by_party, total_valid_votes = _aggregate_totals(payload)
        pct_sanchez = _party_pct(totals_by_party, "JUNTOS POR EL PERU", total_valid_votes)
        pct_lopez = _party_pct(totals_by_party, "RENOVACION POPULAR", total_valid_votes)

        row_out: dict[str, object] = {
            "extracted_at_utc": str(meta.get("extracted_at_utc", "")),
            "actas_pct_global": float(meta.get("actas_pct_global", 0) or 0),
            "totals_by_party": totals_by_party,
        }
        imp_res = _impugnadas_resumen_from_payload(payload)
        if imp_res is not None:
            row_out["impugnadas_resumen"] = imp_res
        summary_rows.append(row_out)
        timelapse_points.append(
            {
                "at_ms": int(ts),
                "pct_sanchez": round(pct_sanchez, 6),
                "pct_lopez_aliaga": round(pct_lopez, 6),
            }
        )
        if ts > latest_ts:
            latest_ts = ts
            latest_payload = payload
            race_latest = {
                "extracted_at_utc": str(meta.get("extracted_at_utc", "")),
                "pct_sanchez": round(pct_sanchez, 6),
                "pct_lopez_aliaga": round(pct_lopez, 6),
                "total_valid_votes": int(total_valid_votes),
            }

    summary_rows.sort(key=lambda row: _safe_epoch_ms_from_iso(str(row.get("extracted_at_utc", ""))))
    timelapse_points.sort(key=lambda row: int(row.get("at_ms", 0)))

    latest_min = _minify_snapshot(latest_payload) if latest_payload else {"metadata": {}, "regions": []}
    generated_at_utc = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    payloads = {
        "v1/dashboard/summary.json": {
            "schema_version": 1,
            "generated_at_utc": generated_at_utc,
            "snapshots": summary_rows,
        },
        "v1/dashboard/latest.json": {
            "schema_version": 1,
            "generated_at_utc": generated_at_utc,
            "snapshot": latest_min,
        },
        "v1/race/latest.json": {
            "schema_version": 1,
            "generated_at_utc": generated_at_utc,
            "latest": race_latest,
        },
        "v1/timelapse/series.json": {
            "schema_version": 1,
            "generated_at_utc": generated_at_utc,
            "points": timelapse_points,
        },
        "v1/meta/health.json": {
            "schema_version": 1,
            "generated_at_utc": generated_at_utc,
            "all_snapshots_count": int(all_snapshots_count),
            "filtered_snapshots_count": int(filtered_snapshots_count),
            "latest_extracted_at_utc": race_latest["extracted_at_utc"],
        },
    }
    return {
        rel_path: json.dumps(payload, ensure_ascii=False).encode("utf-8")
        for rel_path, payload in payloads.items()
    }


def _write_api_artifacts_to_disk(local_api_root: Path, artifacts: dict[str, bytes]) -> None:
    for rel_path, data in artifacts.items():
        target = local_api_root / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def _build_ftp_env_from_prefix(env: dict[str, str], *, prefix: str) -> dict[str, str]:
    host = env.get(f"{prefix}_HOST", "").strip()
    user = env.get(f"{prefix}_USER", "").strip()
    password = env.get(f"{prefix}_PASSWORD", "").strip()
    port = env.get(f"{prefix}_PORT", "21").strip() or "21"
    return {
        "FTP_HOST": host,
        "FTP_USER": user,
        "FTP_PASSWORD": password,
        "FTP_PORT": port,
    }


def _snapshot_epoch_ms(payload: dict[str, object]) -> int | None:
    meta = payload.get("metadata", {}) or {}
    extracted = str(meta.get("extracted_at_utc", "")).strip()
    return _safe_epoch_ms_from_iso(extracted)


def _safe_epoch_ms_from_iso(raw: str) -> int | None:
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:  # noqa: BLE001
        return None


def _minify_snapshot(payload: dict[str, object] | None) -> dict[str, object]:
    if not payload:
        return {"metadata": {}, "regions": []}
    meta = payload.get("metadata", {}) or {}
    regions_in = payload.get("regions", []) or []
    regions_out = []
    for region in regions_in:
        if not isinstance(region, dict):
            continue
        parties_out = []
        for party in (region.get("partidos", []) or []):
            if not isinstance(party, dict):
                continue
            parties_out.append(
                {
                    "nombre": party.get("nombre", ""),
                    "votos": party.get("votos", 0),
                    "es_blanco_o_nulo": bool(party.get("es_blanco_o_nulo", False)),
                }
            )
        row_min: dict[str, object] = {
            "region": region.get("region", ""),
            "actas_pct": region.get("actas_pct", 0),
            "emitidos_actual": region.get("emitidos_actual", 0),
            "partidos": parties_out,
        }
        if "ubigeo" in region:
            row_min["ubigeo"] = region.get("ubigeo")
        if "jee" in region:
            row_min["jee"] = region.get("jee")
        if "impugnadas" in region:
            row_min["impugnadas"] = region.get("impugnadas")
        regions_out.append(row_min)
    meta_out: dict[str, object] = {
        "extracted_at_utc": meta.get("extracted_at_utc", ""),
        "actas_pct_global": meta.get("actas_pct_global", 0),
    }
    if "resumen_jee_nacional" in meta:
        meta_out["resumen_jee_nacional"] = meta.get("resumen_jee_nacional")
    return {
        "metadata": meta_out,
        "regions": regions_out,
    }


def _impugnadas_resumen_from_payload(payload: dict[str, object]) -> dict[str, object] | None:
    regions_in = payload.get("regions") or []
    if not isinstance(regions_in, list) or not regions_in:
        return None
    tot_v = tot_m = tot_p = 0
    lima_v = lima_m = lima_p = 0
    fuentes: set[str] = set()
    seen_any = False
    for region in regions_in:
        if not isinstance(region, dict):
            continue
        imp = region.get("impugnadas")
        if not isinstance(imp, dict):
            continue
        seen_any = True
        v = int(imp.get("votos_impugnados") or 0)
        m = int(imp.get("mesas_impugnadas") or 0)
        p = int(imp.get("votos_pendientes_contar") or 0)
        tot_v += v
        tot_m += m
        tot_p += p
        fuente = str(imp.get("fuente_agregado") or "").strip()
        if fuente:
            fuentes.add(fuente)
        ub = str(region.get("ubigeo") or imp.get("ubigeo_departamento") or "").strip()
        if bool(imp.get("es_lima_departamento")) or ub == "140000":
            lima_v += v
            lima_m += m
            lima_p += p
    if not seen_any:
        return None
    if len(fuentes) == 1:
        fuente_out = next(iter(fuentes))
    elif len(fuentes) > 1:
        fuente_out = "mixto"
    else:
        fuente_out = "desconocido"
    return {
        "votos_impugnados_total": tot_v,
        "mesas_impugnadas_total": tot_m,
        "votos_pendientes_contar_total": tot_p,
        "votos_impugnados_lima_depto": lima_v,
        "mesas_impugnadas_lima_depto": lima_m,
        "votos_pendientes_contar_lima_depto": lima_p,
        "votos_impugnados_no_lima": tot_v - lima_v,
        "mesas_impugnadas_no_lima": tot_m - lima_m,
        "votos_pendientes_contar_no_lima": tot_p - lima_p,
        "fuente_agregado": fuente_out,
    }


def _aggregate_totals(payload: dict[str, object]) -> tuple[dict[str, int], int]:
    totals: dict[str, int] = {}
    total_valid_votes = 0
    regions = payload.get("regions", []) or []
    for region in regions:
        if not isinstance(region, dict):
            continue
        for party in (region.get("partidos", []) or []):
            if not isinstance(party, dict):
                continue
            name = str(party.get("nombre", "")).strip()
            if not name:
                continue
            votes = int(party.get("votos", 0) or 0)
            totals[name] = totals.get(name, 0) + votes
            if not _is_special_party(name, bool(party.get("es_blanco_o_nulo", False))):
                total_valid_votes += votes
    return totals, total_valid_votes


def _is_special_party(name: str, explicit_flag: bool = False) -> bool:
    if explicit_flag:
        return True
    normalized = name.upper()
    return (
        "BLANCO" in normalized
        or "NULO" in normalized
        or "VICIADO" in normalized
        or "IMPUGN" in normalized
        or normalized == "AJUSTE"
    )


def _party_pct(totals_by_party: dict[str, int], canonical_name: str, total_valid_votes: int) -> float:
    if total_valid_votes <= 0:
        return 0.0
    votes = 0
    canonical = canonical_name.upper()
    for name, value in totals_by_party.items():
        if _canonical_party_name(name) == canonical:
            votes += value
    return (votes / total_valid_votes) * 100


def _canonical_party_name(name: str) -> str:
    normalized = name.upper()
    aliases = {
        "JUNTOS POR EL PERÚ": "JUNTOS POR EL PERU",
        "RENOVACIÓN POPULAR": "RENOVACION POPULAR",
        "LOPEZ ALIAGA": "RENOVACION POPULAR",
        "RAFAEL LOPEZ ALIAGA": "RENOVACION POPULAR",
        "RAFAEL LÓPEZ ALIAGA": "RENOVACION POPULAR",
    }
    return aliases.get(normalized, normalized)


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
    try:
        return ftp.size(remote)
    except Exception:  # noqa: BLE001
        return None


def _ftp_upload(ftp: FTP, local: Path, remote: str) -> bool:
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
