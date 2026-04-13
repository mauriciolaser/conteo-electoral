// ─────────────────────────────────────────────
//  CONFIG — inyectado por el pipeline desde .env (WEB_BASE_URL).
//  El build script reemplaza __BASE_URL__ con el valor real.
//  Estructura esperada en el servidor:
//    <BASE_URL>/raw_history/<timestamp>/raw_region_results.json
//    <BASE_URL>/history_index.json   ← generado por el pipeline
// ─────────────────────────────────────────────
const BASE_URL = __BASE_URL__;
const PARTIES_CATALOG_URL = "./parties.json";

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

const PARTY_ABBREVIATIONS = {
  "FUERZA POPULAR": "FP",
  "RENOVACION POPULAR": "RP",
  "PARTIDO DEL BUEN GOBIERNO": "BG",
  "JUNTOS POR EL PERU": "JP",
  "PARTIDO CIVICO OBRAS": "OB",
  "PARTIDO PAIS PARA TODOS": "PP",
};

const PARTY_ALIAS_TO_CANONICAL = {
  "LOPEZ ALIAGA": "RENOVACION POPULAR",
  "RENOVACIÓN POPULAR": "RENOVACION POPULAR",
  "JUNTOS POR EL PERÚ": "JUNTOS POR EL PERU",
  "PARTIDO PAÍS PARA TODOS": "PARTIDO PAIS PARA TODOS",
  "PARTIDO CÍVICO OBRAS": "PARTIDO CIVICO OBRAS",
};

const PARTY_INITIALS_STOPWORDS = new Set([
  "A", "AL", "AN", "ANTE", "CON", "DE", "DEL", "EL", "EN", "LA", "LAS",
  "LOS", "PARA", "PARTIDO", "PARTIDOS", "POLITICO", "POLITICA", "POR", "Y",
]);

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

function canonicalPartyName(name) {
  const normalized = normalizeName(name);
  return PARTY_ALIAS_TO_CANONICAL[normalized] || normalized;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 620px)").matches;
}

function buildPartyInitials(name) {
  const canonical = canonicalPartyName(name);
  if (PARTY_ABBREVIATIONS[canonical]) return PARTY_ABBREVIATIONS[canonical];

  const words = canonical
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .filter(word => !PARTY_INITIALS_STOPWORDS.has(word));
  const sourceWords = words.length ? words : canonical.split(/[^A-Z0-9]+/).filter(Boolean);
  return sourceWords.slice(0, 2).map(word => word[0]).join("") || canonical.slice(0, 2);
}

let partiesCatalogPromise = null;
let partyDisplayMap = new Map();
let mobilePartyIconPluginRegistered = false;
const partyImageCache = new Map();

function buildPartyDisplayMap(rows) {
  const nextMap = new Map();
  for (const row of rows || []) {
    const canonical = canonicalPartyName(row.name);
    nextMap.set(canonical, {
      imageSrc: row.partyImage || "",
      shortLabel: PARTY_ABBREVIATIONS[canonical] || buildPartyInitials(canonical),
    });
  }
  partyDisplayMap = nextMap;
}

async function ensurePartiesCatalog() {
  if (!partiesCatalogPromise) {
    partiesCatalogPromise = fetchJSON(PARTIES_CATALOG_URL)
      .then(rows => {
        buildPartyDisplayMap(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        buildPartyDisplayMap([]);
      });
  }
  return partiesCatalogPromise;
}

function getPartyDisplayMeta(name) {
  const canonical = canonicalPartyName(name);
  const fromCatalog = partyDisplayMap.get(canonical);
  return {
    fullLabel: name,
    shortLabel: fromCatalog?.shortLabel || PARTY_ABBREVIATIONS[canonical] || buildPartyInitials(canonical),
    imageSrc: fromCatalog?.imageSrc || "",
  };
}

function ensureMobilePartyIconPlugin() {
  if (mobilePartyIconPluginRegistered || typeof Chart === "undefined") return;
  Chart.register({
    id: "mobilePartyIcons",
    afterDraw(chart, _args, options) {
      if (!options?.enabled || !isMobileViewport()) return;
      const yScale = chart.scales?.y;
      const items = options.items || [];
      if (!yScale || !items.length) return;

      const { ctx } = chart;
      ctx.save();
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!item?.imageSrc) continue;
        if (!item.image) {
          const img = new Image();
          img.src = item.imageSrc;
          img.onload = () => chart.draw();
          item.image = img;
        }
        if (!item.image.complete) continue;

        const size = 16;
        const x = yScale.left + 2;
        const y = yScale.getPixelForTick(index) - (size / 2);
        ctx.drawImage(item.image, x, y, size, size);
      }
      ctx.restore();
    },
  });
  mobilePartyIconPluginRegistered = true;
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
    note: "Sesgo rural (popularidad real en todas las regiones donde lidera Sánchez): ×1.45 Sánchez · ×1.20 Cívico Obras/Ahora Nación · ×1.00 FP/Buen Gobierno · ×0.80 tier medio · ×0.55 resto (Top 6)",
    tooltipSuffix: "votos proyectados modo rural",
  },
  ruralFallback: {
    note: "VOTO RURAL sin regiones elegibles en este corte — se muestra interpolación base (Top 6)",
    tooltipSuffix: "votos proyectados modo rural",
  },
  megaRural: {
    note: "VOTO MEGA-RURAL: en regiones donde lidera Sánchez, el voto pendiente se reparte con ×2.00 para Sánchez y ×0.50 para López Aliaga; los demás partidos reparten su crecimiento pendiente con los multiplicadores rurales por popularidad local (Top 6)",
    tooltipSuffix: "votos proyectados modo mega-rural",
  },
  megaRuralFallback: {
    note: "VOTO MEGA-RURAL sin regiones elegibles en este corte — se muestra interpolación base (Top 6)",
    tooltipSuffix: "votos proyectados modo mega-rural",
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
  const megaRuralBtn = document.getElementById("mode-mega-rural");
  if (!actualBtn || !interpolationBtn || !ruralBtn || !megaRuralBtn) return;
  actualBtn.classList.toggle("active", mainChartMode === "actual");
  interpolationBtn.classList.toggle("active", mainChartMode === "interpolation");
  ruralBtn.classList.toggle("active", mainChartMode === "rural");
  megaRuralBtn.classList.toggle("active", mainChartMode === "megaRural");
}

