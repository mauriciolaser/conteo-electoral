from __future__ import annotations

import argparse
from pathlib import Path

from election_counter.parsers import parse_padron
from election_counter.publish import publish_frontend, publish_raw_history  # publish_frontend usado en deploy-frontend
from election_counter.projection import build_projection
from election_counter.reporting import (
    build_base_scenario_chart,
    build_markdown_summary,
    build_national_trend_chart,
    build_scenarios_table_markdown,
    read_json,
    write_raw_history_snapshot,
    write_json,
)
from election_counter.scraper import scrape_onpe
from election_counter.web import run_hud_server


def main() -> int:
    parser = argparse.ArgumentParser(description="Scraping + proyección ONPE")
    parser.add_argument(
        "--mode",
        choices=["scrape", "project", "report", "full", "serve", "publish", "deploy-frontend"],
        default="full",
    )
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--output-dir", default="outputs")
    parser.add_argument("--source-url", default="https://resultadoelectoral.onpe.gob.pe/main/presidenciales")
    parser.add_argument("--margin", type=float, default=0.05)
    parser.add_argument("--top-n", type=int, default=6)
    parser.add_argument("--headed", action="store_true", default=False)
    parser.add_argument("--browser-channel", default=None)
    parser.add_argument("--user-data-dir", default=None)
    parser.add_argument("--allow-fallback", action="store_true", default=False)
    parser.add_argument("--raw-input", default=None)
    parser.add_argument("--projection-input", default=None)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--no-publish", action="store_true", default=False)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    raw_path = Path(args.raw_input) if args.raw_input else output_dir / "raw_region_results.json"
    proj_path = (
        Path(args.projection_input) if args.projection_input else output_dir / "projection.json"
    )
    summary_path = output_dir / "projection_summary.md"
    table_path = Path("table.md")
    chart_path = output_dir / "base_scenario_chart.png"
    trend_chart_path = output_dir / "national_trend_chart.png"
    history_dir = output_dir / "raw_history"

    if args.mode == "deploy-frontend":
        project_root = Path(__file__).resolve().parent.parent
        publish_frontend(project_root=project_root)
        return 0

    if args.mode == "publish":
        if not args.no_publish:
            try:
                publish_raw_history(output_dir=output_dir)
            except Exception as exc:  # noqa: BLE001
                print(f"[publish] error: {exc}")
        return 0

    if args.mode in {"scrape", "full"}:
        raw = scrape_onpe(
            data_dir=data_dir,
            source_url=args.source_url,
            headed=args.headed,
            browser_channel=args.browser_channel,
            user_data_dir=Path(args.user_data_dir) if args.user_data_dir else None,
            allow_fallback=args.allow_fallback,
        )
        write_json(raw_path, raw)
        print(f"[scrape] escrito: {raw_path}")
        snapshot_path = write_raw_history_snapshot(raw, history_dir)
        print(f"[scrape] snapshot histórico: {snapshot_path}")
        if args.mode == "scrape":
            return 0

    if args.mode in {"project", "full"}:
        raw = read_json(raw_path)
        padron = parse_padron(data_dir / "padron.md")
        projection = build_projection(raw, padron=padron, margin=args.margin, top_n=args.top_n)
        write_json(proj_path, projection)
        print(f"[project] escrito: {proj_path}")
        if args.mode == "project":
            return 0

    if args.mode in {"report", "full"}:
        projection = read_json(proj_path)
        md = build_markdown_summary(projection)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(md, encoding="utf-8")
        print(f"[report] escrito: {summary_path}")
        table_md = build_scenarios_table_markdown(projection)
        table_path.write_text(table_md, encoding="utf-8")
        print(f"[report] escrito: {table_path}")
        build_base_scenario_chart(projection, chart_path)
        if not chart_path.exists():
            raise RuntimeError(f"No se pudo generar el gráfico: {chart_path}")
        print(f"[report] escrito: {chart_path}")
        build_national_trend_chart(history_dir, trend_chart_path, top_n=args.top_n)
        if trend_chart_path.exists():
            print(f"[report] escrito: {trend_chart_path}")

    if args.mode == "full" and not args.no_publish:
        try:
            publish_raw_history(output_dir=output_dir)
        except Exception as exc:  # noqa: BLE001
            print(f"[publish] error raw_history: {exc}")

    if args.mode == "serve":
        run_hud_server(output_dir=output_dir, host=args.host, port=args.port)

    return 0
