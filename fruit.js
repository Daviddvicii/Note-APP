/* Retro neon fruit slicing mini-game */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let devicePixelRatioValue = 1;
let worldWidth = 0;
let worldHeight = 0;

function resizeCanvas() {
  devicePixelRatioValue = window.devicePixelRatio || 1;
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  canvas.width = Math.max(1, Math.floor(cssWidth * devicePixelRatioValue));
  canvas.height = Math.max(1, Math.floor(cssHeight * devicePixelRatioValue));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  worldWidth = cssWidth;
  worldHeight = cssHeight;
  ctx.setTransform(devicePixelRatioValue, 0, 0, devicePixelRatioValue, 0, 0);
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

const GameState = Object.freeze({
  Ready: "ready",
  Running: "running",
  Over: "over",
});

const MAX_LIVES = 3;
const GRAVITY = 2200;
const BASE_SPAWN_INTERVAL = 0.95;
const MIN_SPAWN_INTERVAL = 0.45;
const BIG_FRUIT_INTERVAL = 6;
const SLICE_FADE_MS = 260;
const MAX_SLICE_POINTS = 20;

const FRUIT_TYPES = [
  { name: "plasma kiwi", radius: 22, base: "#04ffb2", highlight: "#cafff0", score: 6, slices: 1 },
  { name: "magenta mango", radius: 26, base: "#ff5fbb", highlight: "#ffd6ff", score: 8, slices: 1 },
  { name: "lazer lime", radius: 20, base: "#5cff6a", highlight: "#e6ffef", score: 5, slices: 1 },
  { name: "ultra berry", radius: 24, base: "#8d6bff", highlight: "#f1e7ff", score: 7, slices: 1 },
];

const BIG_FRUIT = { name: "hyper melon", radius: 40, base: "#80d7ff", highlight: "#f0fbff", score: 20, slices: 3 };
const BOMB_SETTINGS = { radius: 22 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function segmentHitsCircle(p1, p2, cx, cy, radius) {
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const wx = cx - p1.x;
  const wy = cy - p1.y;
  const lenSq = vx * vx + vy * vy || 0.00001;
  const t = clamp((wx * vx + wy * vy) / lenSq, 0, 1);
  const closestX = p1.x + vx * t;
  const closestY = p1.y + vy * t;
  const dx = closestX - cx;
  const dy = closestY - cy;
  return dx * dx + dy * dy <= radius * radius;
}

class FlyingItem {
  constructor(config) {
    this.x = config.x;
    this.y = config.y;
    this.vx = config.vx;
    this.vy = config.vy;
    this.radius = config.radius;
    this.rotation = rand(0, Math.PI * 2);
    this.spin = rand(-2.5, 2.5);
    this.dead = false;
  }

  update(dt) {
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rotation += this.spin * dt;
  }
}

class Fruit extends FlyingItem {
  constructor(config) {
    super(config);
    this.kind = "fruit";
    this.baseColor = config.baseColor;
    this.highlight = config.highlight;
    this.points = config.points;
    this.slicesNeeded = config.slices;
    this.sliceProgress = 0;
    this.sliceState = "fresh";
    this.sliceFade = 0;
    this.sliceAngle = 0;
    this.hitCooldown = 0;
  }

  update(dt) {
    super.update(dt);
    if (this.hitCooldown > 0) {
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    }
    if (this.sliceState === "sliced") {
      this.sliceFade -= dt;
      if (this.sliceFade <= 0) this.dead = true;
    }
  }

  trySlice(p1, p2) {
    if (this.sliceState === "sliced" || this.hitCooldown > 0) return null;
    if (!segmentHitsCircle(p1, p2, this.x, this.y, this.radius)) return null;
    this.hitCooldown = 0.08;
    this.sliceProgress += 1;
    const finished = this.sliceProgress >= this.slicesNeeded;
    return {
      kind: "fruit",
      finished,
      angle: Math.atan2(p2.y - p1.y, p2.x - p1.x),
    };
  }

  markSliced(angle) {
    this.sliceState = "sliced";
    this.sliceFade = 0.45;
    this.sliceAngle = angle;
  }

  draw(ctx) {
    if (this.sliceState === "sliced") {
      this.drawSliced(ctx);
      return;
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    const gradient = ctx.createRadialGradient(0, 0, this.radius * 0.15, 0, 0, this.radius);
    gradient.addColorStop(0, this.highlight);
    gradient.addColorStop(1, this.baseColor);
    ctx.fillStyle = gradient;
    ctx.shadowColor = this.baseColor;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (this.slicesNeeded > 1 && this.sliceState === "fresh") {
      ctx.strokeStyle = this.highlight;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.85;
      const progress = this.sliceProgress / this.slicesNeeded;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawSliced(ctx) {
    const fade = clamp(this.sliceFade / 0.45, 0, 1);
    const offset = 10 + (1 - fade) * 18;
    const normalAngle = this.sliceAngle + Math.PI / 2;
    const nx = Math.cos(normalAngle);
    const ny = Math.sin(normalAngle);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.shadowColor = this.baseColor;
    ctx.shadowBlur = 16;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(this.x + nx * offset * dir, this.y + ny * offset * dir);
      ctx.rotate(this.rotation + dir * 0.25);
      ctx.fillStyle = this.baseColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius * 0.95, this.radius * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

class Bomb extends FlyingItem {
  constructor(config) {
    super(config);
    this.kind = "bomb";
  }

  trySlice(p1, p2) {
    if (this.dead) return null;
    return segmentHitsCircle(p1, p2, this.x, this.y, this.radius) ? { kind: "bomb" } : null;
  }

  draw(ctx, now) {
    const pulse = (Math.sin(now / 90) + 1) * 0.5;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = `rgba(255,64,64,${0.65 + pulse * 0.35})`;
    ctx.shadowColor = "#ff4545";
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2 + pulse;
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * (0.6 + 0.25 * pulse), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

class Particle {
  constructor({ x, y, color, speed, angle, ttl, size }) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = ttl;
    this.ttl = ttl;
    this.size = size;
    this.color = color;
  }

  update(dt) {
    this.life -= dt;
    this.vy += 450 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    const alpha = clamp(this.life / this.ttl, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * alpha + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  get dead() {
    return this.life <= 0;
  }
}

class FruitNinjaGame {
  constructor() {
    this.state = GameState.Ready;
    this.items = [];
    this.particles = [];
    this.sliceTrail = [];
    this.sliceActive = false;
    this.spawnTimer = 0;
    this.totalFruits = 0;
    this.score = 0;
    this.lives = MAX_LIVES;
    this.bestScore = this.loadBestScore();
    this.gridOffset = 0;
    this.gameOverReason = "";
  }

  loadBestScore() {
    try {
      const raw = localStorage.getItem("retro_fruit_best");
      return raw ? parseInt(raw, 10) || 0 : 0;
    } catch (_) {
      return 0;
    }
  }

  saveBestScore() {
    try {
      localStorage.setItem("retro_fruit_best", String(this.bestScore));
    } catch (_) {
      /* ignore storage errors */
    }
  }

  startRun() {
    this.items.length = 0;
    this.particles.length = 0;
    this.sliceTrail.length = 0;
    this.spawnTimer = 0;
    this.totalFruits = 0;
    this.score = 0;
    this.lives = MAX_LIVES;
    this.gameOverReason = "";
    this.state = GameState.Running;
  }

  update(dt, now) {
    this.gridOffset = (this.gridOffset + dt * 60) % 60;
    this.sliceTrail = this.sliceTrail.filter((point) => now - point.time <= SLICE_FADE_MS);

    if (this.state === GameState.Running) {
      this.spawnTimer += dt;
      const difficulty = clamp(this.score / 80, 0, 1);
      const interval = clamp(BASE_SPAWN_INTERVAL - difficulty * 0.45, MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL);
      if (this.spawnTimer >= interval) {
        this.spawnTimer = 0;
        this.launchWave();
      }
    }

    for (const item of this.items) {
      item.update(dt);
      if (item.kind === "fruit") {
        const fruit = item;
        if (fruit.sliceState !== "sliced" && fruit.y - fruit.radius > worldHeight + 50) {
          fruit.dead = true;
          this.registerMiss();
        } else if (fruit.sliceState === "sliced" && fruit.y - fruit.radius > worldHeight + 80) {
          fruit.dead = true;
        }
      } else if (item.kind === "bomb") {
        if (item.y - item.radius > worldHeight + 60) {
          item.dead = true;
        }
      }
    }
    this.items = this.items.filter((item) => !item.dead);

    for (const particle of this.particles) {
      particle.update(dt);
    }
    this.particles = this.particles.filter((p) => !p.dead);
  }

  launchWave() {
    if (worldWidth === 0 || worldHeight === 0) return;
    const fruitCount = 1 + Math.floor(Math.random() * 3); // 1-3 fruits
    for (let i = 0; i < fruitCount; i += 1) {
      const forceBig = (++this.totalFruits % BIG_FRUIT_INTERVAL === 0);
      this.items.push(this.createFruit(forceBig));
    }

    const bombChanceBase = this.score < 12 ? 0.08 : clamp(0.12 + this.score * 0.004, 0.12, 0.32);
    if (Math.random() < bombChanceBase) {
      this.items.push(this.createBomb());
    }
  }

  randomLaunch(speedScale = 1) {
    const x = rand(worldWidth * 0.15, worldWidth * 0.85);
    const y = worldHeight + 40;
    const vy = -rand(950, 1350) * speedScale;
    const curve = (worldWidth / 2 - x) * 0.6;
    const vx = rand(-220, 220) + curve / 10;
    return { x, y, vx, vy };
  }

  createFruit(forceBig) {
    const launch = this.randomLaunch(forceBig ? 0.9 : 1);
    const config = forceBig ? BIG_FRUIT : FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
    return new Fruit({
      ...launch,
      radius: config.radius,
      baseColor: config.base,
      highlight: config.highlight,
      points: config.score,
      slices: config.slices,
    });
  }

  createBomb() {
    const launch = this.randomLaunch(0.9);
    return new Bomb({
      ...launch,
      radius: BOMB_SETTINGS.radius,
    });
  }

  recordSlicePoint(point, time) {
    this.sliceTrail.push({ ...point, time });
    if (this.sliceTrail.length > MAX_SLICE_POINTS) {
      this.sliceTrail.shift();
    }
  }

  checkSliceSegment(p1, p2) {
    if (this.state !== GameState.Running) return;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    if (dx * dx + dy * dy < 25) return;

    for (const item of this.items) {
      const hit = item.trySlice?.(p1, p2);
      if (!hit) continue;
      if (hit.kind === "bomb") {
        this.handleBombSlice(item);
        return;
      }
      if (hit.kind === "fruit") {
        if (hit.finished) {
          this.finishFruit(item, hit.angle);
        } else {
          this.spawnSpark(item, hit.angle);
        }
      }
    }
  }

  finishFruit(fruit, angle) {
    fruit.markSliced(angle);
    this.score += fruit.points;
    this.spawnJuice(fruit, angle);
  }

  spawnJuice(fruit, angle) {
    const baseAngle = angle - Math.PI / 4;
    for (let i = 0; i < 12; i += 1) {
      const dir = baseAngle + Math.random() * (Math.PI / 2);
      const speed = rand(180, 360);
      this.particles.push(
        new Particle({
          x: fruit.x,
          y: fruit.y,
          color: fruit.baseColor,
          speed,
          angle: dir,
          ttl: rand(0.35, 0.6),
          size: rand(2, 4),
        })
      );
    }
  }

  spawnSpark(item, angle) {
    for (let i = 0; i < 4; i += 1) {
      const jitter = angle + rand(-0.4, 0.4);
      this.particles.push(
        new Particle({
          x: item.x,
          y: item.y,
          color: item.highlight || "#ffffff",
          speed: rand(120, 200),
          angle: jitter,
          ttl: rand(0.2, 0.35),
          size: rand(1.5, 2.5),
        })
      );
    }
  }

  handleBombSlice(bomb) {
    if (this.state !== GameState.Running) return;
    this.triggerExplosion(bomb);
    bomb.dead = true;
    this.gameOverReason = "Bomb detonated!";
    this.endRun();
  }

  triggerExplosion(bomb) {
    for (let i = 0; i < 24; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(200, 420);
      this.particles.push(
        new Particle({
          x: bomb.x,
          y: bomb.y,
          color: "#ff3840",
          speed,
          angle,
          ttl: rand(0.4, 0.7),
          size: rand(2, 4),
        })
      );
    }
  }

  registerMiss() {
    if (this.state !== GameState.Running) return;
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives <= 0) {
      this.gameOverReason = "Too many fruits escaped";
      this.endRun();
    }
  }

  endRun() {
    if (this.state === GameState.Over) return;
    this.state = GameState.Over;
    this.sliceActive = false;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.saveBestScore();
    }
  }

  handlePointerDown(point) {
    if (this.state === GameState.Ready) {
      this.startRun();
    } else if (this.state === GameState.Over) {
      this.startRun();
    }
    this.sliceActive = true;
    this.sliceTrail.length = 0;
    this.recordSlicePoint(point, performance.now());
  }

  handlePointerMove(point) {
    if (!this.sliceActive) return;
    const now = performance.now();
    const prev = this.sliceTrail[this.sliceTrail.length - 1];
    this.recordSlicePoint(point, now);
    if (prev) {
      this.checkSliceSegment(prev, point);
    }
  }

  handlePointerUp() {
    this.sliceActive = false;
  }

  cancelSlice() {
    this.sliceActive = false;
    this.sliceTrail.length = 0;
  }

  drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, worldHeight);
    gradient.addColorStop(0, "#050014");
    gradient.addColorStop(0.5, "#0b0230");
    gradient.addColorStop(1, "#020015");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, worldWidth, worldHeight);

    const spacing = 70;
    ctx.save();
    ctx.translate(0, this.gridOffset);
    ctx.strokeStyle = "rgba(0,255,170,0.05)";
    ctx.lineWidth = 1;
    for (let y = -spacing; y < worldHeight + spacing; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(worldWidth, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0,170,255,0.05)";
    for (let x = 0; x < worldWidth + spacing; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, -spacing);
      ctx.lineTo(x, worldHeight + spacing);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSliceTrail(ctx, now) {
    if (this.sliceTrail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 1; i < this.sliceTrail.length; i += 1) {
      const prev = this.sliceTrail[i - 1];
      const point = this.sliceTrail[i];
      const age = clamp(1 - (now - point.time) / SLICE_FADE_MS, 0, 1);
      if (age <= 0) continue;
      ctx.strokeStyle = `rgba(0,255,230,${age})`;
      ctx.lineWidth = 4 + age * 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHUD(ctx) {
    ctx.save();
    ctx.fillStyle = "#d2fff3";
    ctx.font = "600 20px 'Press Start 2P', system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(`Score ${this.score}`, 20, 16);
    ctx.fillText(`Lives ${"*".repeat(this.lives)}${".".repeat(MAX_LIVES - this.lives)}`, 20, 46);
    ctx.textAlign = "right";
    ctx.fillText(`Best ${this.bestScore}`, worldWidth - 20, 16);
    ctx.restore();
  }

  drawStateText(ctx) {
    if (this.state === GameState.Running) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ecfdf7";
    ctx.font = "700 26px 'Press Start 2P', system-ui, sans-serif";
    const midX = worldWidth / 2;
    const midY = worldHeight / 2;
    if (this.state === GameState.Ready) {
      ctx.fillText("Slice to Begin", midX, midY - 10);
      ctx.font = "500 16px 'Press Start 2P', system-ui, sans-serif";
      ctx.fillText("Big fruit needs 3 hits", midX, midY + 28);
      ctx.fillText("Avoid bombs!", midX, midY + 54);
    } else if (this.state === GameState.Over) {
      ctx.fillText("Game Over", midX, midY - 20);
      ctx.font = "500 16px 'Press Start 2P', system-ui, sans-serif";
      ctx.fillText(this.gameOverReason || "Ouch!", midX, midY + 8);
      ctx.fillText("Slice to restart", midX, midY + 40);
    }
    ctx.restore();
  }

  draw(ctx, now) {
    ctx.clearRect(0, 0, worldWidth, worldHeight);
    this.drawBackground(ctx);

    for (const item of this.items) {
      if (item.kind === "fruit") {
        item.draw(ctx);
      } else if (item.kind === "bomb") {
        item.draw(ctx, now);
      }
    }

    for (const particle of this.particles) {
      particle.draw(ctx);
    }

    this.drawSliceTrail(ctx, now);
    this.drawHUD(ctx);
    this.drawStateText(ctx);
  }
}

const game = new FruitNinjaGame();

let activePointerId = null;

function pointerToCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left),
    y: (event.clientY - rect.top),
  };
}

canvas.addEventListener("pointerdown", (event) => {
  if (activePointerId !== null) return;
  activePointerId = event.pointerId;
  if (canvas.setPointerCapture) {
    try {
      canvas.setPointerCapture(activePointerId);
    } catch (_) {
      /* ignore */
    }
  }
  const point = pointerToCanvasPoint(event);
  game.handlePointerDown(point);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointerId) return;
  const point = pointerToCanvasPoint(event);
  game.handlePointerMove(point);
});

function endPointer(event) {
  if (event.pointerId !== activePointerId) return;
  if (canvas.releasePointerCapture) {
    try {
      canvas.releasePointerCapture(activePointerId);
    } catch (_) {
      /* ignore */
    }
  }
  activePointerId = null;
  game.handlePointerUp();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", endPointer);

window.addEventListener("blur", () => {
  activePointerId = null;
  game.cancelSlice();
});

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" && event.code !== "Enter") return;
  if (game.state === GameState.Ready || game.state === GameState.Over) {
    game.startRun();
  }
  event.preventDefault();
});

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;
  game.update(dt, now);
  game.draw(ctx, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
