(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayHint = document.getElementById("overlay-hint");
  const scoreEl = document.getElementById("score");
  const speedEl = document.getElementById("speed");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls?.querySelectorAll(".touch-btn") ?? [];

  // ---------- CONFIG ----------
  const config = {
    baseSpeed: 120,
    maxSpeed: 260,
    accel: 80,
    friction: 120,

    horizonY: canvas.height * 0.33,
    bottomY: canvas.height + 60,
    roadHalfTop: canvas.width * 0.08,
    roadHalfBottom: canvas.width * 0.45,

    laneOffsets: [-0.6, 0, 0.6],
    enemySpawnBase: 1.2,
    enemySpawnMin: 0.45,
    carWidthBase: 36,
    carHeightBase: 60,
    enemyWidthBase: 34,
    enemyHeightBase: 56
  };

  // ---------- STATE ----------
  const state = {
    phase: "idle", // idle | running | paused | over
    score: 0,
    speed: config.baseSpeed,
    playerOffset: 0, // -1..1 left/right in road
    enemies: [], // {offset, depth}
    roadOffset: 0,
    spawnTimer: 0,
    lastTime: performance.now()
  };

  const input = {
    left: false,
    right: false,
    up: false
  };

  const hudCache = {
    score: "",
    speed: ""
  };

  init();

  // ---------- INIT ----------
  function init() {
    resetRun();
    bindEvents();
    showOverlay("Press Space or Tap to Start");
    render();
    requestAnimationFrame(loop);
  }

  function resetRun() {
    state.score = 0;
    state.speed = config.baseSpeed;
    state.playerOffset = 0;
    state.enemies = [];
    state.roadOffset = 0;
    state.spawnTimer = 0;
    updateHud(true);
  }

  // ---------- MAIN LOOP ----------
  function loop(now) {
    const dt = Math.min((now - state.lastTime) / 1000, 0.05);
    state.lastTime = now;

    if (state.phase === "running") {
      update(dt);
    }

    render();
    updateHud();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    handleControls(dt);
    updateRoad(dt);
    updateEnemies(dt);
    spawnEnemies(dt);
    checkCollisions();
    state.score += state.speed * dt * 0.15;
  }

  // ---------- GAME LOGIC ----------
  function handleControls(dt) {
    // speed
    if (input.up) {
      state.speed = Math.min(
        state.speed + config.accel * dt,
        config.maxSpeed
      );
    } else {
      state.speed = Math.max(
        config.baseSpeed,
        state.speed - config.friction * dt
      );
    }

    // horizontal movement
    const moveSpeed = 1.6; // how fast offset changes
    if (input.left) state.playerOffset -= moveSpeed * dt;
    if (input.right) state.playerOffset += moveSpeed * dt;
    state.playerOffset = clamp(state.playerOffset, -1, 1);
  }

  function updateRoad(dt) {
    state.roadOffset += state.speed * dt * 0.0025;
    if (state.roadOffset > 1) state.roadOffset -= 1;
  }

  function updateEnemies(dt) {
    const speedFactor = state.speed / config.baseSpeed;
    state.enemies.forEach((e) => {
      e.depth += dt * 0.6 * speedFactor; // move towards camera
    });
    state.enemies = state.enemies.filter((e) => e.depth < 1.3);
  }

  function spawnEnemies(dt) {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;

    const lane =
      config.laneOffsets[Math.floor(Math.random() * config.laneOffsets.length)];
    state.enemies.push({
      offset: lane,
      depth: 0.1 + Math.random() * 0.2
    });

    const speedRatio =
      (state.speed - config.baseSpeed) /
      (config.maxSpeed - config.baseSpeed);
    const base = config.enemySpawnBase;
    const min = config.enemySpawnMin;
    const interval = base - (base - min) * clamp(speedRatio, 0, 1);
    state.spawnTimer = interval;
  }

  function checkCollisions() {
    // player considered at depth 1
    const playerDepth = 1;
    const hitDepth = 0.82;

    for (const e of state.enemies) {
      if (e.depth > hitDepth && e.depth < 1.15) {
        const dx = Math.abs(e.offset - state.playerOffset);
        if (dx < 0.3) {
          gameOver();
          return;
        }
      }
    }
  }

  function gameOver() {
    state.phase = "over";
    showOverlay(`Crashed! Score: ${Math.floor(state.score)}`);
  }

  // ---------- PROJECTION / DRAWING HELPERS ----------
  function project(depth, offset) {
    // depth: 0 (horizon) .. 1 (bottom)
    const y = lerp(config.horizonY, config.bottomY, depth);
    const halfWidth = lerp(config.roadHalfTop, config.roadHalfBottom, depth);
    const centerX = canvas.width / 2 + offset * halfWidth;
    return { x: centerX, y, halfWidth };
  }

  // ---------- RENDER ----------
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawSkyAndCity();
    drawRoad();
    drawEnemies();
    drawPlayer();
  }

  function drawSkyAndCity() {
    const h = canvas.height;
    const w = canvas.width;

    // sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, config.horizonY);
    skyGrad.addColorStop(0, "#03080f");
    skyGrad.addColorStop(1, "#02040a");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, config.horizonY);

    // ground
    const groundGrad = ctx.createLinearGradient(
      0,
      config.horizonY,
      0,
      h
    );
    groundGrad.addColorStop(0, "#021408");
    groundGrad.addColorStop(1, "#000000");
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, config.horizonY, w, h - config.horizonY);

    // neon buildings
    ctx.save();
    ctx.translate(0, config.horizonY - 30);
    ctx.fillStyle = "#031820";
    for (let i = 0; i < 14; i++) {
      const bw = 30 + Math.random() * 40;
      const bh = 20 + Math.random() * 40;
      const x = (i / 14) * w + (Math.random() - 0.5) * 20;
      ctx.fillRect(x, -bh, bw, bh);

      // windows
      ctx.fillStyle = "rgba(57,255,180,0.35)";
      for (let y = -bh + 4; y < -4; y += 8) {
        for (let xw = x + 4; xw < x + bw - 4; xw += 8) {
          if (Math.random() < 0.5) {
            ctx.fillRect(xw, y, 3, 3);
          }
        }
      }
      ctx.fillStyle = "#031820";
    }
    ctx.restore();
  }

  function drawRoad() {
    const segments = 22;
    const stripeSpacing = 0.08;
    ctx.save();

    // road body
    for (let i = 0; i < segments; i++) {
      const z1 = i / segments;
      const z2 = (i + 1) / segments;

      const p1 = project(z1, 0);
      const p2 = project(z2, 0);

      ctx.beginPath();
      // trapezoid for road from z1 to z2
      ctx.moveTo(p1.x - p1.halfWidth, p1.y);
      ctx.lineTo(p1.x + p1.halfWidth, p1.y);
      ctx.lineTo(p2.x + p2.halfWidth, p2.y);
      ctx.lineTo(p2.x - p2.halfWidth, p2.y);
      ctx.closePath();

      const shade = 0.03 + (i % 2) * 0.03;
      ctx.fillStyle = `rgba(0, 255, 80, ${0.14 + shade})`;
      ctx.fill();
    }

    // side “neon” rails
    for (let side of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const z = i / segments;
        const p = project(z, 0);
        const x = p.x + side * p.halfWidth;
        const y = p.y;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(57,255,120,0.9)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#39ff88";
      ctx.shadowBlur = 12;
      ctx.stroke();
    }

    // center lane stripes (animated)
    ctx.setLineDash([14, 20]);
    ctx.lineDashOffset = -state.roadOffset * 220;
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const z = i / segments;
      const p = project(z, 0);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(220,255,220,0.9)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#bfffdd";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  function drawPlayer() {
    const depth = 1;
    const proj = project(depth, state.playerOffset);
    const scale = depthScale(depth);

    const w = config.carWidthBase * scale;
    const h = config.carHeightBase * scale;
    const x = proj.x;
    const y = proj.y - h * 0.9; // slightly up from very bottom

    ctx.save();
    ctx.translate(x, y);

    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 20;

    // body
    ctx.fillStyle = "#39ff14";
    ctx.fillRect(-w / 2, -h / 2, w, h);

    ctx.shadowBlur = 0;

    // cockpit
    ctx.fillStyle = "#032010";
    ctx.fillRect(-w / 2 + 5, -h / 2 + 10, w - 10, h * 0.25);

    // rear engine glow
    ctx.fillStyle = "#ffdf6b";
    ctx.fillRect(-w / 2 + 6, h / 2 - 10, w - 12, 6);

    ctx.restore();
  }

  function drawEnemies() {
    state.enemies.forEach((e) => {
      const proj = project(e.depth, e.offset);
      const scale = depthScale(e.depth);

      const w = config.enemyWidthBase * scale;
      const h = config.enemyHeightBase * scale;
      const x = proj.x;
      const y = proj.y - h * 0.9;

      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = "#ff477e";
      ctx.shadowBlur = 18;

      ctx.fillStyle = "#ff477e";
      ctx.fillRect(-w / 2, -h / 2, w, h);

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#3a0212";
      ctx.fillRect(-w / 2 + 4, -h / 2 + 8, w - 8, h * 0.25);

      ctx.restore();
    });
  }

  function depthScale(depth) {
    // closer (depth -> 1) => larger
    return lerp(0.22, 1.1, clamp(depth, 0, 1));
  }

  // ---------- HUD ----------
  function updateHud(force = false) {
    if (!scoreEl || !speedEl) return;
    const scoreText = Math.floor(state.score).toString();
    const speedText = `${Math.round(state.speed)} km/h`;

    if (force || hudCache.score !== scoreText) {
      hudCache.score = scoreText;
      scoreEl.textContent = scoreText;
    }
    if (force || hudCache.speed !== speedText) {
      hudCache.speed = speedText;
      speedEl.textContent = speedText;
    }
  }

  // ---------- OVERLAY / PHASES ----------
  function showOverlay(message) {
    if (!overlay) return;
    if (overlayTitle) overlayTitle.textContent = message;

    if (overlayHint) {
      if (state.phase === "over") {
        overlayHint.textContent = "Press Space or Tap to restart";
      } else {
        overlayHint.textContent =
          "←/→ or A/D to steer · ↑/W to speed up · P pause · R restart";
      }
    }

    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  function startRun() {
    if (state.phase === "running") return;
    if (state.phase === "over") {
      resetRun();
    }
    state.phase = "running";
    state.lastTime = performance.now();
    hideOverlay();
  }

  function pauseGame() {
    if (state.phase !== "running") return;
    state.phase = "paused";
    showOverlay("Paused");
  }

  function resumeGame() {
    if (state.phase !== "paused") return;
    state.phase = "running";
    state.lastTime = performance.now();
    hideOverlay();
  }

  // ---------- INPUT ----------
  document.addEventListener("keydown", (e) => {
    const code = e.code;
    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        input.left = true;
        e.preventDefault();
        break;
      case "ArrowRight":
      case "KeyD":
        input.right = true;
        e.preventDefault();
        break;
      case "ArrowUp":
      case "KeyW":
        input.up = true;
        e.preventDefault();
        break;
      case "Space":
        e.preventDefault();
        if (state.phase === "idle") startRun();
        else if (state.phase === "paused") resumeGame();
        else if (state.phase === "over") {
          resetRun();
          startRun();
        }
        break;
      case "KeyP":
        e.preventDefault();
        if (state.phase === "running") pauseGame();
        else if (state.phase === "paused") resumeGame();
        break;
      case "KeyR":
        e.preventDefault();
        state.phase = "idle";
        resetRun();
        showOverlay("Press Space or Tap to Start");
        break;
      default:
        break;
    }
  });

  document.addEventListener("keyup", (e) => {
    const code = e.code;
    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        input.left = false;
        break;
      case "ArrowRight":
      case "KeyD":
        input.right = false;
        break;
      case "ArrowUp":
      case "KeyW":
        input.up = false;
        break;
      default:
        break;
    }
  });

  if (overlay) {
    overlay.addEventListener("click", () => {
      if (state.phase === "idle") startRun();
      else if (state.phase === "paused") resumeGame();
      else if (state.phase === "over") {
        resetRun();
        startRun();
      }
    });
  }

  // ---------- TOUCH ----------
  setupTouchControls();

  function setupTouchControls() {
    if (!touchControls || !touchButtons.length) return;

    const coarse = window.matchMedia
      ? window.matchMedia("(pointer: coarse)")
      : null;

    const updateAria = () => {
      const visible = coarse ? coarse.matches : false;
      touchControls.setAttribute("aria-hidden", visible ? "false" : "true");
    };
    updateAria();
    coarse?.addEventListener?.("change", updateAria);

    touchButtons.forEach((btn) => {
      const action = btn.getAttribute("data-action");
      if (!action) return;

      const set = (value) => {
        if (action === "left") input.left = value;
        if (action === "right") input.right = value;
        if (action === "up") input.up = value;

        if (value) {
          if (state.phase === "idle") startRun();
          else if (state.phase === "paused") resumeGame();
          else if (state.phase === "over") {
            resetRun();
            startRun();
          }
        }
      };

      const down = (ev) => {
        ev.preventDefault();
        btn.setPointerCapture?.(ev.pointerId);
        set(true);
      };

      const up = (ev) => {
        ev.preventDefault();
        btn.releasePointerCapture?.(ev.pointerId);
        set(false);
      };

      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointerleave", up);
      btn.addEventListener("pointercancel", up);
    });
  }

  // ---------- UTILS ----------
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
})();
