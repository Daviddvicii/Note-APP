(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const overlay = document.getElementById("overlay");
  const overlayMessage = document.getElementById("overlay-message");
  const scoreEl = document.getElementById("score");
  const missionEl = document.getElementById("mission");
  const speedEl = document.getElementById("speed");
  const missionsDoneEl = document.getElementById("missions-done");
  const touchControls = document.getElementById("touch-controls");

  // Tile-based city layout (logical grid rendered through the camera).
  const config = {
    tileSize: 16,
    mapWidth: 60,
    mapHeight: 60,
  };

  const diff = localStorage.getItem('retro_difficulty') || 'normal';
  const speedMax = diff==='easy'?120 : diff==='hard'?170 : 140;
  const turnS = diff==='easy'?3.0 : diff==='hard'?2.2 : 2.6;

  const car = {
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    maxSpeed: speedMax,
    accel: 220,
    friction: 140,
    turnSpeed: turnS,
    radius: 8,
  };

  const input = {
    accelerate: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  };

  // Game-wide state for HUD/missions/camera.
  const state = {
    phase: "idle",
    score: 0,
    missionsDone: 0,
    missionText: "Drive to the glowing checkpoint",
    missionTextTimer: 0,
    checkpoint: { x: 0, y: 0, radius: 24 },
    world: [],
    roadTiles: [],
    cameraX: 0,
    cameraY: 0,
    lastTime: performance.now(),
  };

  init();

  function init() {
    const { world, roads } = createWorld();
    state.world = world;
    state.roadTiles = roads;

    placeCarAtCenter();
    placeCheckpoint(200);
    state.cameraX = car.x;
    state.cameraY = car.y;
    updateHUD(0);

    setupKeyboard();
    setupTouchControls();
    overlay.addEventListener("click", handleOverlayClick);
    window.addEventListener("blur", () => {
      clearInput();
      if (state.phase === "running") {
        pauseGame("Paused · Tap or Press Space to Resume");
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.phase === "running") {
        pauseGame("Paused · Tap or Press Space to Resume");
      }
    });

    render();
    requestAnimationFrame(loop);
  }

  function handleOverlayClick() {
    if (state.phase === "idle") {
      startGame();
    } else if (state.phase === "paused") {
      resumeGame();
    }
  }

  function setupKeyboard() {
    window.addEventListener("keydown", (event) => handleKey(event, true));
    window.addEventListener("keyup", (event) => handleKey(event, false));
  }

  function handleKey(event, isDown) {
    const { code } = event;
    let handled = false;

    const applyInput = (key, value) => {
      input[key] = value;
      handled = true;
    };

    switch (code) {
      case "ArrowUp":
      case "KeyW":
        applyInput("accelerate", isDown);
        break;
      case "ArrowDown":
      case "KeyS":
        applyInput("brake", isDown);
        break;
      case "ArrowLeft":
      case "KeyA":
        applyInput("steerLeft", isDown);
        break;
      case "ArrowRight":
      case "KeyD":
        applyInput("steerRight", isDown);
        break;
      case "Space":
        if (state.phase === "idle" && isDown) {
          startGame();
        } else if (state.phase === "paused" && isDown) {
          resumeGame();
        } else {
          applyInput("handbrake", isDown);
        }
        handled = true;
        break;
      case "KeyP":
        if (isDown) {
          if (state.phase === "running") {
            pauseGame("Paused · Tap or Press Space to Resume");
          } else if (state.phase === "paused") {
            resumeGame();
          }
        }
        handled = true;
        break;
      case "KeyR":
        if (isDown) resetGame();
        handled = true;
        break;
      default:
        break;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  function setupTouchControls() {
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    touchControls?.setAttribute("aria-hidden", isCoarse ? "false" : "true");

    if (!touchControls) return;
    const buttons = touchControls.querySelectorAll(".touch-btn");

    buttons.forEach((button) => {
      const action = button.dataset.action;
      if (!action) return;

      const setInput = (value) => {
        switch (action) {
          case "steer-left":
            input.steerLeft = value;
            break;
          case "steer-right":
            input.steerRight = value;
            break;
          case "accelerate":
            input.accelerate = value;
            break;
          case "brake":
            input.brake = value;
            break;
          default:
            break;
        }
      };

      button.addEventListener("pointerdown", (event) => {
        button.setPointerCapture(event.pointerId);
        setInput(true);
        event.preventDefault();
      });

      const clear = (event) => {
        setInput(false);
        event.preventDefault();
      };

      button.addEventListener("pointerup", clear);
      button.addEventListener("pointercancel", clear);
      button.addEventListener("pointerleave", clear);
    });
  }

  function startGame() {
    state.phase = "running";
    hideOverlay();
    state.lastTime = performance.now();
  }

  function resumeGame() {
    state.phase = "running";
    hideOverlay();
    state.lastTime = performance.now();
  }

  function pauseGame(message) {
    state.phase = "paused";
    setOverlayMessage(message);
    showOverlay();
  }

  function resetGame() {
    car.x = 0;
    car.y = 0;
    car.angle = 0;
    car.speed = 0;
    state.score = 0;
    state.missionsDone = 0;
    state.missionText = "Drive to the glowing checkpoint";
    state.missionTextTimer = 0;
    placeCarAtCenter();
    placeCheckpoint(200);
    updateHUD(0);
    setOverlayMessage("Press Space or Tap to Start");
    showOverlay();
    state.phase = "idle";
  }

  function placeCarAtCenter() {
    if (!state.roadTiles.length) return;
    const centerX = (config.mapWidth * config.tileSize) / 2;
    const centerY = (config.mapHeight * config.tileSize) / 2;
    let best = state.roadTiles[0];
    let bestDist = Infinity;

    for (const tile of state.roadTiles) {
      const worldX = (tile.x + 0.5) * config.tileSize;
      const worldY = (tile.y + 0.5) * config.tileSize;
      const dist = (worldX - centerX) ** 2 + (worldY - centerY) ** 2;
      if (dist < bestDist) {
        best = tile;
        bestDist = dist;
      }
    }

    car.x = (best.x + 0.5) * config.tileSize;
    car.y = (best.y + 0.5) * config.tileSize;
  }

  function placeCheckpoint(minDistance = 150) {
    if (!state.roadTiles.length) return;
    const minDistSq = minDistance * minDistance;
    const candidates = state.roadTiles.filter((tile) => {
      const wx = (tile.x + 0.5) * config.tileSize;
      const wy = (tile.y + 0.5) * config.tileSize;
      const dx = wx - car.x;
      const dy = wy - car.y;
      return dx * dx + dy * dy > minDistSq;
    });

    const pool = candidates.length ? candidates : state.roadTiles;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    state.checkpoint.x = (choice.x + 0.5) * config.tileSize;
    state.checkpoint.y = (choice.y + 0.5) * config.tileSize;
  }

  function showOverlay() {
    overlay.classList.add("visible");
  }

  function hideOverlay() {
    overlay.classList.remove("visible");
  }

  function setOverlayMessage(message) {
    overlayMessage.textContent = message;
  }

  function loop(timestamp) {
    const dt = Math.min((timestamp - state.lastTime) / 1000, 0.1);
    state.lastTime = timestamp;

    if (state.phase === "running") {
      update(dt);
    }

    render();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    // Core simulation order keeps physics stable before camera + HUD.
    updateCar(dt);
    resolveMapCollisions();
    updateCamera(dt);
    updateCheckpointLogic(dt);
    updateHUD(dt);
  }

  function updateCar(dt) {
    // Simple top-down physics: accelerate forward/backward and apply friction when idle.
    const accelForce = input.accelerate ? car.accel : 0;
    const brakeForce = input.brake ? car.accel * 0.9 : 0;

    car.speed += accelForce * dt;
    car.speed -= brakeForce * dt;

    const maxReverse = -car.maxSpeed * 0.35;
    if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
    if (car.speed < maxReverse) car.speed = maxReverse;

    const frictionForce = input.handbrake ? car.friction * 2.4 : car.friction;
    car.speed = approachZero(car.speed, frictionForce * dt, accelForce > 0 || brakeForce > 0);

    const turnFactor = Math.min(1, Math.abs(car.speed) / (car.maxSpeed * 0.5));
    if (turnFactor > 0.02) {
      const direction = car.speed >= 0 ? 1 : -1;
      if (input.steerLeft) {
        car.angle -= car.turnSpeed * turnFactor * dt * direction;
      }
      if (input.steerRight) {
        car.angle += car.turnSpeed * turnFactor * dt * direction;
      }
    }

    const dx = Math.cos(car.angle) * car.speed * dt;
    const dy = Math.sin(car.angle) * car.speed * dt;

    car.x += dx;
    car.y += dy;

    const min = car.radius;
    const maxX = config.mapWidth * config.tileSize - car.radius;
    const maxY = config.mapHeight * config.tileSize - car.radius;
    car.x = clamp(car.x, min, maxX);
    car.y = clamp(car.y, min, maxY);
  }

  function resolveMapCollisions() {
    // Check every solid tile the car overlaps and push it back using a circle-vs-rect test.
    const radius = car.radius;
    const tileSize = config.tileSize;
    const left = Math.floor((car.x - radius) / tileSize);
    const right = Math.floor((car.x + radius) / tileSize);
    const top = Math.floor((car.y - radius) / tileSize);
    const bottom = Math.floor((car.y + radius) / tileSize);

    for (let ty = top; ty <= bottom; ty += 1) {
      for (let tx = left; tx <= right; tx += 1) {
        if (isSolid(tx, ty)) {
          resolveCircleRectCollision(tx * tileSize, ty * tileSize, tileSize, tileSize);
        }
      }
    }
  }

  function resolveCircleRectCollision(rx, ry, rw, rh) {
    const nearestX = clamp(car.x, rx, rx + rw);
    const nearestY = clamp(car.y, ry, ry + rh);
    const dx = car.x - nearestX;
    const dy = car.y - nearestY;
    const distSq = dx * dx + dy * dy;
    const radiusSq = car.radius * car.radius;

    if (distSq < radiusSq) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const overlap = car.radius - dist;
      const nx = dx / dist;
      const ny = dy / dist;
      car.x += nx * overlap;
      car.y += ny * overlap;
      car.speed *= -0.2;
    }
  }

  function isSolid(x, y) {
    if (x < 0 || y < 0 || x >= config.mapWidth || y >= config.mapHeight) return true;
    return state.world[y][x] === 2;
  }

  function updateCamera(dt) {
    // Ease camera toward the car so the motion feels smooth and CRT-like.
    const smoothing = 1 - Math.exp(-dt * 5);
    state.cameraX += (car.x - state.cameraX) * smoothing;
    state.cameraY += (car.y - state.cameraY) * smoothing;
  }

  function updateCheckpointLogic(dt) {
    // Mission loop: collect a glowing ring, gain points, and spawn another far away.
    const dx = car.x - state.checkpoint.x;
    const dy = car.y - state.checkpoint.y;
    const reached = dx * dx + dy * dy <= state.checkpoint.radius * state.checkpoint.radius;

    if (reached) {
      state.score += 100;
      state.missionsDone += 1;
      state.missionText = "Checkpoint reached! New destination!";
      state.missionTextTimer = 2.5;
      placeCheckpoint(220);
    }

    if (state.missionTextTimer > 0) {
      state.missionTextTimer -= dt;
      if (state.missionTextTimer <= 0) {
        state.missionText = "Drive to the glowing checkpoint";
      }
    }
  }

  function updateHUD() {
    scoreEl.textContent = state.score.toString();
    missionEl.textContent = state.missionText;
    missionsDoneEl.textContent = state.missionsDone.toString();
    const kmh = Math.max(0, Math.round(Math.abs(car.speed) * 0.6));
    speedEl.textContent = `${kmh} km/h`;
  }

  function render() {
    ctx.fillStyle = "#030c05";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTiles();
    drawCheckpoint();
    drawCar();
    drawSpeedBlur();
  }

  function drawTiles() {
    const tileSize = config.tileSize;
    const startX = Math.floor((state.cameraX - canvas.width / 2) / tileSize) - 1;
    const endX = Math.floor((state.cameraX + canvas.width / 2) / tileSize) + 1;
    const startY = Math.floor((state.cameraY - canvas.height / 2) / tileSize) - 1;
    const endY = Math.floor((state.cameraY + canvas.height / 2) / tileSize) + 1;

    for (let ty = startY; ty <= endY; ty += 1) {
      for (let tx = startX; tx <= endX; tx += 1) {
        const tile = getTile(tx, ty);
        const screenX = worldToScreenX(tx * tileSize);
        const screenY = worldToScreenY(ty * tileSize);
        if (screenX > canvas.width || screenY > canvas.height || screenX + tileSize < 0 || screenY + tileSize < 0) {
          continue;
        }

        switch (tile) {
          case 1:
            ctx.fillStyle = "#0c1f11";
            ctx.fillRect(screenX, screenY, tileSize, tileSize);
            ctx.fillStyle = "rgba(57,255,20,0.05)";
            if ((tx + ty) % 2 === 0) {
              ctx.fillRect(screenX, screenY + tileSize / 2 - 1, tileSize, 2);
            }
            break;
          case 2:
            ctx.fillStyle = "#072617";
            ctx.fillRect(screenX, screenY, tileSize, tileSize);
            ctx.strokeStyle = "rgba(57,255,20,0.2)";
            ctx.strokeRect(screenX + 0.5, screenY + 0.5, tileSize - 1, tileSize - 1);
            break;
          default:
            ctx.fillStyle = "#021406";
            ctx.fillRect(screenX, screenY, tileSize, tileSize);
            break;
        }
      }
    }
  }

  function drawCheckpoint() {
    const { x, y, radius } = state.checkpoint;
    const screenX = worldToScreenX(x);
    const screenY = worldToScreenY(y);

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.strokeStyle = "#39ff14";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.5, 0, Math.PI * 2);
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.restore();
  }

  function drawCar() {
    const screenX = worldToScreenX(car.x);
    const screenY = worldToScreenY(car.y);
    const carLength = 26;
    const carWidth = 14;

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(car.angle);
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#39ff14";
    ctx.fillRect(-carLength / 2, -carWidth / 2, carLength, carWidth);
    ctx.fillStyle = "#001a0a";
    ctx.fillRect(-carLength / 6, -carWidth / 2 + 2, carLength / 3, carWidth - 4);
    ctx.restore();
  }

  function drawSpeedBlur() {
    const speedRatio = Math.min(1, Math.abs(car.speed) / car.maxSpeed);
    if (speedRatio < 0.15) return;
    const alpha = speedRatio * 0.18;
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, `rgba(57,255,20,0)`);
    gradient.addColorStop(1, `rgba(57,255,20,${alpha})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function getTile(x, y) {
    if (x < 0 || y < 0 || x >= config.mapWidth || y >= config.mapHeight) return 2;
    return state.world[y][x];
  }

  function worldToScreenX(worldX) {
    return worldX - state.cameraX + canvas.width / 2;
  }

  function worldToScreenY(worldY) {
    return worldY - state.cameraY + canvas.height / 2;
  }

  function approachZero(value, delta, skip) {
    if (skip) return value;
    if (value > 0) {
      return Math.max(0, value - delta);
    }
    if (value < 0) {
      return Math.min(0, value + delta);
    }
    return 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clearInput() {
    Object.keys(input).forEach((key) => {
      input[key] = false;
    });
  }

  function createWorld() {
    // Build a grid: 0 grass, 1 roads, 2 neon building blocks (solid for collisions).
    const { mapWidth, mapHeight } = config;
    const world = Array.from({ length: mapHeight }, () => Array(mapWidth).fill(0));
    const roads = [];

    const carveRoad = (x, y) => {
      if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) return;
      if (world[y][x] !== 1) {
        world[y][x] = 1;
        roads.push({ x, y });
      }
    };

    const horizontalRows = [6, 14, 22, 30, 38, 46, 54];
    const verticalCols = [8, 16, 24, 32, 40, 48, 56];

    horizontalRows.forEach((row) => {
      for (let offset = -1; offset <= 1; offset += 1) {
        for (let x = 0; x < mapWidth; x += 1) {
          carveRoad(x, row + offset);
        }
      }
    });

    verticalCols.forEach((col) => {
      for (let offset = -1; offset <= 1; offset += 1) {
        for (let y = 0; y < mapHeight; y += 1) {
          carveRoad(col + offset, y);
        }
      }
    });

    const fillBuildingRect = (x0, y0, w, h) => {
      for (let y = y0; y < y0 + h; y += 1) {
        for (let x = x0; x < x0 + w; x += 1) {
          if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
          if (world[y][x] !== 1) {
            world[y][x] = 2;
          }
        }
      }
    };

    const buildingRects = [
      { x: 2, y: 2, w: 10, h: 10 },
      { x: 20, y: 4, w: 8, h: 8 },
      { x: 34, y: 4, w: 10, h: 10 },
      { x: 44, y: 2, w: 12, h: 12 },
      { x: 6, y: 20, w: 10, h: 10 },
      { x: 18, y: 18, w: 12, h: 12 },
      { x: 32, y: 20, w: 10, h: 10 },
      { x: 46, y: 18, w: 10, h: 10 },
      { x: 8, y: 34, w: 12, h: 12 },
      { x: 24, y: 34, w: 10, h: 10 },
      { x: 38, y: 34, w: 10, h: 10 },
      { x: 50, y: 34, w: 8, h: 12 },
      { x: 10, y: 48, w: 10, h: 10 },
      { x: 26, y: 48, w: 10, h: 10 },
      { x: 40, y: 50, w: 10, h: 8 },
    ];

    buildingRects.forEach((rect) => fillBuildingRect(rect.x, rect.y, rect.w, rect.h));

    return { world, roads };
  }
})();
