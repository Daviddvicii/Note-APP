"use strict";

/**
 * Neon Stack (mobile-first HTML5 canvas game)
 * - One-tap: tap/click to drop the moving block.
 * - Overlap stacking rule (trim falls).
 * - Perfect bonus: within 6px snaps +2 score.
 * - Best saved under localStorage "stack-best" (and "stack-best-json" as extra).
 */

// ===== DOM =====
const canvas = document.getElementById("game");
/** @type {CanvasRenderingContext2D} */
const ctx = canvas.getContext("2d", { alpha: true });

const scoreText = document.getElementById("scoreText");
const bestText = document.getElementById("bestText");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayDesc = document.getElementById("overlayDesc");
const overlayStats = document.getElementById("overlayStats");
const finalScore = document.getElementById("finalScore");
const finalBest = document.getElementById("finalBest");
const overlayBtn = document.getElementById("overlayBtn");

// ===== Storage =====
const BEST_KEY = "stack-best";
const BEST_KEY_JSON = "stack-best-json";

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw == null ? 0 : Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);

    // Optional robust JSON record
    const rawJson = localStorage.getItem(BEST_KEY_JSON);
    if (rawJson) {
      try {
        const obj = JSON.parse(rawJson);
        if (obj && typeof obj.best === "number" && Number.isFinite(obj.best)) return Math.floor(obj.best);
      } catch (_) {}
    }
  } catch (_) {}
  return 0;
}

function saveBest(best) {
  try {
    // MUST exist as a number string for your menu compatibility.
    localStorage.setItem(BEST_KEY, String(best));
    // Optional JSON for robustness.
    localStorage.setItem(BEST_KEY_JSON, JSON.stringify({ best }));
  } catch (_) {
    // ignore storage errors
  }
}

// ===== Canvas scaling (DPR + fixed portrait world) =====
const WORLD_W = 360;
const WORLD_H = 640; // 9:16

let dpr = 1;
let viewScale = 1;
let viewOffX = 0;
let viewOffY = 0;

let lastCssW = 0;
let lastCssH = 0;
let lastDpr = 0;

function resize() {
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));

  // Avoid expensive reallocation unless something actually changed.
  if (cssW === lastCssW && cssH === lastCssH && dpr === lastDpr) return;
  lastCssW = cssW;
  lastCssH = cssH;
  lastDpr = dpr;

  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));

  // Fit the fixed world into the canvas without distortion
  viewScale = Math.min(cssW / WORLD_W, cssH / WORLD_H);
  viewOffX = (cssW - WORLD_W * viewScale) / 2;
  viewOffY = (cssH - WORLD_H * viewScale) / 2;

  ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, dpr * viewOffX, dpr * viewOffY);
}

window.addEventListener("resize", resize);
resize();

// ===== Audio (optional) =====
let audioReady = false;
let audioCtx = null;
let sfxGain = null;

function ensureAudio() {
  if (audioReady) return;
  audioReady = true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;

  audioCtx = new AC();
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.22;
  sfxGain.connect(audioCtx.destination);
}

function beep(freq, durMs, type = "square", gain = 0.12) {
  if (!audioCtx || !sfxGain) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;

  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);

  o.connect(g);
  g.connect(sfxGain);

  o.start(t);
  o.stop(t + durMs / 1000 + 0.02);
}

// ===== Helpers =====
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// ===== Game data =====
const State = Object.freeze({
  Ready: "ready",
  Playing: "playing",
  Over: "over",
});

const COLORS = Object.freeze({
  neon: "rgba(0,255,102,1)",
  neonSoft: "rgba(0,255,170,0.85)",
  dim: "rgba(0,255,102,0.55)",
  dim2: "rgba(0,255,102,0.28)",
  bg0: "#000000",
  bg1: "rgba(0, 255, 102, 0.10)",
});

const BLOCK_H = 24;
const BASE_Y = WORLD_H - 92;
const MIN_W = 56;
const PERFECT_PX = 6;
const MIN_OVERLAP_PX = 8;
const GRAVITY = 1500;

let state = State.Ready;
let score = 0;
let best = loadBest();

/** @type {{x:number,y:number,w:number,h:number}[]} */
let blocks = [];

/** @type {{x:number,y:number,w:number,h:number,dir:number,speed:number} | null} */
let mover = null;