function renderMainChart() {
  ensureMobilePartyIconPlugin();
  const canvas = document.getElementById("main-chart");
  const noteEl = document.getElementById("main-chart-note");
  if (!canvas || !mainChartData) return;
  const ctx = canvas.getContext("2d");
  if (mainChartInstance) mainChartInstance.destroy();

  const source = mainChartData[mainChartMode] || mainChartData.actual;
  const displayItems = source.topCandidates.map(([name]) => getPartyDisplayMeta(name));
  const labels = displayItems.map(item => isMobileViewport() ? item.shortLabel : item.fullLabel);
  const fullLabels = displayItems.map(item => item.fullLabel);
  const values = source.topCandidates.map(([, votes]) => votes);
  const pcts = values.map(v => source.totalValidVotes > 0 ? (v / source.totalValidVotes * 100) : 0);
  const colors = fullLabels.map((name, i) => partyColor(name, i));
  const fallbackMetaByMode = {
    rural: MAIN_CHART_MODE_META.ruralFallback,
    megaRural: MAIN_CHART_MODE_META.megaRuralFallback,
  };
  const modeMeta = source.isFallback
    ? (fallbackMetaByMode[mainChartMode] || MAIN_CHART_MODE_META[mainChartMode] || MAIN_CHART_MODE_META.actual)
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
              return ` ${fullLabels[ctx.dataIndex]}: ${pct}% (${votes} ${modeMeta.tooltipSuffix})`;
            },
          },
        },
        mobilePartyIcons: {
          enabled: true,
          items: displayItems,
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
          afterFit: scale => {
            if (isMobileViewport()) {
              scale.width += 22;
            }
          },
          ticks: {
            color: "#e8eaf0",
            font: { size: 11 },
            padding: isMobileViewport() ? 22 : 8,
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
  ensureMobilePartyIconPlugin();
  const canvas = document.getElementById("trend-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (trendChartInstance) trendChartInstance.destroy();

  const labels = snapshots.map(s => {
    const bucketMs = Math.floor(s.dt.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS;
    const d = new Date(bucketMs);
    return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });
  });

  const datasets = top5Names.map((name, i) => {
    const display = getPartyDisplayMeta(name);
    return {
    label: isMobileViewport() ? display.shortLabel : display.fullLabel,
    fullLabel: display.fullLabel,
    shortLabel: display.shortLabel,
    imageSrc: display.imageSrc,
    data: snapshots.map(s => s.totals[name] || 0),
    borderColor: partyColor(name, i),
    backgroundColor: partyColor(name, i) + "33",
    borderWidth: 2,
    pointRadius: 4,
    tension: 0.3,
    fill: false,
    };
  });

  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#e8eaf0",
            font: { size: 11 },
            generateLabels(chart) {
              const defaults = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              if (!isMobileViewport()) return defaults;
              return defaults.map((item, i) => {
                const ds = chart.data.datasets[i];
                item.text = ds.shortLabel || item.text;
                if (ds.imageSrc) {
                  let img = partyImageCache.get(ds.imageSrc);
                  if (!img) {
                    img = new Image(16, 16);
                    img.src = ds.imageSrc;
                    img.onload = () => { if (chart) chart.update("none"); };
                    partyImageCache.set(ds.imageSrc, img);
                  }
                  item.pointStyle = img;
                  item.usePointStyle = true;
                }
                return item;
              });
            },
            usePointStyle: true,
          },
          position: "bottom",
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.fullLabel || ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("es-PE")} votos`,
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
  await ensurePartiesCatalog();

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
  const megaRuralStats = window.ProjectionModes.buildMegaRuralProjectionStats(latest.payload);
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
    megaRural: {
      topCandidates: megaRuralStats.projectedCandidates.slice(0, TOP_N),
      totalValidVotes: megaRuralStats.totalValidProjectedVotes,
      isFallback: megaRuralStats.isFallback,
      eligibleRegionCount: megaRuralStats.eligibleRegionCount,
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
  let headerCompact = false;
  const COMPACT_ON = 120;
  const COMPACT_OFF = 60;
  const syncHeaderState = () => {
    if (!headerCompact && window.scrollY > COMPACT_ON) {
      headerCompact = true;
      document.body.classList.add("header-compact");
    } else if (headerCompact && window.scrollY < COMPACT_OFF) {
      headerCompact = false;
      document.body.classList.remove("header-compact");
    }
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
  const megaRuralBtn = document.getElementById("mode-mega-rural");
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
  if (megaRuralBtn) {
    megaRuralBtn.addEventListener("click", () => {
      mainChartMode = "megaRural";
      renderMainChart();
    });
  }
  loadAndRender();
  setInterval(loadAndRender, 60_000);
});
