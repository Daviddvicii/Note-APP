/ Minimal Space Invaders-like game on Canvas
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let dpr = 1;
let scale = 1;
let offsetX = 0;
let offsetY = 0;

const WORLD = { width: 320, height: 240 };

function updateCanvas() {
  dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  const sX = cssW / WORLD.width;
  const sY = cssH / WORLD.height;
  scale = Math.min(sX, sY);
  offsetX = (cssW - WORLD.width * scale) / 2;
  offsetY = (cssH - WORLD.height * scale) / 2;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
}

window.addEventListener('resize', updateCanvas);
updateCanvas();

// Entities
class Player {
  constructor() {
    this.width = 18;
    this.height = 10;
    this.x = (WORLD.width - this.width) / 2;
    this.y = WORLD.height - 24;
    this.speed = 120; // units/s
    this.cooldown = 0;
  }
  update(dt, input, bullets) {
    if (input.left) this.x -= this.speed * dt;
    if (input.right) this.x += this.speed * dt;
    this.x = Math.max(0, Math.min(this.x, WORLD.width - this.width));
    this.cooldown -= dt;
    if (input.fire && this.cooldown <= 0) {
      bullets.push(new Bullet(this.x + this.width / 2, this.y));
      this.cooldown = 0.35; // seconds
    }
  }
  draw(ctx) {
    ctx.fillStyle = '#7fffd4';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.fillStyle = '#35d0a6';
    ctx.fillRect(this.x, this.y + this.height - 3, this.width, 3);
  }
}

class Bullet {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 2;
    this.speed = 200;
    this.dead = false;
  }
  update(dt) {
    this.y -= this.speed * dt;
    if (this.y < -10) this.dead = true;
  }
  draw(ctx) {
    ctx.fillStyle = '#ffea00';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Invader {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.w = 14;
    this.h = 10;
    this.dead = false;
  }
  draw(ctx) {
    ctx.fillStyle = '#ff6ec7';
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.fillStyle = '#b84d93';
    ctx.fillRect(this.x, this.y + this.h - 2, this.w, 2);
  }
}

function createInvaderGrid(cols, rows) {
  const invaders = [];
  const spacingX = 22;
  const spacingY = 18;
  const startX = (WORLD.width - (cols - 1) * spacingX - 14) / 2;
  const startY = 32;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      invaders.push(new Invader(startX + c * spacingX, startY + r * spacingY));
    }
  }
  return invaders;
}

const input = { left: false, right: false, fire: false };
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
  if (e.code === 'Space') input.fire = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
  if (e.code === 'Space') input.fire = false;
});

const player = new Player();
let bullets = [];
let invaders = createInvaderGrid(10, 4);
let invaderDir = 1; // 1 right, -1 left
let invaderSpeed = 20;
let dropAmount = 12;
let time = 0;
let gameOver = false;
let win = false;

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function update(dt) {
  if (gameOver) return;
  player.update(dt, input, bullets);
  for (const b of bullets) b.update(dt);
  bullets = bullets.filter(b => !b.dead);

  // Move invaders as a group
  let minX = Infinity, maxX = -Infinity;
  for (const inv of invaders) {
    inv.x += invaderDir * invaderSpeed * dt;
    if (!inv.dead) {
      minX = Math.min(minX, inv.x);
      maxX = Math.max(maxX, inv.x + inv.w);
    }
  }
  if (minX < 8) { invaderDir = 1; for (const inv of invaders) inv.y += dropAmount; }
  if (maxX > WORLD.width - 8) { invaderDir = -1; for (const inv of invaders) inv.y += dropAmount; }

  // Bullet vs invader collisions
  for (const b of bullets) {
    for (const inv of invaders) {
      if (!inv.dead && rectsOverlap(b.x - 2, b.y - 2, 4, 4, inv.x, inv.y, inv.w, inv.h)) {
        inv.dead = true;
        b.dead = true;
      }
    }
  }
  invaders = invaders.filter(inv => !inv.dead);
  if (invaders.length === 0) { gameOver = true; win = true; }

  // Lose if invaders reach player line
  for (const inv of invaders) {
    if (inv.y + inv.h >= player.y) { gameOver = true; win = false; break; }
  }
}

