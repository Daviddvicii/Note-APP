(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const scoreEl = document.getElementById("score");
  const missionEl = document.getElementById("mission");
  const speedEl = document.getElementById("speed");
  const touchButtons = document.querySelectorAll("#touch-controls .touch-btn");

  const config = {
    width: canvas.width,
    height: canvas.height,
    tileSize: 16,
    mapWidth: 60,
    mapHeight: 60,
    checkpointRadius: 24,
  };

  const state = {
    world: [],
    phase: "idle",
    baseMissionText: "Drive to the glowing checkpoint",
    missionText: "Drive to the glowing checkpoint",
    missionTimer: 0,
    score: 0,
    lastTimestamp: 0,
    cameraX: 0,
    cameraY: 0,
    checkpoint: { x: 0, y: 0, radius: config.checkpointRadius },
    car: {
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      maxSpeed: 140,
      accel: 220,
      friction: 130,
      turnSpeed: 2.6,
      handbrake: 420,
      radius: 6,
    },
  };

  const input = {
    accelerate: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  };

  function init() {
    state.world = generateWorld();
    placeCarAtSpawn();
    pickCheckpoint(true);
    updateHud();
    showOverlay("Press Space or Tap to Start");
    overlay?.addEventListener("click", handleOverlayClick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", pauseOnBlur);
    document.addEventListener("visibilitychange", pauseOnVisibilityChange);
    bindTouchControls();
    state.lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
  }

  // --- Map representation (grid of tile enums) -----------------------------
  function generateWorld() {
    const grid = Array.from({ length: config.mapHeight }, () =>
      new Array(config.mapWidth).fill(0)
    );

    const carveRoadRow = (row) => {
      for (let offset = -1; offset <= 1; offset += 1) {
        const y = row + offset;
        if (y < 0 || y >= config.mapHeight) continue;
        for (let x = 0; x < config.mapWidth; x += 1) {
          grid[y][x] = 1;
        }
      }
    };

    const carveRoadColumn = (col) => {
      for (let offset = -1; offset <= 1; offset += 1) {
        const x = col + offset;
        if (x < 0 || x >= config.mapWidth) continue;
        for (let y = 0; y < config.mapHeight; y += 1) {
          grid[y][x] = 1;
        }
      }
    };

    for (let y = 6; y < config.mapHeight; y += 9) {
      carveRoadRow(y);
    }

    for (let x = 6; x < config.mapWidth; x += 9) {
      carveRoadColumn(x);
    }

    for (let edge = 0; edge < config.mapWidth; edge += 1) {
      grid[0][edge] = 1;
      grid[config.mapHeight - 1][edge] = 1;
    }
    for (let edge = 0; edge < config.mapHeight; edge += 1) {
      grid[edge][0] = 1;
      grid[edge][config.mapWidth - 1] = 1;
    }

    for (let y = 0; y < config.mapHeight; y += 1) {
      for (let x = 0; x < config.mapWidth; x += 1) {
        if (grid[y][x] !== 0) continue;
        const nearRoad = hasRoadNeighbor(grid, x, y);
        if (nearRoad && Math.random() < 0.55) {
          grid[y][x] = 2;
        } else if (!nearRoad && Math.random() < 0.12) {
          grid[y][x] = 2;
        }
      }
    }

    return grid;
  }

  function hasRoadNeighbor(grid, x, y) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= config.mapWidth || ny >= config.mapHeight) {
          continue;
        }
        if (grid[ny][nx] === 1) return true;
      }
    }
    return false;
  }

  function placeCarAtSpawn() {
    const centerX = Math.floor(config.mapWidth / 2);
    const centerY = Math.floor(config.mapHeight / 2);
    let spawn = { x: centerX, y: centerY };
    let bestDist = Infinity;
    for (let y = 0; y < config.mapHeight; y += 1) {
      for (let x = 0; x < config.mapWidth; x += 1) {
        if (state.world[y][x] !== 1) continue;
        const dist = Math.hypot(x - centerX, y - centerY);
        if (dist < bestDist) {
          bestDist = dist;
          spawn = { x, y };
        }
      }
    }
    state.car.x = spawn.x * config.tileSize + config.tileSize / 2;
    state.car.y = spawn.y * config.tileSize + config.tileSize / 2;
    state.car.angle = 0;
    state.car.speed = 0;
    state.cameraX = state.car.x;
    state.cameraY = state.car.y;
  }

  function handleOverlayClick() {
    if (state.phase === "idle" || state.phase === "paused") {
      startGame();
    }
  }

  function startGame() {
    state.phase = "running";
    hideOverlay();
    state.lastTimestamp = performance.now();
  }

  function pauseGame() {
    if (state.phase !== "running") return;
    state.phase = "paused";
    showOverlay("Paused · Press Space or Tap to Resume");
  }

  function togglePause() {
    if (state.phase === "running") {
      pauseGame();
    } else if (state.phase === "paused") {
      startGame();
    }
  }

  function resetGame() {
    state.score = 0;
    state.missionText = state.baseMissionText;
    state.missionTimer = 0;
    placeCarAtSpawn();
    pickCheckpoint(true);
    updateHud();
    state.phase = "idle";
    showOverlay("Press Space or Tap to Start");
  }

  function handleKeyDown(event) {
    const actionableKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];
    if (actionableKeys.includes(event.code)) {
      event.preventDefault();
    }

    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        input.accelerate = true;
        break;
      case "ArrowDown":
      case "KeyS":
        input.brake = true;
        break;
      case "ArrowLeft":
      case "KeyA":
        input.steerLeft = true;
        break;
      case "ArrowRight":
      case "KeyD":
        input.steerRight = true;
        break;
      case "Space":
        if (state.phase === "running") {
          input.handbrake = true;
        } else {
          startGame();
        }
        break;
      case "KeyP":
        togglePause();
        break;
      case "KeyR":
        resetGame();
        break;
      default:
        break;
    }
  }

  function handleKeyUp(event) {
    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        input.accelerate = false;
        break;
      case "ArrowDown":
      case "KeyS":
        input.brake = false;
        break;
      case "ArrowLeft":
      case "KeyA":
        input.steerLeft = false;
        break;
      case "ArrowRight":
      case "KeyD":
        input.steerRight = false;
        break;
      case "Space":
        input.handbrake = false;
        break;
      default:
        break;
    }
  }

  function pauseOnBlur() {
    if (state.phase === "running") {
      pauseGame();
    }
  }

  function pauseOnVisibilityChange() {
    if (document.visibilityState === "hidden") {
      pauseOnBlur();
    }
  }

  function bindTouchControls() {
    touchButtons.forEach((btn) => {
      const action = btn.dataset.action;
      if (!action) return;
      const press = (event) => {
        event.preventDefault();
        setInputFromAction(action, true);
        if (state.phase !== "running") {
          startGame();
        }
        btn.setPointerCapture?.(event.pointerId);
      };
      const release = (event) => {
        event.preventDefault();
        setInputFromAction(action, false);
        if (btn.hasPointerCapture?.(event.pointerId)) {
          btn.releasePointerCapture(event.pointerId);
        }
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("pointercancel", release);
    });
  }

  function setInputFromAction(action, active) {
    switch (action) {
      case "steer-left":
        input.steerLeft = active;
        break;
      case "steer-right":
        input.steerRight = active;
        break;
      case "accelerate":
        input.accelerate = active;
        break;
      case "brake":
        input.brake = active;
        break;
      default:
        break;
    }
  }

  function gameLoop(timestamp) {
    const delta = Math.min((timestamp - state.lastTimestamp) / 1000, 0.1);
    state.lastTimestamp = timestamp;
    if (state.phase === "running") {
      update(delta);
    }
    render();
    requestAnimationFrame(gameLoop);
  }

  function update(dt) {
    updateCar(dt);
    updateCamera();
    handleCheckpoint(dt);
    updateHud();
  }

  // --- Car physics block ---------------------------------------------------
  function updateCar(dt) {
    const car = state.car;
    if (input.accelerate) {
      car.speed += car.accel * dt;
    }
    if (input.brake) {
      car.speed -= car.accel * 0.7 * dt;
    }

    const friction = car.friction * dt;
    if (!input.accelerate && !input.brake) {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - friction);
      } else if (car.speed < 0) {
        car.speed = Math.min(0, car.speed + friction);
      }
    }

    if (input.handbrake) {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - car.handbrake * dt);
      } else if (car.speed < 0) {
        car.speed = Math.min(0, car.speed + car.handbrake * dt);
      }
    }

    car.speed = clamp(car.speed, -car.maxSpeed * 0.55, car.maxSpeed);

    const steerInput = (input.steerLeft ? -1 : 0) + (input.steerRight ? 1 : 0);
    if (steerInput !== 0) {
      const speedFactor = clamp(Math.abs(car.speed) / (car.maxSpeed * 0.45), 0.2, 1);
      const direction = car.speed >= 0 ? 1 : -1;
      car.angle += steerInput * car.turnSpeed * speedFactor * direction * dt;
    }

    const nextX = car.x + Math.cos(car.angle) * car.speed * dt;
    const nextY = car.y + Math.sin(car.angle) * car.speed * dt;
    const collision = resolveCollisions(nextX, nextY);
    car.x = collision.x;
    car.y = collision.y;
    if (collision.collided) {
      car.speed *= -0.2;
    }
  }

  // --- Collision checks against solid tiles --------------------------------
  function resolveCollisions(nextX, nextY) {
    let x = nextX;
    let y = nextY;
    let collided = false;
    const radius = state.car.radius;
    const minTileX = Math.floor((x - radius) / config.tileSize);
    const maxTileX = Math.floor((x + radius) / config.tileSize);
    const minTileY = Math.floor((y - radius) / config.tileSize);
    const maxTileY = Math.floor((y + radius) / config.tileSize);

    for (let ty = minTileY; ty <= maxTileY; ty += 1) {
      for (let tx = minTileX; tx <= maxTileX; tx += 1) {
        if (!isSolidTile(tx, ty)) continue;
        const tileMinX = tx * config.tileSize;
        const tileMinY = ty * config.tileSize;
        const tileMaxX = tileMinX + config.tileSize;
        const tileMaxY = tileMinY + config.tileSize;
        const closestX = clamp(x, tileMinX, tileMaxX);
        const closestY = clamp(y, tileMinY, tileMaxY);
        const dx = x - closestX;
        const dy = y - closestY;
        const distSq = dx * dx + dy * dy;
        if (distSq < radius * radius) {
          const dist = Math.sqrt(distSq) || 0.0001;
          const overlap = radius - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          x += nx * overlap;
          y += ny * overlap;
          collided = true;
        }
      }
    }

    return { x, y, collided };
  }

  function isSolidTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= config.mapWidth || ty >= config.mapHeight) {
      return true;
    }
    return state.world[ty][tx] === 2;
  }

  function updateCamera() {
    // Camera follows the car with slight easing for a smooth chase-cam effect.
    const ease = 0.12;
    state.cameraX += (state.car.x - state.cameraX) * ease;
    state.cameraY += (state.car.y - state.cameraY) * ease;
  }

  // --- Mission / checkpoint logic -----------------------------------------
  function handleCheckpoint(dt) {
    const { checkpoint } = state;
    const dx = state.car.x - checkpoint.x;
    const dy = state.car.y - checkpoint.y;
    if (Math.hypot(dx, dy) <= checkpoint.radius) {
      state.score += 100;
      state.missionText = "Checkpoint reached! New destination set.";
      state.missionTimer = 3;
      pickCheckpoint(true);
    } else if (state.missionTimer > 0) {
      state.missionTimer -= dt;
      if (state.missionTimer <= 0) {
        state.missionText = state.baseMissionText;
      }
    }
  }

  function pickCheckpoint(forceFar) {
    const attempts = 250;
    const minDistance = forceFar ? config.tileSize * 14 : config.tileSize * 8;
    let candidate = null;
    let bestDist = 0;
    for (let i = 0; i < attempts; i += 1) {
      const tx = Math.floor(Math.random() * config.mapWidth);
      const ty = Math.floor(Math.random() * config.mapHeight);
      if (state.world[ty][tx] !== 1) continue;
      const wx = tx * config.tileSize + config.tileSize / 2;
      const wy = ty * config.tileSize + config.tileSize / 2;
      const dist = Math.hypot(wx - state.car.x, wy - state.car.y);
      if (dist > bestDist) {
        candidate = { x: wx, y: wy };
        bestDist = dist;
      }
      if (dist >= minDistance) break;
    }
    if (!candidate) {
      candidate = {
        x: config.mapWidth * config.tileSize * 0.8,
        y: config.mapHeight * config.tileSize * 0.2,
      };
    }
    state.checkpoint.x = candidate.x;
    state.checkpoint.y = candidate.y;
    state.checkpoint.radius = config.checkpointRadius;
  }

  function updateHud() {
    if (scoreEl) {
      scoreEl.textContent = state.score.toString();
    }
    if (missionEl) {
      missionEl.textContent = state.missionText;
    }
    if (speedEl) {
      const kmh = Math.abs(state.car.speed) * 0.32;
      speedEl.textContent = `${kmh.toFixed(0)} km/h`;
    }
  }

  function showOverlay(message) {
    if (overlayTitle) {
      overlayTitle.textContent = message;
    }
    if (overlay) {
      overlay.classList.add("visible");
      overlay.setAttribute("aria-hidden", "false");
    }
  }

  function hideOverlay() {
    if (overlay) {
      overlay.classList.remove("visible");
      overlay.setAttribute("aria-hidden", "true");
    }
  }

  function render() {
    ctx.clearRect(0, 0, config.width, config.height);
    drawWorld();
    drawCheckpoint();
    drawCar();
  }

  function drawWorld() {
    ctx.save();
    ctx.fillStyle = "#02150b";
    ctx.fillRect(0, 0, config.width, config.height);
    const startWorldX = state.cameraX - config.width / 2;
    const startWorldY = state.cameraY - config.height / 2;
    const startTileX = Math.floor(startWorldX / config.tileSize) - 1;
    const startTileY = Math.floor(startWorldY / config.tileSize) - 1;
    const endTileX = Math.floor((state.cameraX + config.width / 2) / config.tileSize) + 1;
    const endTileY = Math.floor((state.cameraY + config.height / 2) / config.tileSize) + 1;

    for (let ty = startTileY; ty <= endTileY; ty += 1) {
      for (let tx = startTileX; tx <= endTileX; tx += 1) {
        const tile = getTile(tx, ty);
        const screenX = tx * config.tileSize - startWorldX;
        const screenY = ty * config.tileSize - startWorldY;
        if (tile === 0) {
          ctx.fillStyle = "#031c0f";
          ctx.fillRect(screenX, screenY, config.tileSize, config.tileSize);
        } else if (tile === 1) {
          ctx.fillStyle = "#0c2b15";
          ctx.fillRect(screenX, screenY, config.tileSize, config.tileSize);
          if ((tx + ty) % 2 === 0) {
            ctx.strokeStyle = "rgba(57,255,20,0.35)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(screenX, screenY + config.tileSize / 2);
            ctx.lineTo(screenX + config.tileSize, screenY + config.tileSize / 2);
            ctx.stroke();
          }
        } else if (tile === 2) {
          ctx.fillStyle = "#061321";
          ctx.fillRect(screenX, screenY, config.tileSize, config.tileSize);
          ctx.strokeStyle = "rgba(57,255,20,0.08)";
          ctx.strokeRect(screenX, screenY, config.tileSize, config.tileSize);
        }
      }
    }
    ctx.restore();
  }

  function getTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= config.mapWidth || ty >= config.mapHeight) {
      return 2;
    }
    return state.world[ty][tx];
  }

  function drawCheckpoint() {
    const screenX = state.checkpoint.x - state.cameraX + config.width / 2;
    const screenY = state.checkpoint.y - state.cameraY + config.height / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(57,255,20,0.85)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(57,255,20,0.8)";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(screenX, screenY, state.checkpoint.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCar() {
    const screenX = state.car.x - state.cameraX + config.width / 2;
    const screenY = state.car.y - state.cameraY + config.height / 2;
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(state.car.angle);
    ctx.shadowColor = "rgba(57,255,20,0.65)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#39ff14";
    ctx.fillRect(-12, -6, 24, 12);
    ctx.fillStyle = "#08260f";
    ctx.fillRect(-6, -4, 12, 8);
    ctx.fillStyle = "#5dffa0";
    ctx.fillRect(2, -3, 8, 6);
    ctx.restore();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  init();
})();
