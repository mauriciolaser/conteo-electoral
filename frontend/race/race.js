(function () {
  "use strict";

  const LAYERS = [
    { key: "back",  src: "./assets/track-back.png",  speed: 8 },
    { key: "fence", src: "./assets/track-fence.png", speed: 28 },
    { key: "track", src: "./assets/track-track.png", speed: 90 },
    { key: "front", src: "./assets/track-front.png", speed: 180 },
  ];
  const SLOT_W = 256;
  const PORKY = { src: "./assets/porky-sheet.png", frames: 13, w: SLOT_W, h: 170, label: "RENOVACION POPULAR" };
  const SANCHEZ = { src: "./assets/sanchez-sheet.png", frames: 11, w: SLOT_W, h: 171, label: "JUNTOS POR EL PERU" };

  const FRAME_FPS = 10;
  const PX_PER_HUNDREDTH_PP = 0.5;
  const RELOAD_MS = 60_000;

  const SPRITE_BASELINE_Y = 0.78;
  const SPRITE_DRAW_SCALE = 0.45;

  const canvas = document.getElementById("race-canvas");
  const ctx = canvas.getContext("2d");

  const state = {
    sanchez: { pct: 0, posX: 0.5, frame: 0 },
    porky:   { pct: 0, posX: 0.5, frame: 0 },
    lastFrameTickMs: 0,
    lastTickMs: 0,
    layerOffsets: LAYERS.map(() => 0),
  };

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function normalizeName(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
  }

  function votesForParty(region, partyNorm) {
    const entry = (region.partidos || []).find(p => normalizeName(p.nombre) === partyNorm);
    return parseInt(entry?.votos, 10) || 0;
  }

  function computePcts(snapshot) {
    const regions = snapshot.regions || [];
    const sanchezNorm = normalizeName(SANCHEZ.label);
    const porkyNorm = normalizeName(PORKY.label);
    let sanchezVotos = 0;
    let porkyVotos = 0;
    let totalValidos = 0;
    for (const region of regions) {
      sanchezVotos += votesForParty(region, sanchezNorm);
      porkyVotos += votesForParty(region, porkyNorm);
      for (const p of region.partidos || []) {
        if (!p.es_blanco_o_nulo) totalValidos += parseInt(p.votos, 10) || 0;
      }
    }
    const pctSanchez = totalValidos > 0 ? (sanchezVotos / totalValidos) * 100 : 0;
    const pctPorky = totalValidos > 0 ? (porkyVotos / totalValidos) * 100 : 0;
    return { pctSanchez, pctPorky };
  }

  function updateTargets(pctSanchez, pctPorky) {
    state.sanchez.pct = pctSanchez;
    state.porky.pct = pctPorky;

    const diff = Math.abs(pctSanchez - pctPorky);
    const drawW = SLOT_W * SPRITE_DRAW_SCALE;
    const maxSeparationPx = canvas.width - drawW;
    const desiredPx = (diff / 0.01) * PX_PER_HUNDREDTH_PP;
    const separationPx = Math.min(desiredPx, maxSeparationPx);
    const separation = separationPx / canvas.width;
    const leadX = 0.5 + 0.5 * separation;
    const trailX = 0.5 - 0.5 * separation;

    if (pctSanchez >= pctPorky) {
      state.sanchez.posX = leadX;
      state.porky.posX = trailX;
    } else {
      state.porky.posX = leadX;
      state.sanchez.posX = trailX;
    }
  }

  function pickLatestSnapshot(payload) {
    if (Array.isArray(payload)) {
      let best = null;
      let bestT = -Infinity;
      for (const snap of payload) {
        const t = new Date(snap?.metadata?.extracted_at_utc).getTime();
        if (Number.isFinite(t) && t > bestT) {
          bestT = t;
          best = snap;
        }
      }
      return best;
    }
    if (payload && Array.isArray(payload.snapshots)) {
      return pickLatestSnapshot(payload.snapshots);
    }
    if (payload && payload.regions) return payload;
    return null;
  }

  async function fetchData() {
    try {
      const r = await fetch("../history_bundle.json", { cache: "no-store" });
      if (!r.ok) throw new Error("bundle status " + r.status);
      const json = await r.json();
      return pickLatestSnapshot(json);
    } catch (_) {
      const r = await fetch("./dummy.json", { cache: "no-store" });
      const json = await r.json();
      return pickLatestSnapshot(json);
    }
  }

  async function refresh() {
    try {
      const snap = await fetchData();
      if (!snap) return;
      const { pctSanchez, pctPorky } = computePcts(snap);
      updateTargets(pctSanchez, pctPorky);
    } catch (e) {
      console.warn("[race] refresh failed", e);
    }
  }

  function drawCandidate(img, cfg, runner) {
    const drawW = cfg.w * SPRITE_DRAW_SCALE;
    const drawH = cfg.h * SPRITE_DRAW_SCALE;
    const cx = runner.posX * canvas.width;
    const x = Math.round(cx - drawW / 2);
    const y = Math.round(canvas.height * SPRITE_BASELINE_Y - drawH);
    const sx = runner.frame * cfg.w;
    ctx.drawImage(img, sx, 0, cfg.w, cfg.h, x, y, drawW, drawH);
  }

  function drawLayer(img, offsetPx) {
    const w = canvas.width;
    const h = canvas.height;
    const x = -((offsetPx % w) + w) % w;
    ctx.drawImage(img, x, 0, w, h);
    ctx.drawImage(img, x + w, 0, w, h);
  }

  function startLoop(images) {
    const [porkyImg, sanchezImg, ...layerImgs] = images;
    const frameIntervalMs = 1000 / FRAME_FPS;
    const trackLayerIdx = LAYERS.findIndex(l => l.key === "track");

    function tick(nowMs) {
      if (!state.lastTickMs) state.lastTickMs = nowMs;
      const dt = Math.min(0.05, (nowMs - state.lastTickMs) / 1000);
      state.lastTickMs = nowMs;

      if (nowMs - state.lastFrameTickMs >= frameIntervalMs) {
        state.sanchez.frame = (state.sanchez.frame + 1) % SANCHEZ.frames;
        state.porky.frame = (state.porky.frame + 1) % PORKY.frames;
        state.lastFrameTickMs = nowMs;
      }

      for (let i = 0; i < LAYERS.length; i++) {
        state.layerOffsets[i] += LAYERS[i].speed * dt;
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i <= trackLayerIdx; i++) {
        drawLayer(layerImgs[i], state.layerOffsets[i]);
      }

      const trailIsSanchez = state.sanchez.posX < state.porky.posX;
      if (trailIsSanchez) {
        drawCandidate(sanchezImg, SANCHEZ, state.sanchez);
        drawCandidate(porkyImg, PORKY, state.porky);
      } else {
        drawCandidate(porkyImg, PORKY, state.porky);
        drawCandidate(sanchezImg, SANCHEZ, state.sanchez);
      }

      for (let i = trackLayerIdx + 1; i < LAYERS.length; i++) {
        drawLayer(layerImgs[i], state.layerOffsets[i]);
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  async function init() {
    const images = await Promise.all([
      loadImage(PORKY.src),
      loadImage(SANCHEZ.src),
      ...LAYERS.map(l => loadImage(l.src)),
    ]);
    await refresh();
    startLoop(images);
    setInterval(refresh, RELOAD_MS);
  }

  init().catch(e => console.error("[race] init failed", e));
})();
