// ─────────────────────────────────────────────
//  CONFIG — inyectado por el pipeline desde .env (WEB_BASE_URL).
//  El build script reemplaza __BASE_URL__ con el valor real.
//  Estructura esperada en el servidor:
//    <BASE_URL>/raw_history/<timestamp>/raw_region_results.json
//    <BASE_URL>/history_index.json   ← generado por el pipeline
// ─────────────────────────────────────────────
const BASE_URL = __BASE_URL__;

// ─────────────────────────────────────────────
//  Paleta de colores por partido (igual a Python)
// ─────────────────────────────────────────────
const PARTY_COLORS = {
  "RENOVACION POPULAR":     "#0057b8",
  "RENOVACIÓN POPULAR":     "#0057b8",
  "LOPEZ ALIAGA":           "#0057b8",
  "FUERZA POPULAR":         "#ff8c00",
  "KEIKO":                  "#ff8c00",
  "PARTIDO CIVICO OBRAS":   "#006400",
  "PARTIDO CÍVICO OBRAS":   "#006400",
  "OBRAS":                  "#006400",
  "JUNTOS POR EL PERU":     "#32cd32",
  "JUNTOS POR EL PERÚ":     "#32cd32",
  "PARTIDO DEL BUEN GOBIERNO": "#ffd700",
  "BUEN GOBIERNO":          "#ffd700",
  "PARTIDO PAIS PARA TODOS": "#000000",
  "PARTIDO PAÍS PARA TODOS": "#000000",
  "PAIS PARA TODOS":        "#000000",
};

const PALETTE = [
  "#4e79a7","#f28e2b","#e15759","#76b7b2",
  "#59a14f","#edc948","#b07aa1","#ff9da7",
  "#9c755f","#bab0ac",
];

