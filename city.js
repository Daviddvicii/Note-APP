(() => {
  // Map representation: 0 = grass, 1 = road, 2 = building/wall.
  const config = {
    canvasWidth: 400,
    canvasHeight: 225,
    tileSize: 16,
    mapWidth: 60,
    mapHeight: 60,
    checkpointRadius: 24,
    pxToKmh: 0.24,
  };

  const keyToAction = {
    ArrowUp: "accelerate",
    KeyW: "accelerate",
    ArrowDown: "brake",
    KeyS: "brake",
    ArrowLeft: "steerLeft",
    KeyA: "steerLeft",
    ArrowRight: "steerRight",
    KeyD: "steerRight",
    Space: "handbrake",
  };

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const scoreEl = document.getElementById("score");
  const missionEl = document.getElementById("mission");
  const speedEl = document.getElementById("speed");

  // Input booleans shared between keyboard and touch controls.
  const inputState = {
    accelerate: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  const canvas = document.getElementById("game-canvas");
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayHint = document.getElementById("overlay-hint");
  const scoreEl = document.getElementById("score");
  const missionEl = document.getElementById("mission");
  const speedEl = document.getElementById("speed");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls?.querySelectorAll(".touch-btn") ?? [];
  const coarseMediaQuery = window.matchMedia
    ? window.matchMedia("(pointer: coarse)")
    : null;

  // Map representation: 0 = grass, 1 = road, 2 = building (solid).
  const tileTypes = { GRASS: 0, ROAD: 1, BUILDING: 2 };
  const defaultMission = "Drive to the glowing checkpoint";
  const overlayHintText =
    "Arrow keys or WASD to drive · Space handbrake · P pause · R restart";
  const pausedMessage = "Paused - Press Space or Tap to resume";

  const config = {
    mapWidth: 60,
    mapHeight: 60,
    tileSize: 16,
    checkpointRadius: 24,
    minCheckpointDistance: 220,
    pxToKmh: 0.36,
    cameraLerp: 6,
    roadSpacing: 8,
    bgColor: "#010c0a",
  };

  const state = {
    world: [],
    roadTiles: [],
    car: null,
    checkpoint: null,
    cameraX: 0,
    cameraY: 0,
    score: 0,
    missionText: "Drive to the glowing checkpoint",
    missionTimer: 0,
    phase: "idle",
    lastTime: 0,
  };

  // Kick off initialization once the DOM is ready.
  init();
  requestAnimationFrame(loop);

  function init() {
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    regenerateWorld();
    resetRunState();
    bindEvents();
    showOverlay("Press Space or Tap to Start");
  }

  function regenerateWorld() {
    const { grid, roads } = generateWorld();
    state.world = grid;
    state.roadTiles = roads;
  }

  function resetRunState() {
    state.car = createCar();
    state.cameraX = state.car.x;
    state.cameraY = state.car.y;
    state.score = 0;
    state.missionTimer = 0;
    state.phase = "idle";
    state.lastTime = 0;
    state.checkpoint = pickCheckpoint();
    Object.keys(inputState).forEach((key) => {
      inputState[key] = false;
    });
    setMission("Drive to the glowing checkpoint");
    updateScore();
    updateSpeedHud();
  }

  function createCar() {
    const spawnTile = findSpawnTile();
    const baseX = spawnTile ? tileToWorld(spawnTile.x) : config.mapWidth * config.tileSize * 0.5;
    const baseY = spawnTile ? tileToWorld(spawnTile.y) : config.mapHeight * config.tileSize * 0.5;
    return {
      x: baseX,
      y: baseY,
      angle: 0,
      speed: 0,
      width: 26,
      height: 12,
      radius: 8,
    car: {
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      maxSpeed: 140,
      accel: 220,
      friction: 140,
      turnSpeed: 2.6,
    };
  }

  function bindEvents() {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    overlay.addEventListener("click", handleOverlayActivate);
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOverlayActivate();
      }
    });
    window.addEventListener("blur", () => {
      if (state.phase === "running") {
        pauseGame();
      }
    });
    setupTouchControls();
  }

  function setupTouchControls() {
    // Each on-screen button simply toggles the same input booleans.
    const buttons = document.querySelectorAll(".touch-btn");
    buttons.forEach((button) => {
      const action = button.dataset.action;
      if (!action) {
        return;
      }

      const setActive = (active) => {
        setInputAction(action, active);
        button.classList.toggle("active", active);
      };

      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        setActive(true);
      });

      const cancel = (event) => {
        event.preventDefault();
        if (event.pointerId && button.hasPointerCapture?.(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
        setActive(false);
      };

      button.addEventListener("pointerup", cancel);
      button.addEventListener("pointerleave", cancel);
      button.addEventListener("pointercancel", cancel);
      button.addEventListener("lostpointercapture", cancel);
    });
  }

  function handleOverlayActivate() {
    if (state.phase === "idle") {
      startGame();
    } else if (state.phase === "paused") {
      resumeGame();
    }
  }

  function handleKeyDown(event) {
    if (event.code === "KeyP") {
      event.preventDefault();
      if (state.phase === "running") {
        pauseGame();
      } else if (state.phase === "paused") {
        resumeGame();
      }
      return;
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      regenerateWorld();
      resetRunState();
      showOverlay("Press Space or Tap to Start");
      return;
    }

    if (event.code === "Space" && (state.phase === "idle" || state.phase === "paused")) {
      event.preventDefault();
      startGame();
      return;
    }

    const action = keyToAction[event.code];
    if (action) {
      event.preventDefault();
      setInputAction(action, true);
    }
  }

  function handleKeyUp(event) {
    const action = keyToAction[event.code];
    if (action) {
      event.preventDefault();
      setInputAction(action, false);
    }
  }

  function setInputAction(action, value) {
    switch (action) {
      case "accelerate":
        inputState.accelerate = value;
        break;
      case "brake":
        inputState.brake = value;
        break;
      case "steerLeft":
        inputState.steerLeft = value;
        break;
      case "steerRight":
        inputState.steerRight = value;
        break;
      case "handbrake":
        inputState.handbrake = value;
        break;
      default:
        break;
    }
  }

  function startGame() {
    state.phase = "running";
    state.lastTime = 0;
    hideOverlay();
  }

  function pauseGame() {
    state.phase = "paused";
    state.lastTime = 0;
    showOverlay("Paused – Tap to Resume");
  }

  function resumeGame() {
    state.phase = "running";
    state.lastTime = 0;
    hideOverlay();
  }

  function showOverlay(message) {
    if (overlayTitle) {
      overlayTitle.textContent = message;
    }
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  function loop(timestamp) {
    if (!state.lastTime) {
      state.lastTime = timestamp;
      requestAnimationFrame(loop);
      return;
    }

    let dt = (timestamp - state.lastTime) / 1000;
    state.lastTime = timestamp;
    dt = Math.min(dt, 0.12);

    if (state.phase === "running") {
      update(dt);
    }

    render();
      handbrake: 420,
      collisionRadius: 11,
    },
    checkpoint: { x: 0, y: 0, radius: 24 },
    score: 0,
    missionText: defaultMission,
    cameraX: 0,
    cameraY: 0,
    spawn: { x: 0, y: 0 },
  };

  const inputState = {
    accelerate: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  };

  const hudCache = {
    score: "",
    mission: "",
    speed: "",
  };

  let phase = "idle"; // idle | running | paused
  let lastTime = performance.now();
  let missionResetTimer = null;

  init();

  function init() {
    buildWorld();
    resetGame();
    bindEvents();
    updateHud(true);
    render();
    requestAnimationFrame(loop);
  }

  function buildWorld() {
    state.world = [];
    state.roadTiles = [];
    const spacing = config.roadSpacing;

    for (let y = 0; y < config.mapHeight; y += 1) {
      const row = [];
      for (let x = 0; x < config.mapWidth; x += 1) {
        const modX = x % spacing;
        const modY = y % spacing;
        const isRoadColumn = modX === 3 || modX === 4;
        const isRoadRow = modY === 3 || modY === 4;
        let tile = tileTypes.GRASS;

        if (isRoadColumn || isRoadRow || (x - y) % 15 === 0) {
          tile = tileTypes.ROAD;
          state.roadTiles.push({ x, y });
        } else if (
          modX >= 1 &&
          modX <= spacing - 2 &&
          modY >= 1 &&
          modY <= spacing - 2
        ) {
          tile = tileTypes.BUILDING;
        }

        row.push(tile);
      }
      state.world.push(row);
    }
  }

  function resetGame() {
    if (missionResetTimer) {
      clearTimeout(missionResetTimer);
      missionResetTimer = null;
    }
    const spawnTile = findSpawnTile();
    const spawnPoint = tileToWorld(spawnTile);
    state.spawn = { ...spawnPoint };
    state.car.x = spawnPoint.x;
    state.car.y = spawnPoint.y;
    state.car.angle = 0;
    state.car.speed = 0;
    state.cameraX = state.car.x;
    state.cameraY = state.car.y;
    state.score = 0;
    setMission(defaultMission);
    state.checkpoint = pickCheckpoint(true);
    phase = "idle";
    showOverlay("Press Space or Tap to Start", overlayHintText);
    updateHud(true);
  }

  function findSpawnTile() {
    if (!state.roadTiles.length) {
      return { x: 0, y: 0 };
    }
    const centerX = Math.floor(config.mapWidth / 2);
    const centerY = Math.floor(config.mapHeight / 2);
    let best = state.roadTiles[0];
    let bestDist = Infinity;
    for (const tile of state.roadTiles) {
      const dx = tile.x - centerX;
      const dy = tile.y - centerY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = tile;
      }
    }
    return best;
  }

  function pickCheckpoint(forceFar = false) {
    if (!state.roadTiles.length) {
      return { ...state.spawn, radius: config.checkpointRadius };
    }
    const attempts = forceFar ? 400 : 200;
    const requiredDistance = forceFar
      ? config.minCheckpointDistance
      : config.minCheckpointDistance * 0.6;

    for (let i = 0; i < attempts; i += 1) {
      const tile =
        state.roadTiles[Math.floor(Math.random() * state.roadTiles.length)];
      const candidate = tileToWorld(tile);
      const dx = candidate.x - state.car.x;
      const dy = candidate.y - state.car.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= requiredDistance) {
        return { x: candidate.x, y: candidate.y, radius: config.checkpointRadius };
      }
    }
    const fallback = tileToWorld(
      state.roadTiles[Math.floor(Math.random() * state.roadTiles.length)]
    );
    return { x: fallback.x, y: fallback.y, radius: config.checkpointRadius };
  }

  function loop(now) {
    const delta = now - lastTime;
    const dt = Math.min(delta / 1000, 0.12);
    lastTime = now;

    if (phase === "running") {
      update(dt);
    } else {
      updateCamera(dt);
    }

    render();
    updateHud();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    const car = state.car;
    if (!car) {
      return;
    }

    handleAcceleration(car, dt);
    handleSteering(car, dt);
    moveCar(car, dt);
    updateCamera(car, dt);
    updateCheckpoint(car);
    tickMissionTimer(dt);
    updateSpeedHud();
  }

  // Car physics: basic acceleration, braking, friction, and a handbrake assist.
  function handleAcceleration(car, dt) {
    if (inputState.accelerate) {
      car.speed = Math.min(car.maxSpeed, car.speed + car.accel * dt);
    } else if (inputState.brake) {
      car.speed = Math.max(-car.maxSpeed * 0.35, car.speed - car.accel * dt);
    } else {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - car.friction * dt);
      } else if (car.speed < 0) {
        car.speed = Math.min(0, car.speed + car.friction * dt);
      }
    }

    if (inputState.handbrake) {
      car.speed *= Math.max(0, 1 - dt * 8);
      if (Math.abs(car.speed) < 4) {
        car.speed = 0;
      }
    }
  }

  // Steering rate scales with speed so turns feel stable at low speeds.
  function handleSteering(car, dt) {
    const steerLeft = inputState.steerLeft ? 1 : 0;
    const steerRight = inputState.steerRight ? 1 : 0;
    const steerDirection = steerRight - steerLeft;
    if (steerDirection === 0) {
      return;
    }

    const speedFactor = Math.min(1, Math.abs(car.speed) / car.maxSpeed + 0.2);
    if (Math.abs(car.speed) > 4) {
      car.angle += steerDirection * car.turnSpeed * dt * speedFactor * Math.sign(car.speed || 1);
    }
  }

  function moveCar(car, dt) {
    const prevX = car.x;
    const prevY = car.y;
    const nextX = car.x + Math.cos(car.angle) * car.speed * dt;
    const nextY = car.y + Math.sin(car.angle) * car.speed * dt;

    if (collidesWithWorld(nextX, nextY, car.radius)) {
      car.x = prevX;
      car.y = prevY;
      car.speed *= -0.25;
    } else {
      car.x = nextX;
      car.y = nextY;
    }
  }

  // Camera follows the car with gentle smoothing and clamps near the map edges.
  function updateCamera(car, dt) {
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;
    const worldWidth = config.mapWidth * config.tileSize;
    const worldHeight = config.mapHeight * config.tileSize;
    const targetX = clamp(car.x, halfW, worldWidth - halfW);
    const targetY = clamp(car.y, halfH, worldHeight - halfH);
    const smooth = Math.min(1, dt * 6);
    state.cameraX += (targetX - state.cameraX) * smooth;
    state.cameraY += (targetY - state.cameraY) * smooth;
  }

  // Mission loop: reach the neon checkpoint to earn points and spawn a new target.
  function updateCheckpoint(car) {
    if (!state.checkpoint) {
      return;
    }
    const dx = car.x - state.checkpoint.x;
    const dy = car.y - state.checkpoint.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= state.checkpoint.radius + car.radius) {
      state.score += 100;
      updateScore();
      setMission("New destination set!", 3);
      state.checkpoint = pickCheckpoint();
    }
  }

  function tickMissionTimer(dt) {
    if (state.missionTimer > 0) {
      state.missionTimer -= dt;
      if (state.missionTimer <= 0) {
        setMission("Drive to the glowing checkpoint");
      }
    }
  }

  function updateScore() {
    scoreEl.textContent = state.score;
  }

  function setMission(text, durationSeconds = 0) {
    state.missionText = text;
    state.missionTimer = durationSeconds;
    missionEl.textContent = text;
  }

  function updateSpeedHud() {
    const speed = Math.max(0, Math.abs(state.car?.speed || 0));
    const kmh = Math.round(speed * config.pxToKmh);
    speedEl.textContent = `${kmh} km/h`;
  }

  function render() {
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWorld();
    applyControls(dt);
    moveCar(dt);
    resolveCollisions();
    handleCheckpoint();
    updateCamera(dt);
  }

  // Car physics: acceleration, braking, friction, and steering torque.
  function applyControls(dt) {
    const car = state.car;

    if (inputState.accelerate) {
      car.speed = Math.min(car.speed + car.accel * dt, car.maxSpeed);
    }

    if (inputState.brake) {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - car.accel * 1.2 * dt);
      } else {
        car.speed = Math.max(-car.maxSpeed * 0.4, car.speed - car.accel * 0.6 * dt);
      }
    }

    if (!inputState.accelerate && !inputState.brake) {
      applyFriction(dt);
    }

    if (inputState.handbrake && Math.abs(car.speed) > 2) {
      const drag = car.handbrake * dt;
      car.speed += car.speed > 0 ? -drag : drag;
      if (Math.abs(car.speed) < 6) {
        car.speed = 0;
      }
    }

    const steerDir =
      (inputState.steerLeft ? -1 : 0) + (inputState.steerRight ? 1 : 0);
    if (steerDir !== 0 && Math.abs(car.speed) > 5) {
      const turnFactor = Math.min(Math.abs(car.speed) / car.maxSpeed, 1);
      car.angle += steerDir * car.turnSpeed * turnFactor * dt;
    }
    wrapAngle();
  }

  function applyFriction(dt) {
    const car = state.car;
    if (car.speed > 0) {
      car.speed = Math.max(0, car.speed - car.friction * dt);
    } else if (car.speed < 0) {
      car.speed = Math.min(0, car.speed + car.friction * dt);
    }
  }

  function wrapAngle() {
    const car = state.car;
    if (car.angle > Math.PI) {
      car.angle -= Math.PI * 2;
    } else if (car.angle < -Math.PI) {
      car.angle += Math.PI * 2;
    }
  }

  function moveCar(dt) {
    const car = state.car;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
  }

  // Check nearby tiles and push the car out of building blocks.
  function resolveCollisions() {
    const car = state.car;
    const radius = car.collisionRadius;
    const minTileX = Math.max(
      0,
      Math.floor((car.x - radius) / config.tileSize)
    );
    const maxTileX = Math.min(
      config.mapWidth - 1,
      Math.floor((car.x + radius) / config.tileSize)
    );
    const minTileY = Math.max(
      0,
      Math.floor((car.y - radius) / config.tileSize)
    );
    const maxTileY = Math.min(
      config.mapHeight - 1,
      Math.floor((car.y + radius) / config.tileSize)
    );

    for (let ty = minTileY; ty <= maxTileY; ty += 1) {
      for (let tx = minTileX; tx <= maxTileX; tx += 1) {
        if (state.world[ty][tx] !== tileTypes.BUILDING) {
          continue;
        }
        const rectX = tx * config.tileSize;
        const rectY = ty * config.tileSize;
        const closestX = clamp(car.x, rectX, rectX + config.tileSize);
        const closestY = clamp(car.y, rectY, rectY + config.tileSize);
        const dx = car.x - closestX;
        const dy = car.y - closestY;
        const distSq = dx * dx + dy * dy;
        if (distSq < radius * radius && distSq !== 0) {
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          car.x += (dx / dist) * overlap;
          car.y += (dy / dist) * overlap;
          car.speed *= -0.25;
        } else if (distSq === 0) {
          car.x += 0.1;
          car.y += 0.1;
          car.speed = 0;
        }
      }
    }

    const maxX = config.mapWidth * config.tileSize - radius;
    const maxY = config.mapHeight * config.tileSize - radius;
    car.x = clamp(car.x, radius, maxX);
    car.y = clamp(car.y, radius, maxY);
  }

  // Mission loop: grab a checkpoint, award score, and pick a new destination.
  function handleCheckpoint() {
    const cp = state.checkpoint;
    const dx = state.car.x - cp.x;
    const dy = state.car.y - cp.y;
    if (dx * dx + dy * dy <= cp.radius * cp.radius) {
      state.score += 100;
      state.checkpoint = pickCheckpoint(true);
      setMission("New destination set! Keep cruising.", true);
      updateHud(true);
    }
  }

  // Camera lerps toward the car so the CRT shell feels smooth.
  function updateCamera(dt) {
    const lerp = Math.min(1, config.cameraLerp * dt);
    state.cameraX += (state.car.x - state.cameraX) * lerp;
    state.cameraY += (state.car.y - state.cameraY) * lerp;
  }

  function render() {
    ctx.fillStyle = config.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTiles();
    drawCheckpoint();
    drawCar();
  }

  function drawWorld() {
  function drawTiles() {
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;
    const startX = Math.floor((state.cameraX - halfW) / config.tileSize) - 1;
    const endX = Math.floor((state.cameraX + halfW) / config.tileSize) + 1;
    const startY = Math.floor((state.cameraY - halfH) / config.tileSize) - 1;
    const endY = Math.floor((state.cameraY + halfH) / config.tileSize) + 1;

    for (let tileY = startY; tileY <= endY; tileY += 1) {
      for (let tileX = startX; tileX <= endX; tileX += 1) {
        const tile = getTile(tileX, tileY);
        const worldX = tileX * config.tileSize;
        const worldY = tileY * config.tileSize;
        const screenX = worldX - state.cameraX + halfW;
        const screenY = worldY - state.cameraY + halfH;

        if (tile === 1) {
          ctx.fillStyle = "#0b3021";
          ctx.fillRect(screenX, screenY, config.tileSize, config.tileSize);
          ctx.fillStyle = "rgba(57, 255, 20, 0.15)";
          if ((tileX + tileY) % 2 === 0) {
            ctx.fillRect(screenX + config.tileSize / 2 - 1, screenY, 2, config.tileSize);
          }
        } else if (tile === 2) {
          ctx.save();
          ctx.fillStyle = "#082536";
          ctx.shadowColor = "rgba(57, 255, 20, 0.4)";
          ctx.shadowBlur = 6;
          ctx.fillRect(screenX, screenY, config.tileSize, config.tileSize);
          ctx.restore();
        } else {
          ctx.fillStyle = "#02150d";
          ctx.fillRect(screenX, screenY, config.tileSize, config.tileSize);
    for (let y = startY; y <= endY; y += 1) {
      if (y < 0 || y >= config.mapHeight) continue;
      const row = state.world[y];
      for (let x = startX; x <= endX; x += 1) {
        if (x < 0 || x >= config.mapWidth) continue;
        const tile = row[x];
        const worldX = x * config.tileSize;
        const worldY = y * config.tileSize;
        const screenX = Math.round(worldX - state.cameraX + canvas.width / 2);
        const screenY = Math.round(worldY - state.cameraY + canvas.height / 2);

        if (tile === tileTypes.GRASS) {
          ctx.fillStyle = "#03130d";
          ctx.fillRect(screenX, screenY, config.tileSize + 1, config.tileSize + 1);
        } else if (tile === tileTypes.ROAD) {
          ctx.fillStyle = "#06271a";
          ctx.fillRect(screenX, screenY, config.tileSize + 1, config.tileSize + 1);
          ctx.strokeStyle = "rgba(57, 255, 182, 0.15)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(screenX + config.tileSize / 2, screenY + 2);
          ctx.lineTo(
            screenX + config.tileSize / 2,
            screenY + config.tileSize - 2
          );
          ctx.stroke();
        } else if (tile === tileTypes.BUILDING) {
          ctx.fillStyle = "#0a1f1a";
          ctx.fillRect(screenX, screenY, config.tileSize + 1, config.tileSize + 1);
          ctx.strokeStyle = "rgba(57, 255, 182, 0.12)";
          ctx.strokeRect(
            screenX + 1,
            screenY + 1,
            config.tileSize - 2,
            config.tileSize - 2
          );
        }
      }
    }
  }

  function drawCheckpoint() {
    if (!state.checkpoint) {
      return;
    }
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;
    const screenX = state.checkpoint.x - state.cameraX + halfW;
    const screenY = state.checkpoint.y - state.cameraY + halfH;
    ctx.save();
    ctx.strokeStyle = "rgba(57, 255, 20, 0.8)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(57, 255, 20, 0.8)";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(screenX, screenY, state.checkpoint.radius, 0, Math.PI * 2);
    ctx.stroke();
    const cp = state.checkpoint;
    const screenX = cp.x - state.cameraX + canvas.width / 2;
    const screenY = cp.y - state.cameraY + canvas.height / 2;
    if (
      screenX < -cp.radius ||
      screenX > canvas.width + cp.radius ||
      screenY < -cp.radius ||
      screenY > canvas.height + cp.radius
    ) {
      return;
    }
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.strokeStyle = "#39ffb6";
    ctx.lineWidth = 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#39ffb6";
    ctx.beginPath();
    ctx.arc(0, 0, cp.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#39ffb6";
    ctx.beginPath();
    ctx.arc(0, 0, cp.radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCar() {
    const car = state.car;
    if (!car) {
      return;
    }
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;
    const screenX = car.x - state.cameraX + halfW;
    const screenY = car.y - state.cameraY + halfH;

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(car.angle);
    ctx.fillStyle = "#39ff14";
    ctx.shadowColor = "rgba(57, 255, 20, 0.8)";
    ctx.shadowBlur = 18;
    ctx.fillRect(-car.width, -car.height / 2, car.width * 2, car.height);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#001a12";
    ctx.fillRect(-car.width * 0.6, -car.height / 2 + 2, car.width * 1.2, car.height - 4);
    ctx.restore();
  }

  // Collision checks sample a small cross around the car's center against solid tiles.
  function collidesWithWorld(worldX, worldY, radius) {
    const samples = [
      [worldX, worldY],
      [worldX + radius, worldY],
      [worldX - radius, worldY],
      [worldX, worldY + radius],
      [worldX, worldY - radius],
    ];
    for (const [x, y] of samples) {
      if (isSolid(x, y)) {
        return true;
      }
    }
    return false;
  }

  function isSolid(worldX, worldY) {
    const tileX = Math.floor(worldX / config.tileSize);
    const tileY = Math.floor(worldY / config.tileSize);
    const tile = getTile(tileX, tileY);
    return tile === 2;
  }

  function getTile(tileX, tileY) {
    if (
      tileX < 0 ||
      tileY < 0 ||
      tileX >= config.mapWidth ||
      tileY >= config.mapHeight
    ) {
      return 2;
    }
    return state.world[tileY]?.[tileX] ?? 0;
  }

  // Build a neon city grid with looping roads and solid building blocks.
  function generateWorld() {
    const grid = Array.from({ length: config.mapHeight }, () =>
      Array(config.mapWidth).fill(0)
    );
    const roads = [];

    // Build a simple road grid.
    const verticals = [4, 12, 20, 28, 36, 44, 52];
    const horizontals = [6, 14, 22, 30, 38, 46, 54];
    verticals.forEach((column) => carveVerticalRoad(grid, column, 2));
    horizontals.forEach((row) => carveHorizontalRoad(grid, row, 2));
    carveVerticalRoad(grid, Math.floor(config.mapWidth / 2) - 1, 3);
    carveHorizontalRoad(grid, Math.floor(config.mapHeight / 2) - 1, 3);

    // Frame the map edges with buildings to keep the player inside bounds.
    for (let x = 0; x < config.mapWidth; x += 1) {
      grid[0][x] = 2;
      grid[config.mapHeight - 1][x] = 2;
    }
    for (let y = 0; y < config.mapHeight; y += 1) {
      grid[y][0] = 2;
      grid[y][config.mapWidth - 1] = 2;
    }

    // Scatter neon building blocks away from roads.
    for (let y = 2; y < config.mapHeight - 2; y += 3) {
      for (let x = 2; x < config.mapWidth - 2; x += 3) {
        if (grid[y][x] !== 0 || hasRoadNeighbor(grid, x, y, 1)) {
          continue;
        }
        if (Math.random() < 0.25) {
          continue;
        }
        for (let yy = 0; yy < 2; yy += 1) {
          for (let xx = 0; xx < 2; xx += 1) {
            if (grid[y + yy]?.[x + xx] === 0) {
              grid[y + yy][x + xx] = 2;
            }
          }
        }
      }
    }

    // Collect final road list.
    for (let y = 0; y < config.mapHeight; y += 1) {
      for (let x = 0; x < config.mapWidth; x += 1) {
        if (grid[y][x] === 1) {
          roads.push({ x, y });
        }
      }
    }

    return { grid, roads };
  }

  function carveVerticalRoad(grid, column, width) {
    for (let x = column; x < column + width; x += 1) {
      if (x < 1 || x >= config.mapWidth - 1) {
        continue;
      }
      for (let y = 1; y < config.mapHeight - 1; y += 1) {
        grid[y][x] = 1;
      }
    }
  }

  function carveHorizontalRoad(grid, row, height) {
    for (let y = row; y < row + height; y += 1) {
      if (y < 1 || y >= config.mapHeight - 1) {
        continue;
      }
      for (let x = 1; x < config.mapWidth - 1; x += 1) {
        grid[y][x] = 1;
      }
    }
  }

  function hasRoadNeighbor(grid, tileX, tileY, radius) {
    for (let y = tileY - radius; y <= tileY + radius; y += 1) {
      for (let x = tileX - radius; x <= tileX + radius; x += 1) {
        if (grid[y]?.[x] === 1) {
          return true;
        }
      }
    }
    return false;
  }

  function findSpawnTile() {
    if (!state.roadTiles.length) {
      return null;
    }
    const centerX = config.mapWidth / 2;
    const centerY = config.mapHeight / 2;
    let best = state.roadTiles[0];
    let bestScore = Infinity;
    for (const tile of state.roadTiles) {
      const dx = tile.x - centerX;
      const dy = tile.y - centerY;
      const dist = dx * dx + dy * dy;
      if (dist < bestScore) {
        bestScore = dist;
        best = tile;
      }
    }
    return best;
  }

  function pickCheckpoint() {
    if (!state.roadTiles.length) {
      return null;
    }
    const minDistance = 160;
    const minDistSq = minDistance * minDistance;
    const candidates = state.roadTiles.filter((tile) => {
      const worldX = tileToWorld(tile.x);
      const worldY = tileToWorld(tile.y);
      const dx = worldX - state.car.x;
      const dy = worldY - state.car.y;
      return dx * dx + dy * dy > minDistSq;
    });
    const list = candidates.length ? candidates : state.roadTiles;
    const tile = list[Math.floor(Math.random() * list.length)];
    return {
      x: tileToWorld(tile.x),
      y: tileToWorld(tile.y),
      radius: config.checkpointRadius,
    };
  }

  function tileToWorld(tileIndex) {
    return tileIndex * config.tileSize + config.tileSize / 2;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
    const screenX = car.x - state.cameraX + canvas.width / 2;
    const screenY = car.y - state.cameraY + canvas.height / 2;
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(car.angle);
    ctx.shadowColor = "#39ffb6";
    ctx.shadowBlur = 18;
    const carLength = 30;
    const carWidth = 16;
    ctx.fillStyle = "#2affb0";
    ctx.fillRect(-carLength / 2, -carWidth / 2, carLength, carWidth);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#012820";
    ctx.fillRect(-carLength / 2 + 3, -carWidth / 2 + 2, 8, carWidth - 4);
    ctx.fillStyle = "#f1ffcd";
    ctx.fillRect(carLength / 2 - 4, -4, 3, 3);
    ctx.fillRect(carLength / 2 - 4, 1, 3, 3);
    ctx.restore();
  }

  function updateHud(force = false) {
    if (!scoreEl || !missionEl || !speedEl) {
      return;
    }
    const scoreText = state.score.toString();
    const missionText = state.missionText;
    const speedText = `${Math.round(Math.abs(state.car.speed) * config.pxToKmh)} km/h`;

    if (force || hudCache.score !== scoreText) {
      hudCache.score = scoreText;
      scoreEl.textContent = scoreText;
    }
    if (force || hudCache.mission !== missionText) {
      hudCache.mission = missionText;
      missionEl.textContent = missionText;
    }
    if (force || hudCache.speed !== speedText) {
      hudCache.speed = speedText;
      speedEl.textContent = speedText;
    }
  }

  function setMission(text, temporary = false) {
    state.missionText = text;
    updateHud(true);
    if (missionResetTimer) {
      clearTimeout(missionResetTimer);
      missionResetTimer = null;
    }
    if (temporary) {
      missionResetTimer = setTimeout(() => {
        state.missionText = defaultMission;
        updateHud(true);
      }, 4000);
    }
  }

  function bindEvents() {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    overlay?.addEventListener("click", handleOverlayClick);
    window.addEventListener("blur", () => {
      if (phase === "running") {
        pauseGame();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && phase === "running") {
        pauseGame();
      }
    });
    setupTouchControls();
  }

  function handleKeyDown(event) {
    const code = event.code;
    switch (code) {
      case "ArrowUp":
      case "KeyW":
        inputState.accelerate = true;
        event.preventDefault();
        break;
      case "ArrowDown":
      case "KeyS":
        inputState.brake = true;
        event.preventDefault();
        break;
      case "ArrowLeft":
      case "KeyA":
        inputState.steerLeft = true;
        event.preventDefault();
        break;
      case "ArrowRight":
      case "KeyD":
        inputState.steerRight = true;
        event.preventDefault();
        break;
      case "Space":
        event.preventDefault();
        if (phase === "idle") {
          startRun();
        } else if (phase === "paused") {
          resumeRun();
        } else {
          inputState.handbrake = true;
        }
        break;
      case "KeyP":
        event.preventDefault();
        if (phase === "running") {
          pauseGame();
        } else if (phase === "paused") {
          resumeRun();
        }
        break;
      case "KeyR":
        event.preventDefault();
        resetGame();
        break;
      default:
        break;
    }
  }

  function handleKeyUp(event) {
    const code = event.code;
    switch (code) {
      case "ArrowUp":
      case "KeyW":
        inputState.accelerate = false;
        break;
      case "ArrowDown":
      case "KeyS":
        inputState.brake = false;
        break;
      case "ArrowLeft":
      case "KeyA":
        inputState.steerLeft = false;
        break;
      case "ArrowRight":
      case "KeyD":
        inputState.steerRight = false;
        break;
      case "Space":
        inputState.handbrake = false;
        break;
      default:
        break;
    }
  }

  function setupTouchControls() {
    if (!touchControls) return;
    const updateAria = () => {
      const visible = coarseMediaQuery ? coarseMediaQuery.matches : false;
      touchControls.setAttribute("aria-hidden", visible ? "false" : "true");
    };
    updateAria();
    if (coarseMediaQuery?.addEventListener) {
      coarseMediaQuery.addEventListener("change", updateAria);
    } else if (coarseMediaQuery?.addListener) {
      coarseMediaQuery.addListener(updateAria);
    }

    touchButtons.forEach((btn) => {
      const action = btn.getAttribute("data-action");
      if (!action) return;
      const press = (value) => {
        setInput(action, value);
        if (value) {
          if (phase === "idle") {
            startRun();
          } else if (phase === "paused") {
            resumeRun();
          }
        }
      };
      const handlePointerDown = (event) => {
        event.preventDefault();
        btn.setPointerCapture?.(event.pointerId);
        press(true);
      };
      const handlePointerUp = (event) => {
        event.preventDefault();
        btn.releasePointerCapture?.(event.pointerId);
        press(false);
      };
      btn.addEventListener("pointerdown", handlePointerDown);
      btn.addEventListener("pointerup", handlePointerUp);
      btn.addEventListener("pointerleave", handlePointerUp);
      btn.addEventListener("pointercancel", handlePointerUp);
    });
  }

  function setInput(action, value) {
    switch (action) {
      case "steer-left":
        inputState.steerLeft = value;
        break;
      case "steer-right":
        inputState.steerRight = value;
        break;
      case "accelerate":
        inputState.accelerate = value;
        break;
      case "brake":
        inputState.brake = value;
        break;
      case "handbrake":
        inputState.handbrake = value;
        break;
      default:
        break;
    }
  }

  function handleOverlayClick() {
    if (phase === "idle") {
      startRun();
    } else if (phase === "paused") {
      resumeRun();
    }
  }

  function startRun() {
    phase = "running";
    hideOverlay();
    lastTime = performance.now();
  }

  function pauseGame() {
    phase = "paused";
    showOverlay(pausedMessage, overlayHintText);
  }

  function resumeRun() {
    phase = "running";
    hideOverlay();
    lastTime = performance.now();
  }

  function showOverlay(message, hint) {
    if (!overlay) return;
    if (overlayTitle) {
      overlayTitle.textContent = message;
    }
    if (overlayHint) {
      overlayHint.textContent = hint;
    }
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  function tileToWorld(tile) {
    return {
      x: (tile.x + 0.5) * config.tileSize,
      y: (tile.y + 0.5) * config.tileSize,
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
})();
