(() => {
  const canvas = document.getElementById("game-canvas");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score-value");
  const missionEl = document.getElementById("mission-value");
  const speedEl = document.getElementById("speed-value");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls ? touchControls.querySelectorAll(".touch-btn") : null;
  const coarseMediaQuery =
    typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(pointer: coarse)") : null;

  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const overlayHint = "Arrow keys or WASD to drive · Space handbrake · P pause · R restart";
  const defaultMission = "Drive to the glowing checkpoint";
  const missionUpdates = [
    "New route uploaded — follow the glow!",
    "Great driving! A fresh checkpoint just lit up.",
    "Courier call! Cruise to the next neon ring.",
    "Keep the lights bright — next destination marked.",
  ];

  const config = {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    tileSize: 16,
    mapWidth: 60,
    mapHeight: 60,
    car: {
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      maxSpeed: 140,
      accel: 220,
      friction: 140,
      turnSpeed: 2.6,
      radius: 8,
      halfWidth: 6,
      halfLength: 11,
    },
  };

  const state = {
    world: [],
    car: { ...config.car },
    cameraX: canvas.width / 2,
    cameraY: canvas.height / 2,
    checkpoint: { x: 0, y: 0, radius: 24 },
    score: 0,
    missionText: defaultMission,
  };

  const inputState = {
    accelerate: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  };

  let phase = "idle"; // idle | running | paused
  let lastFrameTime = performance.now();

  init();

  function init() {
    state.world = generateWorld();
    resetCarPosition();
    state.checkpoint = pickCheckpoint(true);
    updateHUD();
    showOverlay("Press Space or Tap to Start");
    bindEvents();
    requestAnimationFrame(loop);
  }

  // --- World generation ----------------------------------------------------

  function generateWorld() {
    const { mapWidth, mapHeight } = config;
    const world = Array.from({ length: mapHeight }, () => Array(mapWidth).fill(0));

    // Start with a grid of neon streets every 6 tiles.
    for (let y = 0; y < mapHeight; y += 1) {
      for (let x = 0; x < mapWidth; x += 1) {
        if (x % 6 === 3 || y % 6 === 3) {
          world[y][x] = 1; // road
        }
      }
    }

    // Add a few rectilinear avenues for variety.
    for (let n = 0; n < 4; n += 1) {
      const horizontal = Math.random() > 0.5;
      if (horizontal) {
        const row = 5 + Math.floor(Math.random() * (mapHeight - 10));
        for (let x = 2; x < mapWidth - 2; x += 1) {
          world[row][x] = 1;
          if (Math.random() < 0.35 && row + 1 < mapHeight) world[row + 1][x] = 1;
        }
      } else {
        const col = 5 + Math.floor(Math.random() * (mapWidth - 10));
        for (let y = 2; y < mapHeight - 2; y += 1) {
          world[y][col] = 1;
          if (Math.random() < 0.35 && col + 1 < mapWidth) world[y][col + 1] = 1;
        }
      }
    }

    // Sprinkle building blocks (solid walls) alongside roads.
    for (let y = 0; y < mapHeight; y += 1) {
      for (let x = 0; x < mapWidth; x += 1) {
        if (world[y][x] === 1) continue;
        const nearRoad =
          world[y]?.[x - 1] === 1 ||
          world[y]?.[x + 1] === 1 ||
          world[y - 1]?.[x] === 1 ||
          world[y + 1]?.[x] === 1;
        if (nearRoad && Math.random() < 0.7) {
          world[y][x] = 2; // building
        } else if (Math.random() < 0.18) {
          world[y][x] = 2;
        }
      }
    }

    // Keep a soft grass border to keep players on the map.
    for (let x = 0; x < mapWidth; x += 1) {
      world[0][x] = 2;
      world[mapHeight - 1][x] = 2;
    }
    for (let y = 0; y < mapHeight; y += 1) {
      world[y][0] = 2;
      world[y][mapWidth - 1] = 2;
    }

    return world;
  }

  function findSpawnPoint() {
    const centerX = Math.floor(config.mapWidth / 2);
    const centerY = Math.floor(config.mapHeight / 2);
    const maxRadius = Math.max(config.mapWidth, config.mapHeight);

    for (let radius = 0; radius < maxRadius; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = centerX + dx;
          const y = centerY + dy;
          if (x < 0 || y < 0 || x >= config.mapWidth || y >= config.mapHeight) {
            continue;
          }
          if (state.world[y][x] === 1) {
            return {
              x: x * config.tileSize + config.tileSize / 2,
              y: y * config.tileSize + config.tileSize / 2,
            };
          }
        }
      }
    }

    return {
      x: config.tileSize * 2,
      y: config.tileSize * 2,
    };
  }

  function resetCarPosition() {
    const spawn = findSpawnPoint();
    state.car.x = spawn.x;
    state.car.y = spawn.y;
    state.car.angle = 0;
    state.car.speed = 0;
  }

  function pickCheckpoint(forceFar) {
    const maxAttempts = 200;
    const minDistance = forceFar ? config.tileSize * 10 : config.tileSize * 6;
    const worldWidth = config.mapWidth * config.tileSize;
    const worldHeight = config.mapHeight * config.tileSize;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const tileX = Math.floor(Math.random() * config.mapWidth);
      const tileY = Math.floor(Math.random() * config.mapHeight);
      if (state.world?.[tileY]?.[tileX] !== 1) continue;
      const worldX = tileX * config.tileSize + config.tileSize / 2;
      const worldY = tileY * config.tileSize + config.tileSize / 2;
      const dx = worldX - state.car.x;
      const dy = worldY - state.car.y;
      if (Math.hypot(dx, dy) < minDistance) continue;

      return {
        x: clamp(worldX, 40, worldWidth - 40),
        y: clamp(worldY, 40, worldHeight - 40),
        radius: 24,
      };
    }

    // Fallback: drop near center if no good tile is found.
    return {
      x: (config.mapWidth / 2) * config.tileSize,
      y: (config.mapHeight / 2) * config.tileSize,
      radius: 24,
    };
  }

  // --- HUD / overlay helpers ----------------------------------------------

  function updateHUD() {
    if (scoreEl) scoreEl.textContent = state.score.toString();
    if (missionEl) missionEl.textContent = state.missionText;
    updateSpeedDisplay();
  }

  function updateSpeedDisplay() {
    if (!speedEl) return;
    const kmh = Math.round(Math.abs(state.car.speed) * 0.24);
    speedEl.textContent = `${kmh} km/h`;
  }

  function setMissionText(text) {
    state.missionText = text;
    if (missionEl) missionEl.textContent = text;
  }

  function showOverlay(message, hint = overlayHint) {
    if (!overlay) return;
    overlay.replaceChildren();
    const line = document.createElement("div");
    line.textContent = message;
    overlay.appendChild(line);
    if (hint) {
      const hintLine = document.createElement("span");
      hintLine.textContent = hint;
      overlay.appendChild(hintLine);
    }
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  // --- Input binding -------------------------------------------------------

  function bindEvents() {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    overlay?.addEventListener("click", handlePrimaryAction);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && phase === "running") {
        pauseGame("Paused — tab inactive");
      }
    });
    bindTouchControls();
    syncTouchVisibility();
    if (coarseMediaQuery?.addEventListener) {
      coarseMediaQuery.addEventListener("change", syncTouchVisibility);
    } else if (coarseMediaQuery?.addListener) {
      coarseMediaQuery.addListener(syncTouchVisibility);
    }
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
        if (phase === "running") {
          inputState.handbrake = true;
        } else {
          handlePrimaryAction();
        }
        break;
      case "KeyP":
        event.preventDefault();
        togglePause();
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

  function bindTouchControls() {
    if (!touchButtons || !touchButtons.length) return;
    touchButtons.forEach((button) => {
      const action = button.dataset.action;
      if (!action) return;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        applyTouchAction(action, true);
      });
      button.addEventListener("pointerup", (event) => {
        button.releasePointerCapture?.(event.pointerId);
        applyTouchAction(action, false);
      });
      ["pointerleave", "pointercancel"].forEach((type) => {
        button.addEventListener(type, () => {
          applyTouchAction(action, false);
        });
      });
    });
  }

  function applyTouchAction(action, active) {
    switch (action) {
      case "accelerate":
        inputState.accelerate = active;
        break;
      case "brake":
        inputState.brake = active;
        break;
      case "steer-left":
        inputState.steerLeft = active;
        break;
      case "steer-right":
        inputState.steerRight = active;
        break;
      case "handbrake":
        inputState.handbrake = active;
        break;
      default:
        break;
    }
  }

  function syncTouchVisibility() {
    if (!touchControls) return;
    const prefersTouch = coarseMediaQuery ? coarseMediaQuery.matches : false;
    touchControls.setAttribute("aria-hidden", prefersTouch ? "false" : "true");
  }

  function resetInputs() {
    Object.keys(inputState).forEach((key) => {
      inputState[key] = false;
    });
  }

  // --- Game phase helpers --------------------------------------------------

  function handlePrimaryAction() {
    if (phase === "idle") {
      startGame();
    } else if (phase === "paused") {
      resumeGame();
    }
  }

  function startGame() {
    phase = "running";
    hideOverlay();
    lastFrameTime = performance.now();
  }

  function pauseGame(message = "Paused — Press Space or Tap to Resume") {
    if (phase !== "running") return;
    phase = "paused";
    showOverlay(message);
  }

  function resumeGame() {
    if (phase !== "paused") return;
    phase = "running";
    hideOverlay();
    lastFrameTime = performance.now();
  }

  function togglePause() {
    if (phase === "running") {
      pauseGame();
    } else if (phase === "paused") {
      resumeGame();
    }
  }

  function resetGame() {
    resetInputs();
    resetCarPosition();
    state.score = 0;
    setMissionText(defaultMission);
    state.checkpoint = pickCheckpoint(true);
    phase = "idle";
    updateHUD();
    showOverlay("Press Space or Tap to Start");
  }

  // --- Simulation ----------------------------------------------------------

  function loop(now) {
    const delta = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;

    if (phase === "running") {
      updateGame(delta);
    } else {
      // Even when idle we refresh the speed readout so it settles at zero.
      updateSpeedDisplay();
    }

    updateCamera(delta);
    render();
    requestAnimationFrame(loop);
  }

  function updateGame(delta) {
    const car = state.car;
    // Acceleration / braking
    if (inputState.accelerate) {
      car.speed = Math.min(car.speed + car.accel * delta, car.maxSpeed);
    }
    if (inputState.brake) {
      car.speed = Math.max(car.speed - car.accel * 0.9 * delta, -car.maxSpeed * 0.35);
    }

    if (!inputState.accelerate && !inputState.brake) {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - car.friction * delta);
      } else if (car.speed < 0) {
        car.speed = Math.min(0, car.speed + car.friction * delta);
      }
    }

    if (inputState.handbrake) {
      if (car.speed > 0) {
        car.speed = Math.max(0, car.speed - car.friction * 2 * delta);
      } else if (car.speed < 0) {
        car.speed = Math.min(0, car.speed + car.friction * 2 * delta);
      }
    }

    const steer =
      (inputState.steerRight ? 1 : 0) - (inputState.steerLeft ? 1 : 0); // right positive
    const speedFactor = Math.min(Math.abs(car.speed) / 40, 1);
    if (steer !== 0 && speedFactor > 0) {
      const direction = car.speed >= 0 ? 1 : -1;
      car.angle += steer * car.turnSpeed * speedFactor * direction * delta;
    }

    car.x += Math.cos(car.angle) * car.speed * delta;
    car.y += Math.sin(car.angle) * car.speed * delta;

    clampCarToWorld();
    resolveBuildingCollisions();
    checkCheckpoint();
    updateHUD();
  }

  function clampCarToWorld() {
    const boundsX = config.mapWidth * config.tileSize;
    const boundsY = config.mapHeight * config.tileSize;
    const r = state.car.radius + 2;
    state.car.x = clamp(state.car.x, r, boundsX - r);
    state.car.y = clamp(state.car.y, r, boundsY - r);
  }

  function resolveBuildingCollisions() {
    const car = state.car;
    const radius = car.radius;
    const tileSize = config.tileSize;
    const minTileX = Math.max(0, Math.floor((car.x - radius) / tileSize));
    const maxTileX = Math.min(config.mapWidth - 1, Math.floor((car.x + radius) / tileSize));
    const minTileY = Math.max(0, Math.floor((car.y - radius) / tileSize));
    const maxTileY = Math.min(config.mapHeight - 1, Math.floor((car.y + radius) / tileSize));

    for (let ty = minTileY; ty <= maxTileY; ty += 1) {
      for (let tx = minTileX; tx <= maxTileX; tx += 1) {
        if (state.world[ty][tx] !== 2) continue;
        const tileLeft = tx * tileSize;
        const tileTop = ty * tileSize;
        const tileRight = tileLeft + tileSize;
        const tileBottom = tileTop + tileSize;
        const closestX = clamp(car.x, tileLeft, tileRight);
        const closestY = clamp(car.y, tileTop, tileBottom);
        let dx = car.x - closestX;
        let dy = car.y - closestY;
        let distSq = dx * dx + dy * dy;

        if (distSq < radius * radius - 0.001) {
          if (distSq === 0) {
            // Car center is exactly inside tile — push outward along the steepest axis.
            dx = car.x - (tileLeft + tileSize / 2);
            dy = car.y - (tileTop + tileSize / 2);
            distSq = dx * dx + dy * dy || 1;
          }
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          car.x += nx * overlap;
          car.y += ny * overlap;
          car.speed *= -0.2; // bounce back a tad
        }
      }
    }
  }

  function checkCheckpoint() {
    const dx = state.car.x - state.checkpoint.x;
    const dy = state.car.y - state.checkpoint.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= state.checkpoint.radius) {
      state.score += 100;
      const newMission =
        missionUpdates[Math.floor(Math.random() * missionUpdates.length)] ?? defaultMission;
      setMissionText(newMission);
      state.checkpoint = pickCheckpoint(true);
    }
  }

  function updateCamera(delta) {
    const halfW = config.canvasWidth / 2;
    const halfH = config.canvasHeight / 2;
    const worldWidth = config.mapWidth * config.tileSize;
    const worldHeight = config.mapHeight * config.tileSize;
    const targetX = clamp(state.car.x, halfW, worldWidth - halfW);
    const targetY = clamp(state.car.y, halfH, worldHeight - halfH);
    const smoothing = 1 - Math.exp(-delta * 6);
    state.cameraX += (targetX - state.cameraX) * smoothing;
    state.cameraY += (targetY - state.cameraY) * smoothing;
  }

  // --- Rendering -----------------------------------------------------------

  function render() {
    ctx.clearRect(0, 0, config.canvasWidth, config.canvasHeight);
    drawWorld();
    drawCheckpoint();
    drawCar();
  }

  function drawWorld() {
    const { tileSize, canvasWidth, canvasHeight } = config;
    const halfW = canvasWidth / 2;
    const halfH = canvasHeight / 2;
    const left = state.cameraX - halfW;
    const top = state.cameraY - halfH;
    const startX = Math.max(0, Math.floor(left / tileSize) - 1);
    const endX = Math.min(config.mapWidth - 1, Math.ceil((left + canvasWidth) / tileSize) + 1);
    const startY = Math.max(0, Math.floor(top / tileSize) - 1);
    const endY = Math.min(config.mapHeight - 1, Math.ceil((top + canvasHeight) / tileSize) + 1);

    ctx.fillStyle = "#020d07";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const tile = state.world[y][x];
        if (tile === 0) continue; // grass already drawn

        const screenX = x * tileSize - state.cameraX + halfW;
        const screenY = y * tileSize - state.cameraY + halfH;

        if (tile === 1) {
          ctx.fillStyle = "#08131b";
          ctx.fillRect(screenX, screenY, tileSize + 1, tileSize + 1);
          ctx.fillStyle = "rgba(57,255,20,0.18)";
          if ((x + y) % 2 === 0) {
            ctx.fillRect(screenX + tileSize / 2 - 1, screenY + 3, 2, tileSize - 6);
          } else {
            ctx.fillRect(screenX + 3, screenY + tileSize / 2 - 1, tileSize - 6, 2);
          }
        } else if (tile === 2) {
          ctx.fillStyle = "#08130e";
          ctx.fillRect(screenX, screenY, tileSize + 1, tileSize + 1);
          ctx.strokeStyle = "rgba(57,255,20,0.25)";
          ctx.lineWidth = 1;
          ctx.strokeRect(screenX + 1, screenY + 1, tileSize - 2, tileSize - 2);
          ctx.fillStyle = "rgba(57,255,20,0.08)";
          ctx.fillRect(screenX + 3, screenY + 3, tileSize - 6, tileSize - 6);
        }
      }
    }
  }

  function drawCheckpoint() {
    if (!state.checkpoint) return;
    const { x, y, radius } = state.checkpoint;
    const screen = worldToScreen(x, y);
    ctx.save();
    ctx.strokeStyle = "#39ff14";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCar() {
    const car = state.car;
    const screen = worldToScreen(car.x, car.y);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(car.angle);
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#39ff14";
    ctx.fillRect(-car.halfLength, -car.halfWidth, car.halfLength * 2, car.halfWidth * 2);
    ctx.fillStyle = "#0b1f16";
    ctx.fillRect(-car.halfLength + 4, -car.halfWidth + 3, car.halfLength * 2 - 8, car.halfWidth * 2 - 6);
    ctx.fillStyle = "#39ff1499";
    ctx.fillRect(-car.halfLength + 2, -2, car.halfLength - 4, 4);
    ctx.restore();
  }

  function worldToScreen(worldX, worldY) {
    return {
      x: worldX - state.cameraX + config.canvasWidth / 2,
      y: worldY - state.cameraY + config.canvasHeight / 2,
    };
  }

  // --- Utilities -----------------------------------------------------------

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
