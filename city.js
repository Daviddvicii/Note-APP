(() => {
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
    car: {
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      maxSpeed: 140,
      accel: 220,
      friction: 140,
      turnSpeed: 2.6,
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

  function drawTiles() {
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;
    const startX = Math.floor((state.cameraX - halfW) / config.tileSize) - 1;
    const endX = Math.floor((state.cameraX + halfW) / config.tileSize) + 1;
    const startY = Math.floor((state.cameraY - halfH) / config.tileSize) - 1;
    const endY = Math.floor((state.cameraY + halfH) / config.tileSize) + 1;

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
