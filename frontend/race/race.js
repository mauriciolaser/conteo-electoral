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
  const API_RACE_LATEST_URL = "../api/v1/race/latest";
  const API_DASHBOARD_LATEST_URL = "../api/v1/dashboard/latest";

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
      const r = await fetch(API_RACE_LATEST_URL, { cache: "no-store" });
      if (!r.ok) throw new Error("api race status " + r.status);
      const json = await r.json();
      const latest = json?.latest || {};
      if (Number.isFinite(Number(latest.pct_sanchez)) && Number.isFinite(Number(latest.pct_lopez_aliaga))) {
        return {
          pctSanchez: Number(latest.pct_sanchez) || 0,
          pctPorky: Number(latest.pct_lopez_aliaga) || 0,
        };
      }
      throw new Error("api race payload inválido");
    } catch (_) {
      try {
        const r = await fetch(API_DASHBOARD_LATEST_URL, { cache: "no-store" });
        if (!r.ok) throw new Error("api dashboard latest status " + r.status);
        const json = await r.json();
        const snap = pickLatestSnapshot(json?.snapshot || json);
        if (snap) return computePcts(snap);
      } catch (_) {
        const r = await fetch("./dummy.json", { cache: "no-store" });
        const json = await r.json();
        const snap = pickLatestSnapshot(json);
        if (snap) return computePcts(snap);
      }
    }
    return { pctSanchez: 0, pctPorky: 0 };
  }

  async function refresh() {
    try {
      const data = await fetchData();
      if (!data) return;
      const { pctSanchez, pctPorky } = data;
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
    const isLeader = runner.pct >= Math.max(state.sanchez.pct, state.porky.pct);
    drawPctChip(cx, y, runner.pct, isLeader);
  }

  function drawPctChip(cx, spriteTopY, pct, isLeader) {
    const text = pct.toFixed(2) + "%";
    const fontPx = Math.max(9, Math.round(canvas.width * 0.0224));
    ctx.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    const padX = Math.round(fontPx * 0.8);
    const padY = Math.round(fontPx * 0.38);
    const textW = ctx.measureText(text).width;
    const chipW = Math.round(textW + padX * 2);
    const chipH = Math.round(fontPx + padY * 2);
    const baseGap = Math.round(fontPx * 0.5);
    const stackOffset = isLeader ? 0 : Math.round(chipH * 1.25);
    const chipX = Math.round(cx - chipW / 2);
    const chipY = Math.round(spriteTopY - baseGap - chipH - stackOffset);
    const r = Math.round(chipH / 2);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgba(15, 18, 28, 0.88)";
    roundRect(ctx, chipX, chipY, chipW, chipH, r);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    roundRect(ctx, chipX + 0.5, chipY + 0.5, chipW - 1, chipH - 1, r);
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.fillText(text, cx, chipY + chipH / 2 + 1);
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y,     x + w, y + h, rr);
    c.arcTo(x + w, y + h, x,     y + h, rr);
    c.arcTo(x,     y + h, x,     y,     rr);
    c.arcTo(x,     y,     x + w, y,     rr);
    c.closePath();
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