function partyColor(name, idx) {
  const n = name.toUpperCase();
  for (const [key, color] of Object.entries(PARTY_COLORS)) {
    if (n.includes(key.toUpperCase())) return color;
  }
  return PALETTE[idx % PALETTE.length];
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function isSpecial(name) {
  const n = name.toUpperCase();
  return n.includes("BLANCO") || n.includes("NULO") ||
         n.includes("VICIADO") || n.includes("IMPUGN") || n === "AJUSTE";
}

function normalizeName(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() {
  document.getElementById("error-msg").classList.add("hidden");
}

// ─────────────────────────────────────────────
//  Chart instances (para poder destruirlos al recargar)
// ─────────────────────────────────────────────
let mainChartInstance = null;
let trendChartInstance = null;
let mainChartMode = "actual";
let mainChartData = null;
const MAIN_CHART_MODE_META = {
  actual: {
    note: "Votos válidos procesados actualmente (Top 6)",
    tooltipSuffix: "votos procesados",
  },
  interpolation: {
    note: "Proyección nacional con el último snapshot (Top 6)",
    tooltipSuffix: "votos interpolados",
  },
  rural: {
    note: "Proyección especulativa con sesgo rural en regiones pro-Sánchez (Top 6)",
    tooltipSuffix: "votos proyectados modo rural",
  },
  ruralFallback: {
    note: "VOTO RURAL sin regiones elegibles en este corte; se muestra la interpolación base (Top 6)",
    tooltipSuffix: "votos proyectados modo rural",
  },
};

const HALF_HOUR_MS = 30 * 60 * 1000;
const SANCHEZ_PARTY = "JUNTOS POR EL PERU";
const RLA_PARTY = "RENOVACION POPULAR";

// ─────────────────────────────────────────────
//  Procesado de snapshots crudos
// ─────────────────────────────────────────────
function aggregateSnapshot(payload) {
  /** Suma votos por partido en todas las regiones. */
  const totals = {};
  for (const region of payload.regions || []) {
    for (const p of region.partidos || []) {
      const name = (p.nombre || "").trim();
      if (!name) continue;
      totals[name] = (totals[name] || 0) + (parseInt(p.votos) || 0);
    }
  }
  return totals;
}

const TOP_N = 6;

function top5FromTotals(totals) {
  return Object.entries(totals)
    .filter(([name]) => !isSpecial(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N);
}

function buildCurrentProcessingStats(totals) {
  const candidates = Object.entries(totals)
    .filter(([name]) => !isSpecial(name))
    .sort((a, b) => b[1] - a[1]);

  return {
    topCandidates: candidates.slice(0, TOP_N),
    totalValidVotes: candidates.reduce((acc, [, votes]) => acc + votes, 0),
  };
}

function getHalfHourSnapshots(snapshots) {
  const byBucket = new Map();
  for (const s of snapshots) {
    const bucket = Math.floor(s.dt.getTime() / HALF_HOUR_MS);
    const existing = byBucket.get(bucket);
    if (!existing || s.dt > existing.dt) byBucket.set(bucket, s);
  }
  return [...byBucket.values()].sort((a, b) => a.dt - b.dt);
}

function partyVotesInRegion(region, partyNameNormalized) {
  const party = (region.partidos || []).find(
    p => normalizeName(p.nombre) === partyNameNormalized
  );
  return parseInt(party?.votos) || 0;
}

function leadingPartyInRegion(region) {
  return (region.partidos || [])
    .filter(p => !isSpecial(p.nombre || ""))
    .reduce((best, p) => (parseInt(p.votos) || 0) > best.votes
      ? { name: normalizeName(p.nombre), votes: parseInt(p.votos) || 0 }
      : best,
    { name: "", votes: -1 });
}

function buildProSanchezStats(latestPayload) {
  const regions = latestPayload.regions || [];
  const proSanchezRegions = [];

  for (const region of regions) {
    const leader = leadingPartyInRegion(region);
    if (leader.name !== SANCHEZ_PARTY) continue;

    const actasPct = Number(region.actas_pct) || 0;
    const emitidos = parseInt(region.emitidos_actual) || 0;
    const projectedTotal = actasPct > 0
      ? Math.round((emitidos * 100) / actasPct)
      : emitidos;
    const remainingVotes = Math.max(0, projectedTotal - emitidos);

    const sanchezVotes = partyVotesInRegion(region, SANCHEZ_PARTY);
    const rlaVotes = partyVotesInRegion(region, RLA_PARTY);
    const sanchezShare = emitidos > 0 ? sanchezVotes / emitidos : 0;
    const rlaShare = emitidos > 0 ? rlaVotes / emitidos : 0;

    proSanchezRegions.push({
      region: region.region || "—",
      actasPct,
      remainingVotes,
      sanchezVotes,
      sanchezProjectedVotes: Math.round(projectedTotal * sanchezShare),
      rlaProjectedVotes: Math.round(projectedTotal * rlaShare),
    });
  }

  const top5Regions = [...proSanchezRegions]
    .sort((a, b) => b.sanchezVotes - a.sanchezVotes)
    .slice(0, 5);

  return {
    top5Regions,
    totals: {
      remainingVotes: proSanchezRegions.reduce((acc, r) => acc + r.remainingVotes, 0),
      sanchezProjectedVotes: proSanchezRegions.reduce((acc, r) => acc + r.sanchezProjectedVotes, 0),
      rlaProjectedVotes: proSanchezRegions.reduce((acc, r) => acc + r.rlaProjectedVotes, 0),
    },
  };
}

function formatInt(n) {
  return Math.round(n || 0).toLocaleString("es-PE");
}

function renderProSanchezPanel(stats) {
  const tbody = document.getElementById("pro-sanchez-table-body");
  if (!tbody) return;

  if (!stats.top5Regions.length) {
    tbody.innerHTML = `<tr><td colspan="4">No hay regiones con liderazgo de Juntos por el Perú aún.</td></tr>`;
  } else {
    tbody.innerHTML = stats.top5Regions.map(r => `
      <tr>
        <td>${r.region}</td>
        <td>${formatInt(r.sanchezVotes)}</td>
        <td>${r.actasPct.toFixed(3)}%</td>
        <td>${formatInt(r.sanchezProjectedVotes)}</td>
      </tr>
    `).join("");
  }
}

function renderShowdownPanel(nationalStats, proSanchezStats) {
  const totalSanchezEl = document.getElementById("national-sanchez-total");
  const totalRlaEl = document.getElementById("national-rla-total");
  const showdownDateEl = document.getElementById("showdown-data-date");
  if (!totalSanchezEl || !totalRlaEl || !showdownDateEl) return;

  totalSanchezEl.textContent = formatInt(nationalStats.sanchezProjectedVotes);
  totalRlaEl.textContent = formatInt(nationalStats.rlaProjectedVotes);
  showdownDateEl.textContent = `Data del corte: ${proSanchezStats.extractedAtLabel}`;
}

function updateMainChartButtons() {
  const actualBtn = document.getElementById("mode-actual");
  const interpolationBtn = document.getElementById("mode-interpolation");
  const ruralBtn = document.getElementById("mode-rural");
  if (!actualBtn || !interpolationBtn || !ruralBtn) return;
  actualBtn.classList.toggle("active", mainChartMode === "actual");
  interpolationBtn.classList.toggle("active", mainChartMode === "interpolation");
  ruralBtn.classList.toggle("active", mainChartMode === "rural");
}

function renderMainChart() {
  const canvas = document.getElementById("main-chart");
  const noteEl = document.getElementById("main-chart-note");
  if (!canvas || !mainChartData) return;
  const ctx = canvas.getContext("2d");
  if (mainChartInstance) mainChartInstance.destroy();

  const source = mainChartData[mainChartMode] || mainChartData.actual;
  const labels = source.topCandidates.map(([name]) => name);
  const values = source.topCandidates.map(([, votes]) => votes);
  const pcts = values.map(v => source.totalValidVotes > 0 ? (v / source.totalValidVotes * 100) : 0);
  const colors = labels.map((name, i) => partyColor(name, i));
  const modeMeta = mainChartMode === "rural" && source.isFallback
    ? MAIN_CHART_MODE_META.ruralFallback
    : (MAIN_CHART_MODE_META[mainChartMode] || MAIN_CHART_MODE_META.actual);
  if (noteEl) {
    noteEl.textContent = modeMeta.note;
  }
  updateMainChartButtons();

  mainChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: pcts,
        backgroundColor: colors,
        borderColor: colors.map(c => c + "cc"),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = ctx.parsed.x.toFixed(2);
              const votes = values[ctx.dataIndex].toLocaleString("es-PE");
              return ` ${pct}%  (${votes} ${modeMeta.tooltipSuffix})`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#7b7f94",
            callback: v => v.toFixed(1) + "%",
          },
          grid: { color: "#2a2d3a" },
        },
        y: {
          ticks: {
            color: "#e8eaf0",
            font: { size: 11 },
          },
          grid: { display: false },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────
//  Trend chart: evolución temporal top 5
// ─────────────────────────────────────────────
function renderTrendChart(snapshots, top5Names) {
  const canvas = document.getElementById("trend-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (trendChartInstance) trendChartInstance.destroy();

  const labels = snapshots.map(s => {
    const d = new Date(s.dt);
    return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });
  });

  const datasets = top5Names.map((name, i) => ({
    label: name,
    data: snapshots.map(s => s.totals[name] || 0),
    borderColor: partyColor(name, i),
    backgroundColor: partyColor(name, i) + "33",
    borderWidth: 2,
    pointRadius: 4,
    tension: 0.3,
    fill: false,
  }));

  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#e8eaf0", font: { size: 11 } },
          position: "bottom",
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("es-PE")} votos`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#7b7f94", font: { size: 10 } },
          grid: { color: "#2a2d3a" },
        },
        y: {
          ticks: {
            color: "#7b7f94",
            callback: v => v >= 1_000_000
              ? (v / 1_000_000).toFixed(1) + "M"
              : v >= 1000
              ? (v / 1000).toFixed(0) + "k"
              : v,
          },
          grid: { color: "#2a2d3a" },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────
//  Status bar
// ─────────────────────────────────────────────
function updateStatusBar(latestPayload) {
  const meta = latestPayload.metadata || {};
  const actasPct = typeof meta.actas_pct_global === "number"
    ? meta.actas_pct_global.toFixed(3) + "% actas"
    : "—";
  const extractedAt = meta.extracted_at_utc
    ? new Date(meta.extracted_at_utc).toLocaleString("es-PE", {
        timeZone: "America/Lima",
        dateStyle: "full",
        timeStyle: "short",
      })
    : "—";

  const actasEl = document.getElementById("actas-pct");
  const extractedEl = document.getElementById("extracted-at");
  actasEl.textContent = `Actas procesadas ${actasPct}`;
  extractedEl.textContent = extractedAt;

  return extractedAt;
}

// ─────────────────────────────────────────────
//  Main load
// ─────────────────────────────────────────────
async function loadAndRender() {
  hideError();

  // 1. Obtener índice de snapshots disponibles
  let timestamps = [];
  try {
    const idx = await fetchJSON(`${BASE_URL}/history_index.json`);
    timestamps = Array.isArray(idx.timestamps) ? idx.timestamps : [];
  } catch (e) {
    showError(
      `No se pudo cargar history_index.json desde ${BASE_URL}. ` +
      `Asegúrate de que el pipeline haya publicado los datos. (${e.message})`
    );
    return;
  }

  if (timestamps.length === 0) {
    showError("No hay snapshots disponibles aún. El pipeline aún no ha subido datos.");
    return;
  }

  // 2. Cargar todos los snapshots (en paralelo)
  const results = await Promise.allSettled(
    timestamps.map(ts =>
      fetchJSON(`${BASE_URL}/raw_history/${ts}/raw_region_results.json`)
    )
  );

  const snapshots = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      const payload = results[i].value;
      const meta = payload.metadata || {};
      let dt;
      try {
        dt = new Date(meta.extracted_at_utc);
        if (isNaN(dt.getTime())) throw new Error("invalid");
      } catch {
        // fallback: parsear desde timestamp label
        const ts = timestamps[i];
        const m = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
        if (m) {
          dt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
        } else {
          continue;
        }
      }
      snapshots.push({ dt, totals: aggregateSnapshot(payload), payload });
    }
  }

  if (snapshots.length === 0) {
    showError("No se pudieron cargar los snapshots del servidor.");
    return;
  }

  snapshots.sort((a, b) => a.dt - b.dt);
  const trendSnapshots = getHalfHourSnapshots(snapshots);

  // 3. Determinar top 6 del snapshot más reciente
  const latest = snapshots[snapshots.length - 1];
  const top5 = top5FromTotals(latest.totals);  // devuelve hasta TOP_N
  const top5Names = top5.map(([name]) => name);
  const currentStats = buildCurrentProcessingStats(latest.totals);
  const proSanchezStats = buildProSanchezStats(latest.payload);
  const nationalStats = window.ProjectionModes.buildNationalProjectionStats(latest.payload);
  const ruralStats = window.ProjectionModes.buildRuralProjectionStats(latest.payload);
  const extractedAtLabel = latest.payload?.metadata?.extracted_at_utc
    ? new Date(latest.payload.metadata.extracted_at_utc).toLocaleString("es-PE", {
        timeZone: "America/Lima",
        dateStyle: "full",
        timeStyle: "short",
      })
    : "—";
  proSanchezStats.extractedAtLabel = extractedAtLabel;
  mainChartData = {
    actual: currentStats,
    interpolation: {
      topCandidates: nationalStats.projectedCandidates.slice(0, TOP_N),
      totalValidVotes: nationalStats.totalValidProjectedVotes,
    },
    rural: {
      topCandidates: ruralStats.projectedCandidates.slice(0, TOP_N),
      totalValidVotes: ruralStats.totalValidProjectedVotes,
      isFallback: ruralStats.isFallback,
      eligibleRegionCount: ruralStats.eligibleRegionCount,
    },
  };

  // 4. Renderizar
  updateStatusBar(latest.payload);
  renderMainChart();
  renderProSanchezPanel(proSanchezStats);
  renderShowdownPanel(nationalStats, proSanchezStats);

  if (trendSnapshots.length >= 2) {
    const trendContainer = document.querySelector("#trend-chart-container");
    if (!document.getElementById("trend-chart")) {
      trendContainer.innerHTML = `<canvas id="trend-chart"></canvas>`;
    }
    renderTrendChart(trendSnapshots, top5Names);
  } else {
    document.querySelector("#trend-chart-container").innerHTML =
      `<p style="color:#7b7f94;padding:1rem 0">Se necesitan al menos 2 snapshots de corte (30 min) para mostrar la tendencia.</p>`;
  }
}

// ─────────────────────────────────────────────
//  Init + auto-refresh cada 60s
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  let headerTicking = false;
  const syncHeaderState = () => {
    document.body.classList.toggle("header-compact", window.scrollY > 56);
    headerTicking = false;
  };
  window.addEventListener("scroll", () => {
    if (headerTicking) return;
    headerTicking = true;
    window.requestAnimationFrame(syncHeaderState);
  }, { passive: true });
  syncHeaderState();

  const actualBtn = document.getElementById("mode-actual");
  const interpolationBtn = document.getElementById("mode-interpolation");
  const ruralBtn = document.getElementById("mode-rural");
  if (actualBtn) {
    actualBtn.addEventListener("click", () => {
      mainChartMode = "actual";
      renderMainChart();
    });
  }
  if (interpolationBtn) {
    interpolationBtn.addEventListener("click", () => {
      mainChartMode = "interpolation";
      renderMainChart();
    });
  }
  if (ruralBtn) {
    ruralBtn.addEventListener("click", () => {
      mainChartMode = "rural";
      renderMainChart();
    });
  }
  loadAndRender();
  setInterval(loadAndRender, 60_000);
});
