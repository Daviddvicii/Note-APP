(() => {
  "use strict";

  const canvas = document.getElementById("game");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlayEl = document.getElementById("overlay");
  const overlayBtn = document.getElementById("overlayBtn");
  const overlayBody = document.getElementById("overlayBody");
  const overlaySub = document.getElementById("overlaySub");

  // ===== Storage keys (menu-compatible) =====
  const BEST_KEY = "stack-best"; // MUST be numeric string
  const BEST_JSON_KEY = "stack-best-json"; // optional robustness

  function readBest() {
    const raw = localStorage.getItem(BEST_KEY);
    const n = Number(raw);
    if (Number.isFinite(n) && !Number.isNaN(n)) return Math.max(0, Math.floor(n));
    // fallback to json if present
    try {
      const obj = JSON.parse(localStorage.getItem(BEST_JSON_KEY) || "null");
      if (obj && typeof obj.best === "number" && Number.isFinite(obj.best)) {
        return Math.max(0, Math.floor(obj.best));
      }
    } catch (_) {}
    return 0;
  }

  function writeBest(best) {
    const b = Math.max(0, Math.floor(best));
    localStorage.setItem(BEST_KEY, String(b));
    try {
      localStorage.setItem(BEST_JSON_KEY, JSON.stringify({ best: b }));
    } catch (_) {}
  }

  // ===== Audio (optional) =====
  let audioReady = false;
  let audioCtx = null;
  let sfxGain = null;
  let soundOn = true;

  function ensureAudio() {
    if (audioReady) return;
    audioReady = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.18;
    sfxGain.connect(audioCtx.destination);
  }

  function beep(freq, durMs, type = "square", gain = 0.12) {
    if (!soundOn || !audioCtx || !sfxGain) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t);
    o.stop(t + durMs / 1000 + 0.02);
  }

  // ===== Rendering scale =====
  const view = {
    cssW: 0,
    cssH: 0,
    dpr: 1,
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    view.cssW = Math.max(1, Math.floor(rect.width));
    view.cssH = Math.max(1, Math.floor(rect.height));
    view.dpr = dpr;

    canvas.width = Math.floor(view.cssW * dpr);
    canvas.height = Math.floor(view.cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }

  // ===== Game config =====
  const CFG = {
    marginBottom: 18,
    baseHeight: 34,
    blockHeight: 26,
    minBlockWidth: 64,
    speedStart: 240, // px/s
    speedPerTier: 18, // speed bumps
    speedTierEvery: 5, // points per bump
    shrinkPerPlace: 2.2, // px
    perfectTol: 6, // px
    minOverlap: 10, // px absolute minimum
    gravity: 2200, // px/s^2
    maxParticles: 140,
  };

  // ===== Game state =====
  let best = readBest();
  if (bestEl) bestEl.textContent = String(best);

  const state = {
    phase: "start", // start | playing | over
    score: 0,
    speed: CFG.speedStart,
    shakeT: 0,
    shakeMag: 0,
    flashT: 0,
    perfectTextT: 0,
    perfectText: "",
    blocks: [],
    mover: null,
    falling: [],
    particles: [],
  };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function showOverlay(title, body, sub, btnText) {
    if (!overlayEl || !overlayBtn || !overlaySub || !overlayBody) return;
    overlayEl.classList.add("visible");
    overlayEl.querySelector("h1").textContent = title;
    overlayBody.innerHTML = String(body).replace(/\n/g, "<br />");
    overlaySub.textContent = sub;
    overlayBtn.textContent = btnText;
  }

  function hideOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.remove("visible");
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = String(state.score);
    if (bestEl) bestEl.textContent = String(best);
  }

  function resetGame() {
    state.phase = "start";
    state.score = 0;
    state.speed = CFG.speedStart;
    state.shakeT = 0;
    state.shakeMag = 0;
    state.flashT = 0;
    state.perfectTextT = 0;
    state.perfectText = "";
    state.blocks.length = 0;
    state.falling.length = 0;
    state.particles.length = 0;

    const W = view.cssW;
    const H = view.cssH;

    const base = {
      x: 0,
      y: H - CFG.marginBottom - CFG.baseHeight,
      w: W,
      h: CFG.baseHeight,
      isBase: true,
    };
    state.blocks.push(base);

    spawnMoverFrom(base);
    updateHud();
  }

  function spawnMoverFrom(prevBlock) {
    const W = view.cssW;
    const h = CFG.blockHeight;

    // difficulty: shrink slowly as you stack (never below min)
    const baseW = prevBlock.w;
    const targetW = clamp(baseW - CFG.shrinkPerPlace, CFG.minBlockWidth, W);

    const y = prevBlock.y - h; // stack directly above
    const startOnLeft = Math.random() < 0.5;
    const x = startOnLeft ? 0 : W - targetW;

    state.mover = {
      x,
      y,
      w: targetW,
      h,
      dir: startOnLeft ? 1 : -1,
    };
  }

  function bumpSpeedIfNeeded() {
    const tier = Math.floor(state.score / CFG.speedTierEvery);
    state.speed = CFG.speedStart + tier * CFG.speedPerTier;
  }

  function shake(mag, time = 0.16) {
    state.shakeMag = Math.max(state.shakeMag, mag);
    state.shakeT = Math.max(state.shakeT, time);
  }

  function spawnSparks(x, y, count = 18, bright = true) {
    const cap = CFG.maxParticles;
    if (state.particles.length > cap) state.particles.splice(0, state.particles.length - cap);
    const n = Math.min(count, cap - state.particles.length);
    for (let i = 0; i < n; i++) {
      state.particles.push({
        x: x + rand(-2, 2),
        y: y + rand(-2, 2),
        vx: rand(-220, 220),
        vy: rand(-520, -160),
        life: rand(0.25, 0.5),
        t: 0,
        size: rand(1.2, 2.4),
        bright,
      });
    }
  }

  function recenterIfNeeded() {
    // Keep the action in view by shifting everything down when tower reaches upper region.
    const desiredTopY = view.cssH * 0.34;
    const topBlock = state.blocks[state.blocks.length - 1];
    const yTop = topBlock.y;
    if (yTop < desiredTopY) {
      const shift = desiredTopY - yTop;
      for (const b of state.blocks) b.y += shift;
      if (state.mover) state.mover.y += shift;
      for (const f of state.falling) f.y += shift;
      for (const p of state.particles) p.y += shift;
    }
  }

  function place() {
    if (state.phase !== "playing" || !state.mover) return;

    const last = state.blocks[state.blocks.length - 1];
    const cur = state.mover;

    const lastCenter = last.x + last.w / 2;
    const curCenter = cur.x + cur.w / 2;
    const dx = curCenter - lastCenter;

    // Perfect snap (within 6px)
    const isPerfect = Math.abs(dx) <= CFG.perfectTol;
    if (isPerfect) {
      cur.x = clamp(lastCenter - cur.w / 2, 0, view.cssW - cur.w);
    }

    const left = Math.max(cur.x, last.x);
    const right = Math.min(cur.x + cur.w, last.x + last.w);
    const overlap = right - left;

    if (overlap <= 0 || overlap < CFG.minOverlap) {
      // No overlap = game over
      state.phase = "over";
      state.mover = null;
      beep(180, 220, "sawtooth", 0.12);
      showOverlay(
        "Game Over",
        `Final Score: ${state.score}\nBest: ${best}`,
        "Tap to play again.",
        "Play Again"
      );
      return;
    }

    // Falling trimmed piece (skip if perfect)
    if (!isPerfect) {
      const curRight = cur.x + cur.w;
      const fallLeft = cur.x < left;
      const fallX = fallLeft ? cur.x : right;
      const fallW = fallLeft ? left - cur.x : curRight - right;
      if (fallW > 0.5) {
        state.falling.push({
          x: fallX,
          y: cur.y,
          w: fallW,
          h: cur.h,
          vx: cur.dir * state.speed * 0.18,
          vy: -120,
          rot: rand(-0.08, 0.08),
          vr: rand(-1.6, 1.6),
          t: 0,
        });
      }
    }

    // Place the overlapped block
    const placed = {
      x: left,
      y: cur.y,
      w: overlap,
      h: cur.h,
      isBase: false,
    };
    state.blocks.push(placed);
    state.mover = null;

    // Scoring
    state.score += 1;
    if (isPerfect) {
      state.score += 2;
      state.perfectText = "PERFECT!";
      state.perfectTextT = 0.65;
      state.flashT = 0.12;
      shake(10, 0.18);
      beep(860, 90, "square", 0.12);
      spawnSparks(placed.x + placed.w / 2, placed.y, 28, true);
    } else {
      // near miss shake
      const trim = Math.abs(curCenter - lastCenter);
      if (trim < 22) shake(6, 0.14);
      beep(520, 70, "square", 0.09);
      spawnSparks(placed.x + placed.w / 2, placed.y, 18, false);
    }

    // Best save
    if (state.score > best) {
      best = state.score;
      writeBest(best);
    }
    bumpSpeedIfNeeded();
    updateHud();

    recenterIfNeeded();

    // Next mover
    spawnMoverFrom(placed);
  }

  // ===== Input =====
  function onPointerDown(e) {
    // always attempt to unlock audio on first user interaction
    ensureAudio();
    try {
      // Resume on iOS-ish implementations
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch (_) {}

    if (state.phase === "start") {
      start();
      return;
    }
    if (state.phase === "over") {
      start();
      return;
    }

    e.preventDefault();
    place();
  }

  function start() {
    resize();
    resetGame();
    hideOverlay();
    state.phase = "playing";
    state.flashT = 0.12;
    beep(720, 70, "square", 0.09);
  }

  // Canvas taps drop the block.
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });

  // Overlay button starts / restarts.
  overlayBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    ensureAudio();
    start();
  });

  // Overlay click also starts (mobile-friendly).
  overlayEl?.addEventListener("pointerdown", (e) => {
    // prevent double-trigger when clicking the button
    if (e.target === overlayBtn) return;
    e.preventDefault();
    ensureAudio();
    start();
  }, { passive: false });

  window.addEventListener("resize", () => {
    resize();
    if (state.phase !== "playing") {
      // keep visuals nice on resize before starting
      resetGame();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.phase === "playing") {
      // no pause overlay; just stop the mover in place visually via time delta clamp in loop
    }
  });

  // ===== Update / Render =====
  let lastT = performance.now();

  function update(dt) {
    if (state.flashT > 0) state.flashT = Math.max(0, state.flashT - dt);
    if (state.perfectTextT > 0) state.perfectTextT = Math.max(0, state.perfectTextT - dt);

    // Shake decay
    if (state.shakeT > 0) {
      state.shakeT = Math.max(0, state.shakeT - dt);
    } else {
      state.shakeMag *= Math.pow(0.001, dt); // quick falloff
      if (state.shakeMag < 0.2) state.shakeMag = 0;
    }

    if (state.phase === "playing" && state.mover) {
      const W = view.cssW;
      const m = state.mover;
      m.x += m.dir * state.speed * dt;
      if (m.x <= 0) {
        m.x = 0;
        m.dir = 1;
      } else if (m.x + m.w >= W) {
        m.x = W - m.w;
        m.dir = -1;
      }
    }

    // Falling pieces
    for (let i = state.falling.length - 1; i >= 0; i--) {
      const f = state.falling[i];
      f.t += dt;
      f.vy += CFG.gravity * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.y > view.cssH + 120) state.falling.splice(i, 1);
    }

    // Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.t += dt;
      p.vy += (CFG.gravity * 0.55) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t >= p.life) state.particles.splice(i, 1);
    }
  }

  function drawBackground() {
    const W = view.cssW;
    const H = view.cssH;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // subtle radial glow
    const g = ctx.createRadialGradient(W * 0.5, H * 0.2, 20, W * 0.5, H * 0.2, Math.max(W, H));
    g.addColorStop(0, "rgba(0,255,170,0.10)");
    g.addColorStop(0.6, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,255,102,0.06)";
    const grid = 28;
    for (let x = 0; x <= W; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // scanlines (subtle)
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    const step = 4;
    for (let y = 0; y < H; y += step) {
      ctx.fillRect(0, y, W, 1);
    }
    ctx.restore();
  }

  function drawBlock(b, style = "solid") {
    const fill = style === "dim" ? "rgba(0,255,102,0.14)" : "rgba(0,255,102,0.18)";
    const stroke = style === "dim" ? "rgba(0,255,170,0.38)" : "rgba(0,255,170,0.62)";
    const glow = style === "dim" ? "rgba(0,255,102,0.20)" : "rgba(0,255,102,0.40)";

    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = style === "dim" ? 10 : 16;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const W = view.cssW;
    const H = view.cssH;

    drawBackground();

    // Screen shake
    const shakeAmt = state.shakeT > 0 ? state.shakeMag * (state.shakeT / 0.18) : 0;
    const sx = shakeAmt ? rand(-shakeAmt, shakeAmt) : 0;
    const sy = shakeAmt ? rand(-shakeAmt, shakeAmt) : 0;

    ctx.save();
    ctx.translate(sx, sy);

    // Base + stacked blocks
    for (const b of state.blocks) {
      if (b.isBase) {
        drawBlock(b, "solid");
        // base "floor" line
        ctx.save();
        ctx.strokeStyle = "rgba(0,255,102,0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, b.y + b.h + 6);
        ctx.lineTo(W, b.y + b.h + 6);
        ctx.stroke();
        ctx.restore();
      } else {
        drawBlock(b, "solid");
      }
    }

    // Moving block
    if (state.mover) drawBlock(state.mover, "solid");

    // Falling pieces
    for (const f of state.falling) {
      ctx.save();
      ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
      ctx.rotate(f.rot);
      drawBlock({ x: -f.w / 2, y: -f.h / 2, w: f.w, h: f.h }, "dim");
      ctx.restore();
    }

    // Particles
    for (const p of state.particles) {
      const a = clamp(1 - p.t / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.bright ? "rgba(0,255,170,0.9)" : "rgba(0,255,102,0.8)";
      ctx.shadowColor = p.bright ? "rgba(0,255,170,0.65)" : "rgba(0,255,102,0.45)";
      ctx.shadowBlur = p.bright ? 14 : 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // PERFECT text
    if (state.perfectTextT > 0) {
      const a = clamp(state.perfectTextT / 0.65, 0, 1);
      const top = state.blocks[state.blocks.length - 1];
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(0,255,170,0.98)";
      ctx.shadowColor = "rgba(0,255,170,0.75)";
      ctx.shadowBlur = 18;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(16, Math.min(28, W * 0.06))}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillText(state.perfectText, W / 2, top.y - 22);
      ctx.restore();
    }

    // Flash overlay (tiny)
    if (state.flashT > 0) {
      const a = clamp(state.flashT / 0.12, 0, 1) * 0.14;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#00ffaa";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    ctx.restore();

    // Title hint at the very start if overlay hidden somehow
    if (state.phase === "start" && overlayEl && !overlayEl.classList.contains("visible")) {
      showOverlay(
        "Neon Stack",
        "Tap to drop. Stack as high as you can.\nPerfect drops snap in place and score bonus points.",
        "One-tap gameplay · Best score is saved",
        "Tap to Play"
      );
    }
  }

  function loop(now) {
    const dt = Math.min((now - lastT) / 1000, 0.035);
    lastT = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ===== Boot =====
  function boot() {
    resize();
    resetGame();
    showOverlay(
      "Neon Stack",
      "Tap to drop. Stack as high as you can.\nPerfect drops snap in place and score bonus points.",
      "One-tap gameplay · Best score is saved",
      "Tap to Play"
    );
    requestAnimationFrame(loop);
  }

  boot();
})();

