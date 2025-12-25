/* Neon Tap Defense — one-finger survival defense on HTML5 Canvas. */

const WORLD_WIDTH = 360;
const WORLD_HEIGHT = 640;

const COLORS = Object.freeze({
  bg0: "#02020a",
  bg1: "#070a1a",
  neonCyan: "#59f7ff",
  neonGreen: "#39ff14",
  neonPink: "#ff4fd8",
  neonYellow: "#ffe86a",
  white: "#ffffff",
  danger: "#ff3355",
});

const GameState = Object.freeze({
  Ready: "ready",
  Running: "running",
  Over: "over",
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function len2(x, y) {
  return x * x + y * y;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function normalize(dx, dy) {
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l, len: l };
}

function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Canvas + responsive scaling **/
const canvas = document.getElementById("game");
/** @type {CanvasRenderingContext2D} */
const ctx = canvas.getContext("2d", { alpha: false });

let devicePixelRatioValue = 1;
let screenScale = 1;
let screenOffsetX = 0;
let screenOffsetY = 0;

function updateCanvasTransform() {
  devicePixelRatioValue = window.devicePixelRatio || 1;
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;

  canvas.width = Math.max(1, Math.floor(cssWidth * devicePixelRatioValue));
  canvas.height = Math.max(1, Math.floor(cssHeight * devicePixelRatioValue));

  const scaleX = cssWidth / WORLD_WIDTH;
  const scaleY = cssHeight / WORLD_HEIGHT;
  screenScale = Math.min(scaleX, scaleY);
  screenOffsetX = (cssWidth - WORLD_WIDTH * screenScale) / 2;
  screenOffsetY = (cssHeight - WORLD_HEIGHT * screenScale) / 2;

  ctx.setTransform(
    devicePixelRatioValue * screenScale,
    0,
    0,
    devicePixelRatioValue * screenScale,
    devicePixelRatioValue * screenOffsetX,
    devicePixelRatioValue * screenOffsetY
  );
}

function screenToWorld(clientX, clientY) {
  const x = (clientX - screenOffsetX) / screenScale;
  const y = (clientY - screenOffsetY) / screenScale;
  return { x, y };
}

window.addEventListener("resize", updateCanvasTransform);
updateCanvasTransform();

/** Game entities **/
class Particle {
  constructor(x, y, vx, vy, life, color, size) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.lifeMax = life;
    this.color = color;
    this.size = size;
  }
  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= Math.pow(0.04, dt);
    this.vy *= Math.pow(0.04, dt);
  }
  draw(ctx) {
    const t = clamp(this.life / this.lifeMax, 0, 1);
    ctx.globalAlpha = t;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * (0.75 + 0.5 * (1 - t)), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class Enemy {
  constructor(x, y, vx, vy, radius, hp, speed) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = radius;
    this.hp = hp;
    this.hpMax = hp;
    this.speed = speed;
    this.color = Math.random() < 0.5 ? COLORS.neonPink : COLORS.neonGreen;
    this.phase = randRange(0, Math.PI * 2);
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.phase += dt * 6;
  }
  draw(ctx) {
    // body glow
    ctx.save();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // core
    ctx.fillStyle = COLORS.bg0;
    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(2, this.radius * 0.45), 0, Math.PI * 2);
    ctx.fill();

    // hp ring (minimal)
    const t = clamp(this.hp / this.hpMax, 0, 1);
    if (t < 0.999) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.stroke();
    }
  }
}

class Bullet {
  constructor(x, y, vx, vy, radius, damage, color) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = radius;
    this.damage = damage;
    this.color = color;
    this.life = 1.1; // seconds
  }
  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  draw(ctx) {
    ctx.save();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class Turret {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.r = 14;
    this.activeUntil = 0;
    this.cooldownUntil = 0;
    this.nextShotAt = 0;
  }
  isActive(now) {
    return now < this.activeUntil;
  }
  canActivate(now) {
    return now >= this.cooldownUntil && !this.isActive(now);
  }
  activate(now) {
    // active for short burst; longer cooldown
    this.activeUntil = now + 4.25;
    this.cooldownUntil = now + 9.0;
    this.nextShotAt = now;
  }
  draw(ctx, now) {
    const active = this.isActive(now);
    const cdT = clamp((this.cooldownUntil - now) / 9.0, 0, 1);

    // base ring
    ctx.save();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = active ? 20 : 10;
    ctx.strokeStyle = active ? this.color : "rgba(255,255,255,0.25)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // fill dot
    ctx.fillStyle = active ? this.color : "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // cooldown arc (minimal UI)
    if (!active && cdT > 0.01) {
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        this.x,
        this.y,
        this.r + 6,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * (1 - cdT)
      );
      ctx.stroke();
    }
  }
}

