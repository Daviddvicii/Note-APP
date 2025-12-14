(() => {
  'use strict';

  // -----------------------------
  // DOM + Canvas
  // -----------------------------
  const canvas = document.getElementById('arena');
  const ctx = canvas.getContext('2d', { alpha: false });

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');

  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlay-title');
  const overlayDescEl = document.getElementById('overlay-desc');
  const overlayHintEl = document.getElementById('overlay-hint');
  const startBtn = document.getElementById('start-btn');

  const W = canvas.width;
  const H = canvas.height;

  // -----------------------------
  // Config
  // -----------------------------
  const STORAGE_KEY_BEST = 'neon-sky-jumper-best';

  const CFG = {
    gravity: 2350,
    jumpVel: 1080,
    boostVel: 1620,

    playerRadius: 24,
    horizontalSmoothing: 12.5, // higher = snappier

    cameraThreshold: H * 0.40,

    platform: {
      height: 18,
      widthMin: 150,
      widthMax: 240,
      marginX: 24,

      gapBase: 180,
      gapRand: 120,

      movingSpeed: 140,
      breakDelay: 0.40,

      despawnPad: 380,
      spawnPad: 260,
    },

    scoreScale: 10, // pixels per score point

    trail: {
      enabled: true,
      max: 16,
      decay: 0.90,
    },
  };

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    running: false,
    gameState: 'start', // "start" | "running" | "gameover"

    score: 0,
    best: 0,

    cameraY: 0,
    basePlayerY: 0,
    maxHeight: 0,

    player: {
      x: W * 0.5,
      y: H * 0.75,
      radius: CFG.playerRadius,
      vx: 0,
      vy: 0,
      targetX: W * 0.5,
      prevY: H * 0.75,
      trail: [],
    },

    platforms: [],

    input: {
      pointerActive: false,
      pointerId: null,
      pointerX: W * 0.5,
      keyboardAxis: 0, // -1 left, 0 none, +1 right
    },

    time: {
      lastTs: 0,
    },
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function choiceWeighted(items) {
    // items: [{ value, w }]
    let total = 0;
    for (const it of items) total += it.w;
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it.value;
    }
    return items[items.length - 1].value;
  }

  function worldToScreenY(worldY) {
    return worldY - state.cameraY;
  }

  function screenToWorldY(screenY) {
    return screenY + state.cameraY;
  }

  function readBest() {
    const raw = localStorage.getItem(STORAGE_KEY_BEST);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  function writeBest(n) {
    try {
      localStorage.setItem(STORAGE_KEY_BEST, String(n));
    } catch {
      // Ignore storage failures (private mode, etc.).
    }
  }

  function setOverlay(mode, finalScore = 0) {
    if (mode === 'start') {
      overlayTitleEl.textContent = 'Neon Sky Jumper';
      overlayDescEl.textContent = 'Slide your finger left/right to steer. Bounce up the neon pads. Don\'t fall!';
      overlayHintEl.textContent = 'Tip: Keep moving—wrap around the edges.';
      startBtn.textContent = 'Tap to Jump';
      overlayEl.hidden = false;
      return;
    }

    if (mode === 'gameover') {
      overlayTitleEl.textContent = 'Game Over';
      overlayDescEl.textContent = `Final Score: ${finalScore}  •  Best: ${state.best}`;
      overlayHintEl.textContent = 'Try for a higher climb!';
      startBtn.textContent = 'Play Again';
      overlayEl.hidden = false;
      return;
    }

    overlayEl.hidden = true;
  }

  // -----------------------------
  // Platforms
  // -----------------------------
  function difficultyFactor() {
    // 0 -> ~1.0, grows slowly as you climb
    return clamp(state.maxHeight / 9000, 0, 1.25);
  }

  function nextGap() {
    const d = difficultyFactor();
    const base = CFG.platform.gapBase + d * 90; // slightly bigger gaps over time
    const r = CFG.platform.gapRand + d * 40;
    return rand(base - r * 0.45, base + r);
  }

  function typeForHeight() {
    const d = difficultyFactor();

    const moving = clamp(0.12 + d * 0.18, 0.12, 0.34);
    const breakable = clamp(0.10 + d * 0.22, 0.10, 0.40);
    const boost = clamp(0.06 + d * 0.05, 0.06, 0.12);
    const normal = Math.max(0.08, 1 - (moving + breakable + boost));

    return choiceWeighted([
      { value: 'normal', w: normal },
      { value: 'moving', w: moving },
      { value: 'breakable', w: breakable },
      { value: 'boost', w: boost },
    ]);
  }

  function makePlatform(y, forcedType = null) {
    const type = forcedType || typeForHeight();
    const w = rand(CFG.platform.widthMin, CFG.platform.widthMax);
    const x = rand(CFG.platform.marginX, W - CFG.platform.marginX - w);

    const p = {
      type,
      x,
      y,
      w,
      h: CFG.platform.height,
      vx: 0,
      minX: CFG.platform.marginX,
      maxX: W - CFG.platform.marginX - w,
      breaking: false,
      breakT: 0,
      seed: Math.random() * 9999,
    };

    if (type === 'moving') {
      p.vx = (Math.random() < 0.5 ? -1 : 1) * (CFG.platform.movingSpeed + rand(-25, 60));
    }

    return p;
  }

  function generateInitialPlatforms() {
    state.platforms.length = 0;

    // Ground-ish starter platform (always normal, wide)
    const starter = makePlatform(screenToWorldY(H * 0.82), 'normal');
    starter.x = W * 0.5 - starter.w * 0.5;
    starter.w = 270;
    starter.maxX = W - CFG.platform.marginX - starter.w;
    state.platforms.push(starter);

    // Stack upward
    let y = starter.y;
    const count = 14;
    for (let i = 0; i < count; i++) {
      y -= nextGap();
      // Keep early game friendly: mostly normal, occasional moving/breakable, tiny chance boost.
      let t = null;
      if (i < 5) {
        t = choiceWeighted([
          { value: 'normal', w: 0.80 },
          { value: 'moving', w: 0.10 },
          { value: 'breakable', w: 0.08 },
          { value: 'boost', w: 0.02 },
        ]);
      }
      state.platforms.push(makePlatform(y, t));
    }
  }

  function spawnPlatformsIfNeeded() {
    // Ensure we have platforms above the top edge
    let minY = Infinity;
    for (const p of state.platforms) minY = Math.min(minY, p.y);

    const topWorld = state.cameraY;
    while (minY > topWorld - CFG.platform.spawnPad) {
      const y = minY - nextGap();
      state.platforms.push(makePlatform(y));
      minY = y;
    }

    // Despawn below
    const bottomWorld = state.cameraY + H;
    const cutoff = bottomWorld + CFG.platform.despawnPad;
    state.platforms = state.platforms.filter((p) => p.y < cutoff);
  }

  // -----------------------------
  // Game lifecycle
  // -----------------------------
  function resetPlayer() {
    state.player.x = W * 0.5;
    state.player.targetX = W * 0.5;
    state.player.y = screenToWorldY(H * 0.72);
    state.player.prevY = state.player.y;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.trail.length = 0;
  }

  function startGame() {
    state.running = true;
    state.gameState = 'running';

    state.cameraY = 0;
    state.score = 0;
    state.maxHeight = 0;

    resetPlayer();
    state.basePlayerY = state.player.y;

    generateInitialPlatforms();

    // Give an initial hop so "Tap to Jump" feels literal.
    state.player.vy = -CFG.jumpVel;

    setOverlay('running');
  }

  function endGame() {
    state.running = false;
    state.gameState = 'gameover';

    if (state.score > state.best) {
      state.best = state.score;
      writeBest(state.best);
    }

    bestEl.textContent = String(state.best);
    setOverlay('gameover', state.score);
  }

  // -----------------------------
  // Input
  // -----------------------------
  function canvasPointerToCanvasX(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) * (W / rect.width);
    return clamp(x, 0, W);
  }

  canvas.addEventListener('pointerdown', (evt) => {
    canvas.setPointerCapture?.(evt.pointerId);
    state.input.pointerActive = true;
    state.input.pointerId = evt.pointerId;
    state.input.pointerX = canvasPointerToCanvasX(evt);
    state.player.targetX = state.input.pointerX;
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (!state.input.pointerActive) return;
    if (state.input.pointerId !== evt.pointerId) return;
    state.input.pointerX = canvasPointerToCanvasX(evt);
    state.player.targetX = state.input.pointerX;
  });

  function releasePointer(evt) {
    if (state.input.pointerId !== evt.pointerId) return;
    state.input.pointerActive = false;
    state.input.pointerId = null;
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  const keyState = {
    left: false,
    right: false,
  };

  function updateKeyboardAxis() {
    const axis = (keyState.right ? 1 : 0) - (keyState.left ? 1 : 0);
    state.input.keyboardAxis = axis;
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keyState.left = true;
    if (k === 'arrowright' || k === 'd') keyState.right = true;
    updateKeyboardAxis();
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keyState.left = false;
    if (k === 'arrowright' || k === 'd') keyState.right = false;
    updateKeyboardAxis();
  });

  function handleOverlayStart() {
    // Overlay click/tap starts/restarts the game.
    startGame();
  }

  overlayEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handleOverlayStart();
  });

  startBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleOverlayStart();
  });

  // -----------------------------
  // Physics + Collision
  // -----------------------------
  function collideAndJump() {
    const pl = state.player;

    if (pl.vy <= 0) return; // only when falling

    const r = pl.radius;
    const playerBottomPrev = pl.prevY + r;
    const playerBottom = pl.y + r;

    for (const p of state.platforms) {
      if (p.breaking) continue;

      // platform top in world coords
      const py = p.y;
      const withinY = playerBottomPrev <= py && playerBottom >= py;
      if (!withinY) continue;

      const overlapX = pl.x + r > p.x && pl.x - r < p.x + p.w;
      if (!overlapX) continue;

      // snap to platform
      pl.y = py - r;

      // jump
      if (p.type === 'boost') {
        pl.vy = -CFG.boostVel;
      } else {
        pl.vy = -CFG.jumpVel;
      }

      // mark breakable
      if (p.type === 'breakable') {
        p.breaking = true;
        p.breakT = 0;
      }

      // small upward trail pop
      if (CFG.trail.enabled && pl.vy < 0) {
        pl.trail.unshift({
          x: pl.x,
          y: worldToScreenY(pl.y),
          a: 0.85,
        });
        if (pl.trail.length > CFG.trail.max) pl.trail.length = CFG.trail.max;
      }

      return;
    }
  }

  function updatePlatforms(dt) {
    for (const p of state.platforms) {
      if (p.type === 'moving') {
        p.x += p.vx * dt;
        if (p.x <= p.minX) {
          p.x = p.minX;
          p.vx = Math.abs(p.vx);
        } else if (p.x >= p.maxX) {
          p.x = p.maxX;
          p.vx = -Math.abs(p.vx);
        }
      }

      if (p.type === 'breakable' && p.breaking) {
        p.breakT += dt;
      }
    }

    // Remove fully broken platforms
    state.platforms = state.platforms.filter((p) => !(p.type === 'breakable' && p.breaking && p.breakT >= CFG.platform.breakDelay));
  }

  function updateCamera() {
    const pl = state.player;
    const screenY = worldToScreenY(pl.y);

    if (screenY < CFG.cameraThreshold) {
      state.cameraY = pl.y - CFG.cameraThreshold;
    }
  }

  function updateScore() {
    const height = Math.max(0, state.basePlayerY - state.player.y);
    if (height > state.maxHeight) state.maxHeight = height;
    state.score = Math.floor(state.maxHeight / CFG.scoreScale);
  }

  function updatePlayer(dt) {
    const pl = state.player;

    // Keyboard gently pushes targetX if no active pointer
    if (!state.input.pointerActive && state.input.keyboardAxis !== 0) {
      pl.targetX += state.input.keyboardAxis * 620 * dt;
      pl.targetX = clamp(pl.targetX, pl.radius, W - pl.radius);
    }

    // Smooth steering (exponential-ish smoothing)
    const t = 1 - Math.exp(-CFG.horizontalSmoothing * dt);
    pl.x = lerp(pl.x, pl.targetX, t);

    // Wrap around edges
    if (pl.x < -pl.radius) pl.x = W + pl.radius;
    if (pl.x > W + pl.radius) pl.x = -pl.radius;

    // Vertical motion
    pl.prevY = pl.y;
    pl.vy += CFG.gravity * dt;
    pl.y += pl.vy * dt;

    // Player trail (screen-space)
    if (CFG.trail.enabled) {
      for (const pt of pl.trail) pt.a *= CFG.trail.decay;
      pl.trail = pl.trail.filter((pt) => pt.a > 0.06);

      const screenY = worldToScreenY(pl.y);
      const rising = pl.vy < -220;
      if (rising) {
        pl.trail.unshift({ x: pl.x, y: screenY, a: 0.55 });
        if (pl.trail.length > CFG.trail.max) pl.trail.length = CFG.trail.max;
      }
    }
  }

  function checkDeath() {
    const pl = state.player;
    const screenY = worldToScreenY(pl.y);
    if (screenY - pl.radius > H + 10) {
      endGame();
    }
  }

  // -----------------------------
  // Update + Draw
  // -----------------------------
  function update(dt) {
    if (!state.running) return;

    dt = clamp(dt, 0, 0.05);

    updatePlatforms(dt);
    updatePlayer(dt);
    collideAndJump();
    updateCamera();
    spawnPlatformsIfNeeded();
    updateScore();
    checkDeath();

    scoreEl.textContent = String(state.score);
  }

  function drawBackground() {
    // Base gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#071033');
    g.addColorStop(0.55, '#060a1f');
    g.addColorStop(1, '#040615');

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Subtle glow bands
    ctx.save();
    ctx.globalAlpha = 0.18;
    const g2 = ctx.createRadialGradient(W * 0.35, H * 0.20, 0, W * 0.35, H * 0.20, H * 0.95);
    g2.addColorStop(0, 'rgba(122,92,255,0.50)');
    g2.addColorStop(0.6, 'rgba(37,255,210,0.10)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Faint grid
    const grid = 72;
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.lineWidth = 2;

    // Vertical lines
    ctx.strokeStyle = 'rgba(37,255,210,0.9)';
    ctx.beginPath();
    for (let x = 0; x <= W; x += grid) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
    }
    ctx.stroke();

    // Horizontal lines
    ctx.strokeStyle = 'rgba(122,92,255,0.9)';
    ctx.beginPath();
    for (let y = 0; y <= H; y += grid) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();

    ctx.restore();
  }

  function platformStyle(p) {
    if (p.type === 'moving') {
      return {
        fill: 'rgba(122, 92, 255, 0.22)',
        edge: 'rgba(160, 140, 255, 0.95)',
        glow: 'rgba(122, 92, 255, 0.45)',
      };
    }
    if (p.type === 'breakable') {
      return {
        fill: p.breaking ? 'rgba(255, 61, 242, 0.18)' : 'rgba(255, 61, 242, 0.16)',
        edge: p.breaking ? 'rgba(255, 120, 250, 0.92)' : 'rgba(255, 90, 245, 0.88)',
        glow: 'rgba(255, 61, 242, 0.40)',
      };
    }
    if (p.type === 'boost') {
      return {
        fill: 'rgba(37, 255, 210, 0.20)',
        edge: 'rgba(37, 255, 210, 0.95)',
        glow: 'rgba(37, 255, 210, 0.55)',
      };
    }
    return {
      fill: 'rgba(37, 255, 210, 0.12)',
      edge: 'rgba(37, 255, 210, 0.82)',
      glow: 'rgba(37, 255, 210, 0.35)',
    };
  }

  function drawPlatforms() {
    for (const p of state.platforms) {
      const y = worldToScreenY(p.y);
      if (y < -80 || y > H + 80) continue;

      const s = platformStyle(p);
      const x = p.x;
      const w = p.w;
      const h = p.h;

      // Glow
      ctx.save();
      ctx.shadowColor = s.glow;
      ctx.shadowBlur = 22;
      ctx.fillStyle = s.fill;
      roundRect(ctx, x, y, w, h, 10);
      ctx.fill();
      ctx.restore();

      // Edge stroke
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = s.edge;
      ctx.shadowColor = s.edge;
      ctx.shadowBlur = 10;
      roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 9);
      ctx.stroke();
      ctx.restore();

      // Breakable cracks/flicker
      if (p.type === 'breakable') {
        const flicker = p.breaking ? (Math.sin((performance.now() * 0.03) + p.seed) * 0.5 + 0.5) : 0.0;
        ctx.save();
        ctx.globalAlpha = p.breaking ? (0.35 + 0.45 * flicker) : 0.25;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const mid = x + w * 0.5;
        ctx.moveTo(mid - w * 0.22, y + h * 0.25);
        ctx.lineTo(mid - w * 0.06, y + h * 0.80);
        ctx.lineTo(mid + w * 0.10, y + h * 0.35);
        ctx.lineTo(mid + w * 0.25, y + h * 0.75);
        ctx.stroke();
        ctx.restore();
      }

      // Boost chevrons
      if (p.type === 'boost') {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = 'rgba(37,255,210,0.95)';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(37,255,210,0.7)';
        ctx.shadowBlur = 14;
        const cx = x + w * 0.5;
        ctx.beginPath();
        ctx.moveTo(cx - 28, y + h + 6);
        ctx.lineTo(cx, y - 10);
        ctx.lineTo(cx + 28, y + h + 6);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawPlayer() {
    const pl = state.player;
    const x = pl.x;
    const y = worldToScreenY(pl.y);
    const r = pl.radius;

    // Trail
    if (CFG.trail.enabled && pl.trail.length > 0) {
      ctx.save();
      for (let i = 0; i < pl.trail.length; i++) {
        const t = pl.trail[i];
        const a = t.a;
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = 'rgba(37,255,210,1)';
        ctx.shadowColor = 'rgba(37,255,210,0.55)';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r * (0.75 + i * 0.02), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Body gradient
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.2, x, y, r * 1.35);
    grad.addColorStop(0, 'rgba(220, 255, 250, 1)');
    grad.addColorStop(0.45, 'rgba(37, 255, 210, 1)');
    grad.addColorStop(1, 'rgba(10, 120, 105, 1)');

    ctx.save();
    ctx.shadowColor = 'rgba(37,255,210,0.9)';
    ctx.shadowBlur = 32;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(235, 255, 252, 0.70)';
    ctx.stroke();

    // Simple "visor" highlight
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(10, 18, 45, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.12, y - r * 0.08, r * 0.62, r * 0.35, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function draw() {
    drawBackground();
    drawPlatforms();
    drawPlayer();

    // Subtle top vignette
    ctx.save();
    ctx.globalAlpha = 0.25;
    const vg = ctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0.55)');
    vg.addColorStop(0.22, 'rgba(0,0,0,0.08)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // -----------------------------
  // Drawing utility
  // -----------------------------
  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // -----------------------------
  // Loop
  // -----------------------------
  function loop(ts) {
    if (!state.time.lastTs) state.time.lastTs = ts;
    const dt = (ts - state.time.lastTs) / 1000;
    state.time.lastTs = ts;

    update(dt);
    draw();

    requestAnimationFrame(loop);
  }

  // -----------------------------
  // Boot
  // -----------------------------
  function init() {
    state.best = readBest();
    bestEl.textContent = String(state.best);
    scoreEl.textContent = '0';

    // Start state
    setOverlay('start');

    // Prepare initial scene behind overlay
    state.cameraY = 0;
    resetPlayer();
    state.basePlayerY = state.player.y;
    generateInitialPlatforms();

    requestAnimationFrame(loop);
  }

  init();
})();
