// ─────────────────────────────────────────────
//  CONFIG — inyectado por el pipeline desde .env (WEB_BASE_URL).
//  El build script reemplaza __BASE_URL__ con el valor real.
//
//  Estructura esperada en el servidor:
//    <BASE_URL>/history_bundle.json
//        Archivo principal. Contiene todos los snapshots filtrados
//        (uno por bucket de 30 min) en { "snapshots": [ ...payloads ] }.
//        Publicado por publish_raw_history() en publish.py.
//        El cliente hace 1 solo request en lugar de N requests paralelos.
//
//    <BASE_URL>/history_index.json   (legacy — compatibilidad)
//        Lista de timestamps. Ya no lo usa el cliente activo, se mantiene
//        para sesiones con versiones anteriores cacheadas en el navegador.
//
//    <BASE_URL>/raw_history/<timestamp>/raw_region_results.json
//        Archivos individuales por snapshot. El cliente ya no los descarga
//        directamente; siguen en el servidor como fuente del bundle.
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
  "RAFAEL LOPEZ ALIAGA": "RENOVACION POPULAR",
  "RAFAEL LÓPEZ ALIAGA": "RENOVACION POPULAR",
  "RENOVACIÓN POPULAR": "RENOVACION POPULAR",
  "SANCHEZ": "JUNTOS POR EL PERU",
  "ROBERTO SANCHEZ": "JUNTOS POR EL PERU",
  "ROBERTO SÁNCHEZ": "JUNTOS POR EL PERU",
  "JUNTOS POR EL PERÚ": "JUNTOS POR EL PERU",
  "NIETO": "PARTIDO DEL BUEN GOBIERNO",
  "JORGE NIETO": "PARTIDO DEL BUEN GOBIERNO",
  "BUEN GOBIERNO": "PARTIDO DEL BUEN GOBIERNO",
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

// ─────────────────────────────────────────────
//  LocalStorage cache (fallback resiliente)
// ─────────────────────────────────────────────
const LS_KEY = "elec_snapshots_cache";

function latestDtFromPayloads(payloads) {
  let max = 0;
  for (const p of payloads) {
    const t = new Date(p?.metadata?.extracted_at_utc).getTime();
    if (!isNaN(t) && t > max) max = t;
  }
  return max;
}

function saveSnapshotsToLS(snapshotsRaw) {
  try {
    const existing = loadSnapshotsFromLS();
    // Solo sobreescribir si los nuevos datos son más recientes
    if (existing) {
      const newLatest = latestDtFromPayloads(snapshotsRaw);
      const oldLatest = latestDtFromPayloads(existing.data);
      if (newLatest <= oldLatest) return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), data: snapshotsRaw }));
  } catch (_) { /* quota exceeded — ignorar */ }
}

function loadSnapshotsFromLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.data) ? parsed : null;
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────
//  Overlay helpers
// ─────────────────────────────────────────────
function showLoadingOverlay(subText) {
  const overlay = document.getElementById("loading-overlay");
  const sub = document.getElementById("loading-sub");
  if (overlay) overlay.classList.remove("hidden");
  if (sub) sub.textContent = subText || "";
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
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
let bestLatestPayload = null; // el snapshot más reciente visto en cualquier refresh
const MAIN_CHART_MODE_META = {
  actual: {
    note: "Votos válidos procesados actualmente disponibles en la web de ONPE",
    tooltipSuffix: "votos procesados",
  },
  interpolation: {
    note: "Estiramos la data siguiendo la tendencia del último registro disponible en ONPE sin contar los cambios de tendencia que se producen cuando llegan actas remotas.",
    tooltipSuffix: "votos interpolados",
  },
  rural: {
    note: "Aplicamos 'sesgo rural' en top regiones donde lidera Sánchez: redistribuye solo voto pendiente con ratio Rural/Urbano del conteo Rápido de Ipsos presentado al mediodía del 12 de abril (y OTROS para listas no explícitas), sin tocar votos ya contados",
    tooltipSuffix: "votos proyectados modo rural",
  },
  ruralFallback: {
    note: "VOTO RURAL sin regiones elegibles en este corte — se muestra interpolación base (Top 6)",
    tooltipSuffix: "votos proyectados modo rural",
  },
};

const HALF_HOUR_MS = 30 * 60 * 1000;
const SANCHEZ_PARTY = "JUNTOS POR EL PERU";
const LOPEZ_ALIAGA_PARTY = "RENOVACION POPULAR";
const NIETO_PARTY = "PARTIDO DEL BUEN GOBIERNO";
const CANDIDATE_OPTIONS = {
  [SANCHEZ_PARTY]: {
    label: "Sánchez",
    votesHeader: "VOTOS SÁNCHEZ",
  },
  [LOPEZ_ALIAGA_PARTY]: {
    label: "López Aliaga",
    votesHeader: "VOTOS LÓPEZ ALIAGA",
  },
  [NIETO_PARTY]: {
    label: "Nieto",
    votesHeader: "VOTOS NIETO",
  },
};
let selectedRegionalCandidate = SANCHEZ_PARTY;

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

// Filtra una lista de timestamps (formato YYYYMMDD_HHMMSS) conservando
// un único valor por bucket de 30 minutos (el más reciente de cada ventana).
function filterHalfHourTimestamps(timestamps) {
  const buckets = new Map();
  for (const ts of timestamps) {
    const m = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
    if (!m) continue;
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    const bucket = Math.floor(dt.getTime() / HALF_HOUR_MS);
    if (!buckets.has(bucket) || ts > buckets.get(bucket)) buckets.set(bucket, ts);
  }
  return [...buckets.values()].sort();
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

function partyVotesInRegion(region, partyNameCanonical) {
  return (region.partidos || [])
    .filter(p => canonicalPartyName(p.nombre) === partyNameCanonical)
    .reduce((acc, p) => acc + (parseInt(p.votos) || 0), 0);
}

function leadingPartyInRegion(region) {
  const totalsByParty = new Map();
  for (const p of (region.partidos || [])) {
    const rawName = p.nombre || "";
    if (isSpecial(rawName)) continue;
    const partyName = canonicalPartyName(rawName);
    totalsByParty.set(partyName, (totalsByParty.get(partyName) || 0) + (parseInt(p.votos) || 0));
  }

  let bestName = "";
  let bestVotes = -1;
  for (const [name, votes] of totalsByParty.entries()) {
    if (votes > bestVotes) {
      bestName = name;
      bestVotes = votes;
    }
  }
  return { name: bestName, votes: bestVotes };
}

function projectedVotesInRegion(projectedByParty, partyNameCanonical) {
  if (!projectedByParty) return 0;
  return Object.entries(projectedByParty)
    .filter(([name]) => canonicalPartyName(name) === partyNameCanonical)
    .reduce((acc, [, votes]) => acc + (Number(votes) || 0), 0);
}

function buildTopRegionalLeaderStats(latestPayload, simpleProjectionByRegion, ruralProjectionByRegion, candidatePartyName = SANCHEZ_PARTY) {
  const regions = latestPayload.regions || [];
  const candidateRegions = [];
  const candidatePartyCanonical = canonicalPartyName(candidatePartyName);

  for (const region of regions) {
    const leader = leadingPartyInRegion(region);
    if (leader.name !== candidatePartyCanonical) continue;

    const actasPct = Number(region.actas_pct) || 0;
    const candidateVotes = partyVotesInRegion(region, candidatePartyCanonical);
    const regionName = region.region || "—";
    const simpleProjection = projectedVotesInRegion(simpleProjectionByRegion[regionName], candidatePartyCanonical);
    const ruralProjection = projectedVotesInRegion(ruralProjectionByRegion[regionName], candidatePartyCanonical);

    candidateRegions.push({
      region: region.region || "—",
      actasPct,
      candidateVotes,
      simpleProjection: Math.round(simpleProjection || candidateVotes),
      ruralProjection: Math.round(ruralProjection || simpleProjection || candidateVotes),
    });
  }

  const topRegions = [...candidateRegions]
    .sort((a, b) => b.candidateVotes - a.candidateVotes);

  return {
    topRegions,
  };
}

function formatInt(n) {
  return Math.round(n || 0).toLocaleString("es-PE");
}

function renderTopRegionalLeadersPanel(stats, candidatePartyName = SANCHEZ_PARTY) {
  const tbody = document.getElementById("pro-sanchez-table-body");
  const title = document.getElementById("candidate-top-title");
  const votesHeader = document.getElementById("candidate-votes-header");
  const candidateLabel = CANDIDATE_OPTIONS[candidatePartyName]?.label || candidatePartyName;
  const dynamicVotesHeader = CANDIDATE_OPTIONS[candidatePartyName]?.votesHeader || `VOTOS ${candidateLabel.toUpperCase()}`;
  const topCount = stats.topRegions.length;
  if (title) title.textContent = `Top ${topCount} regiones en las que ${candidateLabel} está primero`;
  if (votesHeader) votesHeader.textContent = dynamicVotesHeader;
  if (!tbody) return;

  if (!stats.topRegions.length) {
    tbody.innerHTML = `<tr><td colspan="5">No hay regiones con liderazgo de ${candidateLabel} aún.</td></tr>`;
  } else {
    tbody.innerHTML = stats.topRegions.map(r => `
      <tr>
        <td>${r.region}</td>
        <td>${r.actasPct.toFixed(3)}%</td>
        <td>${formatInt(r.candidateVotes)}</td>
        <td class="col-simple" title="Proyección lineal al 100% de actas en la región, manteniendo la misma proporción observada del candidato.">${formatInt(r.simpleProjection)}</td>
        <td class="col-rural" title="Proyección aplicando ajuste rural en regiones elegibles; fuera de esas regiones, coincide con la proyección simple.">${formatInt(r.ruralProjection)}</td>
      </tr>
    `).join("");
  }
}

function renderSimpleRegionalLeadersPanel(stats, candidatePartyName, panelConfig) {
  const section = document.getElementById(panelConfig.sectionId);
  const tbody = document.getElementById(panelConfig.bodyId);
  const title = document.getElementById(panelConfig.titleId);
  const votesHeader = document.getElementById(panelConfig.votesHeaderId);
  const candidateLabel = CANDIDATE_OPTIONS[candidatePartyName]?.label || candidatePartyName;
  const dynamicVotesHeader = CANDIDATE_OPTIONS[candidatePartyName]?.votesHeader || `VOTOS ${candidateLabel.toUpperCase()}`;

  if (!section || !tbody || !title || !votesHeader) return;

  const topCount = stats.topRegions.length;
  title.textContent = `Top ${topCount} regiones en las que ${candidateLabel} está primero`;
  votesHeader.textContent = dynamicVotesHeader;

  if (!stats.topRegions.length) {
    section.classList.add("hidden");
    tbody.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  tbody.innerHTML = stats.topRegions.map(r => `
    <tr>
      <td>${r.region}</td>
      <td>${r.actasPct.toFixed(3)}%</td>
      <td>${formatInt(r.candidateVotes)}</td>
      <td class="col-simple" title="Proyección lineal al 100% de actas en la región, manteniendo la misma proporción observada del candidato.">${formatInt(r.simpleProjection)}</td>
    </tr>
  `).join("");
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
//  Growth rate chart: delta de votos por snapshot
// ─────────────────────────────────────────────
let growthRateChartInstance = null;

function renderGrowthRateChart(snapshots) {
  const canvas = document.getElementById("growth-rate-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (growthRateChartInstance) growthRateChartInstance.destroy();

  const sumByNormalized = (totals, normalizedParty) =>
    Object.entries(totals)
      .filter(([k]) => normalizeName(k) === normalizedParty)
      .reduce((acc, [, v]) => acc + v, 0);

  // Agrupa en buckets horarios, tomando el snapshot más reciente de cada hora
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const byHour = new Map();
  for (const s of snapshots) {
    const bucket = Math.floor(s.dt.getTime() / ONE_HOUR_MS);
    const existing = byHour.get(bucket);
    if (!existing || s.dt > existing.dt) byHour.set(bucket, s);
  }
  const hourlySnaps = [...byHour.values()].sort((a, b) => a.dt - b.dt);

  if (hourlySnaps.length < 2) {
    document.getElementById("growth-rate-chart-container").innerHTML =
      `<p style="color:#7b7f94;padding:1rem 0">Se necesitan al menos 2 cortes horarios para mostrar el ritmo de crecimiento.</p>`;
    return;
  }

  // Calcula deltas a partir del segundo snapshot
  const labels = [];
  const rlaDeltas = [];
  const rsDeltas  = [];

  for (let i = 1; i < hourlySnaps.length; i++) {
    const prev = hourlySnaps[i - 1];
    const curr = hourlySnaps[i];

    const rlaOld = sumByNormalized(prev.totals, RLA_PARTY);
    const rsOld  = sumByNormalized(prev.totals, RS_PARTY);
    const rlaNew = sumByNormalized(curr.totals, RLA_PARTY);
    const rsNew  = sumByNormalized(curr.totals, RS_PARTY);

    const bucketMs = Math.floor(curr.dt.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS;
    labels.push(new Date(bucketMs).toLocaleTimeString("es-PE", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Lima",
    }));
    rlaDeltas.push(Math.max(0, rlaNew - rlaOld));
    rsDeltas.push(Math.max(0, rsNew  - rsOld));
  }

  const rlaColor = "#0057b8";
  const rsColor  = "#32cd32";

  growthRateChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "López Aliaga",
          data: rlaDeltas,
          borderColor: rlaColor,
          backgroundColor: rlaColor + "33",
          borderWidth: 2,
          pointRadius: 5,
          tension: 0.3,
          fill: false,
        },
        {
          label: "Sánchez",
          data: rsDeltas,
          borderColor: rsColor,
          backgroundColor: rsColor + "33",
          borderWidth: 2,
          pointRadius: 5,
          tension: 0.3,
          fill: false,
        },
      ],
    },
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
            label: ctx => ` ${ctx.dataset.label}: +${ctx.parsed.y.toLocaleString("es-PE")} votos`,
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
          title: {
            display: true,
            text: "Votos nuevos por hora",
            color: "#7b7f94",
            font: { size: 11 },
          },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────
//  Regiones remotas (las que usa la proyección rural)
// ─────────────────────────────────────────────
const REMOTE_REGIONS = new Set([
  "AMAZONAS", "APURIMAC", "AYACUCHO", "CUSCO", "HUANCAVELICA",
  "HUANUCO", "LORETO", "MADRE DE DIOS", "PUNO", "SAN MARTIN", "UCAYALI",
]);

function normalizeRegionKey(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function isLimaOrExtranjero(regionName) {
  const n = normalizeRegionKey(regionName);
  return n === "LIMA" || n === "LIMA PROVINCIAS" || n === "LIMA METROPOLITANA" ||
         n.includes("EXTRANJERO") || n.includes("EXTERIOR") || n === "CALLAO";
}

function isRemoteRegion(regionName) {
  return REMOTE_REGIONS.has(normalizeRegionKey(regionName));
}

const RLA_PARTY  = "RENOVACION POPULAR";
const RS_PARTY   = "JUNTOS POR EL PERU";

function votesForPartyInRegion(region, partyNormalized) {
  const entry = (region.partidos || []).find(
    p => normalizeName(p.nombre) === partyNormalized
  );
  return parseInt(entry?.votos, 10) || 0;
}

function computePendingVotes(latestPayload) {
  const regions = latestPayload.regions || [];
  let pendingLima = 0;
  let pendingRural = 0;
  let pendingOther = 0;
  let rlaLima = 0, rsLima = 0;
  let rlaRural = 0, rsRural = 0;

  for (const region of regions) {
    const actasPct = Number(region.actas_pct) || 0;
    const emitidos = parseInt(region.emitidos_actual, 10) || 0;
    const projectedTotal = actasPct > 0
      ? Math.round((emitidos * 100) / actasPct)
      : emitidos;
    const remaining = Math.max(0, projectedTotal - emitidos);

    const rlaVotes = votesForPartyInRegion(region, RLA_PARTY);
    const rsVotes  = votesForPartyInRegion(region, RS_PARTY);

    if (isLimaOrExtranjero(region.region)) {
      pendingLima += remaining;
      rlaLima += rlaVotes;
      rsLima  += rsVotes;
    } else if (isRemoteRegion(region.region)) {
      pendingRural += remaining;
      rlaRural += rlaVotes;
      rsRural  += rsVotes;
    } else {
      pendingOther += remaining;
    }
  }

  return { pendingLima, pendingRural, pendingOther, rlaLima, rsLima, rlaRural, rsRural };
}

function renderFrenteAFrente(latestPayload, snapshots) {
  const regions = latestPayload.regions || [];
  let rlaTotal = 0, rsTotal = 0;

  for (const region of regions) {
    rlaTotal += votesForPartyInRegion(region, RLA_PARTY);
    rsTotal  += votesForPartyInRegion(region, RS_PARTY);
  }

  const rlaEl   = document.getElementById("ffe-votes-rla");
  const rsEl    = document.getElementById("ffe-votes-rs");
  const diffRow = document.getElementById("ffe-diff-row");

  if (rlaEl) rlaEl.textContent = formatInt(rlaTotal);
  if (rsEl)  rsEl.textContent  = formatInt(rsTotal);

  if (diffRow) {
    if (rlaTotal === 0 && rsTotal === 0) {
      diffRow.textContent = "—";
      diffRow.className = "ffe-diff-row";
    } else {
      const diff   = Math.abs(rlaTotal - rsTotal);
      const leader = rlaTotal >= rsTotal ? "rla" : "rs";
      const name   = leader === "rla" ? "López Aliaga va adelante" : "Sánchez va adelante";
      diffRow.className = `ffe-diff-row ffe-diff-row--${leader}`;
      diffRow.textContent = `+${formatInt(diff)} — ${name}`;
    }
  }

  // Votos en la última hora
  const rlaHourEl = document.getElementById("ffe-votes-rla-hour");
  const rsHourEl  = document.getElementById("ffe-votes-rs-hour");
  if (rlaHourEl && rsHourEl && snapshots && snapshots.length >= 2) {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const latestSnap = snapshots[snapshots.length - 1];
    const cutoff = latestSnap.dt.getTime() - ONE_HOUR_MS;
    // El snapshot más antiguo dentro de la última hora (o el más antiguo disponible)
    const oldSnap = snapshots.find(s => s.dt.getTime() >= cutoff) || snapshots[0];

    const sumByNormalized = (totals, normalizedParty) =>
      Object.entries(totals)
        .filter(([k]) => normalizeName(k) === normalizedParty)
        .reduce((acc, [, v]) => acc + v, 0);

    const rlaOld = sumByNormalized(oldSnap.totals, RLA_PARTY);
    const rsOld  = sumByNormalized(oldSnap.totals, RS_PARTY);
    const rlaNew = sumByNormalized(latestSnap.totals, RLA_PARTY);
    const rsNew  = sumByNormalized(latestSnap.totals, RS_PARTY);

    const rlaDelta = Math.max(0, rlaNew - rlaOld);
    const rsDelta  = Math.max(0, rsNew  - rsOld);

    rlaHourEl.textContent = formatInt(rlaDelta);
    rsHourEl.textContent  = formatInt(rsDelta);
  }
}

// ─────────────────────────────────────────────
//  Status bar
// ─────────────────────────────────────────────
function updateStatusBar(latestPayload, snapshots) {
  const meta = latestPayload.metadata || {};
  const actasPct = typeof meta.actas_pct_global === "number"
    ? meta.actas_pct_global.toFixed(3)
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
  actasEl.textContent = actasPct !== "—" ? `${actasPct}%` : "—";
  extractedEl.textContent = extractedAt;

  // Update "¿Qué es esto?" panel dynamic percentage
  const qeePct = document.getElementById("qee-actas-pct");
  if (qeePct && typeof meta.actas_pct_global === "number") {
    qeePct.textContent = `${meta.actas_pct_global.toFixed(1)}% contabilizado`;
  }

  // Update pending votes panel
  const { pendingLima, pendingRural, pendingOther } = computePendingVotes(latestPayload);
  const pendingLimaEl  = document.getElementById("pending-lima");
  const pendingRuralEl = document.getElementById("pending-rural");
  const pendingOtherEl = document.getElementById("pending-other");
  const pendingTotalEl = document.getElementById("pending-total");
  if (pendingLimaEl)  pendingLimaEl.textContent  = formatInt(pendingLima);
  if (pendingRuralEl) pendingRuralEl.textContent  = formatInt(pendingRural);
  if (pendingOtherEl) pendingOtherEl.textContent  = formatInt(pendingOther);
  if (pendingTotalEl) pendingTotalEl.textContent  = formatInt(pendingLima + pendingRural + pendingOther);

  renderFrenteAFrente(latestPayload, snapshots);

  return extractedAt;
}

// ─────────────────────────────────────────────
//  Main load
// ─────────────────────────────────────────────
let _firstLoad = true;
// Caché en memoria: map de timestamp → payload ya descargado.
// Se pre-carga desde localStorage al iniciar para no re-descargar
// snapshots ya conocidos tras un reload de página.
function _tsFromPayload(payload) {
  // Deriva el timestamp de directorio (YYYYMMDD_HHMMSS) desde extracted_at_utc
  const raw = payload?.metadata?.extracted_at_utc;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

const _snapshotCache = (() => {
  const m = new Map();
  try {
    const cached = loadSnapshotsFromLS();
    if (cached) {
      for (const payload of cached.data) {
        const ts = _tsFromPayload(payload);
        if (ts) m.set(ts, payload);
      }
    }
  } catch (_) { /* ignorar */ }
  return m;
})();

async function loadAndRender() {
  hideError();
  await ensurePartiesCatalog();

  if (_firstLoad) showLoadingOverlay();

  // ── Carga de datos ─────────────────────────────────────────────────────────
  // El pipeline publica history_bundle.json: un único archivo JSON con todos
  // los snapshots filtrados (uno por bucket de 30 min) dentro de { snapshots: [] }.
  // Esto reemplaza la estrategia anterior de N requests paralelos a archivos
  // individuales, que causaba errores 429 en el servidor.
  //
  // Flujo:
  //   1. Intentar fetch de history_bundle.json (1 request)
  //   2. Comparar el snapshot más reciente del bundle contra _snapshotCache:
  //      si ya lo tenemos, no hay nada nuevo — omitir re-render en refreshes
  //   3. Poblar _snapshotCache con los payloads del bundle
  //   4. Guardar en localStorage como fallback offline
  //   5. Si el fetch falla, usar localStorage como fuente de datos
  // ──────────────────────────────────────────────────────────────────────────

  let rawPayloads = null;

  try {
    const bundle = await fetchJSON(`${BASE_URL}/history_bundle.json`);
    const incoming = Array.isArray(bundle.snapshots) ? bundle.snapshots : [];

    if (incoming.length === 0) {
      if (_firstLoad) hideLoadingOverlay();
      showError("No hay snapshots disponibles aún. El pipeline aún no ha subido datos.");
      _firstLoad = false;
      return;
    }

    // Poblar _snapshotCache con todos los payloads del bundle.
    // Usamos extracted_at_utc como clave para detectar novedades.
    for (const payload of incoming) {
      const ts = _tsFromPayload(payload);
      if (ts) _snapshotCache.set(ts, payload);
    }

    rawPayloads = incoming;
    saveSnapshotsToLS(rawPayloads);
  } catch (e) {
    // El servidor no responde o devuelve error: usar datos guardados localmente.
    const cached = loadSnapshotsFromLS();
    if (cached) {
      rawPayloads = cached.data;
      const savedAgo = Math.round((Date.now() - cached.savedAt) / 60000);
      showError(`Sin conexión al servidor. Mostrando datos guardados hace ${savedAgo} min.`);
    } else {
      if (_firstLoad) hideLoadingOverlay();
      showError(
        `No se pudo cargar history_bundle.json desde ${BASE_URL}. ` +
        `Asegúrate de que el pipeline haya publicado los datos. (${e.message})`
      );
      _firstLoad = false;
      return;
    }
  }

  const snapshots = [];
  for (let i = 0; i < rawPayloads.length; i++) {
    const payload = rawPayloads[i];
    const meta = payload.metadata || {};
    let dt;
    try {
      dt = new Date(meta.extracted_at_utc);
      if (isNaN(dt.getTime())) throw new Error("invalid");
    } catch {
      continue;
    }
    snapshots.push({ dt, totals: aggregateSnapshot(payload), payload });
  }

  if (snapshots.length === 0) {
    if (_firstLoad) hideLoadingOverlay();
    showError("No se pudieron cargar los snapshots del servidor.");
    _firstLoad = false;
    return;
  }

  snapshots.sort((a, b) => a.dt - b.dt);
  const trendSnapshots = getHalfHourSnapshots(snapshots);

  // 3. Determinar top 6 del snapshot más reciente
  const latestFromServer = snapshots[snapshots.length - 1];

  // Nunca retroceder: conservar el snapshot más reciente visto en cualquier refresh
  if (
    !bestLatestPayload ||
    latestFromServer.dt.getTime() > new Date(bestLatestPayload.payload?.metadata?.extracted_at_utc).getTime()
  ) {
    bestLatestPayload = latestFromServer;
  }
  const latest = bestLatestPayload;

  const top5 = top5FromTotals(latest.totals);  // devuelve hasta TOP_N
  const top5Names = top5.map(([name]) => name);
  const currentStats = buildCurrentProcessingStats(latest.totals);
  const nationalStats = window.ProjectionModes.buildNationalProjectionStats(latest.payload);
  const ruralStats = window.ProjectionModes.buildRuralProjectionStats(latest.payload);
  const simpleProjectionByRegion = window.ProjectionModes.buildSimpleProjectionByRegion(latest.payload);
  const ruralProjectionByRegion = window.ProjectionModes.buildRuralProjectionByRegion(latest.payload);
  const topRegionalLeadersStats = buildTopRegionalLeaderStats(
    latest.payload,
    simpleProjectionByRegion,
    ruralProjectionByRegion,
    selectedRegionalCandidate
  );
  const lopezTopRegionalLeadersStats = buildTopRegionalLeaderStats(
    latest.payload,
    simpleProjectionByRegion,
    ruralProjectionByRegion,
    LOPEZ_ALIAGA_PARTY
  );
  const nietoTopRegionalLeadersStats = buildTopRegionalLeaderStats(
    latest.payload,
    simpleProjectionByRegion,
    ruralProjectionByRegion,
    NIETO_PARTY
  );
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
  updateStatusBar(latest.payload, snapshots);
  renderMainChart();
  renderTopRegionalLeadersPanel(topRegionalLeadersStats, selectedRegionalCandidate);
  renderSimpleRegionalLeadersPanel(lopezTopRegionalLeadersStats, LOPEZ_ALIAGA_PARTY, {
    sectionId: "pro-lopez-section",
    titleId: "candidate-top-lopez-title",
    votesHeaderId: "candidate-votes-lopez-header",
    bodyId: "pro-lopez-table-body",
  });
  renderSimpleRegionalLeadersPanel(nietoTopRegionalLeadersStats, NIETO_PARTY, {
    sectionId: "pro-nieto-section",
    titleId: "candidate-top-nieto-title",
    votesHeaderId: "candidate-votes-nieto-header",
    bodyId: "pro-nieto-table-body",
  });

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

  // Gráfico de ritmo de crecimiento horario
  const growthContainer = document.getElementById("growth-rate-chart-container");
  if (growthContainer) {
    if (!document.getElementById("growth-rate-chart")) {
      growthContainer.innerHTML = `<canvas id="growth-rate-chart"></canvas>`;
    }
    renderGrowthRateChart(snapshots);
  }

  if (_firstLoad) {
    hideLoadingOverlay();
    _firstLoad = false;
  }
}

// ─────────────────────────────────────────────
//  Init + auto-refresh cada 5 min
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("header-compact");

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
  // ¿Qué es esto? toggle
  const qeeBtn = document.getElementById("que-es-esto-btn");
  const qeePanel = document.getElementById("que-es-esto-panel");
  if (qeeBtn && qeePanel) {
    qeeBtn.addEventListener("click", () => {
      const isOpen = !qeePanel.hidden;
      qeePanel.hidden = isOpen;
      qeeBtn.setAttribute("aria-expanded", String(!isOpen));
      qeeBtn.classList.toggle("active", !isOpen);
    });
  }

  loadAndRender();
  setInterval(loadAndRender, 300_000);
});
