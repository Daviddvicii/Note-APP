const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score-value");
const bestEl = document.getElementById("best-value");
const livesEl = document.getElementById("lives-value");

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayMessage = document.getElementById("overlay-message");
const startBtn = document.getElementById("start-btn");

const STORAGE_KEY = "retro-neon-fruit-best";
const BIG_FRUIT_HITS = 3;
const GRAVITY = 2200; // px / s^2
const TRAIL_FADE_MS = 280;
const MAX_TRAIL_POINTS = 18;
const BOMB_CHANCE = 0.22;
const HIT_COOLDOWN = 140;

const FRUIT_TYPES = [
  { name: "Neon Kiwi", colors: ["#73ff96", "#32ffc2"], outline: "#0dffb8", juice: "#7dffb6" },
  { name: "Hyper Mango", colors: ["#ffd36e", "#ff5fd2"], outline: "#ffef9c", juice: "#ffc56b" },
  { name: "Synth Berry", colors: ["#ff6b9c", "#ffa976"], outline: "#ff90c6", juice: "#ff8fb5" },
  { name: "Ion Grape", colors: ["#c98bff", "#64e9ff"], outline: "#e0b5ff", juice: "#c882ff" },
  { name: "Pulse Lime", colors: ["#a8ff2f", "#52ffcb"], outline: "#b7ff52", juice: "#9eff5a" }
];

const state = {
  running: false,
  score: 0,
  best: Number(localStorage.getItem(STORAGE_KEY)) || 0,
  lives: 3,
  spawnTimer: 0,
  spawnDelay: 1,
  fruits: [],
  bombs: [],
  particles: [],
  slashTrail: [],
  pointerDown: false,
  lastTime: 0,
  fruitLaunchCount: 0
};

updateHud();

startBtn.addEventListener("click", startGame);
overlay.addEventListener("click", (event) => {
  if (event.target === overlay) {
    startGame();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && overlay.classList.contains("visible")) {
    event.preventDefault();
    startGame();
  }
});

canvas.addEventListener("pointerdown", (event) => {
  state.pointerDown = true;
  canvas.setPointerCapture(event.pointerId);
  state.slashTrail.length = 0;
  addSlashPoint(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.pointerDown) return;
  addSlashPoint(event);
});

const releasePointer = () => {
  state.pointerDown = false;
  state.slashTrail.length = 0;
};

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("pointerleave", releasePointer);
window.addEventListener("blur", releasePointer);

function startGame() {
  state.running = true;
  state.score = 0;
  state.lives = 3;
  state.spawnTimer = 0;
  state.spawnDelay = rand(0.7, 1.15);
  state.fruits.length = 0;
  state.bombs.length = 0;
  state.particles.length = 0;
  state.slashTrail.length = 0;
  state.fruitLaunchCount = 0;
  state.lastTime = performance.now();
  overlay.classList.remove("visible");
  overlayTitle.textContent = "Retro Neon Fruit Ninja";
  overlayMessage.textContent = "Slice everything but the bombs. Mega fruit arrives every 6th launch.";
  startBtn.textContent = "Keep Slicing";
  updateHud();
}

function endGame(message) {
  state.running = false;
  persistBest();
  overlay.classList.add("visible");
  overlayTitle.textContent = "Game Over";
  overlayMessage.innerHTML = `${message}<br/>Final score: <strong>${state.score}</strong>`;
  startBtn.textContent = "Play Again";
}

function persistBest() {
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem(STORAGE_KEY, state.best);
  }
  updateHud();
}

function updateHud() {
  scoreEl.textContent = state.score.toString().padStart(2, "0");
  bestEl.textContent = Math.max(state.best, state.score).toString().padStart(2, "0");
  livesEl.textContent = "❤".repeat(state.lives).padEnd(3, "–");
}

function loseLife() {
  state.lives = Math.max(0, state.lives - 1);
  updateHud();
  if (state.lives <= 0) {
    endGame("Too many fruit splattered!");
  }
}

