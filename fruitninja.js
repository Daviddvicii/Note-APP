function syncLeaderboard(name, score) {
  console.log(`[leaderboard] ${name}: ${score}`);
}

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const comboEl = document.getElementById("combo");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayDetail = document.getElementById("overlay-detail");
  const overlayHint = document.getElementById("overlay-hint");
  const startButton = document.getElementById("start-button");
  const storageKey = "retro_neon_fruit_ninja_best";

  const fruits = [];
  const particles = [];
  let bladeTrail = [];

  let running = false;
  let slicing = false;
  let score = 0;
  let comboStreak = 0;
  let comboTimer = 0;
  let best = loadBestScore();
  let lastTime = 0;
  let fruitCounter = 0;
  let spawnTimer = 0;
  let spawnDelay = randomSpawnDelay();

  const gravity = 0.18;
  const bladePersistence = 180; // ms

  updateScore();
  updateBest();
  updateCombo();
  resizeCanvas();
  drawIdleBackground();

  window.addEventListener("resize", () => {
    resizeCanvas();
    if (!running) {
      drawIdleBackground();
    }
  });

  startButton.addEventListener("click", () => {
    startGame();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      startGame();
    }
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.code === "Space" && !running) {
        event.preventDefault();
        startGame();
      }
    },
    { passive: false }
  );

  canvas.addEventListener("pointerdown", (event) => {
    slicing = true;
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignored
      }
    }
    bladeTrail = [];
    addBladePoint(event);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!slicing) {
      return;
    }
    addBladePoint(event);
    detectHits();
  });

  window.addEventListener("pointerup", endSlice, { passive: true });
  window.addEventListener("pointercancel", endSlice, { passive: true });

  function endSlice() {
    slicing = false;
  }

  function startGame() {
    score = 0;
    comboStreak = 0;
    comboTimer = 0;
    fruitCounter = 0;
    spawnTimer = 0;
    spawnDelay = randomSpawnDelay();
    lastTime = 0;
    fruits.length = 0;
    particles.length = 0;
    bladeTrail = [];
    overlay.classList.remove("visible");
    overlayTitle.textContent = "Retro Neon Fruit Ninja";
    overlayDetail.textContent = "Slice fruits, dodge bombs, and shatter mega fruit with multiple cuts.";
    overlayHint.textContent = "Drag with mouse or touch to swing your neon blade.";
    updateScore();
    updateCombo();
    running = true;
    requestAnimationFrame(gameLoop);
  }

  function gameLoop(timestamp) {
    if (!running) {
      return;
    }

    if (lastTime === 0) {
      lastTime = timestamp;
    }

    const delta = Math.min(48, timestamp - lastTime || 16);
    lastTime = timestamp;

    update(delta);
    draw();

    requestAnimationFrame(gameLoop);
  }

  function update(delta) {
    spawnTimer += delta;
    if (spawnTimer >= spawnDelay) {
      spawnTimer = 0;
      spawnDelay = randomSpawnDelay();
      launchEntity();
    }

    if (comboTimer > 0) {
      comboTimer = Math.max(0, comboTimer - delta);
      if (comboTimer === 0 && comboStreak > 0) {
        comboStreak = 0;
        updateCombo();
      }
    }

    const normalizedDelta = delta / 16.6667;

    for (let i = fruits.length - 1; i >= 0; i -= 1) {
      const fruit = fruits[i];
      fruit.vy += gravity * normalizedDelta;
      fruit.x += fruit.vx * normalizedDelta;
      fruit.y += fruit.vy * normalizedDelta;
      fruit.rotation += fruit.spin * normalizedDelta;

      if (fruit.y - fruit.radius > canvas.height + 80) {
        fruits.splice(i, 1);
      }
    }

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.life += delta;
      if (particle.life >= particle.ttl) {
        particles.splice(i, 1);
        continue;
      }
      if (particle.ring) {
        continue;
      }
      particle.x += particle.vx * normalizedDelta;
      particle.y += particle.vy * normalizedDelta;
      particle.vy += 0.02 * normalizedDelta;
    }

    if (!slicing && bladeTrail.length > 0) {
      trimBladeTrail(performance.now());
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackdrop();
    drawGrid();
    drawParticles();
    drawFruits();
    drawBlade();
  }

  function drawIdleBackground() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackdrop();
    drawGrid();
  }

  function drawBackdrop() {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#040010");
    gradient.addColorStop(0.5, "#050018");
    gradient.addColorStop(1, "#02000a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const aura = ctx.createRadialGradient(
      canvas.width * 0.5,
      canvas.height * 1.1,
      canvas.height * 0.1,
      canvas.width * 0.5,
      canvas.height * 1.2,
      canvas.height * 0.9
    );
    aura.addColorStop(0, "rgba(53, 244, 255, 0.18)");
    aura.addColorStop(1, "rgba(3, 1, 16, 0)");

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 90, 241, 0.08)";
    ctx.lineWidth = 1;
    const spacing = 80;
    for (let x = canvas.width % spacing; x < canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(53, 244, 255, 0.08)";
    for (let y = canvas.height % spacing; y < canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFruits() {
    fruits.forEach((fruit) => {
      ctx.save();
      ctx.translate(fruit.x, fruit.y);
      ctx.rotate(fruit.rotation);
      const radius = fruit.radius;

      if (fruit.type === "bomb") {
        const gradient = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
        gradient.addColorStop(0, "#1b1b24");
        gradient.addColorStop(1, "#050509");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255, 87, 87, 0.9)";
        ctx.stroke();

        ctx.strokeStyle = "rgba(255, 189, 87, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-radius * 0.6, -radius * 0.6);
        ctx.lineTo(radius * 0.6, radius * 0.6);
        ctx.moveTo(radius * 0.6, -radius * 0.6);
        ctx.lineTo(-radius * 0.6, radius * 0.6);
        ctx.stroke();
      } else {
        const gradient = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
        gradient.addColorStop(0, fruit.tintInner);
        gradient.addColorStop(1, fruit.tintOuter);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = 3;
        ctx.strokeStyle = fruit.glow;
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.ellipse(-radius * 0.3, -radius * 0.3, radius * 0.3, radius * 0.15, 0.4, 0, Math.PI * 2);
        ctx.fill();

        if (fruit.type === "mega") {
          ctx.strokeStyle = "rgba(247, 255, 72, 0.7)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(0, 0, radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (fruit.health / fruit.maxHealth));
          ctx.stroke();
        }
      }

      ctx.restore();
    });
  }

  function drawBlade() {
    if (bladeTrail.length < 2) {
      return;
    }

    const gradient = ctx.createLinearGradient(
      bladeTrail[0].x,
      bladeTrail[0].y,
      bladeTrail[bladeTrail.length - 1].x,
      bladeTrail[bladeTrail.length - 1].y
    );
    gradient.addColorStop(0, "rgba(53, 244, 255, 0)");
    gradient.addColorStop(0.5, "rgba(255, 90, 241, 0.8)");
    gradient.addColorStop(1, "rgba(53, 244, 255, 0)");

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(bladeTrail[0].x, bladeTrail[0].y);
    for (let i = 1; i < bladeTrail.length; i += 1) {
      ctx.lineTo(bladeTrail[i].x, bladeTrail[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function resizeCanvas() {
    const wrapper = canvas.parentElement;
    const rect = wrapper.getBoundingClientRect();
    const targetWidth = rect.width;
    const targetHeight = Math.min(rect.width * 0.6, window.innerHeight * 0.65);
    canvas.width = Math.max(640, Math.floor(targetWidth));
    canvas.height = Math.max(420, Math.floor(targetHeight));
  }

  function launchEntity() {
    if ((fruitCounter + 1) % 6 === 0) {
      spawnFruit("mega");
      fruitCounter += 1;
      return;
    }

    if (Math.random() < 0.18) {
      spawnBomb();
      return;
    }

    spawnFruit("fruit");
    fruitCounter += 1;
  }

  function spawnFruit(kind) {
    const palette = randomPalette();
    const radius = kind === "mega" ? randomRange(38, 48) : randomRange(22, 30);
    const startX = randomRange(canvas.width * 0.2, canvas.width * 0.8);
    const startY = canvas.height + radius + 20;
    const baseVy = kind === "mega" ? randomRange(-9.2, -7.8) : randomRange(-11, -8.2);
    const fruit = {
      type: kind,
      x: startX,
      y: startY,
      vx: randomRange(-2.4, 2.4),
      vy: baseVy,
      radius,
      rotation: 0,
      spin: randomRange(-0.05, 0.05),
      tintInner: palette.inner,
      tintOuter: palette.outer,
      glow: palette.glow,
      hitCooldown: 0,
      maxHealth: kind === "mega" ? 3 : 1,
      health: kind === "mega" ? 3 : 1,
      points: kind === "mega" ? 40 : 12
    };
    fruits.push(fruit);
  }

  function spawnBomb() {
    const radius = randomRange(22, 28);
    const startX = randomRange(canvas.width * 0.1, canvas.width * 0.9);
    const startY = canvas.height + radius + 30;
    const bomb = {
      type: "bomb",
      x: startX,
      y: startY,
      vx: randomRange(-2.1, 2.1),
      vy: randomRange(-9, -7.2),
      radius,
      rotation: 0,
      spin: randomRange(-0.04, 0.04)
    };
    fruits.push(bomb);
  }

  function addBladePoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const timestamp = performance.now();
    bladeTrail.push({ x, y, time: timestamp });
    trimBladeTrail(timestamp);
  }

  function trimBladeTrail(timestamp) {
    while (bladeTrail.length > 25) {
      bladeTrail.shift();
    }
    while (bladeTrail.length && timestamp - bladeTrail[0].time > bladePersistence) {
      bladeTrail.shift();
    }
  }

  function detectHits() {
    if (!running || bladeTrail.length < 2) {
      return;
    }

    const timestamp = performance.now();

    fruits.forEach((fruit) => {
      if (fruit.hitCooldown && timestamp < fruit.hitCooldown) {
        return;
      }

      const threshold = fruit.radius + 8;
      for (let i = 1; i < bladeTrail.length; i += 1) {
        const a = bladeTrail[i - 1];
        const b = bladeTrail[i];
        const distance = distanceToSegment(fruit.x, fruit.y, a.x, a.y, b.x, b.y);
        if (distance <= threshold) {
          resolveHit(fruit, b);
          fruit.hitCooldown = timestamp + 140;
          break;
        }
      }
    });
  }

  function resolveHit(fruit, impactPoint) {
    if (fruit.type === "bomb") {
      spawnShockwave(impactPoint.x, impactPoint.y, "rgba(255, 96, 96, 0.7)");
      handleGameOver("Bomb detonated!", true);
      return;
    }

    fruit.health -= 1;
    spawnJuiceBurst(fruit, impactPoint.x, impactPoint.y);

    if (fruit.health <= 0) {
      const index = fruits.indexOf(fruit);
      if (index >= 0) {
        fruits.splice(index, 1);
      }
      comboStreak += 1;
      comboTimer = 2200;
      const comboBonus = comboStreak > 1 ? Math.round(fruit.points * (comboStreak - 1) * 0.15) : 0;
      score += fruit.points + comboBonus;
      updateScore();
      updateCombo();
      spawnShockwave(fruit.x, fruit.y, fruit.glow);
    }
  }

  function spawnJuiceBurst(fruit, x, y) {
    const count = fruit.type === "mega" ? 28 : 16;
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (fruit.type === "mega" ? 8 : 6),
        vy: (Math.random() - 0.8) * (fruit.type === "mega" ? 8 : 6),
        life: 0,
        ttl: randomRange(280, 560),
        size: randomRange(3, 5),
        color: fruit.tintInner
      });
    }
  }

  function spawnShockwave(x, y, color) {
    particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0,
      ttl: 500,
      size: 0,
      color,
      ring: true
    });
  }

  function drawParticles() {
    particles.forEach((particle) => {
      const alpha = 1 - particle.life / particle.ttl;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      if (particle.ring) {
        const radius = (particle.life / particle.ttl) * 80 + 10;
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 2 + (1 - alpha) * 3;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function updateScore() {
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      updateBest();
      saveBestScore(best);
      syncLeaderboard("Fruit Ninja", best);
    }
  }

  function updateBest() {
    bestEl.textContent = String(best);
  }

  function updateCombo() {
    comboEl.textContent = `${comboStreak}×`;
  }

  function handleGameOver(reason, isBomb = false) {
    running = false;
    overlay.classList.add("visible");
    overlayTitle.textContent = reason;
    overlayDetail.textContent = `Score ${score} · Best ${best}`;
    overlayHint.textContent = isBomb
      ? "Bombs end the run instantly. Watch the fuse!"
      : "Tap the neon button or press Space to slice again.";
  }

  function loadBestScore() {
    const stored = Number.parseInt(localStorage.getItem(storageKey) ?? "0", 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  }

  function saveBestScore(value) {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch (error) {
      console.warn("Unable to persist best score", error);
    }
  }

  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randomPalette() {
    const palettes = [
      { inner: "#ff9bdc", outer: "#ff2e91", glow: "rgba(255, 46, 145, 0.9)" },
      { inner: "#9bfffb", outer: "#35f4ff", glow: "rgba(53, 244, 255, 0.9)" },
      { inner: "#ffe29b", outer: "#f7ff48", glow: "rgba(247, 255, 72, 0.85)" },
      { inner: "#c59bff", outer: "#8d35ff", glow: "rgba(141, 53, 255, 0.85)" },
      { inner: "#a5ff9b", outer: "#38ff6d", glow: "rgba(56, 255, 109, 0.85)" }
    ];
    return palettes[Math.floor(Math.random() * palettes.length)];
  }

  function randomSpawnDelay() {
    return randomRange(520, 1100);
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    let t = abLenSq === 0 ? 0 : (apx * abx + apy * aby) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = ax + abx * t;
    const closestY = ay + aby * t;
    const dx = px - closestX;
    const dy = py - closestY;
    return Math.hypot(dx, dy);
  }
});
