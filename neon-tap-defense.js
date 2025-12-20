'use strict';

/* Neon Tap Defense – single-finger strategy game
   Enemies approach from all sides, tap to shoot/activate turrets
   Survive as long as possible
*/

/* ===== Tuning ===== */
const BASE_SPAWN_RATE = 1.2; // seconds between spawns
const ENEMY_SPEED = 60;
const ENEMY_SIZE = 12;
const BULLET_SPEED = 400;
const BULLET_SIZE = 4;
const TURRET_RANGE = 120;
const TURRET_COOLDOWN = 0.4;
const BASE_SIZE = 20;
const BASE_HEALTH = 100;
const ENEMY_DAMAGE = 10;
const PARTICLE_LIFETIME = 0.5;

/* ===== Utils ===== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (x1, y1, x2, y2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2);
const angle = (x1, y1, x2, y2) => Math.atan2(y2-y1, x2-x1);
const random = (a, b) => a + Math.random() * (b - a);

/* ===== Sound ===== */
class Sound {
  constructor(){ this.enabled = true; this.ctx = null; }
  ensure(){ if (!this.ctx) { try{ this.ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch{ this.enabled=false; } } }
  toggle(){ this.enabled = !this.enabled; return this.enabled; }
  resume(){ this.ensure(); if (this.ctx && this.ctx.state==='suspended') this.ctx.resume(); }
  _beep(freqFrom, freqTo, dur, type='square', gain=0.08){
    if(!this.enabled) return; this.ensure(); if(!this.ctx) return;
    const t = this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freqFrom, t);
    if (freqTo!==null) o.frequency.exponentialRampToValueAtTime(freqTo, t+dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g).connect(this.ctx.destination); o.start(); o.stop(t+dur+0.01);
  }
  shoot(){ this._beep(600, 800, 0.08, 'square', 0.06); }
  hit(){ this._beep(300, 150, 0.12, 'sawtooth', 0.1); }
  explode(){ this._beep(200, 50, 0.2, 'sawtooth', 0.12); }
  baseHit(){ this._beep(150, 80, 0.25, 'square', 0.15); }
}