function spawnWave() {
  const fruitThisWave = 1 + (Math.random() < 0.55 ? 1 : 0);
  for (let i = 0; i < fruitThisWave; i++) {
    spawnFruit();
  }
  if (Math.random() < BOMB_CHANCE) {
    spawnBomb();
  }
}

function spawnFruit() {
  state.fruitLaunchCount += 1;
  const isBig = state.fruitLaunchCount % 6 === 0;
  const type = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
  const radius = isBig ? rand(40, 54) : rand(20, 32);
  const x = rand(radius + 40, canvas.width - radius - 40);
  const y = canvas.height + radius + 30;
  const vx = rand(-220, 220);
  const vy = -(rand(820, 1180) + (isBig ? 120 : 0));
  const fruit = {
    type,
    x,
    y,
    vx,
    vy,
    radius,
    rotation: rand(0, Math.PI * 2),
    spin: rand(-2, 2),
    slicesNeeded: isBig ? BIG_FRUIT_HITS : 1,
    isBig,
    lastHit: 0
  };
  state.fruits.push(fruit);
}

function spawnBomb() {
  const radius = 26;
  const bomb = {
    x: rand(radius + 40, canvas.width - radius - 40),
    y: canvas.height + radius + 25,
    vx: rand(-180, 180),
    vy: -rand(900, 1250),
    radius,
    rotation: rand(0, Math.PI * 2),
    spin: rand(-3, 3),
    armed: true,
    lastHit: 0
  };
  state.bombs.push(bomb);
}

function addSlashPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const point = {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
    time: performance.now()
  };
  state.slashTrail.push(point);
  if (state.slashTrail.length > MAX_TRAIL_POINTS) {
    state.slashTrail.shift();
  }
  const trailCount = state.slashTrail.length;
  if (trailCount >= 2) {
    const p1 = state.slashTrail[trailCount - 2];
    const p2 = state.slashTrail[trailCount - 1];
    testSegment(p1, p2);
  }
}

function testSegment(a, b) {
  for (let i = state.fruits.length - 1; i >= 0; i--) {
    const fruit = state.fruits[i];
    if (segmentHitsCircle(a, b, fruit.x, fruit.y, fruit.radius + 6)) {
      const now = performance.now();
      if (now - fruit.lastHit < HIT_COOLDOWN) continue;
      fruit.lastHit = now;
      fruit.slicesNeeded -= 1;
      state.score += fruit.isBig ? (fruit.slicesNeeded <= 0 ? 35 : 12) : 10;
      updateHud();
      spawnJuice(fruit);
      if (fruit.slicesNeeded <= 0) {
        state.fruits.splice(i, 1);
      }
    }
  }

  for (let i = state.bombs.length - 1; i >= 0; i--) {
    const bomb = state.bombs[i];
    if (segmentHitsCircle(a, b, bomb.x, bomb.y, bomb.radius + 4)) {
      triggerBomb(bomb);
      state.bombs.splice(i, 1);
      break;
    }
  }
}

function triggerBomb(bomb) {
  spawnExplosion(bomb);
  state.lives = 0;
  updateHud();
  endGame("Boom! Bombs end the run instantly.");
}

function spawnJuice(fruit) {
  const pieces = fruit.isBig ? 20 : 12;
  for (let i = 0; i < pieces; i++) {
    state.particles.push({
      x: fruit.x,
      y: fruit.y,
      vx: rand(-260, 260),
      vy: rand(-260, 60),
      life: rand(0.25, 0.55),
      color: fruit.type.juice
    });
  }
}

function spawnExplosion(bomb) {
  for (let i = 0; i < 32; i++) {
    state.particles.push({
      x: bomb.x,
      y: bomb.y,
      vx: rand(-320, 320),
      vy: rand(-320, 320),
      life: rand(0.2, 0.45),
      color: "#ff446d"
    });
  }
}

