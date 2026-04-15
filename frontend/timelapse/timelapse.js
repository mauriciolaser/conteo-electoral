(function () {
  "use strict";

  const LAYERS = [
    { key: "back", src: "../race/assets/track-back.png", speed: 8 },
    { key: "fence", src: "../race/assets/track-fence.png", speed: 28 },
    { key: "track", src: "../race/assets/track-track.png", speed: 90 },
    { key: "front", src: "../race/assets/track-front.png", speed: 180 },
  ];
  const SLOT_W = 256;
  const PORKY = {
    src: "../race/assets/porky-sheet.png",
    frames: 13,
    w: SLOT_W,
    h: 170,
    label: "RENOVACION POPULAR",
  };
  const SANCHEZ = {
    src: "../race/assets/sanchez-sheet.png",
    frames: 11,
    w: SLOT_W,
    h: 171,
    label: "JUNTOS POR EL PERU",
  };

  const DATA_URL = "../../outputs/history_bundle.json";
  const FRAME_FPS = 10;
  const PX_PER_HUNDREDTH_PP = 0.5;
  const LOOP_DURATION_MS = 60_000;
  const SPRITE_BASELINE_Y = 0.78;
  const SPRITE_DRAW_SCALE = 0.45;
  const PCT_SMOOTHING_PER_SECOND = 6.5;

  const canvas = document.getElementById("race-canvas");
  const ctx = canvas.getContext("2d");

  const state = {
    sanchez: { pct: 0, targetPct: 0, posX: 0.5, frame: 0 },
    porky: { pct: 0, targetPct: 0, posX: 0.5, frame: 0 },
    lastFrameTickMs: 0,
    lastTickMs: 0,
    layerOffsets: LAYERS.map(() => 0),
    timelineStartedAtMs: 0,
    series: [],
    firstPoint: null,
    lastPoint: null,
    errorMessage: "",
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

  function isSpecial(name, explicitFlag) {
    if (explicitFlag) return true;
    const normalized = normalizeName(name);
    return normalized.includes("BLANCO") ||
      normalized.includes("NULO") ||
      normalized.includes("VICIADO") ||
      normalized.includes("IMPUGN") ||
      normalized === "AJUSTE";
  }

  function votesForParty(region, partyNorm) {
    return (region.partidos || [])
      .filter(p => normalizeName(p.nombre) === partyNorm)
      .reduce((sum, p) => sum + (parseInt(p.votos, 10) || 0), 0);
  }

  function buildPoint(snapshot) {
    const extractedAt = snapshot?.metadata?.extracted_at_utc;
    const dt = new Date(extractedAt);
    if (!Number.isFinite(dt.getTime())) return null;

    const regions = Array.isArray(snapshot?.regions) ? snapshot.regions : [];
    const sanchezNorm = normalizeName(SANCHEZ.label);
    const porkyNorm = normalizeName(PORKY.label);
    let sanchezVotes = 0;
    let porkyVotes = 0;
    let totalValidVotes = 0;

    for (const region of regions) {
      sanchezVotes += votesForParty(region, sanchezNorm);
      porkyVotes += votesForParty(region, porkyNorm);

      for (const party of region.partidos || []) {
        if (isSpecial(party.nombre, party.es_blanco_o_nulo)) continue;
        totalValidVotes += parseInt(party.votos, 10) || 0;
      }
    }

    return {
      atMs: dt.getTime(),
      pctSanchez: totalValidVotes > 0 ? (sanchezVotes / totalValidVotes) * 100 : 0,
      pctPorky: totalValidVotes > 0 ? (porkyVotes / totalValidVotes) * 100 : 0,
    };
  }

  async function fetchSeries() {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`history bundle HTTP ${response.status}`);
    }

    const payload = await response.json();
    const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
    const points = snapshots
      .map(buildPoint)
      .filter(Boolean)
      .sort((a, b) => a.atMs - b.atMs);

    if (points.length === 0) {
      throw new Error("history bundle sin snapshots válidos");
    }

    if (points.length === 1) {
      return [points[0], { ...points[0], atMs: points[0].atMs + 1 }];
    }

    return points;
  }

  function initializeSeries(points) {
    state.series = points;
    state.firstPoint = points[0];
    state.lastPoint = points[points.length - 1];
    state.sanchez.pct = points[0].pctSanchez;
    state.sanchez.targetPct = points[0].pctSanchez;
    state.porky.pct = points[0].pctPorky;
    state.porky.targetPct = points[0].pctPorky;
    updateTargets(points[0].pctSanchez, points[0].pctPorky);
  }

  function interpolateSeries(playheadMs) {
    const points = state.series;
    if (points.length === 0) {
      return { pctSanchez: 0, pctPorky: 0 };
    }
    if (points.length === 1 || !state.firstPoint || !state.lastPoint) {
      return {
        pctSanchez: points[0].pctSanchez,
        pctPorky: points[0].pctPorky,
      };
    }

    const historySpanMs = Math.max(1, state.lastPoint.atMs - state.firstPoint.atMs);
    const historyTargetMs = state.firstPoint.atMs + (playheadMs / LOOP_DURATION_MS) * historySpanMs;

    if (historyTargetMs <= points[0].atMs) {
      return {
        pctSanchez: points[0].pctSanchez,
        pctPorky: points[0].pctPorky,
      };
    }

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (historyTargetMs > current.atMs) continue;

      const span = Math.max(1, current.atMs - previous.atMs);
      const t = (historyTargetMs - previous.atMs) / span;
      return {
        pctSanchez: previous.pctSanchez + (current.pctSanchez - previous.pctSanchez) * t,
        pctPorky: previous.pctPorky + (current.pctPorky - previous.pctPorky) * t,
      };
    }

    return {
      pctSanchez: state.lastPoint.pctSanchez,
      pctPorky: state.lastPoint.pctPorky,
    };
  }

  function smoothTowards(current, target, dtSeconds) {
    const blend = 1 - Math.exp(-PCT_SMOOTHING_PER_SECOND * dtSeconds);
    return current + (target - current) * blend;
  }

  function updateTargets(pctSanchez, pctPorky) {
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

  function drawCandidate(img, cfg, runner) {
    const drawW = cfg.w * SPRITE_DRAW_SCALE;
    const drawH = cfg.h * SPRITE_DRAW_SCALE;
    const cx = runner.posX * canvas.width;
    const x = Math.round(cx - drawW / 2);
    const y = Math.round(canvas.height * SPRITE_BASELINE_Y - drawH);
    const sx = runner.frame * cfg.w;
    ctx.drawImage(img, sx, 0, cfg.w, cfg.h, x, y, drawW, drawH);
    const leaderPct = Math.max(state.sanchez.pct, state.porky.pct);
    drawPctChip(cx, y, runner.pct, runner.pct >= leaderPct);
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
    const radius = Math.round(chipH / 2);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgba(15, 18, 28, 0.88)";
    roundRect(ctx, chipX, chipY, chipW, chipH, radius);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    roundRect(ctx, chipX + 0.5, chipY + 0.5, chipW - 1, chipH - 1, radius);
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.fillText(text, cx, chipY + chipH / 2 + 1);
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawLayer(img, offsetPx) {
    const width = canvas.width;
    const height = canvas.height;
    const x = -((offsetPx % width) + width) % width;
    ctx.drawImage(img, x, 0, width, height);
    ctx.drawImage(img, x + width, 0, width, height);
  }

  function drawErrorOverlay(message) {
    const titleSize = Math.max(18, Math.round(canvas.width * 0.038));
    const bodySize = Math.max(12, Math.round(canvas.width * 0.024));

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${titleSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText("No se pudo cargar el timelapse", canvas.width / 2, canvas.height * 0.43);

    ctx.font = `500 ${bodySize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    wrapCenteredText(message, canvas.width / 2, canvas.height * 0.53, canvas.width * 0.78, bodySize * 1.45);
    ctx.restore();
  }

  function wrapCenteredText(text, centerX, startY, maxWidth, lineHeight) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !current) {
        current = next;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    const totalHeight = Math.max(0, (lines.length - 1) * lineHeight);
    let y = startY - totalHeight / 2;
    for (const line of lines) {
      ctx.fillText(line, centerX, y);
      y += lineHeight;
    }
  }

  function startLoop(images) {
    const [porkyImg, sanchezImg, ...layerImgs] = images;
    const frameIntervalMs = 1000 / FRAME_FPS;
    const trackLayerIdx = LAYERS.findIndex(layer => layer.key === "track");

    function tick(nowMs) {
      if (!state.lastTickMs) state.lastTickMs = nowMs;
      if (!state.timelineStartedAtMs) state.timelineStartedAtMs = nowMs;

      const dtSeconds = Math.min(0.05, (nowMs - state.lastTickMs) / 1000);
      state.lastTickMs = nowMs;

      if (nowMs - state.lastFrameTickMs >= frameIntervalMs) {
        state.sanchez.frame = (state.sanchez.frame + 1) % SANCHEZ.frames;
        state.porky.frame = (state.porky.frame + 1) % PORKY.frames;
        state.lastFrameTickMs = nowMs;
      }

      for (let i = 0; i < LAYERS.length; i += 1) {
        state.layerOffsets[i] += LAYERS[i].speed * dtSeconds;
      }

      if (state.series.length > 0) {
        const playheadMs = (nowMs - state.timelineStartedAtMs) % LOOP_DURATION_MS;
        const target = interpolateSeries(playheadMs);
        state.sanchez.targetPct = target.pctSanchez;
        state.porky.targetPct = target.pctPorky;
        state.sanchez.pct = smoothTowards(state.sanchez.pct, state.sanchez.targetPct, dtSeconds);
        state.porky.pct = smoothTowards(state.porky.pct, state.porky.targetPct, dtSeconds);
        updateTargets(state.sanchez.pct, state.porky.pct);
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i <= trackLayerIdx; i += 1) {
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

      for (let i = trackLayerIdx + 1; i < LAYERS.length; i += 1) {
        drawLayer(layerImgs[i], state.layerOffsets[i]);
      }

      if (state.errorMessage) {
        drawErrorOverlay(state.errorMessage);
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  async function init() {
    const images = await Promise.all([
      loadImage(PORKY.src),
      loadImage(SANCHEZ.src),
      ...LAYERS.map(layer => loadImage(layer.src)),
    ]);

    try {
      const points = await fetchSeries();
      initializeSeries(points);
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : String(error);
      console.warn("[timelapse] init data failed", error);
    }

    startLoop(images);
  }

  init().catch(error => {
    state.errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[timelapse] init failed", error);
  });
})();
