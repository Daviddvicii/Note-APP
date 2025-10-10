// Minimal Space Invaders-like game on Canvas
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
});