/* ===== Enemy ===== */
class Enemy {
  constructor(game, x, y, targetX, targetY){
    this.game = game;
    this.x = x;
    this.y = y;
    this.size = ENEMY_SIZE;
    this.targetX = targetX;
    this.targetY = targetY;
    this.health = 1;
    this.active = true;
    const dx = targetX - x;
    const dy = targetY - y;
    const len = Math.sqrt(dx*dx + dy*dy);
    this.vx = (dx / len) * ENEMY_SPEED;
    this.vy = (dy / len) * ENEMY_SPEED;
    this.hue = random(0, 360);
  }
  update(dt){
    if(!this.active) return;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const d = dist(this.x, this.y, this.targetX, this.targetY);
    if(d < 5){
      this.hitBase();
    }
  }
  hitBase(){
    this.active = false;
    this.game.baseHealth -= ENEMY_DAMAGE;
    this.game.sound.baseHit();
    this.game.createExplosion(this.x, this.y, '#ff0040');
    if(this.game.baseHealth <= 0){
      this.game.gameOver();
    }
  }
  takeDamage(){
    this.health--;
    if(this.health <= 0){
      this.active = false;
      this.game.score += 10;
      this.game.sound.explode();
      this.game.createExplosion(this.x, this.y, `hsl(${this.hue}, 100%, 60%)`);
    } else {
      this.game.sound.hit();
    }
  }
  draw(ctx){
    if(!this.active) return;
    ctx.save();
    ctx.fillStyle = `hsl(${this.hue}, 100%, 60%)`;
    ctx.shadowBlur = 12;
    ctx.shadowColor = `hsl(${this.hue}, 100%, 60%)`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size/2, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

/* ===== Bullet ===== */
class Bullet {
  constructor(){
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.size = BULLET_SIZE;
  }
  spawn(x, y, tx, ty){
    this.active = true;
    this.x = x;
    this.y = y;
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.sqrt(dx*dx + dy*dy);
    this.vx = (dx / len) * BULLET_SPEED;
    this.vy = (dy / len) * BULLET_SPEED;
  }
  update(dt){
    if(!this.active) return;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if(this.x < -50 || this.x > this.game.width + 50 || 
       this.y < -50 || this.y > this.game.height + 50){
      this.active = false;
    }
  }
  draw(ctx){
    if(!this.active) return;
    ctx.save();
    ctx.fillStyle = '#00ffff';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00ffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size/2, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

/* ===== Turret ===== */
class Turret {
  constructor(game, x, y){
    this.game = game;
    this.x = x;
    this.y = y;
    this.range = TURRET_RANGE;
    this.cooldown = 0;
    this.active = true;
  }
  update(dt){
    if(!this.active || this.cooldown > 0){
      this.cooldown -= dt;
      return;
    }
    let closest = null;
    let closestDist = this.range;
    for(const enemy of this.game.enemies){
      if(!enemy.active) continue;
      const d = dist(this.x, this.y, enemy.x, enemy.y);
      if(d < closestDist){
        closestDist = d;
        closest = enemy;
      }
    }
    if(closest){
      const bullet = this.game.bulletPool.find(b => !b.active);
      if(bullet){
        bullet.spawn(this.x, this.y, closest.x, closest.y);
        this.cooldown = TURRET_COOLDOWN;
        this.game.sound.shoot();
      }
    }
  }
  draw(ctx){
    if(!this.active) return;
    ctx.save();
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#00ff88';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 8, 0, Math.PI*2);
    ctx.stroke();
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

/* ===== Particle ===== */
class Particle {
  constructor(x, y, vx, vy, color){
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = PARTICLE_LIFETIME;
    this.maxLife = PARTICLE_LIFETIME;
    this.size = random(2, 6);
  }
  update(dt){
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
  }
  draw(ctx){
    const alpha = this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 4;
    ctx.shadowColor = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

/* ===== Game ===== */
const GameState = { READY: 'READY', RUNNING: 'RUNNING', GAME_OVER: 'GAME_OVER' };

class Game {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.sound = new Sound();
    this.state = GameState.READY;
    this.score = 0;
    this.best = Number(localStorage.getItem('neon_tap_defense_best') || '0') || 0;
    this.survivalTime = 0;
    this.baseHealth = BASE_HEALTH;
    this.baseX = 0;
    this.baseY = 0;
    this.enemies = [];
    this.turrets = [];
    this.bulletPool = Array.from({length: 50}, () => {
      const b = new Bullet();
      b.game = this;
      return b;
    });
    this.particles = [];
    this.spawnTimer = 0;
    this.lastTime = 0;
    this.accum = 0;
    this.fixedDt = 1/60;
    this.installEvents();
    this.onResize();
    requestAnimationFrame(t => this.frame(t));
  }

  installEvents(){
    window.addEventListener('resize', () => this.onResize());
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      this.sound.resume();
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const x = (touch.clientX - rect.left) * this.dpr;
      const y = (touch.clientY - rect.top) * this.dpr;
      this.onTap(x, y);
    }, {passive: false});
    this.canvas.addEventListener('touchmove', e => e.preventDefault(), {passive: false});
    this.canvas.addEventListener('touchend', e => e.preventDefault(), {passive: false});
    this.canvas.addEventListener('click', e => {
      e.preventDefault();
      this.sound.resume();
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * this.dpr;
      const y = (e.clientY - rect.top) * this.dpr;
      this.onTap(x, y);
    });
    window.addEventListener('keydown', e => {
      if([' ', 'Space', 'm', 'M'].includes(e.key)) e.preventDefault();
      if(e.key === 'm' || e.key === 'M'){
        updateMuteButton(this.sound.toggle());
        return;
      }
      if(e.key === ' ' || e.code === 'Space'){
        this.sound.resume();
        if(this.state === GameState.READY){
          this.state = GameState.RUNNING;
        } else if(this.state === GameState.GAME_OVER){
          this.reset();
          this.state = GameState.RUNNING;
        }
      }
    }, {passive: false});
    const M = document.getElementById('btn-mute');
    if(M){
      M.addEventListener('click', () => updateMuteButton(this.sound.toggle()));
    }
  }

  onTap(x, y){
    if(this.state === GameState.READY){
      this.state = GameState.RUNNING;
      return;
    }
    if(this.state === GameState.GAME_OVER){
      this.reset();
      this.state = GameState.RUNNING;
      return;
    }
    if(this.state === GameState.RUNNING){
      const d = dist(x, y, this.baseX, this.baseY);
      if(d < 30) return; // Don't place turrets too close to base
      this.turrets.push(new Turret(this, x, y));
      this.createExplosion(x, y, '#00ff88');
    }
  }

  onResize(){
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    this.dpr = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    this.width = w;
    this.height = h;
    this.baseX = w / 2;
    this.baseY = h / 2;
  }

  reset(){
    this.score = 0;
    this.survivalTime = 0;
    this.baseHealth = BASE_HEALTH;
    this.enemies = [];
    this.turrets = [];
    this.particles = [];
    this.spawnTimer = 0;
    for(const b of this.bulletPool) b.active = false;
  }

  spawnEnemy(){
    const side = Math.floor(Math.random() * 4);
    let x, y;
    const margin = 20;
    if(side === 0){ // top
      x = random(margin, this.width - margin);
      y = -ENEMY_SIZE;
    } else if(side === 1){ // right
      x = this.width + ENEMY_SIZE;
      y = random(margin, this.height - margin);
    } else if(side === 2){ // bottom
      x = random(margin, this.width - margin);
      y = this.height + ENEMY_SIZE;
    } else { // left
      x = -ENEMY_SIZE;
      y = random(margin, this.height - margin);
    }
    this.enemies.push(new Enemy(this, x, y, this.baseX, this.baseY));
  }

  createExplosion(x, y, color){
    for(let i = 0; i < 8; i++){
      const angle = (Math.PI * 2 * i) / 8;
      const speed = random(50, 150);
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        color
      ));
    }
  }

  frame(ms){
    requestAnimationFrame(t => this.frame(t));
    const now = ms * 0.001;
    if(!this.lastTime) this.lastTime = now;
    let dt = Math.min(now - this.lastTime, 0.1);
    this.lastTime = now;
    this.accum = Math.min(this.accum + dt, 0.25);
    while(this.accum >= this.fixedDt){
      this.update(this.fixedDt);
      this.accum -= this.fixedDt;
    }
    this.render();
  }

  update(dt){
    if(this.state !== GameState.RUNNING) return;
    this.survivalTime += dt;
    this.spawnTimer -= dt;
    const spawnRate = BASE_SPAWN_RATE / (1 + this.survivalTime * 0.1);
    if(this.spawnTimer <= 0){
      this.spawnEnemy();
      this.spawnTimer = spawnRate;
    }
    for(const enemy of this.enemies){
      enemy.update(dt);
    }
    this.enemies = this.enemies.filter(e => e.active);
    for(const turret of this.turrets){
      turret.update(dt);
    }
    for(const bullet of this.bulletPool){
      if(bullet.active) bullet.update(dt);
    }
    for(const particle of this.particles){
      particle.update(dt);
    }
    this.particles = this.particles.filter(p => p.life > 0);
    // Bullet-enemy collisions
    for(const bullet of this.bulletPool){
      if(!bullet.active) continue;
      for(const enemy of this.enemies){
        if(!enemy.active) continue;
        const d = dist(bullet.x, bullet.y, enemy.x, enemy.y);
        if(d < enemy.size / 2 + bullet.size / 2){
          bullet.active = false;
          enemy.takeDamage();
          break;
        }
      }
    }
  }

  gameOver(){
    this.state = GameState.GAME_OVER;
    if(this.score > this.best){
      this.best = this.score;
      localStorage.setItem('neon_tap_defense_best', String(this.best));
    }
  }

  render(){
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    // Dark background with subtle grid
    ctx.fillStyle = '#000011';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = '#001122';
    ctx.lineWidth = 1;
    for(let x = 0; x < this.width; x += 40){
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for(let y = 0; y < this.height; y += 40){
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    // Draw base
    ctx.save();
    const baseAlpha = this.baseHealth / BASE_HEALTH;
    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = '#ff0040';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff0040';
    ctx.beginPath();
    ctx.arc(this.baseX, this.baseY, BASE_SIZE, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff4080';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.baseX, this.baseY, BASE_SIZE + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Draw turrets
    for(const turret of this.turrets){
      turret.draw(ctx);
    }
    // Draw enemies
    for(const enemy of this.enemies){
      enemy.draw(ctx);
    }
    // Draw bullets
    for(const bullet of this.bulletPool){
      if(bullet.active) bullet.draw(ctx);
    }
    // Draw particles
    for(const particle of this.particles){
      particle.draw(ctx);
    }
    // HUD
    ctx.fillStyle = '#00ff88';
    ctx.font = '14px monospace';
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 0;
    ctx.fillText(`Score: ${this.score}`, 12, 10);
    const timeText = `Time: ${Math.floor(this.survivalTime)}s`;
    ctx.fillText(timeText, 12, 28);
    const healthText = `Health: ${Math.max(0, Math.floor(this.baseHealth))}`;
    ctx.fillText(healthText, 12, 46);
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText(`Best: ${this.best}`, 12, 64);
    // State overlay
    if(this.state !== GameState.RUNNING){
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let text = '';
      if(this.state === GameState.READY){
        text = 'Neon Tap Defense\n\nTap to place turrets\nDefend the base\n\nTap / Space to start';
      } else if(this.state === GameState.GAME_OVER){
        text = `Game Over\n\nScore: ${this.score}\nTime: ${Math.floor(this.survivalTime)}s\n\nTap / Space to restart`;
      }
      const lines = text.split('\n');
      const cy = this.height / 2;
      lines.forEach((line, i) => {
        ctx.fillText(line, this.width / 2, cy + (i - lines.length / 2) * 24);
      });
      ctx.restore();
    }
  }
}

/* ===== Boot ===== */
function updateMuteButton(enabled){
  const b = document.getElementById('btn-mute');
  if(b) b.textContent = enabled ? '🔊' : '🔇';
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  if(!canvas) return;
  new Game(canvas);
  updateMuteButton(true);
});
