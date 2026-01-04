(() => {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const levelEl = document.getElementById("level");

  const touchControls = document.getElementById("touch-controls");
  const coarseMediaQuery =
    typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(pointer: coarse)") : null;

  const STORAGE_KEY_DIFFICULTY = "neon_arena_difficulty";

  const palette = ["#39ff14", "#35d0a6", "#1ad4ff", "#b943ff", "#ff6ad5", "#ffb347", "#ffaa00"];
  const defaultHint = "←/→ or A/D to move · Space to launch/pause · R to restart";

  const DIFFICULTY_PRESETS = {
    easy: {
      label: "Easy",
      lives: 5,
      paddleWidth: 136,
      minPaddleWidth: 96,
      paddleSpeed: 460,
      baseBallSpeed: 320,
      ballSpeedIncrement: 1.012,
      maxBallSpeed: 640,
      maxBounceAngle: Math.PI / 2.6,
      brick: { baseRows: 4, maxExtraRows: 3 },
    },
    normal: {
      label: "Normal",
      lives: 3,
      paddleWidth: 112,
      minPaddleWidth: 80,
      paddleSpeed: 440,
      baseBallSpeed: 360,
      ballSpeedIncrement: 1.018,
      maxBallSpeed: 720,
      maxBounceAngle: Math.PI / 2.35,
      brick: { baseRows: 5, maxExtraRows: 4 },
    },
    hard: {
      label: "Hard",
      lives: 2,
      paddleWidth: 96,
      minPaddleWidth: 64,
      paddleSpeed: 430,
      baseBallSpeed: 420,
      ballSpeedIncrement: 1.026,
      maxBallSpeed: 840,
      maxBounceAngle: Math.PI / 2.15,
      brick: { baseRows: 6, maxExtraRows: 5 },
    },
  };

  const baseConfig = {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    paddleHeight: 16,
    paddleBottomMargin: 40,
    paddlePadding: 24,
    ballSize: 10,
    brick: {
      cols: 10,
      gap: 8,
      offsetTop: 70,
      offsetSide: 28,
      height: 24,
    },
  };

  const input = {
    keyLeft: false,
    keyRight: false,
    pointerDir: 0,
  };

  const state = {
    difficulty: "normal",
    phase: "idle", // idle | running | paused | over | between-levels
    score: 0,
    lives: 3,
    level: 1,
    paddleX: 0,
    paddleWidth: 112,
    ballX: 0,
    ballY: 0,
    ballVX: 0,
    ballVY: 0,
    ballAttachedToPaddle: true,
    bricks: [],
  };

  let lastFrameTime = performance.now();

  init();

  function init() {
    const saved = loadDifficulty();
    setDifficulty(saved, { restart: false });
    bindDifficultyUI();

    bindInput();
    bindTouchControls();
    syncTouchVisibility();
    coarseMediaQuery?.addEventListener?.("change", syncTouchVisibility);

    startNewGame();
    requestAnimationFrame(loop);
  }

  function getPreset() {
    return DIFFICULTY_PRESETS[state.difficulty] ?? DIFFICULTY_PRESETS.normal;
  }

  function loadDifficulty() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DIFFICULTY);
      return raw && raw in DIFFICULTY_PRESETS ? raw : "normal";
    } catch {
      return "normal";
    }
  }

  function saveDifficulty(value) {
    try {
      localStorage.setItem(STORAGE_KEY_DIFFICULTY, value);
    } catch {
      // ignore
    }
  }

  function setDifficulty(value, { restart } = { restart: true }) {
    const next = value in DIFFICULTY_PRESETS ? value : "normal";
    state.difficulty = next;
    saveDifficulty(next);

    // Apply preset-dependent starting values. Level scaling happens elsewhere.
    const preset = getPreset();
    state.lives = preset.lives;
    state.paddleWidth = preset.paddleWidth;

    // Sync UI radio buttons if present.
    const inputs = document.querySelectorAll('input[name="difficulty"]');
    inputs.forEach((el) => {
      if (el instanceof HTMLInputElement) el.checked = el.value === next;
    });

    if (restart) startNewGame();
  }

  function bindDifficultyUI() {
    const inputs = document.querySelectorAll('input[name="difficulty"]');
    inputs.forEach((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      el.addEventListener("change", () => {
        if (el.checked) setDifficulty(el.value, { restart: true });
      });
    });
  }

  function showOverlay(message, hint = defaultHint) {
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

  function updateHud() {
    if (scoreEl) scoreEl.textContent = String(state.score);
    if (livesEl) livesEl.textContent = String(state.lives);
    if (levelEl) levelEl.textContent = String(state.level);
  }

  function startNewGame() {
    const preset = getPreset();
    state.phase = "idle";
    state.score = 0;
    state.lives = preset.lives;
    state.level = 1;

    state.paddleWidth = preset.paddleWidth;
    state.paddleX = (baseConfig.canvasWidth - state.paddleWidth) / 2;

    buildLevel(state.level);
    resetBallOnPaddle(true);
    resetMoveInput();
    updateHud();

    showOverlay(`Neon Arena · ${preset.label} — Press Space or Tap to Start`, defaultHint);
  }

  function buildLevel(level) {
    const preset = getPreset();
    const cols = baseConfig.brick.cols;
    const gap = baseConfig.brick.gap;
    const offsetTop = baseConfig.brick.offsetTop;
    const offsetSide = baseConfig.brick.offsetSide;
    const availableWidth = baseConfig.canvasWidth - offsetSide * 2 - gap * (cols - 1);
    const brickWidth = availableWidth / cols;

    const extra = Math.min(level - 1, preset.brick.maxExtraRows);
    const rows = preset.brick.baseRows + extra;

    state.bricks = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = offsetSide + col * (brickWidth + gap);
        const y = offsetTop + row * (baseConfig.brick.height + gap);
        state.bricks.push({
          x,
          y,
          w: brickWidth,
          h: baseConfig.brick.height,
          alive: true,
          value: 40 + row * 10 + level * 10,
          color: palette[(row + level + col) % palette.length],
        });
      }
    }
  }

  function resetMoveInput() {
    input.keyLeft = false;
    input.keyRight = false;
    input.pointerDir = 0;
  }

  function keyboardDirection() {
    return (input.keyRight ? 1 : 0) + (input.keyLeft ? -1 : 0);
  }

  function currentDirection() {
    const keyDir = keyboardDirection();
    return keyDir !== 0 ? Math.sign(keyDir) : input.pointerDir;
  }

  function resetBallOnPaddle(centerPaddle) {
    if (centerPaddle) {
      state.paddleX = (baseConfig.canvasWidth - state.paddleWidth) / 2;
    }
    state.ballAttachedToPaddle = true;
    state.ballVX = 0;
    state.ballVY = 0;
    alignBallWithPaddle();
  }

  function alignBallWithPaddle() {
    state.ballX = state.paddleX + state.paddleWidth / 2;
    state.ballY = baseConfig.canvasHeight - baseConfig.paddleBottomMargin - baseConfig.paddleHeight - baseConfig.ballSize;
  }

  function launchBall() {
    if (!state.ballAttachedToPaddle) return;
    state.ballAttachedToPaddle = false;
    const preset = getPreset();
    const speed = preset.baseBallSpeed;
    const angle = (-Math.PI / 3.5) + Math.random() * (Math.PI / 7);
    state.ballVX = Math.sin(angle) * speed;
    state.ballVY = -Math.cos(angle) * speed;
  }

  function beginLevel() {
    if (state.phase === "running") return;
    if (state.phase === "over") {
      startNewGame();
      return;
    }
    hideOverlay();
    state.phase = "running";
    lastFrameTime = performance.now();
    if (state.ballAttachedToPaddle) launchBall();
  }

  function pauseGame(message = "Paused — Press Space or Tap to Resume") {
    if (state.phase !== "running") return;
    state.phase = "paused";
    showOverlay(message, defaultHint);
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

  function bindInput() {
    overlay?.addEventListener("click", handlePrimaryAction);

    window.addEventListener("keydown", (event) => {
      if (event.repeat) return;
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
        input.keyLeft = true;
      } else if (code === "ArrowRight" || code === "KeyD") {
        event.preventDefault();
        input.keyRight = true;
      }
    });

    window.addEventListener("keyup", (event) => {
      const { code } = event;
      if (code === "ArrowLeft" || code === "KeyA") input.keyLeft = false;
      if (code === "ArrowRight" || code === "KeyD") input.keyRight = false;
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.phase === "running") pauseGame("Paused — Tab inactive. Press Space to Resume");
    });
  }

  function bindTouchControls() {
    if (!touchControls) return;
    const buttons = touchControls.querySelectorAll(".touch-btn");
    if (!buttons.length) return;

    buttons.forEach((button) => {
      const dir = Math.sign(Number(button.dataset.direction || 0));
      if (!dir) return;

      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        input.pointerDir = dir;
      });

      const clear = (event) => {
        event.preventDefault();
        if (event.pointerId != null) {
          try {
            button.releasePointerCapture(event.pointerId);
          } catch {
            // ignore
          }
        }
        if (input.pointerDir === dir) input.pointerDir = 0;
      };

      button.addEventListener("pointerup", clear);
      button.addEventListener("pointercancel", clear);
      button.addEventListener("pointerleave", clear);
    });
  }

  function syncTouchVisibility() {
    if (!touchControls) return;
    const show = coarseMediaQuery ? coarseMediaQuery.matches : false;
    touchControls.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function movePaddle(direction, dt) {
    if (!direction) return;
    const preset = getPreset();
    state.paddleX += direction * preset.paddleSpeed * dt;
    const minX = baseConfig.paddlePadding;
    const maxX = baseConfig.canvasWidth - state.paddleWidth - baseConfig.paddlePadding;
    state.paddleX = clamp(state.paddleX, minX, maxX);
  }

  function increaseBallSpeed() {
    const preset = getPreset();
    const currentSpeed = Math.hypot(state.ballVX, state.ballVY);
    if (!Number.isFinite(currentSpeed) || currentSpeed <= 0) return;
    const nextSpeed = Math.min(currentSpeed * preset.ballSpeedIncrement, preset.maxBallSpeed);
    const angle = Math.atan2(state.ballVY, state.ballVX);
    state.ballVX = Math.cos(angle) * nextSpeed;
    state.ballVY = Math.sin(angle) * nextSpeed;
  }

  function handleWallCollisions() {
    const half = baseConfig.ballSize / 2;

    if (state.ballX - half <= 0 && state.ballVX < 0) {
      state.ballX = half;
      state.ballVX *= -1;
    } else if (state.ballX + half >= baseConfig.canvasWidth && state.ballVX > 0) {
      state.ballX = baseConfig.canvasWidth - half;
      state.ballVX *= -1;
    }

    if (state.ballY - half <= 0 && state.ballVY < 0) {
      state.ballY = half;
      state.ballVY *= -1;
    }
  }

  function handlePaddleCollision() {
    if (state.ballVY <= 0) return;
    const half = baseConfig.ballSize / 2;
    const paddleY = baseConfig.canvasHeight - baseConfig.paddleBottomMargin - baseConfig.paddleHeight;

    const ballBottom = state.ballY + half;
    const ballTop = state.ballY - half;
    const ballLeft = state.ballX - half;
    const ballRight = state.ballX + half;

    const paddleLeft = state.paddleX;
    const paddleRight = state.paddleX + state.paddleWidth;
    const paddleTop = paddleY;
    const paddleBottom = paddleY + baseConfig.paddleHeight;

    const intersects =
      ballBottom >= paddleTop &&
      ballTop <= paddleBottom &&
      ballRight >= paddleLeft &&
      ballLeft <= paddleRight &&
      state.ballVY > 0;

    if (!intersects) return;

    state.ballY = paddleTop - half;

    const preset = getPreset();
    const paddleCenter = state.paddleX + state.paddleWidth / 2;
    const normalized = clamp((state.ballX - paddleCenter) / (state.paddleWidth / 2), -1, 1);
    const bounceAngle = normalized * preset.maxBounceAngle;

    const speed = Math.hypot(state.ballVX, state.ballVY);
    const nextSpeed = Math.min(speed * 1.02, preset.maxBallSpeed);
    state.ballVX = Math.sin(bounceAngle) * nextSpeed;
    state.ballVY = -Math.abs(Math.cos(bounceAngle) * nextSpeed);
  }

  function handleBrickCollisions() {
    const half = baseConfig.ballSize / 2;
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
    if (state.bricks.every((b) => !b.alive)) {
      state.level += 1;

      const preset = getPreset();
      state.paddleWidth = Math.max(preset.paddleWidth - (state.level - 1) * 5, preset.minPaddleWidth);
      state.paddleX = (baseConfig.canvasWidth - state.paddleWidth) / 2;

      buildLevel(state.level);
      resetBallOnPaddle(true);
      resetMoveInput();
      updateHud();

      state.phase = "between-levels";
      showOverlay(`Level ${state.level} — Press Space or Tap to Start`, defaultHint);
    }
  }

  function handleLifeLost() {
    state.lives -= 1;
    updateHud();
    if (state.lives <= 0) {
      state.phase = "over";
      const preset = getPreset();
      showOverlay(`Game Over · ${preset.label} — Press Space or Tap to Restart`, defaultHint);
      resetBallOnPaddle(true);
      return;
    }
    state.phase = "idle";
    resetBallOnPaddle(true);
    resetMoveInput();
    showOverlay("Life lost — Press Space or Tap to continue", defaultHint);
  }

  function update(dt) {
    const dir = currentDirection();
    if (dir) movePaddle(dir, dt);

    if (state.ballAttachedToPaddle) {
      alignBallWithPaddle();
      return;
    }

    if (state.phase !== "running") return;

    state.ballX += state.ballVX * dt;
    state.ballY += state.ballVY * dt;

    handleWallCollisions();
    handlePaddleCollision();
    handleBrickCollisions();

    if (state.ballY - baseConfig.ballSize / 2 > baseConfig.canvasHeight) {
      handleLifeLost();
    }
  }

  function renderBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, baseConfig.canvasHeight);
    gradient.addColorStop(0, "#050b05");
    gradient.addColorStop(1, "#000000");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, baseConfig.canvasWidth, baseConfig.canvasHeight);

    ctx.save();
    ctx.strokeStyle = "rgba(57, 255, 20, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 60; i < baseConfig.canvasHeight; i += 60) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(baseConfig.canvasWidth, i);
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
      ctx.shadowBlur = 14;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
    }
    ctx.restore();
  }

  function renderPaddleAndBall() {
    const paddleY = baseConfig.canvasHeight - baseConfig.paddleBottomMargin - baseConfig.paddleHeight;

    ctx.save();
    ctx.fillStyle = "#39ff14";
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 18;
    ctx.fillRect(state.paddleX, paddleY, state.paddleWidth, baseConfig.paddleHeight);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#f2fff5";
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, baseConfig.ballSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, baseConfig.canvasWidth, baseConfig.canvasHeight);
    renderBackground();
    renderBricks();
    renderPaddleAndBall();
  }

  function loop(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.04);
    lastFrameTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
})();