/** @type {{x:number,y:number,w:number,h:number,vx:number,vy:number,rot:number,vr:number,ttl:number}[]} */
let falling = [];

/** @type {{x:number,y:number,vx:number,vy:number,r:number,ttl:number}[]} */
let particles = [];

/** @type {{text:string,x:number,y:number,ttl:number,alpha:number,scale:number} | null} */
let floatText = null;

let cameraY = 0;
let cameraTargetY = 0;
let shakeT = 0;
let shakeMag = 0;

function updateHud() {
  scoreText.textContent = String(score);
  bestText.textContent = String(best);
}

function showOverlay(mode) {
  overlay.classList.remove("hidden");

  if (mode === "start") {
    overlayTitle.textContent = "Neon Stack";
    overlayDesc.textContent = "Tap to drop. Stack as high as you can.";
    overlayBtn.textContent = "Tap to Play";
    overlayStats.style.display = "none";
  } else {
    overlayTitle.textContent = "Game Over";
    overlayDesc.textContent = "Tap to drop. Stack as high as you can.";
    overlayBtn.textContent = "Play Again";
    overlayStats.style.display = "block";
    finalScore.textContent = String(score);
    finalBest.textContent = String(best);
  }
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function speedForScore(s) {
  // Gentle ramp every few points
  const tier = Math.floor(s / 5);
  return 128 + tier * 18 + Math.min(s, 60) * 0.55;
}

function shrinkForScore(s) {
  // Slightly faster shrink over time, clamped.
  return clamp(1.6 + s * 0.03, 1.6, 3.4);
}

function startGame() {
  state = State.Playing;
  score = 0;
  falling.length = 0;
  particles.length = 0;
  floatText = null;

  cameraY = 0;
  cameraTargetY = 0;
  shakeT = 0;
  shakeMag = 0;

  const startW = Math.floor(WORLD_W * 0.74);
  blocks = [{ x: 0, y: BASE_Y, w: WORLD_W, h: BLOCK_H }];
  mover = {
    x: Math.floor((WORLD_W - startW) / 2),
    y: BASE_Y - BLOCK_H,
    w: startW,
    h: BLOCK_H,
    dir: 1,
    speed: speedForScore(0),
  };

  updateHud();
  hideOverlay();
}

function gameOver() {
  state = State.Over;
  if (score > best) {
    best = score;
    saveBest(best);
    updateHud();
  }
  showOverlay("over");
  beep(180, 220, "sawtooth", 0.14);
}

function addShake(mag, t = 0.16) {
  shakeMag = Math.max(shakeMag, mag);
  shakeT = Math.max(shakeT, t);
}

function spawnSparks(x, y, intensity = 12) {
  const count = clamp(intensity, 6, 22);
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: rand(-220, 220),
      vy: rand(-420, -120),
      r: rand(1.0, 2.2),
      ttl: rand(0.25, 0.55),
    });
  }
  // Keep arrays small
  if (particles.length > 160) particles.splice(0, particles.length - 160);
}