function drawBackground() {
  // Clear and draw starry backdrop
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);

  const grad = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  grad.addColorStop(0, '#0b1426');
  grad.addColorStop(1, '#0b1426');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 60; i++) {
    const x = (i * 53) % WORLD.width;
    const y = (i * 37) % WORLD.height;
    ctx.fillRect(x, y, 1, 1);
  }
}

function draw() {
  drawBackground();
  // Draw invaders
  for (const inv of invaders) inv.draw(ctx);
  // Draw player
  player.draw(ctx);
  // Draw bullets
  for (const b of bullets) b.draw(ctx);

  // HUD
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 12px system-ui, sans-serif';
  if (gameOver) {
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(win ? 'You Win!' : 'Game Over', WORLD.width/2, WORLD.height/2 - 8);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Press Space to restart', WORLD.width/2, WORLD.height/2 + 12);
  } else {
    ctx.fillText('← → move, Space shoot', WORLD.width/2, 12);
  }
}

let last = performance.now();
function loop(now) {
  updateCanvas();
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Restart handler
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && gameOver) {
    bullets = [];
    invaders = createInvaderGrid(10, 4);
    invaderDir = 1; invaderSpeed = 20;
    gameOver = false; win = false;
  }
'use strict';

// ======================
// Tuning constants
// ======================
const PLAYER_SPEED = 260;          // px per second (logical, pre-DPR)
const BULLET_SPEED = 520;          // px per second
const ENEMY_SPEED = 60;            // base horizontal px per second
const DESCENT_STEP = 18;           // px per bounce descend
const SHOOT_COOLDOWN = 0.25;       // seconds between player shots
const ENEMY_FIRE_RATE = 0.9;       // average enemy bullets per second
const INVADER_COLS = 10;
const INVADER_ROWS = 5;
const INVADER_SIZE = 18;           // square invader size
const INVADER_H_SPACING = 16;      // horizontal spacing between invaders
const INVADER_V_SPACING = 14;      // vertical spacing between invaders
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 16;
const BULLET_WIDTH = 2;
const BULLET_HEIGHT = 8;
const PLAYER_INVULN_TIME = 1.0;    // seconds of invulnerability after hit

// ======================
// Utility helpers
// ======================
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function aabbIntersects(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Simple audio helper using WebAudio for beeps; auto-mutes until first gesture
class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }
  ensureContext() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {
      this.enabled = false;
    }
  }
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  resume() {
    this.ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  beepShoot() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 880; // A5
    g.gain.setValueAtTime(0.08, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.09);
  }
  popKill() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(440, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.1, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.16);
  }
}

// ======================
// Bullet + Pool
// ======================
class Bullet {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0; this.vy = 0;
    this.width = BULLET_WIDTH; this.height = BULLET_HEIGHT;
    this.fromEnemy = false;
  }
}

class BulletPool {
  constructor(maxBullets, color) {
    this.pool = new Array(maxBullets);
    for (let i = 0; i < maxBullets; i++) this.pool[i] = new Bullet();
    this.active = [];
    this.color = color;
  }
  spawn(x, y, vy, fromEnemy) {
    // find an inactive bullet
    for (let i = 0; i < this.pool.length; i++) {
      const b = this.pool[i];
      if (!b.active) {
        b.active = true;
        b.x = x; b.y = y; b.vy = vy; b.fromEnemy = !!fromEnemy;
        this.active.push(b);
        return b;
      }
    }
    return null; // pool exhausted
  }
  update(dt, boundsHeight) {
    if (this.active.length === 0) return;
    // manual index iteration to allow removals without GC churn
    let w = 0; // write pointer
    for (let r = 0; r < this.active.length; r++) {
      const b = this.active[r];
      b.y += b.vy * dt;
      if (b.y + b.height < 0 || b.y > boundsHeight) {
        b.active = false;
      } else {
        this.active[w++] = b;
      }
    }
    this.active.length = w;
  }
  draw(ctx) {
    if (this.active.length === 0) return;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < this.active.length; i++) {
      const b = this.active[i];
      ctx.fillRect(b.x, b.y, b.width, b.height);
    }
  }
}

