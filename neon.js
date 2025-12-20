(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const healthEl = document.getElementById("health");

  // Game Configuration
  const CONFIG = {
    width: 800,
    height: 800,
    playerRadius: 25,
    projectileSpeed: 600,
    baseEnemySpeed: 80,
    enemySpawnRate: 1500, // ms
    spawnRateDecay: 0.98, // Multiplier per wave/interval
    minSpawnRate: 400,
    maxHealth: 100,
  };

  // Game State
  const state = {
    score: 0,
    health: CONFIG.maxHealth,
    phase: "idle", // idle, running, over
    lastTime: 0,
    spawnTimer: 0,
    currentSpawnRate: CONFIG.enemySpawnRate,
    projectiles: [],
    enemies: [],
    particles: [],
  };

  // --- ENTITY CLASSES ---

  class Projectile {
    constructor(x, y, angle) {
      this.x = x;
      this.y = y;
      this.vx = Math.cos(angle) * CONFIG.projectileSpeed;
      this.vy = Math.sin(angle) * CONFIG.projectileSpeed;
      this.radius = 4;
      this.active = true;
      this.trail = []; // simple trail
    }

    update(dt) {
      this.trail.push({ x: this.x, y: this.y, age: 1.0 });
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Remove trail points
      for (let i = this.trail.length - 1; i >= 0; i--) {
        this.trail[i].age -= dt * 5;
        if (this.trail[i].age <= 0) this.trail.splice(i, 1);
      }

      // Bounds check (remove if off screen)
      if (
        this.x < 0 ||
        this.x > CONFIG.width ||
        this.y < 0 ||
        this.y > CONFIG.height
      ) {
        this.active = false;
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.fillStyle = "#00ffff";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#00ffff";
      
      // Draw head
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();

      // Draw trail
      for (const p of this.trail) {
        ctx.globalAlpha = p.age;
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.radius * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  class Enemy {
    constructor() {
      // Spawn at random edge
      const edge = Math.floor(Math.random() * 4); // 0:top, 1:right, 2:bottom, 3:left
      if (edge === 0) {
        this.x = Math.random() * CONFIG.width;
        this.y = -20;
      } else if (edge === 1) {
        this.x = CONFIG.width + 20;
        this.y = Math.random() * CONFIG.height;
      } else if (edge === 2) {
        this.x = Math.random() * CONFIG.width;
        this.y = CONFIG.height + 20;
      } else {
        this.x = -20;
        this.y = Math.random() * CONFIG.height;
      }

      const dx = CONFIG.width / 2 - this.x;
      const dy = CONFIG.height / 2 - this.y;
      const angle = Math.atan2(dy, dx);
      
      // Speed increases slightly with score
      const speedMultiplier = 1 + Math.min(state.score / 500, 2); 
      const speed = CONFIG.baseEnemySpeed * speedMultiplier;

      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      
      this.radius = 15;
      this.active = true;
      this.angle = angle;
      this.rotation = 0;
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.rotation += dt * 2;

      // Check collision with player base
      const dx = this.x - CONFIG.width / 2;
      const dy = this.y - CONFIG.height / 2;
      const dist = Math.hypot(dx, dy);
      
      if (dist < CONFIG.playerRadius + this.radius) {
        this.active = false;
        damagePlayer(10);
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle + Math.PI / 2); // Point towards center
      
      ctx.fillStyle = "#ff00ff";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#ff00ff";
      
      // Draw enemy shape (Triangle)
      ctx.beginPath();
      ctx.moveTo(0, 15);
      ctx.lineTo(10, -15);
      ctx.lineTo(-10, -15);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  class Particle {
    constructor(x, y, color) {
      this.x = x;
      this.y = y;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 100 + 50;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.life = 1.0;
      this.decay = Math.random() * 2 + 1;
      this.color = color;
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.life -= this.decay * dt;
    }

    draw(ctx) {
      if (this.life <= 0) return;
      ctx.save();
      ctx.globalAlpha = this.life;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // --- GAME FUNCTIONS ---

  function spawnProjectile(tx, ty) {
    const cx = CONFIG.width / 2;
    const cy = CONFIG.height / 2;
    const angle = Math.atan2(ty - cy, tx - cx);
    state.projectiles.push(new Projectile(cx, cy, angle));
  }

  function createExplosion(x, y, color) {
    for (let i = 0; i < 10; i++) {
      state.particles.push(new Particle(x, y, color));
    }
  }

  function damagePlayer(amount) {
    state.health = Math.max(0, state.health - amount);
    updateHud();
    // Screen shake or red flash could go here
    createExplosion(CONFIG.width / 2, CONFIG.height / 2, "#ff0000");

    if (state.health <= 0) {
      endGame();
    }
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = state.score;
    if (healthEl) {
      healthEl.textContent = state.health;
      healthEl.style.color = state.health > 30 ? "var(--primary)" : "#ff0000";
    }
  }

  function resetGame() {
    state.score = 0;
    state.health = CONFIG.maxHealth;
    state.projectiles = [];
    state.enemies = [];
    state.particles = [];
    state.currentSpawnRate = CONFIG.enemySpawnRate;
    state.spawnTimer = 0;
    updateHud();
  }

  function startGame() {
    resetGame();
    state.phase = "running";
    if (overlay) {
      overlay.classList.remove("visible");
      overlay.setAttribute("aria-hidden", "true");
    }
    state.lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function endGame() {
    state.phase = "over";
    if (overlay) {
      overlay.innerHTML = `<p>GAME OVER</p><span>Final Score: ${state.score}<br>Tap to restart</span>`;
      overlay.classList.add("visible");
      overlay.setAttribute("aria-hidden", "false");
    }
  }

  // --- LOOP ---

  function update(dt) {
    // Spawning
    state.spawnTimer += dt * 1000;
    if (state.spawnTimer > state.currentSpawnRate) {
      state.enemies.push(new Enemy());
      state.spawnTimer = 0;
      // Ramp up difficulty
      state.currentSpawnRate = Math.max(
        CONFIG.minSpawnRate,
        state.currentSpawnRate * CONFIG.spawnRateDecay
      );
    }

    // Update Entities
    state.projectiles.forEach((p) => p.update(dt));
    state.enemies.forEach((e) => e.update(dt));
    state.particles.forEach((p) => p.update(dt));

    // Collisions: Projectile vs Enemy
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      if (!p.active) continue;

      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (!e.active) continue;

        const dist = Math.hypot(p.x - e.x, p.y - e.y);
        if (dist < p.radius + e.radius) {
          // Hit!
          p.active = false;
          e.active = false;
          state.score += 10;
          createExplosion(e.x, e.y, "#ff00ff");
          updateHud();
          break; // Projectile can only hit one enemy
        }
      }
    }

    // Cleanup dead entities
    state.projectiles = state.projectiles.filter((p) => p.active);
    state.enemies = state.enemies.filter((e) => e.active);
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  function render() {
    // Clear background
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    
    // Draw Grid (optional retro feel)
    ctx.strokeStyle = "rgba(0, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    // ... grid drawing code if needed ...

    // Draw Player Base
    ctx.save();
    ctx.translate(CONFIG.width / 2, CONFIG.height / 2);
    ctx.fillStyle = "#00ffff";
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#00ffff";
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.playerRadius, 0, Math.PI * 2);
    ctx.fill();
    // Inner pulsing core
    const pulse = Math.sin(performance.now() / 200) * 5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.playerRadius * 0.6 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw Entities
    state.enemies.forEach((e) => e.draw(ctx));
    state.projectiles.forEach((p) => p.draw(ctx));
    state.particles.forEach((p) => p.draw(ctx));
  }

  function loop(ts) {
    if (state.phase !== "running") return;

    const dt = Math.min((ts - state.lastTime) / 1000, 0.1);
    state.lastTime = ts;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  // --- INPUT ---

  function handleInput(e) {
    e.preventDefault();
    if (state.phase === "idle" || state.phase === "over") {
      startGame();
    } else if (state.phase === "running") {
      // Get click/touch position relative to canvas
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      let clientX, clientY;
      if (e.changedTouches) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      
      spawnProjectile(x, y);
    }
  }

  // Initial render
  render();
  // We need a dummy update to show the player base before game starts
  ctx.save();
  ctx.translate(CONFIG.width / 2, CONFIG.height / 2);
  ctx.fillStyle = "#00ffff";
  ctx.shadowBlur = 20;
  ctx.shadowColor = "#00ffff";
  ctx.beginPath();
  ctx.arc(0, 0, CONFIG.playerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();


  canvas.addEventListener("mousedown", handleInput);
  canvas.addEventListener("touchstart", handleInput, { passive: false });
  overlay.addEventListener("click", handleInput);

})();
