(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");

  const config = {
    width: canvas.width,
    height: canvas.height,
    centerX: canvas.width / 2,
    centerY: canvas.height / 2,
    baseRadius: 30,
    projectileSpeed: 400,
    projectileRadius: 5,
    enemySpeed: 50,
    enemyRadius: 10,
    spawnRate: 1.5, // seconds
    spawnRateDecay: 0.98,
    minSpawnRate: 0.3,
    initialLives: 5,
  };

  const state = {
    projectiles: [],
    enemies: [],
    particles: [], // Explosion effects
    score: 0,
    lives: config.initialLives,
    spawnTimer: 0,
    currentSpawnRate: config.spawnRate,
    phase: "idle", // idle | running | over
    lastTime: 0,
  };

  function updateHud() {
    if (scoreEl) scoreEl.textContent = state.score;
    if (livesEl) livesEl.textContent = state.lives;
  }

  function showOverlay(msg, sub) {
    if (!overlay) return;
    overlay.replaceChildren();

    const p = document.createElement("p");
    p.textContent = msg;
    overlay.appendChild(p);

    if (sub) {
      const span = document.createElement("span");
      span.textContent = sub;
      overlay.appendChild(span);
    }

    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  function spawnEnemy() {
    // Pick a random side: 0=top, 1=right, 2=bottom, 3=left
    const side = Math.floor(Math.random() * 4);
    let x, y;

    if (side === 0) { // Top
      x = Math.random() * config.width;
      y = -config.enemyRadius;
    } else if (side === 1) { // Right
      x = config.width + config.enemyRadius;
      y = Math.random() * config.height;
    } else if (side === 2) { // Bottom
      x = Math.random() * config.width;
      y = config.height + config.enemyRadius;
    } else { // Left
      x = -config.enemyRadius;
      y = Math.random() * config.height;
    }

    // Calculate angle towards center
    const dx = config.centerX - x;
    const dy = config.centerY - y;
    const angle = Math.atan2(dy, dx);

    state.enemies.push({
      x,
      y,
      vx: Math.cos(angle) * config.enemySpeed,
      vy: Math.sin(angle) * config.enemySpeed,
      alive: true,
      color: `hsl(${Math.random() * 60 + 330}, 100%, 50%)` // Reddish/Pinkish neon
    });
  }

  function createExplosion(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      const speed = Math.random() * 50 + 50;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color: color
      });
    }
  }

  function newGame() {
    state.projectiles = [];
    state.enemies = [];
    state.particles = [];
    state.score = 0;
    state.lives = config.initialLives;
    state.currentSpawnRate = config.spawnRate;
    state.spawnTimer = 0;
    updateHud();
    state.phase = "running";
    hideOverlay();
  }

  function gameOver() {
    state.phase = "over";
    showOverlay("Game Over", `Score: ${state.score} · Tap to restart`);
  }

  function handleInput(e) {
    e.preventDefault();
    if (state.phase === "idle" || state.phase === "over") {
      newGame();
      return;
    }

    if (state.phase === "running") {
      // Get click/tap coordinates relative to canvas
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const targetX = (clientX - rect.left) * scaleX;
      const targetY = (clientY - rect.top) * scaleY;

      // Calculate angle from center to target
      const dx = targetX - config.centerX;
      const dy = targetY - config.centerY;
      const angle = Math.atan2(dy, dx);

      state.projectiles.push({
        x: config.centerX,
        y: config.centerY,
        vx: Math.cos(angle) * config.projectileSpeed,
        vy: Math.sin(angle) * config.projectileSpeed,
        alive: true
      });
    }
  }

  function update(dt) {
    if (state.phase !== "running") return;

    // Spawn enemies
    state.spawnTimer += dt;
    if (state.spawnTimer > state.currentSpawnRate) {
      spawnEnemy();
      state.spawnTimer = 0;
      // Increase difficulty
      state.currentSpawnRate = Math.max(
        config.minSpawnRate,
        state.currentSpawnRate * config.spawnRateDecay
      );
    }

    // Update Projectiles
    for (const p of state.projectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Remove if out of bounds
      if (
        p.x < 0 || p.x > config.width ||
        p.y < 0 || p.y > config.height
      ) {
        p.alive = false;
      }
    }

    // Update Enemies
    for (const e of state.enemies) {
      if (!e.alive) continue;
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Check collision with base
      const distToBase = Math.hypot(e.x - config.centerX, e.y - config.centerY);
      if (distToBase < config.baseRadius + config.enemyRadius) {
        e.alive = false;
        state.lives--;
        createExplosion(e.x, e.y, "#ff0000");
        updateHud();
        if (state.lives <= 0) {
          gameOver();
        }
      }

      // Check collision with projectiles
      for (const p of state.projectiles) {
        if (!p.alive) continue;
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        if (dist < config.enemyRadius + config.projectileRadius) {
          e.alive = false;
          p.alive = false;
          state.score += 10;
          createExplosion(e.x, e.y, e.color);
          updateHud();
          break;
        }
      }
    }

    // Update Particles
    for (const p of state.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 2;
    }

    // Cleanup dead objects
    state.projectiles = state.projectiles.filter(p => p.alive);
    state.enemies = state.enemies.filter(e => e.alive);
    state.particles = state.particles.filter(p => p.life > 0);
  }

  function render() {
    ctx.clearRect(0, 0, config.width, config.height);

    // Base background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, config.width, config.height);

    // Radial glow
    const g = ctx.createRadialGradient(
      config.centerX, config.centerY, 0,
      config.centerX, config.centerY, config.width / 1.5
    );
    g.addColorStop(0, "rgba(57,255,20,0.05)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, config.width, config.height);

    // Draw Base
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#39ff14";
    ctx.fillStyle = "#39ff14";
    ctx.beginPath();
    ctx.arc(config.centerX, config.centerY, config.baseRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw Projectiles
    ctx.fillStyle = "#ffffff";
    for (const p of state.projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, config.projectileRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Enemies
    for (const e of state.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      // Rotate enemy to face center
      const angle = Math.atan2(e.vy, e.vx);
      ctx.rotate(angle);
      
      ctx.fillStyle = e.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = e.color;
      
      // Draw triangle
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-10, 8);
      ctx.lineTo(-10, -8);
      ctx.closePath();
      ctx.fill();
      
      ctx.restore();
    }

    // Draw Particles
    for (const p of state.particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }

  function loop(ts) {
    const dt = Math.min((ts - state.lastTime) / 1000, 0.05);
    state.lastTime = ts;
    
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // Input listeners
  canvas.addEventListener("mousedown", handleInput);
  canvas.addEventListener("touchstart", handleInput, { passive: false });
  
  if (overlay) {
    overlay.addEventListener("click", handleInput);
    overlay.addEventListener("touchstart", handleInput, { passive: false });
  }

  // Start loop
  state.lastTime = performance.now();
  requestAnimationFrame(loop);

})();
