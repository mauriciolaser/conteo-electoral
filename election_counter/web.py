from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from election_counter.utils import normalize_name


def run_hud_server(output_dir: Path, host: str = "0.0.0.0", port: int = 8080) -> None:
    projection_path = output_dir / "projection.json"
    trend_chart_path = output_dir / "national_trend_chart.png"

    class HudHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/":
                self._serve_index()
                return
            if path == "/api/hud":
                self._serve_hud_api()
                return
            if path == "/assets/national_trend_chart.png":
                self._serve_chart()
                return
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

        def log_message(self, fmt: str, *args: object) -> None:
            # Mantener logs simples para uso temporal en consola.
            print(f"[hud] {self.address_string()} - {fmt % args}")

        def _serve_index(self) -> None:
            payload = _build_hud_payload(projection_path, trend_chart_path)
            page = _build_html(payload)
            body = page.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _serve_hud_api(self) -> None:
            try:
                payload = _build_hud_payload(projection_path, trend_chart_path)
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:  # noqa: BLE001
                body = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        def _serve_chart(self) -> None:
            if not trend_chart_path.exists():
                self.send_error(HTTPStatus.NOT_FOUND, "Chart not found")
                return
            raw = trend_chart_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/png")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = ThreadingHTTPServer((host, port), HudHandler)
    print(f"[serve] HUD disponible en http://{host}:{port}")
    print(f"[serve] usando outputs en: {output_dir.resolve()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _build_hud_payload(projection_path: Path, trend_chart_path: Path) -> dict[str, object]:
    if not projection_path.exists():
        raise FileNotFoundError(f"No existe archivo de proyección: {projection_path}")
    projection = json.loads(projection_path.read_text(encoding="utf-8"))
    metadata = projection.get("metadata", {}) or {}
    totals = projection.get("totals", {}) or {}
    scenarios = projection.get("scenarios", {}) or {}

    procesado_pct = float(metadata.get("actas_pct_global", 0.0) or 0.0)
    por_procesar_pct = max(0.0, 100.0 - procesado_pct)

    actual_rows = ((totals.get("nacional_mas_extranjero", {}) or {}).get("partidos", []) or [])
    projected_rows = ((scenarios.get("base", {}) or {}).get("partidos", []) or [])

    top5_actual = _top5_candidates(actual_rows)
    top5_projection = _top5_candidates(projected_rows)

    if trend_chart_path.exists():
        ts = int(trend_chart_path.stat().st_mtime)
        trend_chart_url = f"/assets/national_trend_chart.png?ts={ts}"
    else:
        trend_chart_url = ""

    return {
        "procesado_pct": procesado_pct,
        "por_procesar_pct": por_procesar_pct,
        "top5_actual": top5_actual,
        "top5_proyeccion_base": top5_projection,
        "updated_at": str(metadata.get("projected_at_utc") or metadata.get("extracted_at_utc") or ""),
        "trend_chart_url": trend_chart_url,
    }


def _top5_candidates(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for item in rows:
        name = str(item.get("nombre", "")).strip()
        if not name or _is_blank_null_or_invalid(name):
            continue
        votes = int(item.get("votos", 0) or 0)
        pct = float(item.get("porcentaje_emitidos", 0.0) or 0.0)
        out.append({"nombre": name, "votos": votes, "porcentaje_emitidos": pct})
        if len(out) == 5:
            break
    return out


def _is_blank_null_or_invalid(name: str) -> bool:
    n = normalize_name(name)
    return "BLANCO" in n or "NULO" in n or "VICIADO" in n


def _build_html(payload: dict[str, object]) -> str:
    payload_json = json.dumps(payload, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Election HUD MVP</title>
  <style>
    :root {{
      --bg: #f5f6fa;
      --card: #ffffff;
      --ink: #132236;
      --muted: #5a697f;
      --accent: #0a58ca;
      --line: #dde3ec;
    }}
    body {{
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      color: var(--ink);
      background: var(--bg);
    }}
    .wrap {{
      max-width: 1080px;
      margin: 0 auto;
      padding: 16px;
    }}
    .card {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 14px;
    }}
    h1, h2 {{
      margin: 0 0 10px;
      color: var(--ink);
    }}
    h1 {{
      font-size: 24px;
    }}
    h2 {{
      font-size: 18px;
    }}
    .muted {{
      color: var(--muted);
      font-size: 13px;
    }}
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(180px, 1fr));
      gap: 10px;
    }}
    .kpi {{
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      background: #fbfcfe;
    }}
    .kpi .label {{
      color: var(--muted);
      font-size: 12px;
    }}
    .kpi .value {{
      font-size: 28px;
      font-weight: 700;
      color: var(--accent);
    }}
    .tables {{
      display: grid;
      grid-template-columns: repeat(2, minmax(260px, 1fr));
      gap: 14px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }}
    th, td {{
      border-bottom: 1px solid var(--line);
      padding: 8px 6px;
      text-align: left;
    }}
    th {{
      color: var(--muted);
      font-weight: 600;
    }}
    .num {{
      text-align: right;
      font-variant-numeric: tabular-nums;
    }}
    .chart-wrap img {{
      width: 100%;
      height: auto;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
    }}
    @media (max-width: 900px) {{
      .tables {{
        grid-template-columns: 1fr;
      }}
      .kpi-grid {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>HUD Electoral (MVP)</h1>
      <div class="muted">Actualizado: <span id="updatedAt">-</span></div>
    </div>

    <div class="card">
      <h2>Estado de procesamiento</h2>
      <div class="kpi-grid">
        <div class="kpi">
          <div class="label">% procesado</div>
          <div class="value" id="procesadoPct">0.000%</div>
        </div>
        <div class="kpi">
          <div class="label">% por procesar</div>
          <div class="value" id="porProcesarPct">0.000%</div>
        </div>
      </div>
    </div>

    <div class="tables">
      <div class="card">
        <h2>Top 5 actual (candidatos)</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Candidato</th><th class="num">% total</th></tr>
          </thead>
          <tbody id="top5Actual"></tbody>
        </table>
      </div>
      <div class="card">
        <h2>Top 5 proyección (base)</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Candidato</th><th class="num">% total</th></tr>
          </thead>
          <tbody id="top5Proy"></tbody>
        </table>
      </div>
    </div>

    <div class="card chart-wrap">
      <h2>Tendencia nacional</h2>
      <div id="chartState" class="muted">Cargando chart...</div>
      <img id="trendChart" alt="Chart tendencia nacional" style="display:none;" />
    </div>
  </div>

  <script>
    const initialData = {payload_json};

    function fmtPct(v) {{
      return `${{Number(v || 0).toFixed(3)}}%`;
    }}

    function renderRows(id, rows) {{
      const el = document.getElementById(id);
      if (!rows || rows.length === 0) {{
        el.innerHTML = `<tr><td colspan="3">Sin datos</td></tr>`;
        return;
      }}
      el.innerHTML = rows.map((r, idx) => {{
        const pct = Number(r.porcentaje_emitidos || 0).toFixed(3);
        return `<tr>
          <td>${{idx + 1}}</td>
          <td>${{r.nombre || ""}}</td>
          <td class="num">${{pct}}%</td>
        </tr>`;
      }}).join("");
    }}

    function renderChart(url) {{
      const img = document.getElementById("trendChart");
      const state = document.getElementById("chartState");
      if (!url) {{
        img.style.display = "none";
        state.textContent = "Tendencia aun no disponible";
        return;
      }}
      img.src = url;
      img.style.display = "block";
      state.textContent = "";
    }}

    function render(data) {{
      document.getElementById("updatedAt").textContent = data.updated_at || "-";
      document.getElementById("procesadoPct").textContent = fmtPct(data.procesado_pct);
      document.getElementById("porProcesarPct").textContent = fmtPct(data.por_procesar_pct);
      renderRows("top5Actual", data.top5_actual || []);
      renderRows("top5Proy", data.top5_proyeccion_base || []);
      renderChart(data.trend_chart_url || "");
    }}

    async function refreshHud() {{
      try {{
        const resp = await fetch("/api/hud", {{ cache: "no-store" }});
        if (!resp.ok) {{
          return;
        }}
        const data = await resp.json();
        render(data);
      }} catch (_) {{
        // Mantener ultimo estado renderizado.
      }}
    }}

    render(initialData);
    setInterval(refreshHud, 60000);
  </script>
</body>
</html>
"""
