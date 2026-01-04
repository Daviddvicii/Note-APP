(() => {
  const canvas = document.getElementById("game-canvas");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const levelEl = document.getElementById("level");
  const difficultySelect = document.getElementById("difficulty-select");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls?.querySelectorAll(".touch-btn");
  const coarseMediaQuery =
    typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(pointer: coarse)") : null;

  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const overlayHint = "←/→ or A/D to move · Space to launch/pause · R to restart";

  // Difficulty presets
  const DIFFICULTY_PRESETS = {
    easy: {
      paddleWidth: 130,
      minPaddleWidth: 100,
      baseBallSpeed: 300,
      ballSpeedIncrement: 1.01,
      maxBallSpeed: 500,
      lives: 5,
      brickRows: 4,
    },
    normal: {
      paddleWidth: 110,
      minPaddleWidth: 80,
      baseBallSpeed: 360,
      ballSpeedIncrement: 1.018,
      maxBallSpeed: 720,
      lives: 3,
      brickRows: 5,
    },
    hard: {
      paddleWidth: 90,
      minPaddleWidth: 60,
      baseBallSpeed: 420,
      ballSpeedIncrement: 1.025,
      maxBallSpeed: 900,
      lives: 2,
      brickRows: 6,
    },
  };

  let currentDifficulty = "normal";

  const config = {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    paddleHeight: 16,
    paddleSpeed: 420,
    paddleMarginBottom: 40,
    paddlePadding: 24,
    ballSize: 10,
    maxBounceAngle: Math.PI / 2.35,
    brick: {
      cols: 10,
      maxRows: 8,
      gap: 6,
      marginX: 28,
      topOffset: 70,
      height: 22,
    },
  };

  const paddleY = config.canvasHeight - config.paddleMarginBottom - config.paddleHeight;
  const palette = ["#39ff14", "#35d0a6", "#1ad4ff", "#b943ff", "#ff6ad5", "#ffb347", "#ffaa00"];

  const state = {
    paddleX: (config.canvasWidth - DIFFICULTY_PRESETS[currentDifficulty].paddleWidth) / 2,
    paddleWidth: DIFFICULTY_PRESETS[currentDifficulty].paddleWidth,
    paddleY,
    ballX: config.canvasWidth / 2,
    ballY: paddleY - config.ballSize,
    ballVX: 0,
    ballVY: 0,
    bricks: [],
    score: 0,
    lives: DIFFICULTY_PRESETS[currentDifficulty].lives,
    level: 1,
    phase: "idle",
    ballAttachedToPaddle: true,
  };

  const inputState = {
    keyLeft: false,
    keyRight: false,
    pointerDirection: 0,
  };
  const activePointerDirections = new Map();

  let lastFrameTime = performance.now();

  function getDifficultySettings() {
    return DIFFICULTY_PRESETS[currentDifficulty];
  }

  function paddleWidthForLevel(level) {
    const diff = getDifficultySettings();
    return Math.max(diff.paddleWidth - (level - 1) * 4, diff.minPaddleWidth);
  }

  function levelSpeedBoost(level) {
    return 1 + Math.min(level - 1, 8) * 0.08;
  }

  function baseBallSpeedForLevel(level) {
    return getDifficultySettings().baseBallSpeed * levelSpeedBoost(level);
  }

  function maxBallSpeedForLevel(level) {
    return getDifficultySettings().maxBallSpeed * levelSpeedBoost(level);
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = state.score.toString();
    if (livesEl) livesEl.textContent = state.lives.toString();
    if (levelEl) levelEl.textContent = state.level.toString();
  }

  function showOverlay(message, hint = overlayHint) {
    if (!overlay) return;
    overlay.replaceChildren();
    const mainLine = document.createElement("p");
    mainLine.textContent = message;
    overlay.appendChild(mainLine);
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

  function resetBallOnPaddle() {
    state.ballAttachedToPaddle = true;
    state.ballVX = 0;
    state.ballVY = 0;
    state.ballX = state.paddleX + state.paddleWidth / 2;
    state.ballY = state.paddleY - config.ballSize / 2 - 2;
  }

  function launchBall() {
    if (!state.ballAttachedToPaddle) return;
    state.ballAttachedToPaddle = false;
    const speed = baseBallSpeedForLevel(state.level);
    const horizontal = Math.random() * 1.2 - 0.6;
    const vx = horizontal * speed;
    const vyMagnitude = Math.sqrt(Math.max(speed * speed - vx * vx, 25));
    state.ballVX = vx;
    state.ballVY = -Math.abs(vyMagnitude);
  }

  function buildLevel(level) {
    const diff = getDifficultySettings();
    const rows = Math.min(diff.brickRows + Math.floor((level - 1) / 2), config.brick.maxRows);
    const cols = config.brick.cols;
    const gap = config.brick.gap;
    const offsetTop = config.brick.offsetTop;
    const offsetSide = config.brick.marginX;
    const availableWidth = config.canvasWidth - offsetSide * 2 - gap * (cols - 1);
    const brickWidth = availableWidth / cols;

    state.bricks = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = offsetSide + col * (brickWidth + gap);
        const y = offsetTop + row * (config.brick.height + gap);
        state.bricks.push({
          x,
          y,
          w: brickWidth,
          h: config.brick.height,
          alive: true,
          value: 50 + (rows - row) * 10 + level * 5,
          color: palette[(row + level) % palette.length],
        });
      }
    }
  }

  function increaseBallSpeed(factor) {
    const diff = getDifficultySettings();
    const currentSpeed = Math.hypot(state.ballVX, state.ballVY);
    const desiredSpeed = Math.min(currentSpeed * (factor || diff.ballSpeedIncrement), maxBallSpeedForLevel(state.level));
    if (desiredSpeed <= 0) return;
    const angle = Math.atan2(state.ballVY, state.ballVX);
    state.ballVX = Math.cos(angle) * desiredSpeed;
    state.ballVY = Math.sin(angle) * desiredSpeed;
  }

  function keepBallAttached() {
    if (!state.ballAttachedToPaddle) return;
    state.ballX = state.paddleX + state.paddleWidth / 2;
    state.ballY = state.paddleY - config.ballSize / 2 - 2;
  }

  function movePaddle(direction, delta) {
    if (!direction) return;
    state.paddleX += direction * config.paddleSpeed * delta;
    const maxX = config.canvasWidth - state.paddleWidth;
    if (state.paddleX < 0) state.paddleX = 0;
    if (state.paddleX > maxX) state.paddleX = maxX;
  }

  function handleWallCollisions() {
    const half = config.ballSize / 2;
    if (state.ballX - half <= 0 && state.ballVX < 0) {
      state.ballX = half;
      state.ballVX *= -1;
    } else if (state.ballX + half >= config.canvasWidth && state.ballVX > 0) {
      state.ballX = config.canvasWidth - half;
      state.ballVX *= -1;
    }

    if (state.ballY - half <= 0 && state.ballVY < 0) {
      state.ballY = half;
      state.ballVY *= -1;
    }
  }

  function handlePaddleCollision() {
    const half = config.ballSize / 2;
    const ballBottom = state.ballY + half;
    const paddleTop = state.paddleY;
    if (state.ballVY >= 0 && ballBottom >= paddleTop) {
      const withinX =
        state.ballX + half >= state.paddleX && state.ballX - half <= state.paddleX + state.paddleWidth;
      const withinY = state.ballY - half <= paddleTop + config.paddleHeight;
      if (withinX && withinY) {
        const paddleCenter = state.paddleX + state.paddleWidth / 2;
        const distanceFromCenter = state.ballX - paddleCenter;
        const normalized = Math.max(-1, Math.min(1, distanceFromCenter / (state.paddleWidth / 2)));
        const bounceAngle = normalized * config.maxBounceAngle;
        const speed = Math.min(
          Math.hypot(state.ballVX, state.ballVY) * 1.02,
          maxBallSpeedForLevel(state.level)
        );
        state.ballVX = speed * Math.sin(bounceAngle);
        state.ballVY = -Math.abs(speed * Math.cos(bounceAngle));
        state.ballY = paddleTop - half;
      }
    }
  }

  function handleBrickCollisions() {
    const half = config.ballSize / 2;
    const ballLeft = state.ballX - half;
    const ballRight = state.ballX + half;
    const ballTop = state.ballY - half;
    const ballBottom = state.ballY + half;

    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      const intersects =
        ballRight >= brick.x &&
        ballLeft <= brick.x + brick.w &&
        ballBottom >= brick.y &&
        ballTop <= brick.y + brick.h;
      if (!intersects) continue;

      brick.alive = false;
      state.score += brick.value;
      updateHud();

      const overlapLeft = ballRight - brick.x;
      const overlapRight = brick.x + brick.w - ballLeft;
      const overlapTop = ballBottom - brick.y;
      const overlapBottom = brick.y + brick.h - ballTop;
      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

      if (minOverlap === overlapLeft) {
        state.ballX = brick.x - half;
        state.ballVX = -Math.abs(state.ballVX);
      } else if (minOverlap === overlapRight) {
        state.ballX = brick.x + brick.w + half;
        state.ballVX = Math.abs(state.ballVX);
      } else if (minOverlap === overlapTop) {
        state.ballY = brick.y - half;
        state.ballVY = -Math.abs(state.ballVY);
      } else {
        state.ballY = brick.y + brick.h + half;
        state.ballVY = Math.abs(state.ballVY);
      }

      increaseBallSpeed();
      checkLevelCleared();
      break;
    }
  }

  function checkLevelCleared() {
    if (state.bricks.every((brick) => !brick.alive)) {
      state.level += 1;
      state.paddleWidth = paddleWidthForLevel(state.level);
      state.paddleX = (config.canvasWidth - state.paddleWidth) / 2;
      buildLevel(state.level);
      resetBallOnPaddle();
      state.phase = "between-levels";
      updateHud();
      showOverlay(`Level ${state.level} — Press Space to Start`);
    }
  }

  function handleLifeLost() {
    state.lives -= 1;
    updateHud();
    if (state.lives <= 0) {
      state.phase = "over";
      showOverlay("Game Over — Press Space to Restart");
    } else {
      state.phase = "idle";
      resetBallOnPaddle();
      showOverlay("Life lost — Press Space to continue");
    }
  }

  function startNewGame() {
    currentDifficulty = difficultySelect?.value || "normal";
    const diff = getDifficultySettings();
    
    state.score = 0;
    state.lives = diff.lives;
    state.level = 1;
    state.phase = "idle";
    state.paddleWidth = paddleWidthForLevel(state.level);
    state.paddleX = (config.canvasWidth - state.paddleWidth) / 2;
    buildLevel(state.level);
    resetBallOnPaddle();
    updateHud();
    showOverlay("Press Space or Tap to Start");
  }

  function beginLevel() {
    hideOverlay();
    state.phase = "running";
    lastFrameTime = performance.now();
    if (state.ballAttachedToPaddle) {
      launchBall();
    }
  }

  function pauseGame(message = "Paused — Press Space to Resume") {
    if (state.phase !== "running") return;
    state.phase = "paused";
    showOverlay(message);
  }

  function resumeGame() {
    if (state.phase !== "paused") return;
    hideOverlay();
    state.phase = "running";
    lastFrameTime = performance.now();
  }

  function handlePrimaryAction() {
    switch (state.phase) {
      case "running":
        pauseGame();
        break;
      case "paused":
        resumeGame();
        break;
      case "idle":
      case "between-levels":
        beginLevel();
        break;
      case "over":
        startNewGame();
        break;
      default:
        break;
    }
  }

  function keyboardDirection() {
    if (inputState.keyLeft && !inputState.keyRight) return -1;
    if (inputState.keyRight && !inputState.keyLeft) return 1;
    return 0;
  }

  function currentDirection() {
    if (inputState.pointerDirection !== 0) {
      return inputState.pointerDirection;
    }
    return keyboardDirection();
  }

  function handleKeyDown(event) {
    const { code } = event;

    if (code === "Space") {
      event.preventDefault();
      handlePrimaryAction();
      return;
    }

    if (code === "KeyR") {
      event.preventDefault();
      startNewGame();
      return;
    }

    if (code === "ArrowLeft" || code === "KeyA") {
      event.preventDefault();
      inputState.keyLeft = true;
    } else if (code === "ArrowRight" || code === "KeyD") {
      event.preventDefault();
      inputState.keyRight = true;
    }
  }

  function handleKeyUp(event) {
    const { code } = event;
    if (code === "ArrowLeft" || code === "KeyA") {
      inputState.keyLeft = false;
    } else if (code === "ArrowRight" || code === "KeyD") {
      inputState.keyRight = false;
    }
  }

  function refreshPointerDirection() {
    if (!activePointerDirections.size) {
      inputState.pointerDirection = 0;
      return;
    }
    let lastDirection = 0;
    activePointerDirections.forEach((dir) => {
      lastDirection = dir;
    });
    inputState.pointerDirection = lastDirection;
  }

  function bindTouchControls() {
    if (!touchButtons || !touchButtons.length) return;
    touchButtons.forEach((button) => {
      const direction = Math.sign(Number(button.dataset.direction || 0));
      if (!direction) return;

      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        activePointerDirections.set(event.pointerId, direction);
        refreshPointerDirection();
      });

      button.addEventListener("pointerup", (event) => {
        button.releasePointerCapture(event.pointerId);
        activePointerDirections.delete(event.pointerId);
        refreshPointerDirection();
      });

      ["pointerleave", "pointercancel"].forEach((type) => {
        button.addEventListener(type, (event) => {
          if (event.pointerId != null) {
            activePointerDirections.delete(event.pointerId);
          }
          refreshPointerDirection();
        });
      });
    });
  }

  function syncTouchVisibility() {
    if (!touchControls) return;
    const isTouchPreferred = coarseMediaQuery ? coarseMediaQuery.matches : false;
    touchControls.setAttribute("aria-hidden", isTouchPreferred ? "false" : "true");
  }

  function handleVisibilityChange() {
    if (document.hidden && state.phase === "running") {
      pauseGame("Paused — Tab inactive. Press Space to Resume");
    }
  }

  function update(delta) {
    const direction = currentDirection();
    if (direction) {
      movePaddle(direction, delta);
    }
    keepBallAttached();

    if (state.phase !== "running") {
      return;
    }

    state.ballX += state.ballVX * delta;
    state.ballY += state.ballVY * delta;

    handleWallCollisions();
    handlePaddleCollision();
    handleBrickCollisions();

    if (state.ballY - config.ballSize / 2 > config.canvasHeight) {
      handleLifeLost();
    }
  }

  function render() {
    ctx.clearRect(0, 0, config.canvasWidth, config.canvasHeight);
    ctx.fillStyle = "#020202";
    ctx.fillRect(0, 0, config.canvasWidth, config.canvasHeight);

    state.bricks.forEach((brick) => {
      if (!brick.alive) return;
      ctx.save();
      ctx.fillStyle = brick.color;
      ctx.shadowColor = brick.color;
      ctx.shadowBlur = 12;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      ctx.restore();
    });

    ctx.save();
    ctx.fillStyle = "#39ff14";
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 18;
    ctx.fillRect(state.paddleX, state.paddleY, state.paddleWidth, config.paddleHeight);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#f2fff5";
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, config.ballSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function loop(now) {
    const delta = Math.min((now - lastFrameTime) / 1000, 0.04);
    lastFrameTime = now;
    update(delta);
    render();
    requestAnimationFrame(loop);
  }

  // Difficulty selector change handler
  if (difficultySelect) {
    difficultySelect.addEventListener("change", () => {
      if (state.phase === "idle" || state.phase === "over") {
        startNewGame();
      }
    });
  }

  overlay?.addEventListener("click", handlePrimaryAction);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  bindTouchControls();
  syncTouchVisibility();

  if (coarseMediaQuery) {
    const handler = () => syncTouchVisibility();
    if (typeof coarseMediaQuery.addEventListener === "function") {
      coarseMediaQuery.addEventListener("change", handler);
    } else if (typeof coarseMediaQuery.addListener === "function") {
      coarseMediaQuery.addListener(handler);
    }
  }

  startNewGame();
  requestAnimationFrame(loop);
})();