// ======================
// Player
// ======================
class Player {
  constructor(game) {
    this.game = game;
    this.width = PLAYER_WIDTH;
    this.height = PLAYER_HEIGHT;
    this.x = 0; this.y = 0;
    this.moveLeft = false; this.moveRight = false;
    this.cooldown = 0;
    this.invulnTime = 0;
  }
  reset() {
    this.x = (this.game.width - this.width) / 2;
    this.y = this.game.height - this.height - 18;
    this.cooldown = 0;
    this.invulnTime = 0;
  }
  update(dt) {
    let dx = 0;
    if (this.moveLeft) dx -= 1;
    if (this.moveRight) dx += 1;
    this.x += dx * PLAYER_SPEED * dt;
    this.x = clamp(this.x, 0, this.game.width - this.width);

    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.invulnTime > 0) this.invulnTime -= dt;
  }
  tryShoot() {
    if (this.cooldown > 0) return;
    const bx = this.x + this.width / 2 - BULLET_WIDTH / 2;
    const by = this.y - BULLET_HEIGHT;
    const spawned = this.game.playerBullets.spawn(bx, by, -BULLET_SPEED, false);
    if (spawned) {
      this.cooldown = SHOOT_COOLDOWN;
      this.game.sound.beepShoot();
    }
  }
  hit() {
    if (this.invulnTime > 0) return false; // ignore during i-frames
    this.invulnTime = PLAYER_INVULN_TIME;
    return true;
  }
  draw(ctx) {
    // blink when invulnerable
    if (this.invulnTime > 0 && Math.floor(this.invulnTime * 10) % 2 === 0) return;
    ctx.fillStyle = '#41c7ff';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    // simple cannon tip
    ctx.fillRect(this.x + this.width/2 - 2, this.y - 4, 4, 4);
  }
}

// ======================
// Invader Grid
// ======================
class InvaderGrid {
  constructor(game) {
    this.game = game;
    this.cols = INVADER_COLS;
    this.rows = INVADER_ROWS;
    this.size = INVADER_SIZE;
    this.hSpacing = INVADER_H_SPACING;
    this.vSpacing = INVADER_V_SPACING;
    this.alive = new Array(this.rows * this.cols).fill(true);
    this.total = this.alive.length;
    this.remaining = this.total;
    this.dir = 1; // 1 right, -1 left
    this.x = 40; // grid origin
    this.y = 50;
    this.baseSpeed = ENEMY_SPEED;
    this.descendPending = false;
  }
  index(c, r) { return r * this.cols + c; }
  isAlive(c, r) { return this.alive[this.index(c, r)]; }
  killAt(c, r) {
    const idx = this.index(c, r);
    if (this.alive[idx]) {
      this.alive[idx] = false;
      this.remaining--;
      return true;
    }
    return false;
  }
  forEachAlive(callback) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.isAlive(c, r)) callback(c, r);
      }
    }
  }
  getBounds() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const sz = this.size;
    this.forEachAlive((c, r) => {
      const x = this.x + c * (sz + this.hSpacing);
      const y = this.y + r * (sz + this.vSpacing);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + sz);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + sz);
    });
    if (minX === Infinity) return {minX:0, maxX:0, minY:0, maxY:0};
    return { minX, maxX, minY, maxY };
  }
  update(dt) {
    if (this.remaining === 0) return;
    // speed scales with how many are left (up to +180%)
    const aliveRatio = this.remaining / this.total;
    const speed = this.baseSpeed * (1 + (1 - aliveRatio) * 1.8);

    // compute bounds for edge detection
    const b = this.getBounds();
    this.x += this.dir * speed * dt;

    // after moving, check if any edge exceeded
    if (b.minX <= 0 && this.dir < 0) this.descendPending = true;
    if (b.maxX >= this.game.width && this.dir > 0) this.descendPending = true;

    if (this.descendPending) {
      this.descend();
    }
  }
  descend() {
    this.descendPending = false;
    this.dir *= -1;
    this.y += DESCENT_STEP;
  }
  draw(ctx) {
    if (this.remaining === 0) return;
    ctx.fillStyle = '#39ff14';
    const sz = this.size;
    this.forEachAlive((c, r) => {
      const x = this.x + c * (sz + this.hSpacing);
      const y = this.y + r * (sz + this.vSpacing);
      ctx.fillRect(x, y, sz, sz);
      // tiny eyes for retro flavor
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + 4, y + 6, 3, 3);
      ctx.fillRect(x + sz - 7, y + 6, 3, 3);
      ctx.fillStyle = '#39ff14';
    });
  }
  // pick a random bottom-most alive invader as the shooter
  pickRandomShooter() {
    const columnsAlive = [];
    for (let c = 0; c < this.cols; c++) {
      let bottomRow = -1;
      for (let r = 0; r < this.rows; r++) {
        if (this.isAlive(c, r)) bottomRow = r; // last alive encountered will be bottom-most
      }
      if (bottomRow >= 0) columnsAlive.push({ c, bottomRow });
    }
    if (columnsAlive.length === 0) return null;
    const pick = columnsAlive[Math.floor(Math.random() * columnsAlive.length)];
    const sz = this.size;
    const x = this.x + pick.c * (sz + this.hSpacing) + sz / 2 - BULLET_WIDTH / 2;
    const y = this.y + pick.bottomRow * (sz + this.vSpacing) + sz;
    return { x, y };
  }
}

