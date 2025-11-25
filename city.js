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

  // --- CONFIG ----------------------------------------------------

  const config = {
    roadTop: 0,
    roadBottom: canvas.height,
    laneCount: 3,
    laneWidth: canvas.width * 0.22, // road narrower than screen

    playerWidth: 34,
    playerHeight: 52,

    // SPEED MODEL (px / s)
    baseSpeedPx: 110,   // slow cruising
    maxSpeedPx: 450,    // max speed
    speedToKmh: 1.0,    // 450 px/s -> 450 km/h

    accelPx: 200,       // acceleration

    obstacleMinGap: 120,
    obstacleMaxGap: 220,

    obstacleWidth: 34,
    obstacleHeight: 52
  };

  // ROAD GEOMETRY -------------------------------------------------

  const roadWidth = config.laneWidth * config.laneCount;
  const roadCenterX = canvas.width / 2;
  const roadLeft = roadCenterX - roadWidth / 2;
  const roadRight = roadLeft + roadWidth;

  const laneCenters = [];
  for (let i = 0; i < config.laneCount; i++) {
    const cx = roadLeft + config.laneWidth * (i + 0.5);
    laneCenters.push(cx);
  }

  // TRAFFIC VEHICLES ----------------------------------------------

  const VEHICLES = [
    {
      name: "car",
      w: config.obstacleWidth,
      h: config.obstacleHeight,
      color: "#ff2a7f"
    },
    {
      name: "truck",
      w: config.obstacleWidth + 12,
      h: config.obstacleHeight + 26,
      color: "#ffd54f"
    },
    {
      name: "bike",
      w: config.obstacleWidth - 12,
      h: config.obstacleHeight - 18,
      color: "#80deea"
    },
    {
      name: "taxi",
      w: config.obstacleWidth + 4,
      h: config.obstacleHeight,
      color: "#ffeb3b"
    }
  ];

  // --- STATE -----------------------------------------------------

  const state = {
    phase: "idle",            // idle | running | paused | crashed
    lastTime: performance.now(),

    score: 0,
    distance: 0,
    speed: 0,                 // px/s
    scrollOffset: 0,

    playerLane: 1,            // 0 left, 1 middle, 2 right
    playerY: canvas.height - 70, // a bit lower for more road view

    obstacles: []
  };

  const input = {
    left: false,
    right: false,
    speed: false
  };

  const hudCache = {
    score: "",
    speed: ""
  };

  // --- HELPERS ---------------------------------------------------

  function laneToX(laneIndex) {
    return laneCenters[laneIndex] - config.playerWidth / 2;
  }

  function spawnObstacle() {
    const lane = Math.floor(Math.random() * config.laneCount);
    const v = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];

    const y =
      -v.h -
      Math.random() *
        (config.obstacleMaxGap - config.obstacleMinGap) -
      config.obstacleMinGap;

    state.obstacles.push({
      lane,
      y,
      w: v.w,
      h: v.h,
      color: v.color
    });
  }

  function showOverlay(title, hint) {
    if (!overlay) return;
    overlay.innerHTML = `${title}<span>${hint}</span>`;
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
    const speedText = `${Math.round(
      state.speed * config.speedToKmh
    )} km/h`; // goes up to 450

    if (force || hudCache.score !== scoreText) {
      hudCache.score = scoreText;
      scoreEl.textContent = scoreText;
    }
    if (force || hudCache.speed !== speedText) {
      hudCache.speed = speedText;
      speedEl.textContent = speedText;
    }
  }

  function resetGame() {
    state.phase = "idle";
    state.score = 0;
    state.distance = 0;
    state.scrollOffset = 0;
    state.speed = config.baseSpeedPx;
    state.playerLane = 1;
    state.playerY = canvas.height - 70;
    state.obstacles = [];
    spawnObstacle();
    updateHud(true);
    showOverlay(
      "Press Space or Tap to Start",
      "←/→ steer · ↑/W speed up · P pause · R restart"
    );
  }

  // --- INPUT -----------------------------------------------------

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
          input.left = value;
          break;
        case "right":
          input.right = value;
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

  // --- PHASE CONTROL ---------------------------------------------

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

  // --- UPDATE & RENDER -------------------------------------------

  function update(dt) {
    // lane stepping (one lane per tap/press)
    if (input.left && !input.right) {
      if (state.playerLane > 0) state.playerLane -= 1;
      input.left = false;
    } else if (input.right && !input.left) {
      if (state.playerLane < config.laneCount - 1) state.playerLane += 1;
      input.right = false;
    }

    // smooth speed up / down
    const target = input.speed
      ? config.maxSpeedPx
      : config.baseSpeedPx;

    if (state.speed < target) {
      state.speed = Math.min(
        target,
        state.speed + config.accelPx * dt
      );
    } else if (state.speed > target) {
      state.speed = Math.max(
        target,
        state.speed - config.accelPx * dt
      );
    }

    // distance + score
    state.distance += state.speed * dt;
    state.score = state.distance / 6; // faster score gain

    // world scroll: HEAVILY scaled by speed for strong motion
    // higher factor = more visual speed
    state.scrollOffset += state.speed * dt * 4.0;

    // move obstacles – scaled up too
    for (const ob of state.obstacles) {
      ob.y += state.speed * dt * 3.2;
    }

    // clean up off-screen obstacles
    state.obstacles = state.obstacles.filter(
      (ob) => ob.y < canvas.height + 100
    );

    // spawn new traffic depending on speed (denser when faster)
    const lastY =
      state.obstacles.length > 0
        ? state.obstacles[state.obstacles.length - 1].y
        : canvas.height;

    const gapBase = config.obstacleMinGap;
    const speedFactor = 1 + state.speed / config.maxSpeedPx; // 1 ~ 2
    const dynamicGap = gapBase / speedFactor; // smaller gap at high speed

    if (state.obstacles.length === 0 || lastY > dynamicGap) {
      spawnObstacle();
    }

    // collision detection
    const playerX = laneToX(state.playerLane);
    const playerRect = {
      x: playerX,
      y: state.playerY,
      w: config.playerWidth,
      h: config.playerHeight
    };

    for (const ob of state.obstacles) {
      const laneCenter = laneCenters[ob.lane];
      const ox = laneCenter - ob.w / 2;
      const oy = ob.y;
      const rect = { x: ox, y: oy, w: ob.w, h: ob.h };

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

  function drawBuildings() {
    const bandH = 60; // shorter bands = more parallax
    const offset = (state.scrollOffset * 1.4) % bandH; // strong speed tie
    let y = -bandH + offset;

    while (y < canvas.height + bandH) {
      // left block
      ctx.fillStyle = "#020f09";
      ctx.fillRect(0, y + 4, roadLeft - 6, bandH - 8);

      // right block
      ctx.fillRect(
        roadRight + 6,
        y + 4,
        canvas.width - roadRight - 6,
        bandH - 8
      );

      // neon windows
      ctx.fillStyle = "rgba(57,255,20,0.45)";
      const windowW = 6;
      const windowH = 8;

      for (let wx = 6; wx < roadLeft - 12; wx += 14) {
        ctx.fillRect(wx, y + 8, windowW, windowH);
        ctx.fillRect(wx + 4, y + 20, windowW, windowH);
      }

      ctx.fillStyle = "rgba(21,199,159,0.45)";
      for (let wx = roadRight + 10; wx < canvas.width - 10; wx += 16) {
        ctx.fillRect(wx, y + 10, windowW, windowH);
        ctx.fillRect(wx + 5, y + 24, windowW, windowH);
      }

      y += bandH;
    }
  }

  function drawRoad() {
    // base background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // city buildings on both sides
    drawBuildings();

    // asphalt
    ctx.fillStyle = "#031a0d";
    ctx.fillRect(
      roadLeft,
      config.roadTop,
      roadWidth,
      config.roadBottom - config.roadTop
    );

    // lane lines (moving DOWN with strong factor)
    ctx.strokeStyle = "rgba(57,255,20,0.6)";
    ctx.lineWidth = 2;
    const dashLength = 18;
    const gap = 14;
    const period = dashLength + gap;
    const offset = (state.scrollOffset * 2.2) % period; // more aggressive move
    for (let i = 1; i < config.laneCount; i++) {
      const x = roadLeft + config.laneWidth * i;
      let y = -dashLength + offset;
      while (y < canvas.height) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + dashLength);
        ctx.stroke();
        y += period;
      }
    }

    // subtle road texture stripes (help speed feel)
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    const stripeGap = 18;
    const textureOffset = (state.scrollOffset * 1.8) % stripeGap;
    let ty = -stripeGap + textureOffset;
    while (ty < canvas.height) {
      ctx.beginPath();
      ctx.moveTo(roadLeft + 4, ty);
      ctx.lineTo(roadRight - 4, ty);
      ctx.stroke();
      ty += stripeGap;
    }
  }

  function drawObstacles() {
    for (const ob of state.obstacles) {
      const laneCenter = laneCenters[ob.lane];
      const x = laneCenter - ob.w / 2;
      const y = ob.y;

      ctx.fillStyle = ob.color;
      ctx.shadowColor = ob.color;
      ctx.shadowBlur = 10;
      ctx.fillRect(x, y, ob.w, ob.h);
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

    // windshield
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

  // --- INIT ------------------------------------------------------

  resetGame();
  bindEvents();
  requestAnimationFrame(loop);
})();
