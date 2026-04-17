// ─────────────────────────────────────────────
//  CONFIG — inyectado por el pipeline desde .env (WEB_BASE_URL).
//  El build script reemplaza __BASE_URL__ con el valor real.
//
//  Estructura esperada en el servidor:
//    <BASE_URL>/api/v1/dashboard/summary
//    <BASE_URL>/api/v1/dashboard/latest
//    <BASE_URL>/api/v1/race/latest
//    <BASE_URL>/api/v1/timelapse/series
// ─────────────────────────────────────────────
const INJECTED_BASE_URL = '__BASE_URL__';

function resolveBaseUrl(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw || raw === "__BASE_URL__") return "";
  const unquoted = raw.replace(/^['"]+|['"]+$/g, "").trim();
  if (!unquoted || unquoted === "__BASE_URL__") return "";
  return unquoted.replace(/\/+$/, "");
}

const BASE_URL = resolveBaseUrl(INJECTED_BASE_URL);
const PARTIES_CATALOG_URL = "./parties.json";
const API_BASE_URL = BASE_URL ? `${BASE_URL}/api/v1` : "./api/v1";
const API_DASHBOARD_SUMMARY_URL = `${API_BASE_URL}/dashboard/summary`;
const API_DASHBOARD_LATEST_URL = `${API_BASE_URL}/dashboard/latest`;

console.log("Gracias por visitar esta aplicación. Te invito a revisar mis otros proyectos en https://perulainen.com\n¡Viva el Perú!");

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
//  Utilidades de snapshot (timestamps, merge)
// ─────────────────────────────────────────────
function snapshotTimestampFromPayload(payload) {
  const raw = payload?.metadata?.extracted_at_utc;
  if (!raw) return NaN;
  return new Date(raw).getTime();
}

function snapshotTimestampFromEntry(entry) {
  if (!entry) return NaN;
  if (entry.dt instanceof Date) return entry.dt.getTime();
  return snapshotTimestampFromPayload(entry.payload);
}

function pickLatestSnapshotEntry(snapshots) {
  let latest = null;
  for (const entry of snapshots) {
    const ts = snapshotTimestampFromEntry(entry);
    if (!Number.isFinite(ts)) continue;
    if (!latest || ts > snapshotTimestampFromEntry(latest)) {
      latest = entry;
    }
  }
  return latest;
}

function promoteActiveLatestSnapshot(candidate) {
  const candidateTs = snapshotTimestampFromEntry(candidate);
  if (!Number.isFinite(candidateTs)) return activeLatestSnapshot;
  if (!activeLatestSnapshot || candidateTs > activeLatestSnapshotTs) {
    activeLatestSnapshot = candidate;
    activeLatestSnapshotTs = candidateTs;
  }
  return activeLatestSnapshot;
}

function mergeActiveSnapshotIntoSeries(snapshots, activeEntry) {
  if (!activeEntry) return snapshots;
  const activeTs = snapshotTimestampFromEntry(activeEntry);
  if (!Number.isFinite(activeTs)) return snapshots;
  const out = [...snapshots];
  const existingIndex = out.findIndex(entry => snapshotTimestampFromEntry(entry) === activeTs);
  if (existingIndex >= 0) {
    out[existingIndex] = activeEntry;
  } else {
    out.push(activeEntry);
    out.sort((a, b) => a.dt - b.dt);
  }
  return out;
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
let ffeDuelChartInstance = null;
let trendChartInstance = null;
let mainChartMode = "actual";
let ffeDuelChartMode = "actual";
let mainChartData = null;
let ffeDuelChartData = null;
let activeLatestSnapshot = null; // snapshot visible más reciente aceptado por la UI
let activeLatestSnapshotTs = Number.NEGATIVE_INFINITY;
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

const FFE_DUEL_MODE_META = {
  actual: {
    note: "Votos válidos ya contabilizados (ONPE) para los dos candidatos, sumando todas las regiones y Peruanos en el extranjero. Barras: % sobre el total nacional válido del modo.",
    tooltipSuffix: "votos contados",
  },
  simple: {
    note: "Proyección simple al 100% de actas por región (cada departamento y Peruanos en el extranjero), agregada a nivel nacional y extranjero para los dos candidatos. Barras: % sobre el total nacional válido del modo.",
    tooltipSuffix: "votos proyectados simple",
  },
  rural: {
    note: "Proyección con sesgo rural en regiones donde lidera Sánchez (misma lógica que el Top 6 en modo voto rural). Los totales incluyen todas las regiones y el voto en el extranjero. Barras: % sobre el total nacional válido del modo.",
    tooltipSuffix: "votos proyectados voto rural",
  },
  ruralFallback: {
    note: "Voto rural sin regiones elegibles en este corte; coincide con la proyección simple agregada para el duelo (nacional + extranjero). Barras: % sobre el total nacional válido del modo.",
    tooltipSuffix: "votos proyectados",
  },
  impugnacionRural: {
    note: "Misma proyección simple nacional (nacional + extranjero) que el modo SIMPLE, pero se descuenta solo del tramo en disputa JEE/JNE en departamentos fuera de Lima donde Sánchez va primero frente a López Aliaga. El ajuste se aplica únicamente sobre la parte proyectada (no sobre votos ya contados). «Rural» solo nombra ese conjunto de zonas. Lima va en «Impugnación Lima». Barras: % sobre el total nacional válido del modo.",
    tooltipSuffix: "votos (simulación impugnación rural)",
  },
  impugnacionLima: {
    note: "Misma proyección simple nacional (nacional + extranjero) que el modo SIMPLE, pero se descuenta solo del tramo en disputa JEE/JNE del departamento Lima entre ambos candidatos. El ajuste se aplica únicamente sobre la parte proyectada (no sobre votos ya contados). Barras: % sobre el total nacional válido del modo.",
    tooltipSuffix: "votos (simulación impugnación Lima)",
  },
};

function computePercentAxisMax(values) {
  const maxValue = Math.max(0, ...values.map(v => Number(v) || 0));
  const padded = maxValue * 1.15;
  const raw = Math.max(1, padded);
  let step = 1;
  if (raw <= 5) step = 0.5;
  else if (raw <= 20) step = 1;
  else if (raw <= 50) step = 2;
  else step = 5;
  return Math.ceil(raw / step) * step;
}

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
  /** Suma votos por partido en todas las regiones (clave canónica salvo blancos/nulos). */
  const totals = {};
  for (const region of payload.regions || []) {
    for (const p of region.partidos || []) {
      const name = (p.nombre || "").trim();
      if (!name) continue;
      const key = isSpecial(name) ? normalizeName(name) : canonicalPartyName(name);
      totals[key] = (totals[key] || 0) + (parseInt(p.votos) || 0);
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

function pickSnapshotForTrailingWindow(snapshots, latestSnap, windowMs) {
  if (!Array.isArray(snapshots) || snapshots.length === 0 || !latestSnap?.dt) return null;
  const cutoffMs = latestSnap.dt.getTime() - windowMs;
  let best = null;
  for (const snap of snapshots) {
    if (!snap?.dt) continue;
    if (snap.dt.getTime() <= cutoffMs) {
      if (!best || snap.dt > best.dt) best = snap;
    }
  }
  return best || snapshots[0];
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

function buildTopRegionalLeaderStats(latestPayload, simpleProjectionByRegion, ruralProjectionByRegion, candidatePartyName = SANCHEZ_PARTY, filterLeading = true) {
  const regions = latestPayload.regions || [];
  const candidateRegions = [];
  const candidatePartyCanonical = canonicalPartyName(candidatePartyName);

  for (const region of regions) {
    const leader = leadingPartyInRegion(region);
    if (filterLeading && leader.name !== candidatePartyCanonical) continue;

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

function renderTopRegionalLeadersPanel(stats, candidatePartyName = SANCHEZ_PARTY, overrideTitle = null) {
  const tbody = document.getElementById("pro-sanchez-table-body");
  const title = document.getElementById("candidate-top-title");
  const votesHeader = document.getElementById("candidate-votes-header");
  const candidateLabel = CANDIDATE_OPTIONS[candidatePartyName]?.label || candidatePartyName;
  const dynamicVotesHeader = CANDIDATE_OPTIONS[candidatePartyName]?.votesHeader || `VOTOS ${candidateLabel.toUpperCase()}`;
  const topCount = stats.topRegions.length;
  if (title) title.textContent = overrideTitle || `Top ${topCount} regiones en las que ${candidateLabel} está primero`;
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

function buildPotentialVotesStats(topRegions) {
  let totalActasPct = 0;
  let totalCurrentVotes = 0;
  let totalSimple = 0;
  let totalRural = 0;
  for (const r of topRegions) {
    totalActasPct += r.actasPct;
    totalCurrentVotes += r.candidateVotes;
    totalSimple += r.simpleProjection;
    totalRural  += r.ruralProjection;
  }
  const avgActasPct = topRegions.length > 0 ? totalActasPct / topRegions.length : 0;
  return { avgActasPct, totalCurrentVotes, totalSimple, totalRural };
}

function renderPotentialVotesPanel(topRegions, panelId, titleId, bodyId, candidateLabel, hasRural = true, overrideTitle = null) {
  const panel = document.getElementById(panelId);
  const titleEl = document.getElementById(titleId);
  const bodyEl = document.getElementById(bodyId);
  if (!panel || !titleEl || !bodyEl) return;

  const topCount = topRegions.length;
  if (!topCount) {
    panel.classList.add("hidden");
    bodyEl.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  titleEl.textContent = overrideTitle || `Potenciales votos en Top ${topCount} regiones en las que ${candidateLabel} está primero`;

  const { totalCurrentVotes, totalSimple, totalRural } = buildPotentialVotesStats(topRegions);
  bodyEl.innerHTML = `
    <tr>
      <td>${formatInt(totalCurrentVotes)}</td>
      <td class="col-simple">${formatInt(totalSimple)}</td>
      ${hasRural ? `<td class="col-rural">${formatInt(totalRural)}</td>` : ""}
    </tr>
  `;
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
  title.textContent = panelConfig.overrideTitle || `Top ${topCount} regiones en las que ${candidateLabel} está primero`;
  votesHeader.textContent = dynamicVotesHeader;

  if (!stats.topRegions.length) {
    section.classList.add("hidden");
    tbody.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  if (panelConfig.hasRural) {
    tbody.innerHTML = stats.topRegions.map(r => `
      <tr>
        <td>${r.region}</td>
        <td>${r.actasPct.toFixed(3)}%</td>
        <td>${formatInt(r.candidateVotes)}</td>
        <td class="col-simple" title="Proyección lineal al 100% de actas en la región, manteniendo la misma proporción observada del candidato.">${formatInt(r.simpleProjection)}</td>
        <td class="col-rural" title="Proyección aplicando ajuste rural en regiones elegibles; fuera de esas regiones, coincide con la proyección simple.">${formatInt(r.ruralProjection)}</td>
      </tr>
    `).join("");
  } else {
    tbody.innerHTML = stats.topRegions.map(r => `
      <tr>
        <td>${r.region}</td>
        <td>${r.actasPct.toFixed(3)}%</td>
        <td>${formatInt(r.candidateVotes)}</td>
        <td class="col-simple" title="Proyección lineal al 100% de actas en la región, manteniendo la misma proporción observada del candidato.">${formatInt(r.simpleProjection)}</td>
      </tr>
    `).join("");
  }
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
              const votes = formatInt(values[ctx.dataIndex]);
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

function updateFfeDuelChartButtons() {
  const pairs = [
    ["actual", "mode-ffe-actual"],
    ["simple", "mode-ffe-simple"],
    ["rural", "mode-ffe-rural"],
    ["impugnacionRural", "mode-ffe-imp-rural"],
    ["impugnacionLima", "mode-ffe-imp-lima"],
  ];
  for (const [mode, id] of pairs) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", ffeDuelChartMode === mode);
  }
}

function renderFfeDuelChart() {
  const canvas = document.getElementById("ffe-duel-chart");
  const noteEl = document.getElementById("ffe-duel-chart-note");
  const badgeClear = document.getElementById("ffe-duel-leader-badge");
  if (!canvas || !ffeDuelChartData || typeof Chart === "undefined") {
    if (badgeClear) {
      badgeClear.textContent = "";
      badgeClear.classList.remove("ffe-duel-leader-badge--tie");
    }
    return;
  }
  const ctx = canvas.getContext("2d");
  if (ffeDuelChartInstance) ffeDuelChartInstance.destroy();

  const keyByMode = {
    actual: "actual",
    simple: "simple",
    rural: "rural",
    impugnacionRural: "impugnacionRural",
    impugnacionLima: "impugnacionLima",
  };
  const dataKey = keyByMode[ffeDuelChartMode] || "actual";
  const source = ffeDuelChartData[dataKey] || ffeDuelChartData.actual;

  const useRuralFallback =
    ffeDuelChartMode === "rural" && Boolean(source.isFallback);

  const modeMeta = useRuralFallback
    ? FFE_DUEL_MODE_META.ruralFallback
    : (FFE_DUEL_MODE_META[ffeDuelChartMode] || FFE_DUEL_MODE_META.actual);
  if (noteEl) noteEl.textContent = modeMeta.note;

  updateFfeDuelChartButtons();

  const rlaVotes = Number(source.rla) || 0;
  const sanchezVotes = Number(source.sanchez) || 0;
  const rlaPct = Number(source.rlaPct) || 0;
  const sanchezPct = Number(source.sanchezPct) || 0;

  const rows = [
    {
      key: "rla",
      label: "López Aliaga (RP)",
      shortLabel: "López Aliaga",
      votes: rlaVotes,
      pct: rlaPct,
      color: partyColor("RENOVACION POPULAR", 0),
    },
    {
      key: "sanchez",
      label: "Sánchez (JPP)",
      shortLabel: "Sánchez",
      votes: sanchezVotes,
      pct: sanchezPct,
      color: partyColor("JUNTOS POR EL PERU", 1),
    },
  ];

  const isTie = rows.length >= 2 && rows[0].votes === rows[1].votes;
  const voteDiff = rows.length >= 2 ? Math.abs(rows[0].votes - rows[1].votes) : 0;
  const winnerRow = !isTie ? rows.reduce((best, r) => (r.votes > best.votes ? r : best), rows[0]) : null;

  // Chart.js horizontal (indexAxis y): la primera categoría del array se pinta arriba.
  // Orden descendente por votos → el ganador va primero y queda arriba.
  rows.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return String(a.key).localeCompare(String(b.key));
  });

  const winnerIndex = !isTie ? 0 : -1;
  const labels = rows.map(r => r.label);
  const values = rows.map(r => r.pct);
  const votes = rows.map(r => r.votes);
  const colors = rows.map(r => r.color);
  const axisMax = computePercentAxisMax(values);
  const borderWidths = rows.map((r, i) => (!isTie && i === winnerIndex ? 3 : 1));
  const borderColors = rows.map((r, i) => {
    if (!isTie && i === winnerIndex) return "rgba(255, 255, 255, 0.92)";
    return `${r.color}cc`;
  });

  const badgeEl = document.getElementById("ffe-duel-leader-badge");
  if (badgeEl) {
    badgeEl.classList.toggle("ffe-duel-leader-badge--tie", isTie);
    if (isTie) {
      badgeEl.innerHTML = "<span>Empate en votos válidos (este modo).</span>";
    } else if (winnerRow) {
      badgeEl.innerHTML =
        `<span class="ffe-duel-crown" aria-hidden="true">👑</span>` +
        `<span>Gana: <strong>${winnerRow.shortLabel}</strong> · +${formatInt(voteDiff)} votos de diferencia</span>`;
    }
  }

  ffeDuelChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: borderWidths,
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
              const i = ctx.dataIndex;
              const lead = !isTie && i === winnerIndex ? " · 1.er lugar" : "";
              return ` ${labels[i]}: ${values[i].toFixed(2)}% (${formatInt(votes[i])} ${modeMeta.tooltipSuffix})${lead}`;
            },
          },
        },
      },
      scales: {
        x: {
          min: 0,
          max: axisMax,
          ticks: {
            color: "#7b7f94",
            callback: v => `${Number(v).toFixed(1)}%`,
          },
          grid: { color: "#2a2d3a" },
        },
        y: {
          ticks: { color: "#e8eaf0", font: { size: 11 } },
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
    const curr = hourlySnaps[i];
    const prev = pickSnapshotForTrailingWindow(hourlySnaps, curr, ONE_HOUR_MS);
    if (!prev) continue;

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
    const oldSnap = pickSnapshotForTrailingWindow(snapshots, latestSnap, ONE_HOUR_MS);
    if (!oldSnap) return;

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
let _isLoading = false;
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

// Caché en memoria: map de timestamp → payload de la sesión actual.
const _snapshotCache = new Map();

function setRefreshLinkState(isLoading) {
  const refreshLink = document.getElementById("refresh-link");
  if (!refreshLink) return;
  refreshLink.disabled = isLoading;
  refreshLink.setAttribute("aria-busy", String(isLoading));
  refreshLink.textContent = isLoading ? "Actualizando..." : "Actualizar";
}

function pickFallbackForAttempt() {
  if (activeLatestSnapshot) {
    return {
      rawPayloads: [activeLatestSnapshot.payload],
      usingStaleFallback: true,
      message: "Sin conexión al servidor. Conservando el snapshot más reciente ya visible. Usa \"Actualizar\" para reintentar.",
    };
  }
  return null;
}

function buildDummyHistoryPayload(extractedAtUtc, actasPctGlobal, regionalRows) {
  return {
    metadata: {
      extracted_at_utc: extractedAtUtc,
      actas_pct_global: actasPctGlobal,
    },
    regions: regionalRows.map(row => ({
      region: row.region,
      actas_pct: row.actasPct,
      emitidos_actual: row.emitidos,
      partidos: [
        { nombre: "RENOVACION POPULAR", votos: String(row.rla) },
        { nombre: "JUNTOS POR EL PERU", votos: String(row.rs) },
        { nombre: "FUERZA POPULAR", votos: String(row.fp) },
      ],
    })),
  };
}

function buildDummyHistoryBundle() {
  return {
    snapshots: [
      buildDummyHistoryPayload("2026-04-16T10:00:00Z", 62.4, [
        { region: "LIMA", actasPct: 75.1, emitidos: 1500000, rla: 520000, rs: 260000, fp: 180000 },
        { region: "CUSCO", actasPct: 58.2, emitidos: 380000, rla: 62000, rs: 192000, fp: 54000 },
        { region: "PIURA", actasPct: 60.8, emitidos: 430000, rla: 142000, rs: 118000, fp: 72000 },
      ]),
      buildDummyHistoryPayload("2026-04-16T11:00:00Z", 64.8, [
        { region: "LIMA", actasPct: 77.0, emitidos: 1560000, rla: 548000, rs: 276000, fp: 186000 },
        { region: "CUSCO", actasPct: 60.0, emitidos: 395000, rla: 66000, rs: 201000, fp: 56000 },
        { region: "PIURA", actasPct: 62.7, emitidos: 446000, rla: 149000, rs: 123000, fp: 74000 },
      ]),
      buildDummyHistoryPayload("2026-04-16T12:00:00Z", 67.3, [
        { region: "LIMA", actasPct: 79.5, emitidos: 1645000, rla: 586000, rs: 294000, fp: 194000 },
        { region: "CUSCO", actasPct: 62.3, emitidos: 412000, rla: 70000, rs: 212000, fp: 58000 },
        { region: "PIURA", actasPct: 65.1, emitidos: 466000, rla: 158000, rs: 130000, fp: 77000 },
      ]),
    ],
  };
}

function buildSnapshotsFromRawPayloads(rawPayloads) {
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
  return snapshots;
}

function parseTotalsMap(rawTotals) {
  const totals = {};
  for (const [name, votes] of Object.entries(rawTotals || {})) {
    const partyName = String(name || "").trim();
    if (!partyName) continue;
    const v = Number.parseInt(votes, 10) || 0;
    const key = isSpecial(partyName) ? normalizeName(partyName) : canonicalPartyName(partyName);
    totals[key] = (totals[key] || 0) + v;
  }
  return totals;
}

function buildSnapshotsFromApi(summaryPayload, latestPayload) {
  const summaryRows = Array.isArray(summaryPayload?.snapshots) ? summaryPayload.snapshots : [];
  const snapshots = [];
  for (const row of summaryRows) {
    const extractedAtUtc = row?.extracted_at_utc;
    const dt = new Date(extractedAtUtc);
    if (isNaN(dt.getTime())) continue;
    const meta = {
      extracted_at_utc: extractedAtUtc,
      actas_pct_global: Number(row?.actas_pct_global) || 0,
    };
    if (row?.impugnadas_resumen && typeof row.impugnadas_resumen === "object") {
      meta.impugnadas_resumen = row.impugnadas_resumen;
    }
    snapshots.push({
      dt,
      totals: parseTotalsMap(row?.totals_by_party),
      payload: {
        metadata: meta,
        regions: [],
      },
    });
  }

  if (latestPayload?.metadata?.extracted_at_utc && Array.isArray(latestPayload?.regions)) {
    const latestTs = snapshotTimestampFromPayload(latestPayload);
    const fullLatestEntry = {
      dt: new Date(latestPayload.metadata.extracted_at_utc),
      totals: aggregateSnapshot(latestPayload),
      payload: latestPayload,
    };
    const index = snapshots.findIndex(s => snapshotTimestampFromEntry(s) === latestTs);
    if (index >= 0) {
      snapshots[index] = {
        ...snapshots[index],
        totals: aggregateSnapshot(latestPayload),
        payload: latestPayload,
      };
    } else if (!isNaN(fullLatestEntry.dt.getTime())) {
      snapshots.push(fullLatestEntry);
    }
  }
  return snapshots;
}

async function fetchApiDashboardPayloads() {
  const [summary, latestWrapper] = await Promise.all([
    fetchJSON(API_DASHBOARD_SUMMARY_URL),
    fetchJSON(API_DASHBOARD_LATEST_URL),
  ]);
  const latestPayload = latestWrapper?.snapshot || null;
  return { summary, latestPayload };
}

async function loadAndRender() {
  if (_isLoading) return;
  _isLoading = true;
  setRefreshLinkState(true);

  hideError();
  try {
    await ensurePartiesCatalog();

    if (_firstLoad) showLoadingOverlay();

  // ── Carga de datos ─────────────────────────────────────────────────────────
  // Flujo:
  //   1. Fetch de /api/v1/dashboard/summary y /api/v1/dashboard/latest
  //   2. Si falla y hay snapshot en memoria → mantener vista actual
  //   3. Si falla sin datos previos → usar data dummy local
  // ──────────────────────────────────────────────────────────────────────────

    let snapshots = null;
    let usingStaleFallback = false;
    let fallbackUsed = false;

    try {
      if (BASE_URL) {
        const { summary, latestPayload } = await fetchApiDashboardPayloads();
        snapshots = buildSnapshotsFromApi(summary, latestPayload);
        const latestTs = _tsFromPayload(latestPayload);
        if (latestTs && latestPayload) _snapshotCache.set(latestTs, latestPayload);
      } else {
        const bundle = buildDummyHistoryBundle();
        const incoming = Array.isArray(bundle.snapshots) ? bundle.snapshots : [];
        snapshots = buildSnapshotsFromRawPayloads(incoming);
      }

      if (!snapshots || snapshots.length === 0) {
        if (_firstLoad) hideLoadingOverlay();
        showError("No hay snapshots disponibles aún. El pipeline aún no ha subido datos.");
        _firstLoad = false;
        return;
      }
      if (BASE_URL && !snapshots.some(s => Array.isArray(s?.payload?.regions) && s.payload.regions.length > 0)) {
        throw new Error("API dashboard/latest sin regiones válidas");
      }
    } catch (e) {
      if (!fallbackUsed) {
        const fallback = pickFallbackForAttempt();
        if (fallback) {
          fallbackUsed = true;
          snapshots = buildSnapshotsFromRawPayloads(fallback.rawPayloads);
          usingStaleFallback = fallback.usingStaleFallback;
          showError(fallback.message);
        }
      }

      if (!snapshots || snapshots.length === 0) {
        const bundle = buildDummyHistoryBundle();
        snapshots = buildSnapshotsFromRawPayloads(Array.isArray(bundle.snapshots) ? bundle.snapshots : []);
        if (snapshots.length) {
          showError("Servidor de datos no disponible. Mostrando data dummy para pruebas.");
        }
      }

      if (!snapshots || snapshots.length === 0) {
        if (_firstLoad) hideLoadingOverlay();
        showError(
          `No se pudo cargar la API desde ${BASE_URL}. ` +
          `Asegúrate de que el pipeline haya publicado los datos. (${e.message || e}). ` +
          `Usa "Actualizar" para reintentar.`
        );
        _firstLoad = false;
        return;
      }
    }

    if (snapshots.length === 0) {
      if (_firstLoad) hideLoadingOverlay();
      showError("No se pudieron cargar los snapshots del servidor.");
      _firstLoad = false;
      return;
    }

    snapshots.sort((a, b) => a.dt - b.dt);
    const latestFromResponse = pickLatestSnapshotEntry(snapshots);
    const activeLatest = promoteActiveLatestSnapshot(latestFromResponse);
    if (!activeLatest) {
      if (_firstLoad) hideLoadingOverlay();
      showError("No se pudo determinar un snapshot válido para mostrar.");
      _firstLoad = false;
      return;
    }

    const renderSnapshots = usingStaleFallback
      ? mergeActiveSnapshotIntoSeries([], activeLatest)
      : mergeActiveSnapshotIntoSeries(snapshots, activeLatest);
    const trendSnapshots = getHalfHourSnapshots(renderSnapshots);

    const top5 = top5FromTotals(activeLatest.totals);  // devuelve hasta TOP_N
    const top5Names = top5.map(([name]) => name);
    const currentStats = buildCurrentProcessingStats(activeLatest.totals);
    const nationalStats = window.ProjectionModes.buildNationalProjectionStats(activeLatest.payload);
    const ruralStats = window.ProjectionModes.buildRuralProjectionStats(activeLatest.payload);
    const simpleProjectionByRegion = window.ProjectionModes.buildSimpleProjectionByRegion(activeLatest.payload);
    const ruralProjectionByRegion = window.ProjectionModes.buildRuralProjectionByRegion(activeLatest.payload);
    const topRegionalLeadersStats = buildTopRegionalLeaderStats(
      activeLatest.payload,
      simpleProjectionByRegion,
      ruralProjectionByRegion,
      selectedRegionalCandidate,
      false
    );
    const lopezTopRegionalLeadersStats = buildTopRegionalLeaderStats(
      activeLatest.payload,
      simpleProjectionByRegion,
      ruralProjectionByRegion,
      LOPEZ_ALIAGA_PARTY,
      false
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

    if (typeof window.ProjectionModes.buildHeadToHeadBundle === "function") {
      ffeDuelChartData = window.ProjectionModes.buildHeadToHeadBundle(activeLatest.payload);
    } else {
      ffeDuelChartData = null;
    }

    // 4. Renderizar
    updateStatusBar(activeLatest.payload, renderSnapshots);
    renderMainChart();
    renderFfeDuelChart();
    renderTopRegionalLeadersPanel(topRegionalLeadersStats, selectedRegionalCandidate, "Interpolación de votos de Roberto Sánchez (Juntos por el Perú)");
    renderPotentialVotesPanel(
      topRegionalLeadersStats.topRegions,
      "potential-sanchez-panel",
      "potential-sanchez-title",
      "potential-sanchez-body",
      CANDIDATE_OPTIONS[selectedRegionalCandidate]?.label || selectedRegionalCandidate,
      true,
      "Interpolación de votos de Roberto Sánchez (Juntos por el Perú)"
    );
    renderSimpleRegionalLeadersPanel(lopezTopRegionalLeadersStats, LOPEZ_ALIAGA_PARTY, {
      sectionId: "pro-lopez-section",
      titleId: "candidate-top-lopez-title",
      votesHeaderId: "candidate-votes-lopez-header",
      bodyId: "pro-lopez-table-body",
      overrideTitle: "Interpolación de votos de Rafael López Aliaga (Renovación Popular)",
    });
    renderPotentialVotesPanel(
      lopezTopRegionalLeadersStats.topRegions,
      "potential-lopez-panel",
      "potential-lopez-title",
      "potential-lopez-body",
      CANDIDATE_OPTIONS[LOPEZ_ALIAGA_PARTY]?.label || "López Aliaga",
      true,
      "Interpolación de votos de Rafael López Aliaga (Renovación Popular)"
    );

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
      renderGrowthRateChart(renderSnapshots);
    }

    if (_firstLoad) {
      hideLoadingOverlay();
      _firstLoad = false;
    }
  } finally {
    _isLoading = false;
    setRefreshLinkState(false);
  }
}

// ─────────────────────────────────────────────
//  Init + refresh manual
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

  const ffeModeBindings = [
    ["mode-ffe-actual", "actual"],
    ["mode-ffe-simple", "simple"],
    ["mode-ffe-rural", "rural"],
    ["mode-ffe-imp-rural", "impugnacionRural"],
    ["mode-ffe-imp-lima", "impugnacionLima"],
  ];
  for (const [id, mode] of ffeModeBindings) {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener("click", () => {
        ffeDuelChartMode = mode;
        renderFfeDuelChart();
      });
    }
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

  const refreshLink = document.getElementById("refresh-link");
  if (refreshLink) {
    refreshLink.addEventListener("click", () => {
      loadAndRender();
    });
  }

  // Limpiar cache viejo de localStorage (ya no se usa)
  try { localStorage.removeItem("elec_snapshots_cache"); } catch (_) {}

  loadAndRender();
  setInterval(loadAndRender, 60_000);
});