// ======================
// Game
// ======================
const GameState = {
  READY: 'READY',
  RUNNING: 'RUNNING',
  GAME_OVER: 'GAME_OVER',
  YOU_WIN: 'YOU_WIN',
};

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0; this.height = 0; this.dpr = 1;

    // systems
    this.sound = new Sound();

    // entities
    this.player = new Player(this);
    this.grid = new InvaderGrid(this);
    this.playerBullets = new BulletPool(24, '#ffffff');
    this.enemyBullets = new BulletPool(24, '#ffffff');

    // gameplay
    this.lives = 3;
    this.score = 0;
    this.best = Number(localStorage.getItem('invaders_best_score') || '0') || 0;
    this.state = GameState.READY;
    this.timeToEnemyFire = 0.0;

    // loop timing
    this.lastTime = 0;
    this.accum = 0;
    this.fixedDt = 1 / 60;

    // input
    this.keys = new Set();
    this.pointerDownLeft = false;
    this.pointerDownRight = false;

    this.installEventHandlers();
    this.onResize();
    this.resetRound();
    requestAnimationFrame((t) => this.frame(t));
  }

  installEventHandlers() {
    window.addEventListener('resize', () => this.onResize());

    // prevent pull-to-refresh when interacting with canvas
    this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this.onCanvasTap(e); }, { passive: false });
    this.canvas.addEventListener('touchend', (e) => { e.preventDefault(); }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft','ArrowRight','Space',' ','a','A','d','D','m','M'].includes(e.key)) e.preventDefault();
      if (e.key === 'm' || e.key === 'M') {
        const enabled = this.sound.toggle();
        updateMuteButton(enabled);
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        this.onAction();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.player.moveLeft = true;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.player.moveRight = true;
    }, { passive: false });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.player.moveLeft = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.player.moveRight = false;
    });

    // On-screen controls
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    const btnMute = document.getElementById('btn-mute');

    const pressLeft = (e) => { e.preventDefault(); this.sound.resume(); this.player.moveLeft = true; };
    const releaseLeft = (e) => { e.preventDefault(); this.player.moveLeft = false; };
    const pressRight = (e) => { e.preventDefault(); this.sound.resume(); this.player.moveRight = true; };
    const releaseRight = (e) => { e.preventDefault(); this.player.moveRight = false; };

    btnLeft.addEventListener('touchstart', pressLeft, { passive: false });
    btnLeft.addEventListener('touchend', releaseLeft, { passive: false });
    btnLeft.addEventListener('touchcancel', releaseLeft, { passive: false });
    btnLeft.addEventListener('mousedown', pressLeft);
    btnLeft.addEventListener('mouseup', releaseLeft);
    btnLeft.addEventListener('mouseleave', releaseLeft);

    btnRight.addEventListener('touchstart', pressRight, { passive: false });
    btnRight.addEventListener('touchend', releaseRight, { passive: false });
    btnRight.addEventListener('touchcancel', releaseRight, { passive: false });
    btnRight.addEventListener('mousedown', pressRight);
    btnRight.addEventListener('mouseup', releaseRight);
    btnRight.addEventListener('mouseleave', releaseRight);

    btnMute.addEventListener('click', () => {
      const enabled = this.sound.toggle();
      updateMuteButton(enabled);
    });
  }

  onCanvasTap(e) {
    // Any tap on canvas is action (shoot or start)
    this.onAction();
  }

  onAction() {
    this.sound.resume();
    if (this.state === GameState.READY) {
      this.state = GameState.RUNNING;
      return;
    }
    if (this.state === GameState.GAME_OVER || this.state === GameState.YOU_WIN) {
      this.resetRound();
      this.state = GameState.RUNNING;
      return;
    }
    if (this.state === GameState.RUNNING) {
      this.player.tryShoot();
      return;
    }
  }

  onResize() {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    this.dpr = dpr;
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    this.canvas.style.width = cssWidth + 'px';
    this.canvas.style.height = cssHeight + 'px';
    this.canvas.width = Math.floor(cssWidth * dpr);
    this.canvas.height = Math.floor(cssHeight * dpr);
    const ctx = this.ctx;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;

    this.width = cssWidth;
    this.height = cssHeight;

    // reposition player relative to bottom
    this.player.y = this.height - this.player.height - 18;
  }

  resetRound() {
    this.lives = 3;
    this.score = 0;
    this.player.reset();
    this.grid = new InvaderGrid(this);
    this.playerBullets.active.length = 0;
    this.enemyBullets.active.length = 0;
    for (let b of this.playerBullets.pool) b.active = false;
    for (let b of this.enemyBullets.pool) b.active = false;
    this.timeToEnemyFire = this.sampleEnemyFireInterval();
  }

  frame(nowMs) {
    requestAnimationFrame((t) => this.frame(t));
    const now = nowMs * 0.001;
    if (!this.lastTime) this.lastTime = now;
    let dt = now - this.lastTime;
    this.lastTime = now;

    // clamp to avoid spiral-of-death after tab suspend
    dt = Math.min(dt, 0.1);
    this.accum = Math.min(this.accum + dt, 0.25);

    while (this.accum >= this.fixedDt) {
      this.update(this.fixedDt);
      this.accum -= this.fixedDt;
    }
    this.render();
  }

  update(dt) {
    if (this.state !== GameState.RUNNING) return;

    this.player.update(dt);
    this.grid.update(dt);

    // enemy fire logic (Poisson process with exponential inter-arrival times)
    this.timeToEnemyFire -= dt;
    if (this.timeToEnemyFire <= 0) {
      do {
        this.enemyShoot();
        this.timeToEnemyFire += this.sampleEnemyFireInterval();
      } while (this.timeToEnemyFire <= 0);
    }

    // bullets update
    this.playerBullets.update(dt, this.height);
    this.enemyBullets.update(dt, this.height);

    // collisions: player bullets vs invaders
    this.handlePlayerBulletCollisions();

    // collisions: enemy bullets vs player
    this.handleEnemyBulletCollisions();

    // check invaders reaching player row -> immediate game over
    const b = this.grid.getBounds();
    if (b.maxY >= this.player.y) {
      this.gameOver();
      return;
    }

    // win condition
    if (this.grid.remaining === 0) {
      this.win();
    }
  }

  enemyShoot() {
    if (this.grid.remaining === 0) return;
    const s = this.grid.pickRandomShooter();
    if (!s) return;
    this.enemyBullets.spawn(s.x, s.y, BULLET_SPEED * 0.7, true);
  }

  // Draw from exponential distribution with mean 1 / ENEMY_FIRE_RATE
  sampleEnemyFireInterval() {
    const rate = Math.max(ENEMY_FIRE_RATE, 0.0001);
    const u = Math.random();
    const interval = -Math.log(1 - u) / rate;
    return Math.max(0.08, interval); // clamp to avoid bursts too fast
  }

  handlePlayerBulletCollisions() {
    if (this.playerBullets.active.length === 0 || this.grid.remaining === 0) return;
    const sz = this.grid.size;
    const hs = this.grid.hSpacing;
    const vs = this.grid.vSpacing;
    const gx = this.grid.x;
    const gy = this.grid.y;
    for (let i = 0; i < this.playerBullets.active.length; i++) {
      const b = this.playerBullets.active[i];
      // quick grid range rejection using bounds
      const bounds = this.grid.getBounds();
      if (bounds.minX === bounds.maxX) continue; // empty
      if (b.x + b.width < bounds.minX || b.x > bounds.maxX || b.y + b.height < bounds.minY || b.y > bounds.maxY) continue;

      // map bullet position to nearest cell
      for (let r = 0; r < this.grid.rows; r++) {
        for (let c = 0; c < this.grid.cols; c++) {
          if (!this.grid.isAlive(c, r)) continue;
          const ix = gx + c * (sz + hs);
          const iy = gy + r * (sz + vs);
          if (aabbIntersects(b.x, b.y, b.width, b.height, ix, iy, sz, sz)) {
            this.grid.killAt(c, r);
            b.active = false;
            // remove from active list by swap-with-end style compaction next update
            this.sound.popKill();
            this.score += 10;
            if (this.score > this.best) {
              this.best = this.score;
              localStorage.setItem('invaders_best_score', String(this.best));
            }
            return; // one bullet hits one invader
          }
        }
      }
    }
    // compact active list (remove inactive bullets)
    let w = 0;
    for (let r = 0; r < this.playerBullets.active.length; r++) {
      const bb = this.playerBullets.active[r];
      if (bb.active) this.playerBullets.active[w++] = bb;
    }
    this.playerBullets.active.length = w;
  }

  handleEnemyBulletCollisions() {
    if (this.enemyBullets.active.length === 0) return;
    const p = this.player;
    for (let i = 0; i < this.enemyBullets.active.length; i++) {
      const b = this.enemyBullets.active[i];
      if (aabbIntersects(b.x, b.y, b.width, b.height, p.x, p.y, p.width, p.height)) {
        b.active = false;
        if (p.hit()) {
          this.lives -= 1;
          if (this.lives <= 0) {
            this.gameOver();
            return;
          }
        }
      }
    }
    // compact
    let w = 0;
    for (let r = 0; r < this.enemyBullets.active.length; r++) {
      const bb = this.enemyBullets.active[r];
      if (bb.active) this.enemyBullets.active[w++] = bb;
    }
    this.enemyBullets.active.length = w;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // background grid scanlines for retro feel (very subtle)
    ctx.fillStyle = '#020202';
    for (let y = 0; y < this.height; y += 4) {
      ctx.fillRect(0, y, this.width, 1);
    }

    // entities
    this.grid.draw(ctx);
    this.player.draw(ctx);
    this.playerBullets.draw(ctx);
    this.enemyBullets.draw(ctx);

    // HUD
    ctx.fillStyle = '#32ff7e';
    ctx.font = '16px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`Score: ${this.score}`, 12, 10);
    const livesText = `Lives: ${this.lives}`;
    const ltWidth = ctx.measureText(livesText).width;
    ctx.fillText(livesText, this.width - ltWidth - 12, 10);

    // best score subtle
    ctx.fillStyle = '#888';
    ctx.font = '12px monospace';
    ctx.fillText(`Best: ${this.best}`, 12, 28);

    // overlays
    if (this.state === GameState.READY) {
      this.drawCenterText('Tap / Space to start');
      this.drawBottomHint();
    } else if (this.state === GameState.GAME_OVER) {
      this.drawCenterText(`Game Over\nScore: ${this.score}\nTap / Space to restart`);
    } else if (this.state === GameState.YOU_WIN) {
      this.drawCenterText(`You Win!\nScore: ${this.score}\nTap / Space to restart`);
    }
  }

  drawCenterText(text) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = (text || '').split('\n');
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, cy + i * 28 - ((lines.length - 1) * 14));
    }
    ctx.restore();
  }

  drawBottomHint() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#999';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Desktop: ← → move, Space shoot, M mute | Mobile: buttons + tap', this.width / 2, this.height - 8);
    ctx.restore();
  }

  gameOver() {
    this.state = GameState.GAME_OVER;
  }
  win() {
    this.state = GameState.YOU_WIN;
  }
}

// ======================
// Boot
// ======================
function updateMuteButton(enabled) {
  const btn = document.getElementById('btn-mute');
  if (!btn) return;
  btn.textContent = enabled ? '🔊' : '🔇';
}

window.addEventListener('load', () => {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  updateMuteButton(true);
});