/** Game controller **/
class TapDefense {
  constructor() {
    this.state = GameState.Ready;
    this.core = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      r: 18,
      hp: 100,
      hpMax: 100,
      hitFlash: 0,
    };

    this.enemies = [];
    this.bullets = [];
    this.particles = [];

    const pad = 44;
    this.turrets = [
      new Turret(pad, pad, COLORS.neonCyan),
      new Turret(WORLD_WIDTH - pad, pad, COLORS.neonYellow),
      new Turret(pad, WORLD_HEIGHT - pad, COLORS.neonGreen),
      new Turret(WORLD_WIDTH - pad, WORLD_HEIGHT - pad, COLORS.neonPink),
    ];

    this.time = 0;
    this.bestTime = this.loadBestTime();
    this.spawnTimer = 0;
    this.spawnEvery = 1.05;
    this.shotCooldown = 0;
    this.combo = 0;
  }

  loadBestTime() {
    try {
      const raw = localStorage.getItem("tap_defense_best_time_s");
      return raw ? Number(raw) || 0 : 0;
    } catch (_) {
      return 0;
    }
  }

  saveBestTime() {
    try {
      localStorage.setItem("tap_defense_best_time_s", String(this.bestTime));
    } catch (_) {
      // ignore
    }
  }

  reset() {
    this.state = GameState.Ready;
    this.core.hp = this.core.hpMax;
    this.core.hitFlash = 0;
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.particles.length = 0;
    this.time = 0;
    this.spawnTimer = 0;
    this.spawnEvery = 1.05;
    this.shotCooldown = 0;
    this.combo = 0;
    for (const t of this.turrets) {
      t.activeUntil = 0;
      t.cooldownUntil = 0;
      t.nextShotAt = 0;
    }
  }

  start() {
    if (this.state === GameState.Running) return;
    this.state = GameState.Running;
  }

  gameOver() {
    if (this.state === GameState.Over) return;
    this.state = GameState.Over;
    if (this.time > this.bestTime) {
      this.bestTime = this.time;
      this.saveBestTime();
    }
    // burst particles at core
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = randRange(60, 240);
      this.particles.push(
        new Particle(
          this.core.x,
          this.core.y,
          Math.cos(a) * s,
          Math.sin(a) * s,
          randRange(0.35, 0.75),
          i % 2 ? COLORS.neonPink : COLORS.neonCyan,
          randRange(1.5, 3.5)
        )
      );
    }
  }

  spawnEnemy() {
    // Spawn from a random edge, aimed at core
    const side = Math.floor(Math.random() * 4);
    const margin = 20;
    let x = 0;
    let y = 0;
    if (side === 0) {
      x = randRange(0, WORLD_WIDTH);
      y = -margin;
    } else if (side === 1) {
      x = WORLD_WIDTH + margin;
      y = randRange(0, WORLD_HEIGHT);
    } else if (side === 2) {
      x = randRange(0, WORLD_WIDTH);
      y = WORLD_HEIGHT + margin;
    } else {
      x = -margin;
      y = randRange(0, WORLD_HEIGHT);
    }

    const difficulty = 1 + this.time * 0.045;
    const speed = clamp(62 + difficulty * 8, 62, 190);
    const hp = Math.round(clamp(8 + difficulty * 1.25, 8, 32));
    const radius = clamp(10 + difficulty * 0.2, 10, 16);

    const n = normalize(this.core.x - x, this.core.y - y);
    const vx = n.x * speed;
    const vy = n.y * speed;

    this.enemies.push(new Enemy(x, y, vx, vy, radius, hp, speed));
  }

  shoot(fromX, fromY, targetX, targetY, color, damage, speed) {
    const n = normalize(targetX - fromX, targetY - fromY);
    const vx = n.x * speed;
    const vy = n.y * speed;
    this.bullets.push(new Bullet(fromX, fromY, vx, vy, 3.2, damage, color));

    // muzzle sparkle
    for (let i = 0; i < 4; i++) {
      const a = Math.atan2(n.y, n.x) + randRange(-0.6, 0.6);
      const s = randRange(40, 120);
      this.particles.push(
        new Particle(
          fromX + n.x * 10,
          fromY + n.y * 10,
          Math.cos(a) * s,
          Math.sin(a) * s,
          randRange(0.08, 0.16),
          color,
          randRange(1.1, 2.2)
        )
      );
    }
  }

  tryTap(x, y) {
    const now = performance.now() / 1000;

    if (this.state === GameState.Ready) {
      this.start();
      // immediate shot feels good
      this.shoot(this.core.x, this.core.y, x, y, COLORS.neonCyan, 10, 520);
      this.shotCooldown = 0.11;
      return;
    }

    if (this.state === GameState.Over) {
      this.reset();
      return;
    }

    if (this.state !== GameState.Running) return;

    // tap turret to activate
    for (const t of this.turrets) {
      if (dist2(x, y, t.x, t.y) <= (t.r + 16) * (t.r + 16)) {
        if (t.canActivate(now)) {
          t.activate(now);
          // activation pulse
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            const s = randRange(40, 180);
            this.particles.push(
              new Particle(
                t.x,
                t.y,
                Math.cos(a) * s,
                Math.sin(a) * s,
                randRange(0.22, 0.38),
                t.color,
                randRange(1.4, 2.8)
              )
            );
          }
        }
        return; // turret tap doesn't also shoot
      }
    }

    // tap to shoot from core (rate-limited)
    if (this.shotCooldown <= 0) {
      this.shoot(this.core.x, this.core.y, x, y, COLORS.neonCyan, 10, 520);
      this.shotCooldown = 0.115;
    }
  }

  update(dt) {
    const now = performance.now() / 1000;

    // background particles always animate
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    if (this.state !== GameState.Running) {
      this.core.hitFlash = Math.max(0, this.core.hitFlash - dt);
      return;
    }

    this.time += dt;
    this.spawnEvery = clamp(1.05 - this.time * 0.004, 0.35, 1.05);
    this.spawnTimer += dt;
    while (this.spawnTimer >= this.spawnEvery) {
      this.spawnTimer -= this.spawnEvery;
      this.spawnEnemy();
      if (Math.random() < clamp(this.time * 0.002, 0, 0.25)) {
        this.spawnEnemy();
      }
    }

    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    this.core.hitFlash = Math.max(0, this.core.hitFlash - dt);

    // turrets auto-fire while active
    for (const t of this.turrets) {
      if (!t.isActive(now)) continue;
      if (now < t.nextShotAt) continue;

      // pick nearest enemy
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        const d = dist2(t.x, t.y, e.x, e.y);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      if (bestI >= 0) {
        const e = this.enemies[bestI];
        this.shoot(t.x, t.y, e.x, e.y, t.color, 7, 460);
        t.nextShotAt = now + 0.14;
      } else {
        t.nextShotAt = now + 0.18;
      }
    }

    // update bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.update(dt);
      const out =
        b.life <= 0 ||
        b.x < -60 ||
        b.x > WORLD_WIDTH + 60 ||
        b.y < -60 ||
        b.y > WORLD_HEIGHT + 60;
      if (out) this.bullets.splice(i, 1);
    }

    // update enemies and handle core hits
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt);

      const hitCore = dist2(e.x, e.y, this.core.x, this.core.y) <= (e.radius + this.core.r) ** 2;
      if (hitCore) {
        this.enemies.splice(i, 1);
        this.core.hp = clamp(this.core.hp - 12, 0, this.core.hpMax);
        this.core.hitFlash = 0.2;
        this.combo = 0;
        for (let k = 0; k < 18; k++) {
          const a = Math.random() * Math.PI * 2;
          const s = randRange(60, 220);
          this.particles.push(
            new Particle(
              this.core.x,
              this.core.y,
              Math.cos(a) * s,
              Math.sin(a) * s,
              randRange(0.18, 0.35),
              COLORS.danger,
              randRange(1.4, 3.0)
            )
          );
        }
        if (this.core.hp <= 0) this.gameOver();
      }
    }

    // bullet-enemy collisions
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi];
      let hit = false;
      for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
        const e = this.enemies[ei];
        const rr = b.radius + e.radius;
        if (dist2(b.x, b.y, e.x, e.y) <= rr * rr) {
          hit = true;
          e.hp -= b.damage;
          // impact sparks
          for (let k = 0; k < 8; k++) {
            const a = Math.random() * Math.PI * 2;
            const s = randRange(40, 170);
            this.particles.push(
              new Particle(
                b.x,
                b.y,
                Math.cos(a) * s,
                Math.sin(a) * s,
                randRange(0.08, 0.16),
                b.color,
                randRange(1.0, 2.2)
              )
            );
          }
          if (e.hp <= 0) {
            this.enemies.splice(ei, 1);
            this.combo += 1;
            // explode
            for (let k = 0; k < 14; k++) {
              const a = Math.random() * Math.PI * 2;
              const s = randRange(60, 260);
              this.particles.push(
                new Particle(
                  e.x,
                  e.y,
                  Math.cos(a) * s,
                  Math.sin(a) * s,
                  randRange(0.16, 0.32),
                  e.color,
                  randRange(1.2, 3.2)
                )
              );
            }
          }
          break;
        }
      }
      if (hit) this.bullets.splice(bi, 1);
    }
  }

  drawBackground() {
    // Clear whole canvas including letterbox
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.bg0;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Back to world transform
    ctx.setTransform(
      devicePixelRatioValue * screenScale,
      0,
      0,
      devicePixelRatioValue * screenScale,
      devicePixelRatioValue * screenOffsetX,
      devicePixelRatioValue * screenOffsetY
    );

    // Gradient arena
    const g = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    g.addColorStop(0, COLORS.bg1);
    g.addColorStop(1, COLORS.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Subtle scanlines
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let y = 0; y < WORLD_HEIGHT; y += 6) {
      ctx.fillRect(0, y, WORLD_WIDTH, 1);
    }

    // Border glow
    ctx.save();
    ctx.strokeStyle = "rgba(89,247,255,0.25)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(89,247,255,0.45)";
    ctx.shadowBlur = 18;
    ctx.strokeRect(6, 6, WORLD_WIDTH - 12, WORLD_HEIGHT - 12);
    ctx.restore();
  }

  drawHUD() {
    // Minimal HUD: HP + Time + Best
    const hpT = this.core.hp / this.core.hpMax;

    // HP bar
    const barX = 16;
    const barY = 16;
    const barW = 110;
    const barH = 10;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpT > 0.33 ? COLORS.neonGreen : COLORS.danger;
    ctx.fillRect(barX, barY, Math.max(0, barW * hpT), barH);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "left";
    ctx.fillText("CORE", barX, barY + 22);

    // Time center
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillText(formatTime(this.time), WORLD_WIDTH / 2, 26);

    // Best (small)
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(`BEST ${formatTime(this.bestTime)}`, WORLD_WIDTH / 2, 42);
  }

  drawCore() {
    const flash = this.core.hitFlash > 0 ? 1 : 0;
    const coreColor = flash ? COLORS.danger : COLORS.neonCyan;

    ctx.save();
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = flash ? 30 : 22;
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(this.core.x, this.core.y, this.core.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = COLORS.bg0;
    ctx.beginPath();
    ctx.arc(this.core.x, this.core.y, this.core.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTextCenter(lines, y, color = "rgba(255,255,255,0.92)") {
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    for (const line of lines) {
      ctx.fillText(line, WORLD_WIDTH / 2, y);
      y += 22;
    }
  }

  draw() {
    const now = performance.now() / 1000;
    this.drawBackground();

    // turrets (behind action)
    for (const t of this.turrets) t.draw(ctx, now);

    // core
    this.drawCore();

    // bullets
    for (const b of this.bullets) b.draw(ctx);

    // enemies
    for (const e of this.enemies) e.draw(ctx);

    // particles on top
    for (const p of this.particles) p.draw(ctx);

    // HUD on top
    this.drawHUD();

    // overlays (minimal)
    if (this.state === GameState.Ready) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, WORLD_HEIGHT * 0.36, WORLD_WIDTH, 120);
      ctx.font = "800 24px system-ui, sans-serif";
      ctx.fillStyle = COLORS.neonCyan;
      ctx.textAlign = "center";
      ctx.fillText("NEON TAP DEFENSE", WORLD_WIDTH / 2, WORLD_HEIGHT * 0.42);
      ctx.font = "600 14px system-ui, sans-serif";
      this.drawTextCenter(
        ["Tap to shoot", "Tap a turret to activate", "Survive as long as possible"],
        WORLD_HEIGHT * 0.46,
        "rgba(255,255,255,0.82)"
      );
    } else if (this.state === GameState.Over) {
      ctx.fillStyle = "rgba(0,0,0,0.66)";
      ctx.fillRect(0, WORLD_HEIGHT * 0.36, WORLD_WIDTH, 120);
      ctx.font = "800 26px system-ui, sans-serif";
      ctx.fillStyle = COLORS.danger;
      ctx.textAlign = "center";
      ctx.fillText("CORE DOWN", WORLD_WIDTH / 2, WORLD_HEIGHT * 0.42);
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(`TIME ${formatTime(this.time)}`, WORLD_WIDTH / 2, WORLD_HEIGHT * 0.46);
      ctx.font = "600 14px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText("Tap to restart", WORLD_WIDTH / 2, WORLD_HEIGHT * 0.50);
    }
  }
}

const game = new TapDefense();

// Input
window.addEventListener(
  "pointerdown",
  (e) => {
    e.preventDefault();
    const w = screenToWorld(e.clientX, e.clientY);
    // allow taps slightly outside letterboxed world; clamp to edges
    game.tryTap(clamp(w.x, 0, WORLD_WIDTH), clamp(w.y, 0, WORLD_HEIGHT));
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.code !== "Enter") return;
  e.preventDefault();
  // shoot toward center-top for keyboard users
  game.tryTap(game.core.x, 0);
});

// Main loop
let lastTime = performance.now();
function frame(nowMs) {
  updateCanvasTransform();

  const now = nowMs;
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  game.update(dt);
  game.draw();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