function drop() {
  if (state !== State.Playing || !mover) return;
  const prev = blocks[blocks.length - 1];

  const dx = mover.x - prev.x;
  const absDx = Math.abs(dx);

  // Perfect snap
  const isPerfect = absDx <= PERFECT_PX;
  const overlapStart = isPerfect ? prev.x : Math.max(mover.x, prev.x);
  const overlapEnd = isPerfect ? prev.x + Math.min(prev.w, mover.w) : Math.min(mover.x + mover.w, prev.x + prev.w);
  const overlapW = overlapEnd - overlapStart;

  if (overlapW <= 0 || overlapW < MIN_OVERLAP_PX) {
    addShake(6, 0.2);
    gameOver();
    return;
  }

  // Falling trimmed piece(s)
  const trimLeftW = overlapStart - mover.x;
  const trimRightW = (mover.x + mover.w) - overlapEnd;

  if (!isPerfect && trimLeftW > 0.5) {
    falling.push({
      x: mover.x,
      y: mover.y,
      w: trimLeftW,
      h: mover.h,
      vx: rand(-40, -10),
      vy: rand(-60, 40),
      rot: rand(-0.25, 0.25),
      vr: rand(-2.4, -1.1),
      ttl: 2.2,
    });
  }
  if (!isPerfect && trimRightW > 0.5) {
    falling.push({
      x: overlapEnd,
      y: mover.y,
      w: trimRightW,
      h: mover.h,
      vx: rand(10, 40),
      vy: rand(-60, 40),
      rot: rand(-0.25, 0.25),
      vr: rand(1.1, 2.4),
      ttl: 2.2,
    });
  }
  if (falling.length > 10) falling.splice(0, falling.length - 10);

  // Place the overlapping part
  const placed = { x: overlapStart, y: mover.y, w: overlapW, h: mover.h };
  blocks.push(placed);

  // Score + feedback
  score += 1;
  if (isPerfect) {
    score += 2; // PERFECT bonus
    floatText = { text: "PERFECT!", x: placed.x + placed.w / 2, y: placed.y - 18, ttl: 0.55, alpha: 1, scale: 1.0 };
    addShake(7, 0.18);
    beep(920, 70, "square", 0.10);
  } else {
    if (absDx <= 18) addShake(4, 0.14); // near-miss shake
    beep(520, 55, "square", 0.08);
  }

  spawnSparks(placed.x + placed.w / 2, placed.y + placed.h * 0.25, isPerfect ? 16 : 10);

  // Difficulty: speed up and shrink a bit (never below min)
  const nextW = Math.max(MIN_W, placed.w - shrinkForScore(score));
  const nextY = placed.y - BLOCK_H;
  const nextDir = mover.dir * -1;
  const startX = nextDir > 0 ? 0 : WORLD_W - nextW;

  mover = {
    x: startX,
    y: nextY,
    w: nextW,
    h: BLOCK_H,
    dir: nextDir,
    speed: speedForScore(score),
  };

  updateHud();
}

// ===== Rendering =====
function clearAll() {
  // Clear in device pixels (so letterbox areas are cleared too)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Restore view transform (world -> screen)
  ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, dpr * viewOffX, dpr * viewOffY);
}

function drawBackground(timeS) {
  // Base fill
  ctx.fillStyle = COLORS.bg0;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Soft green glow
  const g = ctx.createRadialGradient(WORLD_W * 0.5, WORLD_H * 0.42, 10, WORLD_W * 0.5, WORLD_H * 0.5, WORLD_H * 0.9);
  g.addColorStop(0, COLORS.bg1);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Subtle grid
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,255,102,0.22)";
  const step = 24;
  for (let x = 0; x <= WORLD_W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, WORLD_H);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(WORLD_W, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // In-canvas scanline shimmer (very subtle)
  ctx.save();
  ctx.globalAlpha = 0.06;
  const sl = 4;
  const phase = (timeS * 28) % sl;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let y = -sl; y < WORLD_H + sl; y += sl) {
    const yy = y + phase;
    ctx.fillRect(0, yy, WORLD_W, 1);
  }
  ctx.restore();
}

function neonRect(x, y, w, h, bright = 1, dimmer = false) {
  const fill = dimmer ? "rgba(0,255,102,0.10)" : "rgba(0,255,102,0.14)";
  const stroke = dimmer ? "rgba(0,255,102,0.60)" : "rgba(0,255,170,0.90)";

  // Fill
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);

  // Glow stroke
  ctx.save();
  ctx.shadowColor = dimmer ? "rgba(0,255,102,0.45)" : "rgba(0,255,170,0.70)";
  ctx.shadowBlur = dimmer ? 10 * bright : 16 * bright;
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.restore();

  // Inner edge
  ctx.save();
  ctx.globalAlpha = dimmer ? 0.20 : 0.28;
  ctx.strokeStyle = COLORS.neon;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 2.5, y + 2.5, Math.max(0, w - 5), Math.max(0, h - 5));
  ctx.restore();
}

