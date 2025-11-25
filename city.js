(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const speedEl = document.getElementById("speed");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons =
    touchControls?.querySelectorAll(".touch-btn") ?? [];

  // --- Game config ---
  const config = {
    roadTop: 0,
    roadBottom: canvas.height,
    laneCount: 3,
    laneWidth: canvas.width * 0.22, // road narrower than screen
    roadCenterX: canvas.width / 2,
    playerWidth: 34,
    playerHeight: 52,
    baseSpeed: 140, // px / s
    boostSpeed: 220,
    obstacleMinGap: 120,
    obstacleMaxGap: 220,
    obstacleWidth: 34,
    obstacleHeight: 52
  };

  // Precompute lane X positions (center of each lane)
  const roadWidth = config.laneWidth * config.laneCount;
  const roadLeft = config.roadCenterX - roadWidth / 2;
  const laneCenters = [];
  for (let i = 0; i < config.laneCount; i++) {
    const cx = roadLeft + config.laneWidth * (i + 0.5);
    laneCenters.push(cx);
  }

  const state = {
    phase: "idle", // idle | running | paused | crashed
    lastTime: performance.now(),
    score: 0,
    distance: 0,
    speed: 0,
    scrollOffset: 0,
    playerLane: 1, // 0 left, 1 mid, 2 right
    playerY: canvas.height - 80,
    obstacles: []
  };

  const input = {
    left: false,
    right: false,
    speed: false
  };

  const hudCache = { score: "", speed: "" };

  // --- Helpers ---

  function resetGame() {
    state.phase = "idle";
    state.score = 0;
    state.distance = 0;
    state.scrollOffset = 0;
    state.speed = 0;
    state.playerLane = 1;
    state.playerY = canvas.height - 80;
    state.obstacles = [];
    spawnObstacle();
    updateHud(true);
    showOverlay(
      "Press Space or Tap to Start",
      "←/→ steer · ↑/W speed up · P pause · R restart"
    );
  }

  function currentSpeed() {
    return input.speed ? config.boostSpeed : config.baseSpeed;
  }

  function laneToX(laneIndex) {
    return laneCenters[laneIndex] - config.playerWidth / 2;
  }

  function spawnObstacle() {
    const lane = Math.floor(Math.random() * config.laneCount);
    const y =
      -config.obstacleHeight -
      Math.random() *
        (config.obstacleMaxGap - config.obstacleMinGap) -
      config.obstacleMinGap;
    state.obstacles.push({ lane, y });
  }

  function showOverlay(title, hint) {
    if (!overlay) return;
    overlay.innerHTML =
      `${title}<span>${hint}</span>`;
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  function updateHud(force = false) {
    if (!scoreEl || !speedEl) return;
    const scoreText = Math.floor(state.score).toString();
    const speedText = `${Math.round(state.speed / 2)} km/h`;

    if (force || hudCache.score !== scoreText) {
      hudCache.score = scoreText;
      scoreEl.textContent = scoreText;
    }
    if (force || hudCache.speed !== speedText) {
      hudCache.speed = speedText;
      speedEl.textContent = speedText;
    }
  }

  // --- Input handling ---

  function handleKeyDown(e) {
    switch (e.code) {
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
        input.speed = true;
        e.preventDefault();
        break;
      case "Space":
        e.preventDefault();
        if (state.phase === "idle" || state.phase === "crashed") {
          startRun();
        } else if (state.phase === "paused") {
          resumeRun();
        }
        break;
      case "KeyP":
        e.preventDefault();
        if (state.phase === "running") pauseGame();
        else if (state.phase === "paused") resumeRun();
        break;
      case "KeyR":
        e.preventDefault();
        resetGame();
        break;
    }
  }

  function handleKeyUp(e) {
    switch (e.code) {
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
        input.speed = false;
        break;
    }
  }

  function setupTouchControls() {
    if (!touchControls) return;

    const press = (action, value) => {
      switch (action) {
        case "left":
          if (value) input.left = true;
          else input.left = false;
          break;
        case "right":
          if (value) input.right = true;
          else input.right = false;
          break;
        case "speed":
          input.speed = value;
          break;
      }

      if (value) {
        if (state.phase === "idle" || state.phase === "crashed") {
          startRun();
        } else if (state.phase === "paused") {
          resumeRun();
        }
      }
    };

    touchButtons.forEach((btn) => {
      const action = btn.getAttribute("data-action");
      if (!action) return;

      const down = (ev) => {
        ev.preventDefault();
        btn.setPointerCapture?.(ev.pointerId);
        press(action, true);
      };
      const up = (ev) => {
        ev.preventDefault();
        btn.releasePointerCapture?.(ev.pointerId);
        press(action, false);
      };

      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointerleave", up);
      btn.addEventListener("pointercancel", up);
    });

    // Touch controls visible on coarse pointers (mobile)
    const mq = window.matchMedia
      ? window.matchMedia("(pointer: coarse)")
      : null;
    const updateHidden = () => {
      const isCoarse = mq ? mq.matches : false;
      touchControls.setAttribute(
        "aria-hidden",
        isCoarse ? "false" : "true"
      );
    };
    updateHidden();
    if (mq?.addEventListener) mq.addEventListener("change", updateHidden);
    else if (mq?.addListener) mq.addListener(updateHidden);
  }

  function bindEvents() {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    overlay?.addEventListener("click", () => {
      if (state.phase === "idle" || state.phase === "crashed") {
        startRun();
      } else if (state.phase === "paused") {
        resumeRun();
      }
    });

    window.addEventListener("blur", () => {
      if (state.phase === "running") pauseGame();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.phase === "running") pauseGame();
    });

    setupTouchControls();
  }

  // --- Phase control ---

  function startRun() {
    hideOverlay();
    state.phase = "running";
    state.lastTime = performance.now();
  }

  function pauseGame() {
    state.phase = "paused";
    showOverlay("Paused", "Press Space or Tap to resume");
  }

  function resumeRun() {
    hideOverlay();
    state.phase = "running";
    state.lastTime = performance.now();
  }

  function crash() {
    state.phase = "crashed";
    showOverlay("Crashed!", "Press Space or R to try again");
  }

  // --- Update & render ---

  function update(dt) {
    // Handle lane changes (press = instant lane snap)
    if (input.left && !input.right) {
      if (state.playerLane > 0) {
        state.playerLane -= 1;
      }
      input.left = false; // avoid double-step
    } else if (input.right && !input.left) {
      if (state.playerLane < config.laneCount - 1) {
        state.playerLane += 1;
      }
      input.right = false;
    }

    state.speed = currentSpeed();
    state.distance += state.speed * dt;
    state.score = state.distance / 10;
    state.scrollOffset += state.speed * dt;

    // Move obstacles
    const speed = state.speed;
    for (const ob of state.obstacles) {
      ob.y += speed * dt * 0.9;
    }

    // Remove off-screen obstacles & spawn new ones
    state.obstacles = state.obstacles.filter((ob) => ob.y < canvas.height + 60);
    if (
      state.obstacles.length === 0 ||
      state.obstacles[state.obstacles.length - 1].y >
        config.obstacleMinGap
    ) {
      spawnObstacle();
    }

    // Collision check
    const playerX = laneToX(state.playerLane);
    const playerRect = {
      x: playerX,
      y: state.playerY,
      w: config.playerWidth,
      h: config.playerHeight
    };

    for (const ob of state.obstacles) {
      const ox = laneCenters[ob.lane] - config.obstacleWidth / 2;
      const oy = ob.y;
      const rect = {
        x: ox,
        y: oy,
        w: config.obstacleWidth,
        h: config.obstacleHeight
      };

      if (
        rect.x < playerRect.x + playerRect.w &&
        rect.x + rect.w > playerRect.x &&
        rect.y < playerRect.y + playerRect.h &&
        rect.y + rect.h > playerRect.y
      ) {
        crash();
        break;
      }
    }

    updateHud();
  }

  function drawRoad() {
    ctx.fillStyle = "#011309";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grass
    ctx.fillStyle = "#010903";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Asphalt
    ctx.fillStyle = "#031a0d";
    ctx.fillRect(
      roadLeft,
      config.roadTop,
      roadWidth,
      config.roadBottom - config.roadTop
    );

    // Lane lines
    ctx.strokeStyle = "rgba(57,255,20,0.4)";
    ctx.lineWidth = 2;
    const dashLength = 18;
    const gap = 14;
    for (let i = 1; i < config.laneCount; i++) {
      const x = roadLeft + config.laneWidth * i;
      let y = -((state.scrollOffset * 0.8) % (dashLength + gap));
      while (y < canvas.height) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + dashLength);
        ctx.stroke();
        y += dashLength + gap;
      }
    }
  }

  function drawObstacles() {
    for (const ob of state.obstacles) {
      const x = laneCenters[ob.lane] - config.obstacleWidth / 2;
      const y = ob.y;
      ctx.fillStyle = "#ff2a7f";
      ctx.shadowColor = "#ff2a7f";
      ctx.shadowBlur = 10;
      ctx.fillRect(x, y, config.obstacleWidth, config.obstacleHeight);
      ctx.shadowBlur = 0;
    }
  }

  function drawPlayer() {
    const x = laneToX(state.playerLane);
    const y = state.playerY;

    ctx.fillStyle = "#00ffb0";
    ctx.shadowColor = "#00ffb0";
    ctx.shadowBlur = 12;
    ctx.fillRect(x, y, config.playerWidth, config.playerHeight);
    ctx.shadowBlur = 0;

    // simple "windshield"
    ctx.fillStyle = "#011a15";
    ctx.fillRect(
      x + 5,
      y + 6,
      config.playerWidth - 10,
      config.playerHeight / 2 - 4
    );
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawRoad();
    drawObstacles();
    drawPlayer();
  }

  function loop(now) {
    const dt = Math.min((now - state.lastTime) / 1000, 0.05);
    state.lastTime = now;

    if (state.phase === "running") {
      update(dt);
    }

    render();
    requestAnimationFrame(loop);
  }

  // --- init ---
  resetGame();
  bindEvents();
  requestAnimationFrame(loop);
})();
