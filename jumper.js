/**
 * Neon Sky Jumper — Reachable Platforms 2.0 (FIXED)
 * Guarantees vertical + horizontal reachability
 */

/* =========================
   DOM
========================= */
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreDisplay = document.getElementById("scoreDisplay");
const bestDisplay = document.getElementById("bestDisplay");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayDesc = document.getElementById("overlayDesc");
const overlayScore = document.getElementById("overlayScore");
const overlayBest = document.getElementById("overlayBest");
const startBtn = document.getElementById("startBtn");

const W = canvas.width;
const H = canvas.height;

/* =========================
   Physics / Constants
========================= */
const GRAVITY = 2200;
const JUMP_VELOCITY = -900;
const BOOST_VELOCITY = -1400;
const PLAYER_RADIUS = 25;
const PLATFORM_WIDTH = 120;
const PLATFORM_HEIGHT = 20;
const HORIZONTAL_SPEED = 800;
const HORIZONTAL_LERP = 0.15;
const CAMERA_THRESHOLD = 0.4;
const INITIAL_PLATFORMS = 15;
const STORAGE_KEY = "neon-sky-jumper-best";

/* =========================
   Reachability Control
========================= */
const GAP_SAFETY = 0.82;
const MIN_GAP = 90;

function maxJumpHeight(v) {
  return (v * v) / (2 * GRAVITY);
}

function maxReachableGap() {
  return Math.max(
    MIN_GAP,
    maxJumpHeight(Math.abs(JUMP_VELOCITY)) * GAP_SAFETY
  );
}

function maxHorizontalReach(dy) {
  const t = dy / (Math.abs(JUMP_VELOCITY) * 0.6);
  return HORIZONTAL_SPEED * t * 1.15;
}

/* =========================
   Platform Types
========================= */
const PLATFORM_NORMAL = "normal";
const PLATFORM_MOVING = "moving";
const PLATFORM_BREAKABLE = "breakable";
const PLATFORM_BOOST = "boost";

/* =========================
   State
========================= */
let state = {
  gameState: "start",
  score: 0,
  best: 0,
  maxHeight: 0,
  cameraY: 0,
  difficulty: 1,
  player: {
    x: W / 2,
    y: H - 150,
    vy: 0,
    targetX: W / 2,
    radius: PLAYER_RADIUS,
    trail: []
  },
  platforms: [],
  particles: [],
  keys: { left: false, right: false }
};

let lastTime = 0;

/* =========================
   Utils
========================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => Math.random() * (b - a) + a;

/* =========================
   Platform Creation
========================= */
function createPlatform(x, y, type = PLATFORM_NORMAL) {
  const p = {
    x,
    y,
    width: PLATFORM_WIDTH,
    height: PLATFORM_HEIGHT,
    type,
    breaking: false,
    breakTimer: 0,
    opacity: 1
  };

  if (type === PLATFORM_MOVING) {
    p.vx = rand(120, 220) * (Math.random() < 0.5 ? -1 : 1);
    p.minX = 40;
    p.maxX = W - p.width - 40;
  }

  if (type === PLATFORM_BOOST) p.width = 100;
  return p;
}

function randomPlatformType() {
  const d = Math.min(state.difficulty / 10, 0.6);
  const r = Math.random();
  if (r < 0.05 + d * 0.05) return PLATFORM_BOOST;
  if (r < 0.18 + d * 0.2) return PLATFORM_BREAKABLE;
  if (r < 0.35 + d * 0.25) return PLATFORM_MOVING;
  return PLATFORM_NORMAL;
}

/* =========================
   Platform Generation (FIXED)
========================= */
function generateInitialPlatforms() {
  state.platforms = [];
  state.platforms.push(
    createPlatform(W / 2 - PLATFORM_WIDTH / 2, H - 100)
  );

  let last = state.platforms[0];

  for (let i = 1; i < INITIAL_PLATFORMS; i++) {
    const reach = maxReachableGap();
    const gap = rand(100, reach);

    const y = last.y - gap;
    const dxCap = maxHorizontalReach(gap);
    const x = clamp(
      rand(last.x - dxCap, last.x + dxCap),
      40,
      W - PLATFORM_WIDTH - 40
    );

    const type = i < 3 ? PLATFORM_NORMAL : randomPlatformType();
    const p = createPlatform(x, y, type);
    state.platforms.push(p);
    last = p;
  }
}

function spawnPlatformsAbove() {
  let highest = Math.min(...state.platforms.map(p => p.y));
  const threshold = state.cameraY - 200;

  while (highest > threshold) {
    const prev = state.platforms.reduce((a, b) =>
      b.y < a.y ? b : a
    );

    const reach = maxReachableGap();
    const minGap = 100 + state.difficulty * 2;
    const maxGap = Math.min(reach, 200 + state.difficulty * 4);
    const gap = rand(minGap, maxGap);

    const y = prev.y - gap;
    const dxCap = maxHorizontalReach(gap);
    const x = clamp(
      rand(prev.x - dxCap, prev.x + dxCap),
      40,
      W - PLATFORM_WIDTH - 40
    );

    state.platforms.push(createPlatform(x, y, randomPlatformType()));
    highest = y;
  }
}

