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
    drawCheckpoint();
    drawCar();
  }

  function drawWorld() {
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
  }
})();
