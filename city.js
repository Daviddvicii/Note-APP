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

  const config = {
    roadWidth: 260,
    laneCount: 3,
    carWidth: 40,
    carHeight: 70,
    enemyWidth: 40,
    enemyHeight: 70,
    baseSpeed: 140,
    maxSpeed: 280,
    accel: 80,
    friction: 100,
    enemySpawnBase: 1.2,
    enemySpawnMin: 0.4,
  };

  const state = {
    phase: "idle", // idle | running | paused | over
    score: 0,
    speed: 0,
    carX: 0,
    carY: 0,
    enemies: [],
    roadOffset: 0,
    lastTime: performance.now(),
    spawnTimer: 0,
  };

  const input = {
    left: false,
    right: false,
    up: false,
  };

  let hudCache = { score: "", speed: "" };

  init();

  function init() {
    initPositions();
    bindEvents();
    showOverlay("Press Space or Tap to Start");
    render();
    requestAnimationFrame(loop);
  }

  function initPositions() {
    state.speed = config.baseSpeed;
    state.score = 0;
    state.enemies = [];
    state.roadOffset = 0;
    state.spawnTimer = 0;

    const centerX = canvas.width / 2;
    state.carX = centerX;
    state.carY = canvas.height - 90;
    updateHud(true);
  }

  function resetGame() {
    state.phase = "idle";
    initPositions();
    showOverlay("Press Space or Tap to Start");
  }

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
    moveRoad(dt);
    updateEnemies(dt);
    spawnEnemies(dt);
    checkCollisions();
    state.score += state.speed * dt * 0.1;
  }

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

    const laneWidth = config.roadWidth / config.laneCount;
    const centerX = canvas.width / 2;
    const maxOffset = (config.roadWidth / 2) - laneWidth * 0.6;
    const lateralSpeed = 220;

    if (input.left) {
      state.carX -= lateralSpeed * dt;
    }
    if (input.right) {
      state.carX += lateralSpeed * dt;
    }

    const minX = centerX - maxOffset;
    const maxX = centerX + maxOffset;
    state.carX = clamp(state.carX, minX, maxX);
  }

  function moveRoad(dt) {
    state.roadOffset += state.speed * dt * 0.5;
    if (state.roadOffset > 40) {
      state.roadOffset -= 40;
    }
  }

  function updateEnemies(dt) {
    const speedFactor = state.speed / config.baseSpeed;
    state.enemies.forEach((e) => {
      e.y += e.speed * speedFactor * dt;
    });
    state.enemies = state.enemies.filter(
      (e) => e.y - config.enemyHeight < canvas.height
    );
  }

  function spawnEnemies(dt) {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;

    const laneWidth = config.roadWidth / config.laneCount;
    const centerX = canvas.width / 2;
    const left = centerX - config.roadWidth / 2;

    const lane = Math.floor(Math.random() * config.laneCount);
    const x = left + laneWidth * (lane + 0.5);
    const y = -config.enemyHeight;

    state.enemies.push({
      x,
      y,
      width: config.enemyWidth,
      height: config.enemyHeight,
      speed: config.baseSpeed * 1.1,
    });

    const speedRatio =
      (state.speed - config.baseSpeed) /
      (config.maxSpeed - config.baseSpeed);
    const spawnInterval =
      config.enemySpawnBase -
      (config.enemySpawnBase - config.enemySpawnMin) * clamp(speedRatio, 0, 1);

    state.spawnTimer = spawnInterval;
  }

  function checkCollisions() {
    const carRect = {
      x: state.carX - config.carWidth / 2,
      y: state.carY - config.carHeight / 2,
      width: config.carWidth,
      height: config.carHeight,
    };

    for (const e of state.enemies) {
      if (rectOverlap(carRect, e)) {
        gameOver();
        return;
      }
    }
  }

  function gameOver() {
    state.phase = "over";
    showOverlay(`Crashed! Score: ${Math.floor(state.score)}`);
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background
    ctx.fillStyle = "#020707";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawRoad();
    drawEnemies();
    drawCar();
  }

  function drawRoad() {
    const centerX = canvas.width / 2;
    const roadWidth = config.roadWidth;
    const left = centerX - roadWidth / 2;

    // grass
    ctx.fillStyle = "#021706";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // road
    ctx.fillStyle = "#041313";
    ctx.fillRect(left, 0, roadWidth, canvas.height);

    // lane lines
    const laneWidth = roadWidth / config.laneCount;
    ctx.strokeStyle = "rgba(200, 255, 200, 0.7)";
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 14]);
    ctx.lineDashOffset = -state.roadOffset;

    ctx.beginPath();
    for (let i = 1; i < config.laneCount; i++) {
      const x = left + laneWidth * i;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCar() {
    const w = config.carWidth;
    const h = config.carHeight;
    const x = state.carX;
    const y = state.carY;

    ctx.save();
    ctx.translate(x, y);

    // glow
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 18;

    // body
    ctx.fillStyle = "#39ff14";
    ctx.fillRect(-w / 2, -h / 2, w, h);

    // windshield
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#052610";
    ctx.fillRect(-w / 2 + 6, -h / 2 + 10, w - 12, 18);

    // headlights
    ctx.fillStyle = "#f7ffcc";
    ctx.fillRect(-w / 2 + 4, h / 2 - 10, 8, 6);
    ctx.fillRect(w / 2 - 12, h / 2 - 10, 8, 6);

    ctx.restore();
  }

  function drawEnemies() {
    ctx.save();
    ctx.shadowColor = "#ff477e";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ff477e";

    for (const e of state.enemies) {
      ctx.fillRect(
        e.x - e.width / 2,
        e.y - e.height / 2,
        e.width,
        e.height
      );

      // simple "windows"
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#330015";
      ctx.fillRect(
        e.x - e.width / 2 + 6,
        e.y - e.height / 2 + 10,
        e.width - 12,
        18
      );
      ctx.fillStyle = "#ff477e";
      ctx.shadowBlur = 16;
    }

    ctx.restore();
  }

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
      initPositions();
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

  // input

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
        if (state.phase === "idle") {
          startRun();
        } else if (state.phase === "paused") {
          resumeGame();
        } else if (state.phase === "over") {
          resetGame();
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
        resetGame();
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
        resetGame();
        startRun();
      }
    });
  }

  // Touch controls
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
            resetGame();
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

  // helpers

  function rectOverlap(a, b) {
    return !(
      a.x + a.width < b.x - b.width / 2 ||
      a.x > b.x + b.width / 2 ||
      a.y + a.height < b.y - b.height / 2 ||
      a.y > b.y + b.height / 2
    );
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }
})();
