(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const livesEl = document.getElementById("lives");

  const GameState = Object.freeze({
    Ready: "ready",
    Running: "running",
    Over: "over",
  });

  const FRUIT_TYPES = [
    { name: "Neon Kiwi", color: "#a6ff4c", glow: "#e5ff93", radius: 22, points: 4 },
    { name: "Electric Mango", color: "#ffb347", glow: "#ffd97a", radius: 24, points: 5 },
    { name: "Cosmic Berry", color: "#ff66d9", glow: "#ffb5f1", radius: 20, points: 6 },
    { name: "Hyper Lime", color: "#6effd8", glow: "#c1fff1", radius: 21, points: 4 },
    { name: "Ultraviolet Plum", color: "#8f6bff", glow: "#c7b0ff", radius: 23, points: 7 },
  ];

  const BIG_FRUIT = {
    name: "Galactic Melon",
    color: "#6dffe8",
    glow: "#d4fff7",
    radius: 46,
    points: 15,
    slicesNeeded: 3,
  };

  const BIG_FRUIT_INTERVAL = 6;
  const GRAVITY = 2200;
  const BOMB_CHANCE = 0.25;
  const MISS_PENALTY = 1;
  const MAX_LIVES = 3;

  const BombConfig = {
    radius: 24,
    shell: "#050505",
    glow: "#ff335d",
    fuse: "#fffd88",
  };

  let cssWidth = window.innerWidth;
  let cssHeight = window.innerHeight;
  let devicePixelRatioValue = window.devicePixelRatio || 1;

  let projectiles = [];
  let particles = [];
  let slashes = [];

  let pointerActive = false;
  let lastPointer = null;

  let spawnTimer = 0.8;
  let fruitCounter = 0;

  let gameState = GameState.Ready;
  let score = 0;
  let best = loadBestScore();
  let lives = MAX_LIVES;

  let lastFrameTime = performance.now();

  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function loadBestScore() {
    try {
      return parseInt(localStorage.getItem("neonFruitBest") || "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  function saveBestScore() {
    try {
      localStorage.setItem("neonFruitBest", String(best));
    } catch {
      /* ignore storage errors */
    }
  }

  function resizeCanvas() {
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    devicePixelRatioValue = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(cssWidth * devicePixelRatioValue));
    canvas.height = Math.max(1, Math.floor(cssHeight * devicePixelRatioValue));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(devicePixelRatioValue, 0, 0, devicePixelRatioValue, 0, 0);
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function pointerPosition(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (cssWidth / rect.width),
      y: (evt.clientY - rect.top) * (cssHeight / rect.height),
    };
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    livesEl.textContent = String(lives);
  }

  function showOverlay(message, subtext = "Tap / Click / Drag to play") {
    overlay.innerHTML = `${message}<small>${subtext}</small>`;
    overlay.classList.add("visible");
  }

  function hideOverlay() {
    overlay.classList.remove("visible");
  }

  function resetGameState() {
    projectiles = [];
    particles = [];
    slashes = [];
    spawnTimer = 0.3;
    fruitCounter = 0;
    score = 0;
    lives = MAX_LIVES;
    updateHud();
  }

  function startGame() {
    resetGameState();
    gameState = GameState.Running;
    hideOverlay();
  }

  function triggerGameOver(reason) {
    if (gameState === GameState.Over) return;
    gameState = GameState.Over;
    if (score > best) {
      best = score;
      saveBestScore();
    }
    updateHud();
    const message =
      reason === "bomb"
        ? "💣 Boom! The bomb blew up."
        : "🍓 Too many fruit slipped away.";
    showOverlay(message, "Tap / Click to restart");
  }

  function spawnFruit(isBig) {
    const config = isBig
      ? BIG_FRUIT
      : FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
    const radius = config.radius + randomRange(-2, 3);
    const spawnX = randomRange(radius + 20, cssWidth - radius - 20);
    const spawnY = cssHeight + radius + 50;
    const vyBase = isBig ? randomRange(-1400, -1200) : randomRange(-1600, -1350);
    const vx = randomRange(-480, 480);

    projectiles.push({
      kind: isBig ? "big" : "fruit",
      name: config.name,
      x: spawnX,
      y: spawnY,
      vx,
      vy: vyBase,
      radius,
      baseRadius: radius,
      color: config.color,
      glow: config.glow,
      points: config.points,
      slicesNeeded: config.slicesNeeded || 1,
      hitCooldown: 0,
      rotation: Math.random() * Math.PI * 2,
      spin: randomRange(-2.8, 2.8),
      alive: true,
      sliced: false,
    });
  }

  function spawnBomb() {
    const radius = BombConfig.radius;
    const spawnX = randomRange(radius + 30, cssWidth - radius - 30);
    const spawnY = cssHeight + radius + 60;
    projectiles.push({
      kind: "bomb",
      name: "Bomb",
      x: spawnX,
      y: spawnY,
      vx: randomRange(-420, 420),
      vy: randomRange(-1500, -1250),
      radius,
      baseRadius: radius,
      color: BombConfig.shell,
      glow: BombConfig.glow,
      points: 0,
      slicesNeeded: 1,
      hitCooldown: 0,
      rotation: Math.random() * Math.PI * 2,
      spin: randomRange(-4.5, 4.5),
      alive: true,
      sliced: false,
    });
  }

  function scheduleNextSpawn() {
    spawnTimer = randomRange(0.55, 1.05);
  }

  function spawnWave() {
    fruitCounter += 1;
    const isBigDrop = fruitCounter % BIG_FRUIT_INTERVAL === 0;
    spawnFruit(isBigDrop);

    if (!isBigDrop && Math.random() < 0.35) {
      spawnFruit(false);
    }

    if (Math.random() < BOMB_CHANCE) {
      spawnBomb();
    }

    scheduleNextSpawn();
  }

  function updateProjectiles(dt) {
    for (const entity of projectiles) {
      entity.hitCooldown = Math.max(0, entity.hitCooldown - dt);
      entity.vy += GRAVITY * dt;
      entity.x += entity.vx * dt;
      entity.y += entity.vy * dt;
      entity.rotation += entity.spin * dt;

      if (entity.y - entity.radius > cssHeight + 120) {
        entity.alive = false;
        if (
          gameState === GameState.Running &&
          (entity.kind === "fruit" || entity.kind === "big") &&
          !entity.sliced
        ) {
          handleMissedFruit();
        }
      }
    }
    projectiles = projectiles.filter((entity) => entity.alive);
  }

  function handleMissedFruit() {
    lives = Math.max(0, lives - MISS_PENALTY);
    updateHud();
    if (lives <= 0) {
      triggerGameOver("miss");
    }
  }

  function spawnJuiceBurst(entity, countMultiplier = 1) {
    const count = Math.floor(10 * countMultiplier);
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: entity.x,
        y: entity.y,
        vx: randomRange(-120, 120),
        vy: randomRange(-80, 80),
        life: randomRange(0.25, 0.5),
        color: entity.glow || entity.color,
        radius: randomRange(2, 5),
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function addSlashSegment(a, b) {
    slashes.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      life: 0.18,
    });
  }

  function updateSlashes(dt) {
    for (const slash of slashes) {
      slash.life -= dt;
    }
    slashes = slashes.filter((slash) => slash.life > 0);
  }

  function distancePointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
      return Math.hypot(px - x1, py - y1);
    }
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  function checkSliceCollision(a, b) {
    if (gameState !== GameState.Running) return;
    if (!a || !b) return;
    const sliceThickness = 8;

    for (const entity of projectiles) {
      if (!entity.alive) continue;
      const dist = distancePointToSegment(entity.x, entity.y, a.x, a.y, b.x, b.y);
      if (dist <= entity.radius + sliceThickness) {
        applySlice(entity);
      }
    }
  }

  function applySlice(entity) {
    if (entity.hitCooldown > 0) return;
    entity.hitCooldown = entity.kind === "big" ? 0.2 : 0.12;

    if (entity.kind === "bomb") {
      entity.alive = false;
      spawnJuiceBurst(entity, 2);
      triggerGameOver("bomb");
      return;
    }

    entity.slicesNeeded -= 1;
    spawnJuiceBurst(entity, entity.kind === "big" ? 2 : 1);

    if (entity.slicesNeeded <= 0) {
      entity.alive = false;
      entity.sliced = true;
      score += entity.points;
      best = Math.max(best, score);
      if (best === score) saveBestScore();
      updateHud();
    } else {
      entity.radius = Math.max(entity.baseRadius * 0.65, entity.radius * 0.85);
      entity.spin *= 1.1;
    }
  }

  function drawBackground() {
    ctx.setTransform(devicePixelRatioValue, 0, 0, devicePixelRatioValue, 0, 0);
    const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
    gradient.addColorStop(0, "#06021a");
    gradient.addColorStop(0.5, "#090029");
    gradient.addColorStop(1, "#04000f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    const spacing = 60;
    ctx.beginPath();
    for (let x = 0; x < cssWidth; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssHeight);
    }
    for (let y = 0; y < cssHeight; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(cssWidth, y);
    }
    ctx.stroke();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawProjectiles() {
    for (const entity of projectiles) {
      ctx.save();
      ctx.translate(entity.x, entity.y);
      ctx.rotate(entity.rotation);
      const gradient = ctx.createRadialGradient(0, 0, entity.radius * 0.15, 0, 0, entity.radius);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.2, entity.glow || entity.color);
      gradient.addColorStop(0.85, entity.color);
      gradient.addColorStop(1, "#000000");

      if (entity.kind === "bomb") {
        ctx.fillStyle = entity.color;
        ctx.shadowBlur = 30;
        ctx.shadowColor = entity.glow;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = entity.glow;
        ctx.lineWidth = 3;
        ctx.stroke();
        // fuse
        ctx.beginPath();
        ctx.strokeStyle = BombConfig.fuse;
        ctx.lineWidth = 4;
        ctx.moveTo(0, -entity.radius);
        ctx.quadraticCurveTo(10, -entity.radius - 18, 0, -entity.radius - 30);
        ctx.stroke();
      } else {
        ctx.fillStyle = gradient;
        ctx.shadowBlur = 25;
        ctx.shadowColor = entity.glow || entity.color;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = entity.glow || "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        if (entity.kind === "big") {
          const remainingRatio = entity.slicesNeeded / BIG_FRUIT.slicesNeeded;
          ctx.strokeStyle = "#ffffff88";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(0, 0, entity.radius + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remainingRatio);
          ctx.stroke();
          ctx.font = "600 18px 'Space Grotesk', system-ui";
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(`${entity.slicesNeeded}x`, 0, 6);
        }
      }
      ctx.restore();
    }
  }

  function drawSlashes() {
    ctx.lineCap = "round";
    for (const slash of slashes) {
      const t = clamp(slash.life / 0.18, 0, 1);
      const color = `rgba(102, 255, 227, ${t})`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 6 * t + 2;
      ctx.beginPath();
      ctx.moveTo(slash.x1, slash.y1);
      ctx.lineTo(slash.x2, slash.y2);
      ctx.stroke();
    }
  }

  function gameLoop(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.033);
    lastFrameTime = now;

    if (gameState === GameState.Running) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnWave();
      }
    }

    updateProjectiles(dt);
    updateParticles(dt);
    updateSlashes(dt);
    drawBackground();
    drawParticles();
    drawProjectiles();
    drawSlashes();

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);

  function releasePointer(evt) {
    if (pointerActive && evt.pointerId !== undefined) {
      canvas.releasePointerCapture(evt.pointerId);
    }
    pointerActive = false;
    lastPointer = null;
  }

  canvas.addEventListener("pointerdown", (evt) => {
    evt.preventDefault();
    canvas.setPointerCapture(evt.pointerId);
    const pos = pointerPosition(evt);
    pointerActive = true;
    if (gameState === GameState.Ready) {
      startGame();
    } else if (gameState === GameState.Over) {
      startGame();
    }
    lastPointer = pos;
  });

  canvas.addEventListener("pointermove", (evt) => {
    if (!pointerActive) return;
    const pos = pointerPosition(evt);
    if (lastPointer) {
      addSlashSegment(lastPointer, pos);
      checkSliceCollision(lastPointer, pos);
    }
    lastPointer = pos;
  });

  canvas.addEventListener("pointerup", (evt) => {
    releasePointer(evt);
  });

  canvas.addEventListener("pointercancel", (evt) => {
    releasePointer(evt);
  });

  canvas.addEventListener("pointerleave", (evt) => {
    releasePointer(evt);
  });

  overlay.addEventListener("click", () => {
    if (gameState === GameState.Ready || gameState === GameState.Over) {
      startGame();
    }
  });

  overlay.addEventListener("keydown", (evt) => {
    if (evt.code === "Space" || evt.code === "Enter") {
      evt.preventDefault();
      if (gameState === GameState.Ready || gameState === GameState.Over) {
        startGame();
      }
    }
  });

  window.addEventListener("keydown", (evt) => {
    if (evt.code === "Space" || evt.code === "Enter") {
      evt.preventDefault();
      if (gameState === GameState.Running) {
        return;
      }
      startGame();
    }
  });

  showOverlay("Swipe to slice the neon fruit", "Tap / Click / Drag to play");
  updateHud();
})();
