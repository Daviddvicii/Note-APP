(() => {
  const canvas = document.getElementById("game-canvas");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const levelEl = document.getElementById("level");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls?.querySelectorAll(".touch-btn");
  const coarseMediaQuery = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;

  const defaultHint = "←/→ or A/D to move · Space to launch/pause · R to restart";
  const palette = ["#39ff14", "#35d0a6", "#1ad4ff", "#b943ff", "#ff6ad5", "#ffb347", "#ffaa00"];
  const touchButtons = touchControls?.querySelectorAll(".touch-btn") || null;
  const coarseMediaQuery =
    typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(pointer: coarse)") : null;

  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const overlayHint = "←/→ or A/D to move · Space to launch/pause · R to restart";

  const config = {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    paddleWidth: 110,
    paddleHeight: 16,
    paddleSpeed: 420,
    paddleMarginBottom: 40,
    paddlePadding: 24,
    ballSize: 10,
    baseBallSpeed: 360,
    ballSpeedIncrement: 1.018,
    maxBallSpeed: 760,
    maxBounceAngle: Math.PI / 2.35,
    brick: {
      cols: 10,
      baseRows: 5,
      maxRows: 8,
      gap: 6,
      marginX: 28,
      topOffset: 70,
      height: 22,
    },
  };

  const paddleY = config.canvasHeight - config.paddleMarginBottom - config.paddleHeight;

  const state = {
    paddleX: (config.canvasWidth - config.paddleWidth) / 2,
    paddleY,
    ballX: config.canvasWidth / 2,
    ballY: paddleY - config.ballSize,
    ballVX: 0,
    ballVY: 0,
    bricks: [],
    bricksAlive: 0,
    score: 0,
    lives: 3,
    level: 1,
    ballSpeed: config.baseBallSpeed,
  };

  const keyState = { left: false, right: false };
  let pointerDirection = 0;
  let moveDirection = 0;
  let phase = "idle"; // idle | running | paused | over | between-levels
  let ballAttachedToPaddle = true;
  let lastFrameTime = performance.now();

  function updateHUD() {
    minPaddleWidth: 80,
    paddleHeight: 16,
    paddleBottomMargin: 40,
    paddleSpeed: 420,
    ballSize: 10,
    baseBallSpeed: 360,
    maxBallSpeed: 720,
    maxBounceAngle: Math.PI / 3,
    brick: {
      cols: 10,
      baseRows: 5,
      height: 24,
      gap: 8,
      offsetTop: 70,
      offsetSide: 28,
    },
  };

  const state = {
    paddleX: 0,
    paddleWidth: config.paddleWidth,
    paddleY: config.canvasHeight - config.paddleBottomMargin - config.paddleHeight,
    ballX: 0,
    ballY: 0,
    ballVX: 0,
    ballVY: 0,
    ballAttachedToPaddle: true,
    bricks: [],
    score: 0,
    lives: 3,
    level: 1,
    phase: "idle", // idle | running | paused | over | between-levels
  };

  const inputState = {
    keyLeft: false,
    keyRight: false,
    pointerDirection: 0,
  };
  const activePointerDirections = new Map();

  let lastFrameTime = performance.now();

  function paddleWidthForLevel(level) {
    return Math.max(config.paddleWidth - (level - 1) * 4, config.minPaddleWidth);
  }

  function levelSpeedBoost(level) {
    return 1 + Math.min(level - 1, 8) * 0.08;
  }

  function baseBallSpeedForLevel(level) {
    return config.baseBallSpeed * levelSpeedBoost(level);
  }

  function maxBallSpeedForLevel(level) {
    return config.maxBallSpeed * levelSpeedBoost(level);
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = state.score.toString();
    if (livesEl) livesEl.textContent = state.lives.toString();
    if (levelEl) levelEl.textContent = state.level.toString();
  }

  function showOverlay(message, hint = defaultHint) {
    if (!overlay) return;
    overlay.replaceChildren();
    const main = document.createElement("div");
    main.textContent = message;
    overlay.appendChild(main);
    if (hint) {
      const span = document.createElement("span");
      span.textContent = hint;
      overlay.appendChild(span);
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

  function resetMoveInput() {
    keyState.left = false;
    keyState.right = false;
    pointerDirection = 0;
    recalcMoveDirection();
  }

  function recalcMoveDirection() {
    const keyDir = (keyState.left ? -1 : 0) + (keyState.right ? 1 : 0);
    if (keyDir !== 0) {
      moveDirection = keyDir < 0 ? -1 : 1;
    } else {
      moveDirection = pointerDirection;
    }
  }

  function clampPaddle() {
    const min = config.paddlePadding;
    const max = config.canvasWidth - config.paddleWidth - config.paddlePadding;
    if (state.paddleX < min) state.paddleX = min;
    if (state.paddleX > max) state.paddleX = max;
  }

  function alignBallWithPaddle() {
    state.ballX = state.paddleX + config.paddleWidth / 2;
    state.ballY = state.paddleY - config.ballSize / 2 - 4;
  }

  function resetBallOnPaddle(centerPaddle = false) {
    if (centerPaddle) {
      state.paddleX = (config.canvasWidth - config.paddleWidth) / 2;
    }
    ballAttachedToPaddle = true;
    state.ballVX = 0;
    state.ballVY = 0;
    alignBallWithPaddle();
  }

  function buildLevel(level) {
    const rows = Math.min(config.brick.baseRows + (level - 1), config.brick.maxRows);
    const totalGap = (config.brick.cols - 1) * config.brick.gap;
    const brickWidth =
      (config.canvasWidth - config.brick.marginX * 2 - totalGap) / config.brick.cols;
    const bricks = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < config.brick.cols; col += 1) {
        const x = config.brick.marginX + col * (brickWidth + config.brick.gap);
        const y = config.brick.topOffset + row * (config.brick.height + config.brick.gap);
        bricks.push({
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
    const horizontal = (Math.random() * 1.2 - 0.6);
    const vx = horizontal * speed;
    const vyMagnitude = Math.sqrt(Math.max(speed * speed - vx * vx, 25));
    state.ballVX = vx;
    state.ballVY = -Math.abs(vyMagnitude);
  }

  function buildLevel(level) {
    const rows = config.brick.baseRows + Math.min(level - 1, 5);
    const cols = config.brick.cols;
    const gap = config.brick.gap;
    const offsetTop = config.brick.offsetTop;
    const offsetSide = config.brick.offsetSide;
    const availableWidth = config.canvasWidth - offsetSide * 2 - gap * (cols - 1);
    const brickWidth = availableWidth / cols;
    const colors = ["#39ff14", "#35d0a6", "#32ffd5", "#39c5ff", "#ff6fed", "#ffaa39"];

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
          value: 50 + row * 10 + level * 5,
          color: palette[(row + level) % palette.length],
        });
      }
    }

    state.bricks = bricks;
    state.bricksAlive = bricks.length;
    state.ballSpeed = config.baseBallSpeed + (level - 1) * 18;
  }

  function startNewGame() {
    state.score = 0;
    state.lives = 3;
    state.level = 1;
    buildLevel(state.level);
    resetBallOnPaddle(true);
    resetMoveInput();
    updateHUD();
    phase = "idle";
    showOverlay("Press Space or Tap to Start", defaultHint);
  }

  function launchBall() {
    if (!ballAttachedToPaddle) return;
    ballAttachedToPaddle = false;
    const angle = (-Math.PI / 4) + Math.random() * (Math.PI / 6);
    const speed = state.ballSpeed;
    state.ballVX = Math.sin(angle) * speed;
    state.ballVY = -Math.cos(angle) * speed;
  }

  function beginLevel() {
    if (phase === "over") {
      startNewGame();
      return;
    }
    if (phase === "running") return;
    hideOverlay();
    phase = "running";
    lastFrameTime = performance.now();
    launchBall();
  }

  function pauseGame(message = "Paused — Press Space or Tap to Resume") {
    if (phase !== "running") return;
    phase = "paused";
    showOverlay(message, defaultHint);
  }

  function resumeGame() {
    if (phase !== "paused") return;
    hideOverlay();
    phase = "running";
    lastFrameTime = performance.now();
  }

  function loseLife() {
    state.lives -= 1;
    updateHUD();
    if (state.lives <= 0) {
      phase = "over";
      resetBallOnPaddle(true);
      resetMoveInput();
      showOverlay("Game Over — Press Space to Restart", defaultHint);
      return;
    }
    phase = "idle";
    resetBallOnPaddle();
    resetMoveInput();
    showOverlay("Life lost — Press Space to continue", defaultHint);
  }

  function advanceLevel() {
    state.level += 1;
    buildLevel(state.level);
    resetBallOnPaddle();
    resetMoveInput();
    updateHUD();
    phase = "between-levels";
    showOverlay(`Level ${state.level} — Press Space to Start`, defaultHint);
  }

  function handleSpacePress() {
    if (phase === "running") {
      pauseGame();
    } else if (phase === "paused") {
      resumeGame();
    } else if (phase === "idle" || phase === "between-levels") {
      beginLevel();
    } else if (phase === "over") {
      startNewGame();
    }
  }

  function speedUpBall(factor = config.ballSpeedIncrement) {
    const speed = Math.hypot(state.ballVX, state.ballVY);
    if (speed === 0) return;
    const newSpeed = Math.min(speed * factor, config.maxBallSpeed);
    const angle = Math.atan2(state.ballVY, state.ballVX);
    state.ballVX = Math.cos(angle) * newSpeed;
    state.ballVY = Math.sin(angle) * newSpeed;
  }

  function handleWallCollisions() {
    if (ballAttachedToPaddle) return;
    const half = config.ballSize / 2;

          value: 50 + (rows - row) * 5 + level * 10,
          color: colors[row % colors.length],
        });
      }
    }
  }

  function increaseBallSpeed(factor = 1.02) {
    const currentSpeed = Math.hypot(state.ballVX, state.ballVY);
    const desiredSpeed = Math.min(currentSpeed * factor, maxBallSpeedForLevel(state.level));
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
    } else if (state.ballY - half > config.canvasHeight) {
      loseLife();
    }
  }

  function handlePaddleCollision() {
    if (ballAttachedToPaddle || state.ballVY <= 0) return;
    const half = config.ballSize / 2;
    const paddleTop = state.paddleY;
    const paddleBottom = paddleTop + config.paddleHeight;
    const paddleLeft = state.paddleX;
    const paddleRight = paddleLeft + config.paddleWidth;

    const ballBottom = state.ballY + half;
    const ballTop = state.ballY - half;
    const ballLeft = state.ballX - half;
    const ballRight = state.ballX + half;

    const intersects =
      ballBottom >= paddleTop &&
      ballTop <= paddleBottom &&
      ballRight >= paddleLeft &&
      ballLeft <= paddleRight &&
      state.ballVY > 0;

    if (!intersects) return;

    state.ballY = paddleTop - half;
    const paddleCenter = state.paddleX + config.paddleWidth / 2;
    const normalized = Math.max(-1, Math.min(1, (state.ballX - paddleCenter) / (config.paddleWidth / 2)));
    const bounceAngle = normalized * config.maxBounceAngle;
    const speed = Math.min(Math.hypot(state.ballVX, state.ballVY) * 1.02, config.maxBallSpeed);
    state.ballVX = Math.sin(bounceAngle) * speed;
    state.ballVY = -Math.abs(Math.cos(bounceAngle) * speed);
  }

  function handleBrickCollisions() {
    if (ballAttachedToPaddle) return;
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
      const overlaps =
        ballRight > brick.x &&
        ballLeft < brick.x + brick.w &&
        ballBottom > brick.y &&
        ballTop < brick.y + brick.h;
      if (!overlaps) continue;

      brick.alive = false;
      state.bricksAlive -= 1;
      state.score += brick.value;
      updateHUD();
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
      const minHorizontal = Math.min(overlapLeft, overlapRight);
      const minVertical = Math.min(overlapTop, overlapBottom);

      if (minHorizontal < minVertical) {
        state.ballVX *= -1;
        if (overlapLeft < overlapRight) {
          state.ballX = brick.x - half;
        } else {
          state.ballX = brick.x + brick.w + half;
        }
      } else {
        state.ballVY *= -1;
        if (overlapTop < overlapBottom) {
          state.ballY = brick.y - half;
        } else {
          state.ballY = brick.y + brick.h + half;
        }
      }

      speedUpBall();

      if (state.bricksAlive <= 0) {
        advanceLevel();
      }
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

      increaseBallSpeed(1.01);
      checkLevelCleared();
      break;
    }
  }

  function updateGame(delta) {
    if (phase !== "running") return;

    if (moveDirection !== 0) {
      state.paddleX += moveDirection * config.paddleSpeed * delta;
      clampPaddle();
    }

    if (ballAttachedToPaddle) {
      alignBallWithPaddle();
      return;
    }

    state.ballX += state.ballVX * delta;
    state.ballY += state.ballVY * delta;

    handleWallCollisions();
    if (phase !== "running") return; // loseLife might change phase

    handlePaddleCollision();
    handleBrickCollisions();
  }

  function renderBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, config.canvasHeight);
    gradient.addColorStop(0, "#050b05");
    gradient.addColorStop(1, "#000000");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, config.canvasWidth, config.canvasHeight);

    ctx.save();
    ctx.strokeStyle = "rgba(57, 255, 20, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 60; i < config.canvasHeight; i += 60) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(config.canvasWidth, i);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderBricks() {
    ctx.save();
    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      ctx.fillStyle = brick.color;
      ctx.shadowColor = brick.color;
      ctx.shadowBlur = 16;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
    }
    ctx.restore();
  }

  function renderPaddleAndBall() {
    ctx.save();
    ctx.fillStyle = "#39ff14";
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 18;
    ctx.fillRect(state.paddleX, state.paddleY, config.paddleWidth, config.paddleHeight);

    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, config.ballSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, config.canvasWidth, config.canvasHeight);
    renderBackground();
    renderBricks();
    renderPaddleAndBall();
  }

  function loop(now) {
    const delta = Math.min((now - lastFrameTime) / 1000, 0.035);
    lastFrameTime = now;
    updateGame(delta);
    render();
    requestAnimationFrame(loop);
  }

  function handleKeyDown(event) {
    if (event.repeat) return;
    switch (event.code) {
      case "ArrowLeft":
      case "KeyA":
        event.preventDefault();
        keyState.left = true;
        recalcMoveDirection();
        break;
      case "ArrowRight":
      case "KeyD":
        event.preventDefault();
        keyState.right = true;
        recalcMoveDirection();
        break;
      case "Space":
        event.preventDefault();
        handleSpacePress();
        break;
      case "KeyR":
        event.preventDefault();
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
    state.score = 0;
    state.lives = 3;
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

  function handleKeyUp(event) {
    switch (event.code) {
      case "ArrowLeft":
      case "KeyA":
        keyState.left = false;
        recalcMoveDirection();
        break;
      case "ArrowRight":
      case "KeyD":
        keyState.right = false;
        recalcMoveDirection();
        break;
      default:
        break;
    }
  }

  function bindTouchControls() {
    if (!touchButtons) return;
    touchButtons.forEach((button) => {
      const direction = Number(button.dataset.direction) || 0;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        pointerDirection = direction;
        recalcMoveDirection();
      });

      const clearPointer = () => {
        if (pointerDirection === direction) {
          pointerDirection = 0;
          recalcMoveDirection();
        }
      };

      button.addEventListener("pointerup", (event) => {
        button.releasePointerCapture(event.pointerId);
        clearPointer();
      });

      ["pointercancel", "pointerleave"].forEach((type) => {
        button.addEventListener(type, clearPointer);
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
    if (document.hidden && phase === "running") {
      pauseGame("Paused (tab inactive) — Press Space or Tap to Resume");
    }
  }

  overlay?.addEventListener("click", () => {
    if (phase === "paused") {
      resumeGame();
    } else {
      beginLevel();
    }
  });

    const coarse = coarseMediaQuery ? coarseMediaQuery.matches : window.matchMedia("(pointer: coarse)").matches;
    touchControls.setAttribute("aria-hidden", coarse ? "false" : "true");
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

  overlay?.addEventListener("click", handlePrimaryAction);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  bindTouchControls();
  syncTouchVisibility();
  coarseMediaQuery?.addEventListener?.("change", syncTouchVisibility);

  if (coarseMediaQuery) {
    const handler = () => syncTouchVisibility();
    if (typeof coarseMediaQuery.addEventListener === "function") {
      coarseMediaQuery.addEventListener("change", handler);
    } else if (typeof coarseMediaQuery.addListener === "function") {
      coarseMediaQuery.addListener(handler);
    }
  }

  bindTouchControls();
  syncTouchVisibility();
  startNewGame();
  requestAnimationFrame(loop);
})();
