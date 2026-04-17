from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from election_counter.parsers import parse_padron
from election_counter.publish import publish_api
from election_counter.projection import build_projection
from election_counter.reporting import (
    build_base_scenario_chart,
    build_markdown_summary,
    build_national_trend_chart,
    build_scenarios_table_markdown,
    write_raw_history_snapshot,
    write_json,
)

from vps.scraper_vps import scrape_onpe_vps


def run_vps_loop(
    *,
    project_root: Path,
    data_dir: Path,
    output_dir: Path,
    browser_channel: str | None,
    user_data_dir: Path,
    margin: float,
    top_n: int,
    source_url: str,
    interval_seconds: int = 1800,
    env_path: Path | None = None,
) -> None:
    raw_path = output_dir / "raw_region_results.json"
    proj_path = output_dir / "projection.json"
    summary_path = output_dir / "projection_summary.md"
    table_path = project_root / "table.md"
    chart_path = output_dir / "base_scenario_chart.png"
    trend_chart_path = output_dir / "national_trend_chart.png"
    history_dir = output_dir / "raw_history"
    heartbeat_path = output_dir / "vps_heartbeat.json"
    scrape_status_path = output_dir / "vps_scrape_status.json"

    while True:
        with _browser_session(
            browser_channel=browser_channel,
            user_data_dir=user_data_dir,
        ) as session:
            started_at = datetime.now(timezone.utc).isoformat()
            print("[vps] ejecutando ciclo completo")
            raw = session(data_dir=data_dir, source_url=source_url)
            write_json(raw_path, raw)
            print(f"[vps] escrito: {raw_path}")
            scrape_status = {
                "source_url": source_url,
                "mode": raw.get("metadata", {}).get("mode", ""),
                "regions": len(raw.get("regions", []) or []),
                "warnings": raw.get("metadata", {}).get("warnings", []),
                "has_json_regions": bool(raw.get("regions")),
                "last_scrape_utc": datetime.now(timezone.utc).isoformat(),
            }
            scrape_status_path.write_text(json.dumps(scrape_status, ensure_ascii=False), encoding="utf-8")
            print(f"[vps] scrape status: {scrape_status_path}")
            snapshot_path = write_raw_history_snapshot(raw, history_dir)
            print(f"[vps] snapshot histórico: {snapshot_path}")

            padron = parse_padron(data_dir / "padron.md")
            projection = build_projection(raw, padron=padron, margin=margin, top_n=top_n)
            write_json(proj_path, projection)
            print(f"[vps] escrito: {proj_path}")

            md = build_markdown_summary(projection)
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(md, encoding="utf-8")
            print(f"[vps] escrito: {summary_path}")
            table_md = build_scenarios_table_markdown(projection)
            table_path.write_text(table_md, encoding="utf-8")
            print(f"[vps] escrito: {table_path}")
            build_base_scenario_chart(projection, chart_path)
            print(f"[vps] escrito: {chart_path}")
            build_national_trend_chart(history_dir, trend_chart_path, top_n=top_n)
            if trend_chart_path.exists():
                print(f"[vps] escrito: {trend_chart_path}")

            try:
                publish_api(output_dir=output_dir, env_path=env_path)
            except Exception as exc:  # noqa: BLE001
                print(f"[vps] error publish-api: {exc}")

            heartbeat_path.write_text(
                (
                    "{"
                    f"\"last_cycle_started_utc\": \"{started_at}\","
                    f"\"last_cycle_finished_utc\": \"{datetime.now(timezone.utc).isoformat()}\","
                    f"\"sleep_seconds\": {interval_seconds}"
                    "}"
                ),
                encoding="utf-8",
            )
            print(f"[vps] heartbeat: {heartbeat_path}")

        print(f"[vps] ciclo completo, durmiendo {interval_seconds}s")
        time.sleep(interval_seconds)


class _browser_session:
    def __init__(self, *, browser_channel: str | None, user_data_dir: Path) -> None:
        self.browser_channel = browser_channel
        self.user_data_dir = user_data_dir
        self._session = None

    def __enter__(self):
        self._session = lambda **kwargs: scrape_onpe_vps(
            headed=True,
            browser_channel=self.browser_channel,
            user_data_dir=self.user_data_dir,
            **kwargs,
        )
        return self._session

    def __exit__(self, exc_type, exc, tb) -> None:
        self._session = None