function drawTextGlow(text, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = "rgba(234,255,245,1)";
  ctx.shadowColor = "rgba(0,255,170,0.9)";
  ctx.shadowBlur = 18;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ===== Update loop =====
let lastT = performance.now();
function frame(now) {
  // Keep transform fresh in case DPR changes (browser zoom/orientation)
  resize();

  const dt = Math.min((now - lastT) / 1000, 0.033);
  lastT = now;
  const timeS = now / 1000;

  // Update camera target (keep the active layer comfortably visible)
  const topY = mover ? mover.y : BASE_Y;
  const desired = topY - WORLD_H * 0.36;
  cameraTargetY = Math.min(0, desired);
  cameraY = lerp(cameraY, cameraTargetY, 1 - Math.pow(0.001, dt)); // smooth, framerate-independent-ish

  // Shake decay
  let shakeX = 0;
  let shakeY = 0;
  if (shakeT > 0) {
    shakeT -= dt;
    const p = clamp(shakeT / 0.22, 0, 1);
    const mag = shakeMag * p;
    shakeX = rand(-mag, mag);
    shakeY = rand(-mag, mag);
    if (shakeT <= 0) shakeMag = 0;
  }

  // Update mover
  if (state === State.Playing && mover) {
    mover.x += mover.dir * mover.speed * dt;
    if (mover.x <= 0) {
      mover.x = 0;
      mover.dir = 1;
    } else if (mover.x + mover.w >= WORLD_W) {
      mover.x = WORLD_W - mover.w;
      mover.dir = -1;
    }
  }

  // Update falling pieces
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.ttl -= dt;
    f.vy += GRAVITY * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
    if (f.ttl <= 0 || f.y - cameraY > WORLD_H + 240) {
      falling.splice(i, 1);
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.ttl -= dt;
    p.vy += GRAVITY * 0.55 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.ttl <= 0 || p.y - cameraY > WORLD_H + 200) particles.splice(i, 1);
  }

  // Floating text
  if (floatText) {
    floatText.ttl -= dt;
    floatText.y -= 38 * dt;
    floatText.alpha = clamp(floatText.ttl / 0.55, 0, 1);
    floatText.scale = 1 + (1 - floatText.alpha) * 0.08;
    if (floatText.ttl <= 0) floatText = null;
  }

  // ===== Draw =====
  clearAll();
  drawBackground(timeS);

  ctx.save();
  ctx.translate(shakeX, -cameraY + shakeY);

  // Draw base + stacked blocks (cull outside view)
  const minY = cameraY - 120;
  const maxY = cameraY + WORLD_H + 200;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.y > maxY || b.y + b.h < minY) continue;
    neonRect(b.x, b.y, b.w, b.h, 1.0, false);
  }

  // Falling pieces (dimmer)
  for (const f of falling) {
    if (f.y > maxY || f.y + f.h < minY) continue;
    ctx.save();
    ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
    ctx.rotate(f.rot);
    neonRect(-f.w / 2, -f.h / 2, f.w, f.h, 0.9, true);
    ctx.restore();
  }

  // Active mover
  if (mover) {
    neonRect(mover.x, mover.y, mover.w, mover.h, 1.15, false);
  }

  // Sparks
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    const a = clamp(p.ttl / 0.55, 0, 1);
    ctx.globalAlpha = 0.9 * a;
    ctx.fillStyle = "rgba(0,255,170,1)";
    ctx.shadowColor = "rgba(0,255,170,0.85)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // PERFECT text
  if (floatText) {
    drawTextGlow(floatText.text, floatText.x, floatText.y, Math.floor(26 * floatText.scale), floatText.alpha);
  }

  ctx.restore();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ===== Input =====
function onPrimaryAction(e) {
  // Ensure we can use preventDefault on mobile
  if (e && typeof e.preventDefault === "function") e.preventDefault();
  ensureAudio();

  if (state === State.Playing) {
    drop();
  }
}

canvas.addEventListener("pointerdown", onPrimaryAction, { passive: false });

overlayBtn.addEventListener("click", (e) => {
  e.preventDefault();
  ensureAudio();
  if (state === State.Ready || state === State.Over) startGame();
});

// Allow tapping the overlay backdrop to start/restart (mobile-friendly)
overlay.addEventListener(
  "pointerdown",
  (e) => {
    // Only if the tap isn't on the button itself
    if (e.target === overlay) {
      e.preventDefault();
      ensureAudio();
      if (state === State.Ready || state === State.Over) startGame();
    }
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  const key = e.code || e.key;
  const isAction = key === "Space" || key === "Enter";
  if (!isAction) return;
  e.preventDefault();
  ensureAudio();

  if (state === State.Playing) drop();
  else startGame();
});

// ===== Boot =====
updateHud();
showOverlay("start");

// Kick audio init on first interaction to satisfy autoplay restrictions.
window.addEventListener("pointerdown", ensureAudio, { once: true });