function removeOffscreenPlatforms() {
  const bottom = state.cameraY + H + 120;
  state.platforms = state.platforms.filter(p => p.y < bottom);
}

/* =========================
   Collision
========================= */
function hitPlatform(player, p, prevY) {
  if (player.vy <= 0) return false;
  const prevBottom = prevY + player.radius;
  const bottom = player.y + player.radius;
  if (prevBottom <= p.y && bottom >= p.y) {
    return (
      player.x + player.radius * 0.8 > p.x &&
      player.x - player.radius * 0.8 < p.x + p.width
    );
  }
  return false;
}

/* =========================
   Update
========================= */
function update(dt) {
  if (state.gameState !== "running") return;

  const p = state.player;
  const prevY = p.y;

  if (state.keys.left) p.targetX -= HORIZONTAL_SPEED * dt;
  if (state.keys.right) p.targetX += HORIZONTAL_SPEED * dt;
  p.targetX = clamp(p.targetX, p.radius, W - p.radius);
  p.x += (p.targetX - p.x) * HORIZONTAL_LERP;

  p.vy += GRAVITY * dt;
  p.y += p.vy * dt;

  for (const plat of state.platforms) {
    if (plat.type === PLATFORM_MOVING) {
      plat.x += plat.vx * dt;
      if (plat.x < plat.minX || plat.x > plat.maxX) {
        plat.vx *= -1;
        plat.x = clamp(plat.x, plat.minX, plat.maxX);
      }
    }

    if (!plat.breaking && hitPlatform(p, plat, prevY)) {
      p.y = plat.y - p.radius;
      p.vy =
        plat.type === PLATFORM_BOOST
          ? BOOST_VELOCITY
          : JUMP_VELOCITY;

      if (plat.type === PLATFORM_BREAKABLE) {
        plat.breaking = true;
      }
      break;
    }
  }

  state.platforms = state.platforms.filter(
    pl => !pl.breaking || pl.breakTimer++ < 25
  );

  const camLine = state.cameraY + H * CAMERA_THRESHOLD;
  if (p.y < camLine) state.cameraY = p.y - H * CAMERA_THRESHOLD;

  const h = H - p.y;
  if (h > state.maxHeight) {
    state.maxHeight = h;
    state.score = Math.floor(h / 10);
    state.difficulty = 1 + Math.floor(h / 2000);
    scoreDisplay.textContent = state.score;
  }

  spawnPlatformsAbove();
  removeOffscreenPlatforms();

  if (p.y > state.cameraY + H + 80) endGame();
}

/* =========================
   Draw (minimal)
========================= */
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#080822";
  ctx.fillRect(0, 0, W, H);

  for (const p of state.platforms) {
    ctx.fillStyle = "#00ffcc";
    ctx.fillRect(p.x, p.y - state.cameraY, p.width, p.height);
  }

  const pl = state.player;
  ctx.fillStyle = "#00ffcc";
  ctx.beginPath();
  ctx.arc(pl.x, pl.y - state.cameraY, pl.radius, 0, Math.PI * 2);
  ctx.fill();
}

/* =========================
   Loop
========================= */
function loop(t) {
  const dt = Math.min((t - lastTime) / 1000, 0.05);
  lastTime = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* =========================
   State
========================= */
function startGame() {
  state.gameState = "running";
  state.score = 0;
  state.maxHeight = 0;
  state.cameraY = 0;
  state.difficulty = 1;
  state.player.x = W / 2;
  state.player.y = H - 150;
  state.player.vy = JUMP_VELOCITY;
  state.player.targetX = W / 2;
  generateInitialPlatforms();
  overlay.classList.add("hidden");
}

function endGame() {
  state.gameState = "gameover";
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem(STORAGE_KEY, state.best);
    bestDisplay.textContent = state.best;
  }
  overlayTitle.textContent = "Game Over";
  overlayScore.textContent = `Score: ${state.score}`;
  overlayBest.textContent = `Best: ${state.best}`;
  overlay.classList.remove("hidden");
}

function init() {
  const b = localStorage.getItem(STORAGE_KEY);
  if (b) {
    state.best = parseInt(b, 10) || 0;
    bestDisplay.textContent = state.best;
  }
  generateInitialPlatforms();
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

startBtn.addEventListener("click", startGame);
window.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft" || e.key === "a") state.keys.left = true;
  if (e.key === "ArrowRight" || e.key === "d") state.keys.right = true;
  if ((e.key === " " || e.key === "Enter") && state.gameState !== "running")
    startGame();
});
window.addEventListener("keyup", e => {
  if (e.key === "ArrowLeft" || e.key === "a") state.keys.left = false;
  if (e.key === "ArrowRight" || e.key === "d") state.keys.right = false;
});

init();
