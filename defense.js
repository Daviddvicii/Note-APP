'use strict';

/* Neon Tap Defense – One-finger strategy game
   Enemies approach from all sides. Tap to shoot and survive!
*/

/* ===== Tuning ===== */
const BASE_ENEMY_SPEED = 40;
const SPAWN_INTERVAL_START = 1.5;
const SPAWN_INTERVAL_MIN = 0.3;
const DIFFICULTY_RAMP = 0.02;
const TURRET_RADIUS = 24;
const ENEMY_SIZE = 20;
const BULLET_SPEED = 600;
const BULLET_SIZE = 6;
const HIT_RADIUS = 30; // tap detection radius
const COMBO_TIMEOUT = 1.5;

/* ===== Utils ===== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const lerp = (a, b, t) => a + (b - a) * t;
const randRange = (min, max) => min + Math.random() * (max - min);

/* ===== Colors ===== */
const NEON_COLORS = [
  '#ff00ff', // magenta
  '#00ffff', // cyan
  '#ff6b6b', // red
  '#ffd93d', // yellow
  '#6bff6b', // green
  '#ff8c00', // orange
];

/* ===== Sound ===== */
class Sound {
  constructor() { this.enabled = true; this.ctx = null; }
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.enabled = false; } } }
  toggle() { this.enabled = !this.enabled; return this.enabled; }
  resume() { this.ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  
  _beep(freqFrom, freqTo, dur, type = 'square', gain = 0.08) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqFrom, t);
    if (freqTo !== null) o.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(t + dur + 0.01);
  }
  
  shoot() { this._beep(880, 440, 0.08, 'square', 0.06); }
  hit() { this._beep(600, 200, 0.12, 'triangle', 0.1); }
  combo() { this._beep(1200, 1600, 0.15, 'sine', 0.08); }
  gameOver() { this._beep(200, 50, 0.5, 'sawtooth', 0.1); }
}

