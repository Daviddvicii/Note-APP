/* Neon Stack - mobile-first HTML5 canvas stacking game
   - One tap/click: drop the moving block
   - Overlap trims; trimmed part falls
   - PERFECT snap within 6px (+2 bonus)
   - Best saved to localStorage "stack-best" (string), plus optional JSON
   - DPR-aware rendering for crisp neon lines
*/

(() => {
  "use strict";

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("game");
  /** @type {CanvasRenderingContext2D} */
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const elScore = document.getElementById("scoreVal");
  const elBest = document.getElementById("bestVal");
  const overlayStart = document.getElementById("overlayStart");
  const overlayGameOver = document.getElementById("overlayGameOver");
  const btnStart = document.getElementById("btnStart");
  const btnAgain = document.getElementById("btnAgain");
  const elFinalScore = document.getElementById("finalScore");
  const elFinalBest = document.getElementById("finalBest");

  // ===== LocalStorage best handling (menu-compatible) =====
  const BEST_KEY = "stack-best";
  const BEST_JSON_KEY = "stack-best-json";

  function readBest() {
    // Required key: numeric string
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));

    // Optional robust JSON
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
    localStorage.setItem(BEST_KEY, String(b)); // MUST exist as number string
    try {
      localStorage.setItem(BEST_JSON_KEY, JSON.stringify({ best: b }));
    } catch (_) {}
  }

  let best = readBest();
  elBest.textContent = String(best);

  // ===== DPR-aware resize =====
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const nextDpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

    cssW = w;
    cssH = h;
    dpr = nextDpr;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    ctx.imageSmoothingEnabled = false;
  }

  // Use a ResizeObserver for reliable mobile resizing (URL bar show/hide)
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener("resize", resize, { passive: true });
  resize();

  // ===== Tiny WebAudio SFX (created on first user interaction) =====
  /** @type {AudioContext|null} */
  let audioCtx = null;
  /** @type {GainNode|null} */
  let sfxGain = null;

  function ensureAudio() {
    if (audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.18;
    sfxGain.connect(audioCtx.destination);
  }

  function beep(freq, durMs, type = "square", gain = 0.09) {
    if (!audioCtx || !sfxGain) return;
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

  // ===== Game constants =====
  const COLORS = {
    bg0: "#000000",
    neon: "#00ff66",
    neon2: "#00ffaa",
    dim: "rgba(0, 255, 102, 0.35)",
    dimFill: "rgba(0, 255, 102, 0.08)",
    pieceFill: "rgba(0, 255, 102, 0.05)",
    grid: "rgba(0, 255, 102, 0.06)",
    text: "rgba(234, 255, 245, 0.95)",
  };

  const PERFECT_PX = 6;
  const MIN_OVERLAP_PX = 10; // too small -> game over

  const BLOCK_H = 34;
  const FLOOR_PAD = 18;
  const MIN_W = 56;
  const WIDTH_DECAY = 2; // every placed block, moving block shrinks slightly

  const SPEED_BASE = 160; // px/sec
  const SPEED_STEP = 18; // every 5 score
  const SPEED_MAX = 420;

  const GRAVITY = 1600; // px/sec^2

  // ===== State =====
  let running = false;
  let startedOnce = false;
  let gameOver = false;
  let score = 0;

  /** @type {{x:number,y:number,w:number,h:number}[]} */
  let stack = [];
  /** @type {{x:number,y:number,w:number,h:number,vx:number} | null} */
  let mover = null;

  /** @type {{x:number,y:number,w:number,h:number,vx:number,vy:number,rot:number,vr:number,life:number}[]} */
  let fallingPieces = [];

  /** @type {{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,r:number}[]} */
  let particles = [];

  let cameraY = 0; // world camera (same units as block y)
  let shakeT = 0;
  let shakeAmp = 0;
  let perfectFlashT = 0;
  let nearMissFlashT = 0;

  let lastT = performance.now();

  // World coordinate convention:
  // - Base block sits at world y = 0 (its top-left y).
  // - Blocks stack upwards with decreasing y (negative).
  // - Screen mapping uses base anchor near bottom of canvas.
  function baseScreenY() {
    return cssH - FLOOR_PAD - BLOCK_H;
  }

  function worldToScreenY(worldY) {
    return baseScreenY() + (worldY - cameraY);
  }

  function currentSpeed() {
    const tier = Math.floor(score / 5);
    return Math.min(SPEED_MAX, SPEED_BASE + tier * SPEED_STEP);
  }

  function setHUD() {
    elScore.textContent = String(score);
    elBest.textContent = String(best);
  }

  function showStartOverlay() {
    overlayStart.classList.add("show");
    overlayGameOver.classList.remove("show");
  }

  function hideOverlays() {
    overlayStart.classList.remove("show");
    overlayGameOver.classList.remove("show");
  }

  function showGameOverOverlay() {
    elFinalScore.textContent = String(score);
    elFinalBest.textContent = String(best);
    overlayGameOver.classList.add("show");
  }

  function resetGame() {
    score = 0;
    gameOver = false;
    cameraY = 0;
    shakeT = 0;
    shakeAmp = 0;
    perfectFlashT = 0;
    nearMissFlashT = 0;

    fallingPieces.length = 0;
    particles.length = 0;
    stack = [];

    // Base platform: full width
    stack.push({
      x: 0,
      y: 0,
      w: cssW,
      h: BLOCK_H,
    });

    spawnMover(true);
    setHUD();
  }

  function spawnMover(startCenter = false) {
    const top = stack[stack.length - 1];
    const w = Math.max(MIN_W, Math.min(cssW, top.w - WIDTH_DECAY));
    const y = top.y - BLOCK_H;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const speed = currentSpeed();
    const vx = dir * speed;
    const x = startCenter ? (cssW - w) * 0.5 : (dir > 0 ? 0 : cssW - w);
    mover = { x, y, w, h: BLOCK_H, vx };
  }

  function addShake(amp, time = 0.18) {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeT = Math.max(shakeT, time);
  }

  function spawnSparks(x, y, count, power) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = power * (0.35 + Math.random() * 0.9);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 120,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.35,
        r: 1.2 + Math.random() * 1.6,
      });
    }
    // keep arrays small
    if (particles.length > 180) particles.splice(0, particles.length - 180);
  }

  function drop() {
    if (!running || gameOver || !mover) return;

    const prev = stack[stack.length - 1];
    const cur = mover;

    // Perfect snap: alignment within 6px (left edge closeness feels right and consistent)
    const dx = cur.x - prev.x;
    const isPerfect = Math.abs(dx) <= PERFECT_PX;
    if (isPerfect) {
      cur.x = prev.x;
      perfectFlashT = 0.6;
      addShake(10, 0.22);
      beep(980, 90, "square", 0.12);
    } else {
      beep(520, 60, "square", 0.08);
    }

    const overlapL = Math.max(cur.x, prev.x);
    const overlapR = Math.min(cur.x + cur.w, prev.x + prev.w);
    const overlapW = overlapR - overlapL;

    if (overlapW < MIN_OVERLAP_PX) {
      // Miss
      gameOver = true;
      running = false;
      beep(160, 240, "sawtooth", 0.11);
      addShake(14, 0.28);
      // Persist best
      if (score > best) {
        best = score;
        writeBest(best);
        setHUD();
      }
      showGameOverOverlay();
      return;
    }

    // Create falling trimmed piece (if any)
    const leftTrim = overlapL - cur.x;
    const rightTrim = (cur.x + cur.w) - overlapR;
    if (leftTrim > 0.5) {
      fallingPieces.push({
        x: cur.x,
        y: cur.y,
        w: leftTrim,
        h: cur.h,
        vx: -40 + Math.random() * -80,
        vy: -180 - Math.random() * 140,
        rot: 0,
        vr: (-2 + Math.random() * 4),
        life: 0,
      });
    } else if (rightTrim > 0.5) {
      fallingPieces.push({
        x: overlapR,
        y: cur.y,
        w: rightTrim,
        h: cur.h,
        vx: 40 + Math.random() * 80,
        vy: -180 - Math.random() * 140,
        rot: 0,
        vr: (-2 + Math.random() * 4),
        life: 0,
      });
    }
    if (fallingPieces.length > 14) fallingPieces.splice(0, fallingPieces.length - 14);

    // Place new block
    const placed = {
      x: overlapL,
      y: cur.y,
      w: overlapW,
      h: cur.h,
    };
    stack.push(placed);

    // Score: +1 per placement, +2 bonus on perfect
    score += 1;
    if (isPerfect) score += 2;

    // Near-miss shake when overlap is small-ish (but not a miss)
    if (!isPerfect && overlapW < Math.max(28, prev.w * 0.35)) {
      nearMissFlashT = 0.35;
      addShake(7, 0.16);
    }

    // Sparks at placement center
    spawnSparks(placed.x + placed.w * 0.5, worldToScreenY(placed.y) + placed.h, isPerfect ? 28 : 18, isPerfect ? 520 : 420);

    // Best persistence
    if (score > best) {
      best = score;
      writeBest(best);
    }
    setHUD();

    // Continue: spawn next moving block
    spawnMover(false);
  }

  // ===== Input (pointer events) =====
  function onUserGesture() {
    ensureAudio();
  }

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      onUserGesture();

      // If start overlay visible, start (also supports tapping canvas anywhere)
      if (overlayStart.classList.contains("show")) {
        start();
        return;
      }
      // If game over overlay visible, restart
      if (overlayGameOver.classList.contains("show")) {
        restart();
        return;
      }
      drop();
    },
    { passive: false },
  );

  btnStart.addEventListener("click", () => {
    onUserGesture();
    start();
  });

  btnAgain.addEventListener("click", () => {
    onUserGesture();
    restart();
  });

  // ===== Main control =====
  function start() {
    hideOverlays();
    resetGame();
    running = true;
    startedOnce = true;
  }

  function restart() {
    overlayGameOver.classList.remove("show");
    resetGame();
    running = true;
  }

  // ===== Rendering helpers =====
  function drawGrid() {
    // subtle neon grid
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.grid;

    const step = 40;
    for (let x = 0.5; x <= cssW; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
    }
    for (let y = 0.5; y <= cssH; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function neonRect(x, y, w, h, fill, stroke, glow, glow2) {
    ctx.save();
    // glow pass
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();

    // crisp pass
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = glow2;
    ctx.beginPath();
    ctx.rect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.stroke();
    ctx.restore();
  }

  function drawTextGlow(text, x, y, size, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "rgba(0, 255, 102, 0.8)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ===== Update + draw =====
  function update(dt) {
    // Resize can happen mid-game; keep base width aligned to screen
    if (stack.length > 0) {
      stack[0].w = cssW;
      if (stack[0].x !== 0) stack[0].x = 0;
    }

    // camera follows top
    const top = stack[stack.length - 1];
    const topY = top ? top.y : 0;
    const desiredTopScreenY = Math.max(90, cssH * 0.22);
    const targetCam = topY + baseScreenY() - desiredTopScreenY;
    cameraY += (targetCam - cameraY) * Math.min(1, dt * 4.5);

    // shake
    if (shakeT > 0) {
      shakeT -= dt;
      shakeAmp *= Math.pow(0.001, dt); // quick decay
      if (shakeT <= 0) {
        shakeT = 0;
        shakeAmp = 0;
      }
    }

    if (perfectFlashT > 0) perfectFlashT = Math.max(0, perfectFlashT - dt);
    if (nearMissFlashT > 0) nearMissFlashT = Math.max(0, nearMissFlashT - dt);

    // mover motion
    if (running && mover) {
      mover.x += mover.vx * dt;
      if (mover.x <= 0) {
        mover.x = 0;
        mover.vx = Math.abs(mover.vx);
      } else if (mover.x + mover.w >= cssW) {
        mover.x = cssW - mover.w;
        mover.vx = -Math.abs(mover.vx);
      }
      // keep speed in sync as score increases
      const s = currentSpeed();
      mover.vx = Math.sign(mover.vx || 1) * s;
    }

    // falling pieces
    for (let i = fallingPieces.length - 1; i >= 0; i--) {
      const p = fallingPieces[i];
      p.life += dt;
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;

      const sy = worldToScreenY(p.y);
      if (sy > cssH + 260 || p.life > 2.6) {
        fallingPieces.splice(i, 1);
      }
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      p.vy += 820 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life >= p.maxLife) particles.splice(i, 1);
    }
  }

  function draw() {
    // background
    ctx.fillStyle = COLORS.bg0;
    ctx.fillRect(0, 0, cssW, cssH);
    drawGrid();

    // subtle vignette overlay (cheap)
    ctx.save();
    const g = ctx.createRadialGradient(cssW * 0.5, cssH * 0.45, Math.min(cssW, cssH) * 0.2, cssW * 0.5, cssH * 0.55, Math.max(cssW, cssH) * 0.72);
    g.addColorStop(0, "rgba(0,255,170,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.restore();

    // apply shake transform to playfield only
    ctx.save();
    if (shakeT > 0 && shakeAmp > 0.2) {
      const t = performance.now() * 0.02;
      const sx = (Math.sin(t) * 0.7 + Math.sin(t * 1.7) * 0.3) * shakeAmp;
      const sy = (Math.cos(t * 1.1) * 0.7 + Math.sin(t * 1.9) * 0.3) * shakeAmp;
      ctx.translate(sx, sy);
    }

    // base glow line
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,102,0.22)";
    ctx.shadowColor = "rgba(0,255,102,0.35)";
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, baseScreenY() + BLOCK_H + 6);
    ctx.lineTo(cssW, baseScreenY() + BLOCK_H + 6);
    ctx.stroke();
    ctx.restore();

    // blocks
    for (let i = 0; i < stack.length; i++) {
      const b = stack[i];
      const sy = worldToScreenY(b.y);
      if (sy > cssH + 100 || sy + b.h < -100) continue;
      neonRect(b.x, sy, b.w, b.h, COLORS.dimFill, COLORS.neon, "rgba(0,255,102,0.7)", "rgba(0,255,170,0.55)");
    }

    // moving block
    if (mover) {
      const sy = worldToScreenY(mover.y);
      neonRect(mover.x, sy, mover.w, mover.h, "rgba(0,255,102,0.12)", COLORS.neon2, "rgba(0,255,170,0.65)", "rgba(0,255,102,0.65)");
    }

    // falling pieces
    for (const p of fallingPieces) {
      const sy = worldToScreenY(p.y);
      ctx.save();
      ctx.translate(p.x + p.w * 0.5, sy + p.h * 0.5);
      ctx.rotate(p.rot);
      neonRect(-p.w * 0.5, -p.h * 0.5, p.w, p.h, COLORS.pieceFill, "rgba(0,255,102,0.55)", "rgba(0,255,102,0.35)", "rgba(0,255,170,0.25)");
      ctx.restore();
    }

    // particles
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const a = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = "rgba(0,255,170,0.85)";
      ctx.shadowColor = "rgba(0,255,102,0.8)";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // feedback text
    if (perfectFlashT > 0) {
      const a = Math.min(1, perfectFlashT / 0.6);
      drawTextGlow("PERFECT!", cssW * 0.5, cssH * 0.22, 30, 0.55 + 0.45 * a);
    } else if (nearMissFlashT > 0) {
      const a = Math.min(1, nearMissFlashT / 0.35);
      drawTextGlow("NICE!", cssW * 0.5, cssH * 0.22, 22, 0.35 + 0.45 * a);
    }

    ctx.restore(); // end shake

    // start hint (only before first start) - subtle
    if (!startedOnce && overlayStart.classList.contains("show")) {
      drawTextGlow("Tap to drop", cssW * 0.5, cssH * 0.78, 16, 0.5);
    }
  }

  function frame(now) {
    const dt = Math.min(0.033, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // Boot
  showStartOverlay();
  resetGame();
  running = false;
  requestAnimationFrame((t) => {
    lastT = t;
    requestAnimationFrame(frame);
  });
})();

