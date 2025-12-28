/* Neon Stack - mobile-first HTML5 canvas stacking game
   - One tap: drop moving block
   - Overlap trims; trimmed piece falls; zero overlap = game over
   - PERFECT snap (<= 6px) gives +2 bonus (in addition to +1)
   - Best saved to localStorage: "stack-best" (string number) and "stack-best-json" (optional)
*/

(() => {
  "use strict";

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("game");
  /** @type {CanvasRenderingContext2D} */
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const ui = {
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlayTitle"),
    overlayMsg: document.getElementById("overlayMsg"),
    overlayStats: document.getElementById("overlayStats"),
    finalScore: document.getElementById("finalScore"),
    finalBest: document.getElementById("finalBest"),
    overlayBtn: document.getElementById("overlayBtn"),
  };

  const StorageKeys = Object.freeze({
    Best: "stack-best",
    BestJson: "stack-best-json",
  });

  function safeParseInt(raw) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function loadBest() {
    try {
      const v = localStorage.getItem(StorageKeys.Best);
      const best = safeParseInt(v);
      if (best > 0) return best;
    } catch (_) {}

    // Optional robust key (ignored if missing)
    try {
      const raw = localStorage.getItem(StorageKeys.BestJson);
      if (!raw) return 0;
      const obj = JSON.parse(raw);
      if (obj && typeof obj.best === "number") return Math.max(0, Math.floor(obj.best));
    } catch (_) {}

    return 0;
  }

  function saveBest(best) {
    try {
      localStorage.setItem(StorageKeys.Best, String(best)); // MUST exist for your menu
    } catch (_) {}
    try {
      localStorage.setItem(StorageKeys.BestJson, JSON.stringify({ best }));
    } catch (_) {}
  }

  let bestScore = loadBest();
  ui.best.textContent = String(bestScore);

  // ======= Audio (created only after first user interaction) =======
  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {GainNode | null} */
  let audioMaster = null;
  let audioReady = false;

  function ensureAudio() {
    if (audioReady) return;
    audioReady = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    audioMaster = audioCtx.createGain();
    audioMaster.gain.value = 0.35;
    audioMaster.connect(audioCtx.destination);
  }

  function beep(freq, durMs, type = "square", gain = 0.12) {
    if (!audioCtx || !audioMaster) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);

    o.connect(g);
    g.connect(audioMaster);
    o.start(t);
    o.stop(t + durMs / 1000 + 0.03);
  }

  // ======= Canvas sizing (DPR crisp) =======
  let dpr = 1;
  let viewW = 1; // CSS pixels
  let viewH = 1; // CSS pixels
  let lastRectW = 0;
  let lastRectH = 0;

  function resizeCanvasIfNeeded() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const nextDpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

    if (w === lastRectW && h === lastRectH && nextDpr === dpr) return false;

    lastRectW = w;
    lastRectH = h;
    dpr = nextDpr;
    viewW = w;
    viewH = h;

    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    return true;
  }

  window.addEventListener("resize", () => resizeCanvasIfNeeded());
  window.addEventListener("orientationchange", () => resizeCanvasIfNeeded());
  resizeCanvasIfNeeded();

  // ======= Game state =======
  const GameState = Object.freeze({
    Ready: "ready",
    Running: "running",
    Over: "over",
  });

  /** @typedef {{x:number,w:number,y:number,h:number}} Block */
  /** @typedef {{x:number,w:number,y:number,h:number,vx:number,vy:number,life:number}} FallingPiece */
  /** @typedef {{x:number,y:number,vx:number,vy:number,life:number}} Particle */
  /** @typedef {{text:string,x:number,y:number,life:number}} FloatText */

  let state = GameState.Ready;
  let score = 0;

  /** @type {Block[]} */
  let blocks = [];
  /** @type {Block | null} */
  let moving = null;
  /** @type {FallingPiece[]} */
  let falling = [];
  /** @type {Particle[]} */
  let particles = [];
  /** @type {FloatText[]} */
  let floatTexts = [];

  let dir = 1;
  let baseSpeed = 200; // will be re-derived from playW
  let speed = 200;
  let shrinkPerDrop = 1.0;
  let minW = 64;
  let blockH = 32;
  let padX = 14;
  let playW = 1;
  let originX = 0;

  // camera + effects
  let camY = 0; // world units (pixels) from bottom
  let shake = 0;
  let shakeT = 0;

  const PERFECT_PX = 6;
  const MIN_OVERLAP_PX = 8;

  function updateDifficulty() {
    const tier = Math.floor(score / 5);
    speed = baseSpeed * (1 + tier * 0.06);
  }

  function setupDimensions() {
    // Responsive block height for portrait; clamp keeps it readable on desktop.
    blockH = Math.round(Math.max(22, Math.min(42, viewH * 0.055)));
    padX = Math.round(Math.max(12, Math.min(24, viewW * 0.04)));
    playW = Math.max(120, Math.floor(viewW - padX * 2));
    originX = Math.floor((viewW - playW) / 2);
    minW = Math.max(52, Math.floor(playW * 0.16));

    baseSpeed = Math.max(150, playW * 0.55);
    shrinkPerDrop = Math.max(0.75, Math.min(1.35, playW / 420)); // small, gradual
    updateDifficulty();
  }

  setupDimensions();
  // Build an initial tower so the start screen isn't empty.
  resetGame();

  function resetGame() {
    score = 0;
    ui.score.textContent = "0";
    setupDimensions();

    blocks.length = 0;
    falling.length = 0;
    particles.length = 0;
    floatTexts.length = 0;

    camY = 0;
    shake = 0;
    shakeT = 0;

    // Base platform (full width)
    blocks.push({ x: 0, w: playW, y: 0, h: blockH });

    // First moving block
    const startW = Math.max(minW, Math.floor(playW * 0.75));
    moving = { x: 0, w: startW, y: blockH, h: blockH };
    dir = 1;
    updateDifficulty();
  }

  function showOverlay(mode) {
    ui.overlay.classList.add("show");
    if (mode === "start") {
      ui.overlayTitle.textContent = "Neon Stack";
      ui.overlayMsg.textContent = "Tap to drop. Stack as high as you can.";
      ui.overlayStats.style.display = "none";
      ui.overlayBtn.textContent = "Tap to Play";
    } else if (mode === "over") {
      ui.overlayTitle.textContent = "Game Over";
      ui.overlayMsg.textContent = "Tap to drop. Stack as high as you can.";
      ui.overlayStats.style.display = "";
      ui.finalScore.textContent = String(score);
      ui.finalBest.textContent = String(bestScore);
      ui.overlayBtn.textContent = "Play Again";
    }
  }

  function hideOverlay() {
    ui.overlay.classList.remove("show");
  }

  function startGame() {
    ensureAudio();
    resetGame();
    state = GameState.Running;
    hideOverlay();
  }

  function gameOver() {
    state = GameState.Over;
    if (score > bestScore) {
      bestScore = score;
      ui.best.textContent = String(bestScore);
      saveBest(bestScore);
    }
    beep(180, 220, "sawtooth", 0.12);
    showOverlay("over");
  }

  function addShake(amount) {
    shake = Math.min(14, shake + amount);
    shakeT = 1;
  }

  function addSparks(worldX, worldY) {
    // Keep arrays small for performance
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 190;
      particles.push({
        x: worldX,
        y: worldY,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 180, // slight upward bias in world space
        life: 0.45 + Math.random() * 0.25,
      });
    }
    if (particles.length > 180) particles.splice(0, particles.length - 180);
  }

  function addFloatText(text, worldX, worldY) {
    floatTexts.push({ text, x: worldX, y: worldY, life: 0.8 });
    if (floatTexts.length > 6) floatTexts.shift();
  }

  function nextMovingFrom(placed) {
    // Never *increase* width after a bad cut; only shrink (down to the configured minimum),
    // but if the player trimmed below minW, keep that width (don't "grow" it back).
    const nextW = Math.max(placed.w - shrinkPerDrop, Math.min(minW, placed.w));
    const y = placed.y + blockH;
    const startLeft = dir > 0 ? 0 : playW - nextW;
    moving = { x: startLeft, w: nextW, y, h: blockH };
    // Alternate direction for variety
    dir *= -1;
    updateDifficulty();
  }

  function dropBlock() {
    if (state !== GameState.Running || !moving) return;

    const prev = blocks[blocks.length - 1];
    const cur = moving;

    // Perfect alignment check: compare centers
    const prevC = prev.x + prev.w / 2;
    const curC = cur.x + cur.w / 2;
    const centerDiff = Math.abs(curC - prevC);
    let isPerfect = false;

    let placedX = cur.x;
    let placedW = cur.w;

    if (centerDiff <= PERFECT_PX) {
      // Snap to perfect center alignment (cur.w <= prev.w by design over time)
      placedX = prev.x + (prev.w - cur.w) / 2;
      placedW = cur.w;
      isPerfect = true;
    } else {
      const overlapLeft = Math.max(cur.x, prev.x);
      const overlapRight = Math.min(cur.x + cur.w, prev.x + prev.w);
      const overlapW = overlapRight - overlapLeft;

      if (overlapW < MIN_OVERLAP_PX) {
        // Create a falling "miss" piece for feedback (optional)
        const missW = Math.max(0, overlapW);
        if (missW > 0) {
          falling.push({ x: overlapLeft, w: missW, y: cur.y, h: cur.h, vx: dir * 35, vy: 0, life: 2.2 });
        }
        gameOver();
        return;
      }

      placedX = overlapLeft;
      placedW = overlapW;

      // Trimmed piece falls
      const leftTrimW = Math.max(0, overlapLeft - cur.x);
      const rightTrimW = Math.max(0, (cur.x + cur.w) - overlapRight);

      if (leftTrimW > 0) {
        falling.push({
          x: cur.x,
          w: leftTrimW,
          y: cur.y,
          h: cur.h,
          vx: -60 - Math.random() * 40,
          vy: 0,
          life: 2.5,
        });
      }
      if (rightTrimW > 0) {
        falling.push({
          x: overlapRight,
          w: rightTrimW,
          y: cur.y,
          h: cur.h,
          vx: 60 + Math.random() * 40,
          vy: 0,
          life: 2.5,
        });
      }

      // Near-miss shake (small overlap or big trim)
      if (placedW / cur.w < 0.4 || Math.max(leftTrimW, rightTrimW) > cur.w * 0.45) {
        addShake(6);
      }
    }

    // Place the block
    const placed = { x: placedX, w: placedW, y: cur.y, h: cur.h };
    blocks.push(placed);

    // Score: +1 per placement, +2 bonus if perfect
    score += 1;
    if (isPerfect) score += 2;
    ui.score.textContent = String(score);

    // Update best live (nice for hub compatibility)
    if (score > bestScore) {
      bestScore = score;
      ui.best.textContent = String(bestScore);
      saveBest(bestScore);
    }

    // Placement feedback
    const sparkX = placed.x + placed.w / 2;
    const sparkY = placed.y + placed.h;
    addSparks(sparkX, sparkY);

    if (isPerfect) {
      addFloatText("PERFECT!", sparkX, sparkY + 10);
      addShake(10);
      beep(880, 70, "square", 0.14);
    } else {
      beep(520, 55, "square", 0.10);
    }

    // Next moving block
    nextMovingFrom(placed);
  }

  // ======= Input =======
  function onPrimaryAction(e) {
    // Prevent scrolling / pull-to-refresh while playing
    if (e && typeof e.preventDefault === "function") e.preventDefault();

    ensureAudio();

    if (state === GameState.Ready) {
      startGame();
      return;
    }

    if (state === GameState.Over) {
      startGame();
      return;
    }

    dropBlock();
  }

  canvas.addEventListener("pointerdown", onPrimaryAction, { passive: false });
  ui.overlayBtn.addEventListener("click", onPrimaryAction);
  ui.overlay.addEventListener("pointerdown", (e) => {
    // Let taps on overlay start/restart without scrolling
    if (e.target === ui.overlay) onPrimaryAction(e);
  });

  // ======= Update + Draw =======
  const BG = {
    base: "#020603",
    grid: "rgba(0,255,102,0.09)",
    grid2: "rgba(0,255,102,0.045)",
  };
  const COL = {
    neon: "#00ff66",
    neon2: "#00ffaa",
    fill: "rgba(0,255,102,0.09)",
    dimFill: "rgba(0,255,102,0.05)",
    dimStroke: "rgba(0,255,102,0.50)",
    text: "rgba(234,255,245,0.95)",
  };

  const GRAVITY = 980; // px/s^2

  function computeCamera() {
    const top = blocks[blocks.length - 1];
    const stackH = top.y + top.h;
    const target = Math.max(0, stackH - viewH * 0.65);
    camY += (target - camY) * 0.12; // smooth camera
  }

  function worldToScreenY(yFromBottom, h) {
    // yFromBottom: 0 is bottom platform
    return viewH - (yFromBottom + h) + camY;
  }

  function drawBackground() {
    ctx.fillStyle = BG.base;
    ctx.fillRect(0, 0, viewW, viewH);

    // Subtle grid (parallax with camera)
    const step = 24;
    const offsetY = (-camY % step + step) % step;

    ctx.save();
    ctx.translate(0, offsetY);
    ctx.lineWidth = 1;

    // major lines
    ctx.strokeStyle = BG.grid;
    for (let x = 0; x <= viewW; x += step * 2) {
      ctx.beginPath();
      ctx.moveTo(x, -step);
      ctx.lineTo(x, viewH + step);
      ctx.stroke();
    }
    for (let y = -step; y <= viewH + step; y += step * 2) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewW, y);
      ctx.stroke();
    }

    // minor lines
    ctx.strokeStyle = BG.grid2;
    for (let x = step; x <= viewW; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, -step);
      ctx.lineTo(x, viewH + step);
      ctx.stroke();
    }
    for (let y = 0; y <= viewH + step; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewW, y);
      ctx.stroke();
    }
    ctx.restore();

    // Scanlines inside canvas for extra CRT punch
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = "#000";
    for (let y = 0; y < viewH; y += 3) {
      ctx.fillRect(0, y, viewW, 1);
    }
    ctx.restore();
  }

  function drawNeonRect(x, y, w, h, dim = false) {
    const stroke = dim ? COL.dimStroke : COL.neon;
    const fill = dim ? COL.dimFill : COL.fill;
    ctx.save();
    ctx.translate(originX, 0);

    // glow
    ctx.shadowColor = stroke;
    ctx.shadowBlur = dim ? 10 : 16;

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // inner highlight line
    ctx.globalAlpha = dim ? 0.18 : 0.25;
    ctx.strokeStyle = COL.neon2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 3);
    ctx.lineTo(x + w - 3, y + 3);
    ctx.stroke();

    ctx.restore();
  }

  function drawTextGlow(text, x, y, sizePx, color = COL.neon2) {
    ctx.save();
    ctx.translate(originX, 0);
    ctx.font = `800 ${sizePx}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function update(dt) {
    // Resize-safe; if changed, recompute responsive dimensions
    if (resizeCanvasIfNeeded()) {
      setupDimensions();
      // Keep gameplay stable on resize/orientation changes: restart to avoid distortion.
      // (Mobile browsers can change DPR/layout mid-game.)
      if (state !== GameState.Ready) showOverlay("start");
      state = GameState.Ready;
      resetGame();
    }

    if (state !== GameState.Running) {
      // Light ambient motion for the grid/camera
      camY += (0 - camY) * 0.08;
      shake = Math.max(0, shake - 18 * dt);
      return;
    }

    if (!moving) return;

    computeCamera();
    updateDifficulty();

    // Move the block (bounce between walls)
    moving.x += dir * speed * dt;
    if (moving.x < 0) {
      moving.x = 0;
      dir = 1;
    }
    if (moving.x + moving.w > playW) {
      moving.x = playW - moving.w;
      dir = -1;
    }

    // Falling pieces physics
    for (let i = falling.length - 1; i >= 0; i--) {
      const p = falling[i];
      p.vy += GRAVITY * dt;
      p.y -= p.vy * dt; // y-from-bottom decreases when falling down
      p.x += p.vx * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y < -blockH * 6) falling.splice(i, 1);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= GRAVITY * 0.9 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Floating texts
    for (let i = floatTexts.length - 1; i >= 0; i--) {
      const t = floatTexts[i];
      t.y += 24 * dt;
      t.life -= dt;
      if (t.life <= 0) floatTexts.splice(i, 1);
    }

    // Shake decay
    shake = Math.max(0, shake - 22 * dt);
    shakeT = Math.max(0, shakeT - 3.5 * dt);
  }

  function draw() {
    drawBackground();

    // Shake offsets
    let sx = 0;
    let sy = 0;
    if (shake > 0 && shakeT > 0) {
      const a = shake * (0.4 + 0.6 * shakeT);
      sx = (Math.random() * 2 - 1) * a;
      sy = (Math.random() * 2 - 1) * a * 0.6;
    }

    ctx.save();
    ctx.translate(sx, sy);

    // Base + stacked blocks
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const y = worldToScreenY(b.y, b.h);
      // Skip drawing if far off-screen (cheap cull)
      if (y > viewH + blockH * 2 || y + b.h < -blockH * 2) continue;
      drawNeonRect(b.x, y, b.w, b.h, false);
    }

    // Moving block
    if (moving) {
      const my = worldToScreenY(moving.y, moving.h);
      drawNeonRect(moving.x, my, moving.w, moving.h, false);
    }

    // Falling pieces (slightly dim)
    for (const p of falling) {
      const y = worldToScreenY(p.y, p.h);
      drawNeonRect(p.x, y, p.w, p.h, true);
    }

    // Particles
    ctx.save();
    ctx.translate(originX, 0);
    for (const p of particles) {
      const y = worldToScreenY(p.y, 0);
      const alpha = Math.max(0, Math.min(1, p.life / 0.6));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COL.neon2;
      ctx.shadowColor = COL.neon2;
      ctx.shadowBlur = 10;
      ctx.fillRect(p.x, y, 2, 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Floating texts ("PERFECT!")
    for (const t of floatTexts) {
      const y = worldToScreenY(t.y, 0);
      drawTextGlow(t.text, t.x, y, 26);
    }

    ctx.restore();

    // Subtle floor glow
    ctx.save();
    const grad = ctx.createLinearGradient(0, viewH - 120, 0, viewH);
    grad.addColorStop(0, "rgba(0,255,102,0)");
    grad.addColorStop(1, "rgba(0,255,102,0.10)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, viewH - 140, viewW, 140);
    ctx.restore();
  }

  // ======= Main loop =======
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // Start screen
  showOverlay("start");
  requestAnimationFrame(frame);
})();