/* ===== Particle System ===== */
class Particle {
  constructor(x, y, vx, vy, color, life) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.life = life;
    this.maxLife = life;
    this.active = true;
  }
  
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.life -= dt;
    if (this.life <= 0) this.active = false;
  }
  
  draw(ctx) {
    const alpha = this.life / this.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    const size = 3 * alpha;
    ctx.beginPath();
    ctx.arc(this.x, this.y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class ParticleSystem {
  constructor() { this.particles = []; }
  
  emit(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = randRange(80, 200);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      this.particles.push(new Particle(x, y, vx, vy, color, randRange(0.3, 0.6)));
    }
  }
  
  update(dt) {
    this.particles = this.particles.filter(p => {
      p.update(dt);
      return p.active;
    });
  }
  
  draw(ctx) {
    for (const p of this.particles) p.draw(ctx);
  }
}

/* ===== Enemy ===== */
class Enemy {
  constructor(x, y, targetX, targetY, speed, color, hp = 1) {
    this.x = x;
    this.y = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.speed = speed;
    this.color = color;
    this.hp = hp;
    this.maxHp = hp;
    this.size = ENEMY_SIZE;
    this.active = true;
    this.angle = Math.atan2(targetY - y, targetX - x);
    this.wobble = Math.random() * Math.PI * 2;
    this.wobbleSpeed = randRange(2, 4);
  }
  
  update(dt) {
    this.wobble += this.wobbleSpeed * dt;
    const wobbleOffset = Math.sin(this.wobble) * 0.3;
    const dx = Math.cos(this.angle + wobbleOffset);
    const dy = Math.sin(this.angle + wobbleOffset);
    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;
  }
  
  draw(ctx) {
    const pulse = 0.8 + Math.sin(this.wobble * 2) * 0.2;
    
    // Glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = this.color;
    
    // Body
    ctx.fillStyle = this.color;
    ctx.beginPath();
    
    // Draw hexagon shape
    const sides = 6;
    const size = this.size * pulse * 0.5;
    for (let i = 0; i < sides; i++) {
      const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
      const px = this.x + Math.cos(angle) * size;
      const py = this.y + Math.sin(angle) * size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    
    // Inner glow
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    const innerSize = size * 0.5;
    for (let i = 0; i < sides; i++) {
      const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
      const px = this.x + Math.cos(angle) * innerSize;
      const py = this.y + Math.sin(angle) * innerSize;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    
    // HP bar for tough enemies
    if (this.maxHp > 1) {
      const barWidth = this.size;
      const barHeight = 4;
      const barX = this.x - barWidth / 2;
      const barY = this.y - this.size / 2 - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = this.color;
      ctx.fillRect(barX, barY, barWidth * (this.hp / this.maxHp), barHeight);
    }
    
    ctx.shadowBlur = 0;
  }
  
  hit() {
    this.hp--;
    if (this.hp <= 0) this.active = false;
    return this.hp <= 0;
  }
}

/* ===== Bullet ===== */
class Bullet {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * BULLET_SPEED;
    this.vy = Math.sin(angle) * BULLET_SPEED;
    this.active = true;
    this.trail = [];
  }
  
  update(dt, w, h) {
    // Store trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) this.trail.shift();
    
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    
    // Out of bounds
    if (this.x < -50 || this.x > w + 50 || this.y < -50 || this.y > h + 50) {
      this.active = false;
    }
  }
  
  draw(ctx) {
    // Trail
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    if (this.trail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (let i = 1; i < this.trail.length; i++) {
        ctx.lineTo(this.trail[i].x, this.trail[i].y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    
    // Bullet
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ffff';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, BULLET_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/* ===== Turret ===== */
class Turret {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = TURRET_RADIUS;
    this.angle = 0;
    this.pulse = 0;
    this.shieldRadius = 60;
    this.shieldHp = 3;
    this.maxShieldHp = 3;
    this.shieldFlash = 0;
  }
  
  update(dt, targetAngle) {
    this.angle = lerp(this.angle, targetAngle, 0.2);
    this.pulse += dt * 3;
    if (this.shieldFlash > 0) this.shieldFlash -= dt;
  }
  
  draw(ctx) {
    const pulseScale = 1 + Math.sin(this.pulse) * 0.05;
    
    // Shield
    if (this.shieldHp > 0) {
      const shieldAlpha = 0.2 + (this.shieldHp / this.maxShieldHp) * 0.3;
      ctx.strokeStyle = this.shieldFlash > 0 ? '#ff0000' : '#00ffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = shieldAlpha;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.shieldRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    
    // Base glow
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00ffff';
    
    // Base circle
    ctx.fillStyle = '#0a2030';
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * pulseScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Inner rings
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.6 * pulseScale, 0, Math.PI * 2);
    ctx.stroke();
    
    // Cannon
    const cannonLen = this.radius * 1.2;
    const cannonWidth = 8;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    
    ctx.fillStyle = '#00ffff';
    ctx.fillRect(0, -cannonWidth / 2, cannonLen, cannonWidth);
    
    // Cannon tip
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cannonLen, 0, cannonWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
    ctx.shadowBlur = 0;
  }
  
  hitShield() {
    this.shieldHp--;
    this.shieldFlash = 0.3;
    return this.shieldHp <= 0;
  }
}

/* ===== Game States ===== */
const GameState = {
  READY: 'READY',
  RUNNING: 'RUNNING',
  GAME_OVER: 'GAME_OVER'
};

/* ===== Main Game ===== */
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    
    this.sound = new Sound();
    this.particles = new ParticleSystem();
    
    this.turret = null;
    this.enemies = [];
    this.bullets = [];
    
    this.score = 0;
    this.wave = 1;
    this.best = Number(localStorage.getItem('defense_best') || '0') || 0;
    
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    
    this.spawnTimer = 0;
    this.spawnInterval = SPAWN_INTERVAL_START;
    this.gameTime = 0;
    
    this.state = GameState.READY;
    this.lastTapPos = null;
    
    this.lastTime = 0;
    this.accum = 0;
    this.fixedDt = 1 / 60;
    
    this.installEvents();
    this.onResize();
    this.reset();
    requestAnimationFrame(t => this.frame(t));
  }
  
  installEvents() {
    window.addEventListener('resize', () => this.onResize());
    
    // Touch events
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      this.sound.resume();
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const x = (touch.clientX - rect.left) * (this.width / rect.width);
      const y = (touch.clientY - rect.top) * (this.height / rect.height);
      this.handleTap(x, y);
    }, { passive: false });
    
    this.canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    this.canvas.addEventListener('touchend', e => e.preventDefault(), { passive: false });
    
    // Mouse events
    this.canvas.addEventListener('mousedown', e => {
      this.sound.resume();
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.width / rect.width);
      const y = (e.clientY - rect.top) * (this.height / rect.height);
      this.handleTap(x, y);
    });
    
    // Keyboard
    window.addEventListener('keydown', e => {
      if (e.key === 'm' || e.key === 'M') {
        updateMuteButton(this.sound.toggle());
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (this.state !== GameState.RUNNING) {
          this.handleTap(this.width / 2, this.height / 2);
        }
      }
    });
    
    // Mute button
    const M = document.getElementById('btn-mute');
    if (M) M.addEventListener('click', () => updateMuteButton(this.sound.toggle()));
  }
  
  handleTap(x, y) {
    this.lastTapPos = { x, y };
    
    if (this.state === GameState.READY) {
      this.state = GameState.RUNNING;
      return;
    }
    
    if (this.state === GameState.GAME_OVER) {
      this.reset();
      this.state = GameState.RUNNING;
      return;
    }
    
    if (this.state === GameState.RUNNING) {
      this.shoot(x, y);
    }
  }
  
  shoot(targetX, targetY) {
    const angle = Math.atan2(targetY - this.turret.y, targetX - this.turret.x);
    this.turret.angle = angle;
    
    const bulletX = this.turret.x + Math.cos(angle) * (this.turret.radius + 10);
    const bulletY = this.turret.y + Math.sin(angle) * (this.turret.radius + 10);
    this.bullets.push(new Bullet(bulletX, bulletY, angle));
    this.sound.shoot();
  }
  
  onResize() {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    this.dpr = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.ctx.imageSmoothingEnabled = false;
    this.width = w;
    this.height = h;
    
    if (this.turret) {
      this.turret.x = w / 2;
      this.turret.y = h / 2;
    }
  }
  
  reset() {
    this.turret = new Turret(this.width / 2, this.height / 2);
    this.enemies = [];
    this.bullets = [];
    this.particles = new ParticleSystem();
    
    this.score = 0;
    this.wave = 1;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    
    this.spawnTimer = 1;
    this.spawnInterval = SPAWN_INTERVAL_START;
    this.gameTime = 0;
  }
  
  spawnEnemy() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    
    // Random edge spawn
    const side = Math.floor(Math.random() * 4);
    let x, y;
    const margin = 50;
    
    switch (side) {
      case 0: // Top
        x = randRange(margin, this.width - margin);
        y = -ENEMY_SIZE;
        break;
      case 1: // Right
        x = this.width + ENEMY_SIZE;
        y = randRange(margin, this.height - margin);
        break;
      case 2: // Bottom
        x = randRange(margin, this.width - margin);
        y = this.height + ENEMY_SIZE;
        break;
      case 3: // Left
        x = -ENEMY_SIZE;
        y = randRange(margin, this.height - margin);
        break;
    }
    
    // Speed increases with time
    const speedMult = 1 + this.gameTime * DIFFICULTY_RAMP;
    const speed = BASE_ENEMY_SPEED * speedMult * randRange(0.8, 1.2);
    
    // Color and HP based on wave
    const colorIndex = Math.floor(Math.random() * NEON_COLORS.length);
    const color = NEON_COLORS[colorIndex];
    
    // Chance for stronger enemies
    let hp = 1;
    if (this.gameTime > 30 && Math.random() < 0.2) hp = 2;
    if (this.gameTime > 60 && Math.random() < 0.1) hp = 3;
    
    this.enemies.push(new Enemy(x, y, cx, cy, speed, color, hp));
  }
  
  frame(ms) {
    requestAnimationFrame(t => this.frame(t));
    const now = ms * 0.001;
    if (!this.lastTime) this.lastTime = now;
    let dt = Math.min(now - this.lastTime, 0.1);
    this.lastTime = now;
    this.accum = Math.min(this.accum + dt, 0.25);
    
    while (this.accum >= this.fixedDt) {
      this.update(this.fixedDt);
      this.accum -= this.fixedDt;
    }
    this.render();
  }
  
  update(dt) {
    if (this.state !== GameState.RUNNING) return;
    
    this.gameTime += dt;
    
    // Update spawn interval (gets faster)
    this.spawnInterval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - this.gameTime * 0.01);
    
    // Wave system
    const newWave = Math.floor(this.gameTime / 20) + 1;
    if (newWave > this.wave) {
      this.wave = newWave;
      // Spawn burst on new wave
      for (let i = 0; i < this.wave; i++) {
        setTimeout(() => this.spawnEnemy(), i * 200);
      }
    }
    
    // Spawn enemies
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnEnemy();
      // Sometimes spawn multiples
      if (this.gameTime > 15 && Math.random() < 0.3) this.spawnEnemy();
      this.spawnTimer = this.spawnInterval;
    }
    
    // Update combo timer
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
      }
    }
    
    // Update turret
    if (this.lastTapPos) {
      const angle = Math.atan2(this.lastTapPos.y - this.turret.y, this.lastTapPos.x - this.turret.x);
      this.turret.update(dt, angle);
    } else {
      this.turret.update(dt, this.turret.angle);
    }
    
    // Update bullets
    for (const bullet of this.bullets) {
      bullet.update(dt, this.width, this.height);
    }
    this.bullets = this.bullets.filter(b => b.active);
    
    // Update enemies
    for (const enemy of this.enemies) {
      enemy.update(dt);
    }
    
    // Update particles
    this.particles.update(dt);
    
    // Check bullet-enemy collisions
    for (const bullet of this.bullets) {
      if (!bullet.active) continue;
      for (const enemy of this.enemies) {
        if (!enemy.active) continue;
        const d = dist(bullet.x, bullet.y, enemy.x, enemy.y);
        if (d < enemy.size / 2 + BULLET_SIZE) {
          bullet.active = false;
          const killed = enemy.hit();
          this.particles.emit(enemy.x, enemy.y, enemy.color, killed ? 15 : 6);
          this.sound.hit();
          
          if (killed) {
            // Score with combo multiplier
            this.combo++;
            this.comboTimer = COMBO_TIMEOUT;
            if (this.combo > this.maxCombo) this.maxCombo = this.combo;
            const points = 10 * Math.min(this.combo, 10);
            this.score += points;
            
            if (this.combo > 1 && this.combo % 5 === 0) {
              this.sound.combo();
            }
            
            if (this.score > this.best) {
              this.best = this.score;
              localStorage.setItem('defense_best', String(this.best));
            }
          }
          break;
        }
      }
    }
    this.enemies = this.enemies.filter(e => e.active);
    
    // Check enemy-turret collisions
    for (const enemy of this.enemies) {
      const d = dist(enemy.x, enemy.y, this.turret.x, this.turret.y);
      
      // Shield collision
      if (this.turret.shieldHp > 0 && d < this.turret.shieldRadius + enemy.size / 2) {
        enemy.active = false;
        this.particles.emit(enemy.x, enemy.y, '#ff0000', 10);
        this.turret.hitShield();
        this.sound.hit();
      }
      // Core collision
      else if (d < this.turret.radius + enemy.size / 2) {
        this.gameOver();
        return;
      }
    }
    this.enemies = this.enemies.filter(e => e.active);
  }
  
  gameOver() {
    this.state = GameState.GAME_OVER;
    this.sound.gameOver();
    // Big explosion
    for (let i = 0; i < 30; i++) {
      const angle = (Math.PI * 2 * i) / 30;
      const d = 30;
      this.particles.emit(
        this.turret.x + Math.cos(angle) * d,
        this.turret.y + Math.sin(angle) * d,
        '#ff0000',
        5
      );
    }
  }
  
  render() {
    const ctx = this.ctx;
    
    // Background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, this.width, this.height);
    
    // Grid pattern
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < this.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y < this.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    
    // Radial gradient from center
    const gradient = ctx.createRadialGradient(
      this.width / 2, this.height / 2, 0,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) / 2
    );
    gradient.addColorStop(0, 'rgba(0, 255, 255, 0.03)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    
    // Particles
    this.particles.draw(ctx);
    
    // Enemies
    for (const enemy of this.enemies) enemy.draw(ctx);
    
    // Bullets
    for (const bullet of this.bullets) bullet.draw(ctx);
    
    // Turret
    if (this.turret) this.turret.draw(ctx);
    
    // HUD
    this.drawHUD();
    
    // State overlays
    if (this.state !== GameState.RUNNING) {
      this.drawOverlay();
    }
  }
  
  drawHUD() {
    const ctx = this.ctx;
    
    // Score
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ffff';
    ctx.fillText(`Score: ${this.score}`, 12, 50);
    
    // Best
    ctx.fillStyle = '#888';
    ctx.font = '14px monospace';
    ctx.shadowBlur = 0;
    ctx.fillText(`Best: ${this.best}`, 12, 75);
    
    // Wave
    ctx.fillStyle = '#ff00ff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ff00ff';
    ctx.fillText(`Wave ${this.wave}`, this.width - 60, 50);
    ctx.shadowBlur = 0;
    
    // Combo
    if (this.combo > 1) {
      const comboAlpha = Math.min(1, this.comboTimer);
      ctx.globalAlpha = comboAlpha;
      ctx.fillStyle = '#ffd93d';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#ffd93d';
      ctx.fillText(`${this.combo}x COMBO!`, this.width / 2, 100);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    
    // Shield HP
    if (this.turret && this.turret.shieldHp > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#00ffff';
      ctx.font = '14px monospace';
      const shieldText = '🛡️'.repeat(this.turret.shieldHp);
      ctx.fillText(shieldText, 12, 95);
    }
  }
  
  drawOverlay() {
    const ctx = this.ctx;
    
    // Darken background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, this.width, this.height);
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (this.state === GameState.READY) {
      // Title
      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 32px monospace';
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#00ffff';
      ctx.fillText('NEON TAP DEFENSE', this.width / 2, this.height / 2 - 60);
      
      // Subtitle
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff00ff';
      ctx.font = '16px monospace';
      ctx.fillText('Tap anywhere to shoot', this.width / 2, this.height / 2);
      
      // Start hint
      ctx.fillStyle = '#888';
      ctx.font = '14px monospace';
      ctx.fillText('Tap to start', this.width / 2, this.height / 2 + 40);
      
      // Controls
      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.fillText('M = Mute | Space = Start', this.width / 2, this.height - 30);
      
    } else if (this.state === GameState.GAME_OVER) {
      // Game Over
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 36px monospace';
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ff0000';
      ctx.fillText('GAME OVER', this.width / 2, this.height / 2 - 80);
      ctx.shadowBlur = 0;
      
      // Stats
      ctx.fillStyle = '#00ffff';
      ctx.font = '20px monospace';
      ctx.fillText(`Score: ${this.score}`, this.width / 2, this.height / 2 - 20);
      
      ctx.fillStyle = '#ff00ff';
      ctx.fillText(`Wave: ${this.wave}`, this.width / 2, this.height / 2 + 15);
      
      if (this.maxCombo > 1) {
        ctx.fillStyle = '#ffd93d';
        ctx.fillText(`Max Combo: ${this.maxCombo}x`, this.width / 2, this.height / 2 + 50);
      }
      
      if (this.score >= this.best) {
        ctx.fillStyle = '#6bff6b';
        ctx.font = 'bold 18px monospace';
        ctx.fillText('NEW BEST!', this.width / 2, this.height / 2 + 90);
      }
      
      // Restart hint
      ctx.fillStyle = '#888';
      ctx.font = '14px monospace';
      ctx.fillText('Tap to restart', this.width / 2, this.height / 2 + 130);
    }
  }
}

/* ===== Boot ===== */
function updateMuteButton(enabled) {
  const b = document.getElementById('btn-mute');
  if (b) b.textContent = enabled ? '🔊' : '🔇';
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  new Game(canvas);
  updateMuteButton(true);
});