function update(dt) {
  state.spawnTimer += dt;
  if (state.spawnTimer >= state.spawnDelay) {
    spawnWave();
    state.spawnTimer = 0;
    state.spawnDelay = rand(0.65, 1.15);
  }

  const entities = state.fruits.concat(state.bombs);
  entities.forEach((entity) => {
    entity.vy += GRAVITY * dt;
    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;
    entity.rotation += entity.spin * dt;
  });

  for (let i = state.fruits.length - 1; i >= 0; i--) {
    const fruit = state.fruits[i];
    if (fruit.y - fruit.radius > canvas.height + 80) {
      state.fruits.splice(i, 1);
      loseLife();
      if (!state.running) return;
    }
  }

  for (let i = state.bombs.length - 1; i >= 0; i--) {
    const bomb = state.bombs[i];
    if (bomb.y - bomb.radius > canvas.height + 80) {
      state.bombs.splice(i, 1);
    }
  }

  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    p.vy += (GRAVITY * 0.35) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  trimTrail();
}

function trimTrail() {
  const cutoff = performance.now() - TRAIL_FADE_MS;
  while (state.slashTrail.length && state.slashTrail[0].time < cutoff) {
    state.slashTrail.shift();
  }
}

function draw() {
  drawBackground();
  drawParticles();
  drawFruits();
  drawBombs();
  drawTrail();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#030112");
  gradient.addColorStop(0.5, "#05082b");
  gradient.addColorStop(1, "#000005");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(64, 255, 178, 0.09)";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  for (let y = 0; y <= canvas.height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  for (let x = 0; x <= canvas.width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
}

function drawFruits() {
  state.fruits.forEach((fruit) => {
    ctx.save();
    ctx.translate(fruit.x, fruit.y);
    ctx.rotate(fruit.rotation);
    const grad = ctx.createRadialGradient(0, 0, fruit.radius * 0.15, 0, 0, fruit.radius);
    grad.addColorStop(0, fruit.type.colors[0]);
    grad.addColorStop(1, fruit.type.colors[1]);
    ctx.fillStyle = grad;
    ctx.shadowColor = fruit.type.outline;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(0, 0, fruit.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = fruit.type.outline;
    ctx.stroke();

    if (fruit.isBig) {
      ctx.rotate(-fruit.rotation);
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      const progress = (BIG_FRUIT_HITS - fruit.slicesNeeded) / BIG_FRUIT_HITS;
      ctx.beginPath();
      ctx.arc(0, 0, fruit.radius + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  });
}

function drawBombs() {
  state.bombs.forEach((bomb) => {
    ctx.save();
    ctx.translate(bomb.x, bomb.y);
    ctx.rotate(bomb.rotation);
    const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, bomb.radius);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.4, "#585dff");
    grad.addColorStop(1, "#050713");
    ctx.fillStyle = grad;
    ctx.shadowColor = "#ff4f6a";
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(0, 0, bomb.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ff4f6a";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  state.particles.forEach((p) => {
    const alpha = Math.max(0, Math.min(1, p.life / 0.55));
    ctx.fillStyle = `${hexToRgba(p.color, alpha)}`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawTrail() {
  if (state.slashTrail.length < 2) {
    return;
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#7dfff2";
  ctx.shadowBlur = 18;
  for (let i = 1; i < state.slashTrail.length; i++) {
    const prev = state.slashTrail[i - 1];
    const curr = state.slashTrail[i];
    const alpha = i / state.slashTrail.length;
    ctx.strokeStyle = `rgba(125, 255, 242, ${alpha})`;
    ctx.lineWidth = 2 + alpha * 8;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }
  ctx.restore();
}

function loop(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  const dt = Math.min(0.04, (timestamp - state.lastTime) / 1000);
  state.lastTime = timestamp;

  if (state.running) {
    update(dt);
  } else {
    trimTrail();
  }
  draw();
  requestAnimationFrame(loop);
}

function segmentHitsCircle(a, b, cx, cy, radius) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const acx = cx - a.x;
  const acy = cy - a.y;
  const abLenSq = abx * abx + aby * aby;
  let t = 0;
  if (abLenSq !== 0) {
    t = (acx * abx + acy * aby) / abLenSq;
  }
  t = Math.max(0, Math.min(1, t));
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  const dx = closestX - cx;
  const dy = closestY - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

requestAnimationFrame(loop);
