(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const leftScoreEl = document.getElementById("score-left");
  const rightScoreEl = document.getElementById("score-right");
  const rightLabelEl = document.getElementById("right-label");
  const modeSelector = document.getElementById("mode-selector");
  const touchControls = document.getElementById("touch-controls");
  const touchGroups = touchControls?.querySelectorAll("[data-player]");
  const touchButtons = touchControls?.querySelectorAll(".touch-btn");

  const config = {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    paddleWidth: 14,
    paddleHeight: 90,
    paddleMargin: 36,
    paddleSpeed: 360, // units per second
    ballSize: 14,
    baseBallSpeed: 380,
    maxBounceAngle: Math.PI / 3,
    serveAngleRange: Math.PI / 3.2,
    aiSpeed: 300,
    winningScore: 10,
  };

  const state = {
    mode: "solo",
    paddles: {
      left: { x: config.paddleMargin, y: 0 },
      right: { x: config.canvasWidth - config.paddleMargin - config.paddleWidth, y: 0 },
    },
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    scores: { left: 0, right: 0 },
    lastServeDirection: 1,
  };

  const inputState = {
    left: { up: false, down: false, pointerUp: false, pointerDown: false, direction: 0 },
    right: { up: false, down: false, pointerUp: false, pointerDown: false, direction: 0 },
  };

  let lastFrameTime = performance.now();
  let gamePhase = "idle"; // idle | running | paused | over

  function resetInputs() {
    Object.values(inputState).forEach((input) => {
      input.up = false;
      input.down = false;
      input.pointerUp = false;
      input.pointerDown = false;
      input.direction = 0;
    });
  }

  function centerPaddles() {
    state.paddles.left.y = (config.canvasHeight - config.paddleHeight) / 2;
    state.paddles.right.y = state.paddles.left.y;
  }

  function serveBall(direction = Math.random() < 0.5 ? -1 : 1) {
    state.ball.x = config.canvasWidth / 2;
    state.ball.y = config.canvasHeight / 2;
    const angle = (Math.random() - 0.5) * config.serveAngleRange;
    const speed = config.baseBallSpeed;
    state.ball.vx = Math.cos(angle) * speed * direction;
    state.ball.vy = Math.sin(angle) * speed;
    state.lastServeDirection = direction;
  }

  function startNewMatch(showOverlayMessage = true) {
    resetInputs();
    state.scores.left = 0;
    state.scores.right = 0;
    updateScoreboard();
    centerPaddles();
    serveBall();
    gamePhase = "idle";
    if (showOverlayMessage) {
      showOverlay("Press Space or Tap to Start", buildHint());
    } else {
      hideOverlay();
    }
  }

  function buildHint() {
    return state.mode === "solo"
      ? "P1: W/S or ↑/↓ · Tap buttons on mobile"
      : "P1: W/S · P2: ↑/↓ · Tap buttons on mobile";
  }

  function showOverlay(message, hint) {
    if (!overlay) return;
    overlay.replaceChildren();
    const main = document.createElement("div");
    main.textContent = message;
    overlay.appendChild(main);
    if (hint) {
      const span = document.createElement("span");
      span.textContent = hint;
      overlay.appendChild(span);
    }
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  function updateScoreboard() {
    leftScoreEl.textContent = state.scores.left;
    rightScoreEl.textContent = state.scores.right;
    rightLabelEl.textContent = state.mode === "solo" ? "CPU" : "P2";
  }

  function resetScores() {
    state.scores.left = 0;
    state.scores.right = 0;
    updateScoreboard();
  }

  function startGame() {
    if (gamePhase === "running") return;
    if (gamePhase === "over") {
      startNewMatch(false);
    }
    hideOverlay();
    lastFrameTime = performance.now();
    gamePhase = "running";
  }

  function pauseGame(message = "Paused — Press Space or Tap to Resume") {
    if (gamePhase !== "running") return;
    gamePhase = "paused";
    showOverlay(message, buildHint());
  }

  function togglePause() {
    if (gamePhase === "running") {
      pauseGame();
    } else {
      startGame();
    }
  }

  function directionFor(player) {
    const input = inputState[player];
    const up = input.up || input.pointerUp;
    const down = input.down || input.pointerDown;
    const dir = up && !down ? -1 : down && !up ? 1 : 0;
    input.direction = dir;
    return dir;
  }

  function updatePaddle(paddle, direction, speed, delta) {
    if (!direction) return;
    paddle.y += direction * speed * delta;
    const maxY = config.canvasHeight - config.paddleHeight;
    if (paddle.y < 0) paddle.y = 0;
    if (paddle.y > maxY) paddle.y = maxY;
  }

  function updateAI(delta) {
    const paddle = state.paddles.right;
    const ball = state.ball;
    const paddleCenter = paddle.y + config.paddleHeight / 2;
    let target = config.canvasHeight / 2;
    if (ball.vx > 0) {
      target = ball.y;
    }
    const threshold = config.paddleHeight * 0.15;
    let direction = 0;
    if (paddleCenter < target - threshold) {
      direction = 1;
    } else if (paddleCenter > target + threshold) {
      direction = -1;
    }
    if (direction) {
      paddle.y += direction * config.aiSpeed * delta;
      const maxY = config.canvasHeight - config.paddleHeight;
      if (paddle.y < 0) paddle.y = 0;
      if (paddle.y > maxY) paddle.y = maxY;
    }
  }

  function handleCollisions() {
    const ball = state.ball;
    const half = config.ballSize / 2;

    // Top & bottom walls
    if (ball.y - half <= 0 && ball.vy < 0) {
      ball.y = half;
      ball.vy *= -1;
    } else if (ball.y + half >= config.canvasHeight && ball.vy > 0) {
      ball.y = config.canvasHeight - half;
      ball.vy *= -1;
    }

    const paddles = [
      { side: "left", paddle: state.paddles.left, normal: 1 },
      { side: "right", paddle: state.paddles.right, normal: -1 },
    ];

    for (const { side, paddle, normal } of paddles) {
      const withinX =
        side === "left"
          ? ball.x - half <= paddle.x + config.paddleWidth && ball.x + half >= paddle.x
          : ball.x + half >= paddle.x && ball.x - half <= paddle.x + config.paddleWidth;
      const withinY = ball.y + half >= paddle.y && ball.y - half <= paddle.y + config.paddleHeight;

      if (withinX && withinY && ball.vx * normal < 0) {
        const paddleCenter = paddle.y + config.paddleHeight / 2;
        const relativeIntersect = ball.y - paddleCenter;
        const normalized = relativeIntersect / (config.paddleHeight / 2);
        const bounceAngle = normalized * config.maxBounceAngle;
        const speed = Math.hypot(ball.vx, ball.vy);
        ball.vx = speed * Math.cos(bounceAngle) * -normal;
        ball.vy = speed * Math.sin(bounceAngle);
        ball.x = side === "left" ? paddle.x + config.paddleWidth + half : paddle.x - half;

        // Nudge speed slightly to keep pace increasing
        const factor = 1.015;
        const newSpeed = Math.min(Math.hypot(ball.vx, ball.vy) * factor, config.baseBallSpeed * 1.45);
        const currentAngle = Math.atan2(ball.vy, ball.vx);
        ball.vx = Math.cos(currentAngle) * newSpeed;
        ball.vy = Math.sin(currentAngle) * newSpeed;
      }
    }
  }

  function awardPoint(side) {
    if (side === "left") {
      state.scores.left += 1;
      updateScoreboard();
      if (state.scores.left >= config.winningScore) {
        finishMatch("left");
        return;
      }
      serveBall(1);
    } else {
      state.scores.right += 1;
      updateScoreboard();
      if (state.scores.right >= config.winningScore) {
        finishMatch("right");
        return;
      }
      serveBall(-1);
    }
    lastFrameTime = performance.now();
  }

  function finishMatch(winner) {
    gamePhase = "over";
    resetInputs();
    centerPaddles();
    state.ball.x = config.canvasWidth / 2;
    state.ball.y = config.canvasHeight / 2;
    state.ball.vx = 0;
    state.ball.vy = 0;
    const message =
      winner === "left"
        ? "Player 1 Wins!"
        : state.mode === "solo"
        ? "CPU Wins!"
        : "Player 2 Wins!";
    showOverlay(`${message}`, "Press Space or Tap to Restart");
  }

  function update(delta) {
    if (gamePhase !== "running") return;
    updatePaddle(state.paddles.left, directionFor("left"), config.paddleSpeed, delta);
    if (state.mode === "duo") {
      updatePaddle(state.paddles.right, directionFor("right"), config.paddleSpeed, delta);
    } else {
      updateAI(delta);
    }

    state.ball.x += state.ball.vx * delta;
    state.ball.y += state.ball.vy * delta;

    handleCollisions();

    const half = config.ballSize / 2;
    if (state.ball.x + half < 0) {
      awardPoint("right");
    } else if (state.ball.x - half > config.canvasWidth) {
      awardPoint("left");
    }
  }

  function render() {
    ctx.clearRect(0, 0, config.canvasWidth, config.canvasHeight);

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, config.canvasWidth, config.canvasHeight);

    ctx.save();
    ctx.strokeStyle = "rgba(57, 255, 20, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(config.canvasWidth / 2, 0);
    ctx.lineTo(config.canvasWidth / 2, config.canvasHeight);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#39ff14";
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 18;
    ctx.fillRect(
      state.paddles.left.x,
      state.paddles.left.y,
      config.paddleWidth,
      config.paddleHeight
    );
    ctx.fillRect(
      state.paddles.right.x,
      state.paddles.right.y,
      config.paddleWidth,
      config.paddleHeight
    );
    ctx.beginPath();
    ctx.rect(
      state.ball.x - config.ballSize / 2,
      state.ball.y - config.ballSize / 2,
      config.ballSize,
      config.ballSize
    );
    ctx.fill();
    ctx.restore();
  }

  function loop(now) {
    const delta = Math.min((now - lastFrameTime) / 1000, 0.03);
    lastFrameTime = now;
    update(delta);
    render();
    requestAnimationFrame(loop);
  }

  function setKeyState(player, direction, active) {
    const key = direction === -1 ? "up" : "down";
    inputState[player][key] = active;
    directionFor(player);
  }

  function setPointerState(player, direction, active) {
    const key = direction === -1 ? "pointerUp" : "pointerDown";
    inputState[player][key] = active;
    directionFor(player);
  }

  function handleKeyDown(event) {
    if (event.repeat) return;
    const { code } = event;
    if (code === "Space") {
      event.preventDefault();
      togglePause();
      return;
    }

    if (code === "KeyR") {
      event.preventDefault();
      if (gamePhase === "over") {
        startNewMatch(true);
      } else {
        resetScores();
        const direction = state.ball.vx >= 0 ? 1 : state.ball.vx < 0 ? -1 : state.lastServeDirection || 1;
        serveBall(direction);
      }
      return;
    }

    switch (code) {
      case "KeyW":
        setKeyState("left", -1, true);
        break;
      case "KeyS":
        setKeyState("left", 1, true);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (state.mode === "duo") {
          setKeyState("right", -1, true);
        } else {
          setKeyState("left", -1, true);
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        if (state.mode === "duo") {
          setKeyState("right", 1, true);
        } else {
          setKeyState("left", 1, true);
        }
        break;
      default:
        break;
    }
  }

  function handleKeyUp(event) {
    const { code } = event;
    switch (code) {
      case "KeyW":
        setKeyState("left", -1, false);
        break;
      case "KeyS":
        setKeyState("left", 1, false);
        break;
      case "ArrowUp":
        if (state.mode === "duo") {
          setKeyState("right", -1, false);
        } else {
          setKeyState("left", -1, false);
        }
        break;
      case "ArrowDown":
        if (state.mode === "duo") {
          setKeyState("right", 1, false);
        } else {
          setKeyState("left", 1, false);
        }
        break;
      default:
        break;
    }
  }

  function bindTouchControls() {
    if (!touchButtons) return;
    touchButtons.forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        const player = button.dataset.player;
        const direction = Number(button.dataset.direction);
        setPointerState(player, direction, true);
      });

      button.addEventListener("pointerup", (event) => {
        button.releasePointerCapture(event.pointerId);
        const player = button.dataset.player;
        const direction = Number(button.dataset.direction);
        setPointerState(player, direction, false);
      });

      ["pointercancel", "pointerleave"].forEach((type) => {
        button.addEventListener(type, () => {
          const player = button.dataset.player;
          const direction = Number(button.dataset.direction);
          setPointerState(player, direction, false);
        });
      });
    });
  }

  function updateTouchVisibility() {
    if (!touchGroups) return;
    touchGroups.forEach((group) => {
      const player = group.getAttribute("data-player");
      const shouldShow = player === "left" || state.mode === "duo";
      group.classList.toggle("hidden", !shouldShow);
    });
    if (touchControls) {
      const anyVisible = Array.from(touchGroups || []).some(
        (group) => !group.classList.contains("hidden")
      );
      touchControls.setAttribute("aria-hidden", anyVisible ? "false" : "true");
    }
  }

  function handleModeChange(event) {
    const value = event.target.value;
    if (value !== state.mode) {
      state.mode = value;
      updateTouchVisibility();
      startNewMatch(true);
    }
  }

  function handleVisibilityChange() {
    if (document.hidden && gamePhase === "running") {
      pauseGame("Paused (tab inactive) — Press Space or Tap to Resume");
    }
  }

  overlay.addEventListener("click", startGame);

  if (modeSelector) {
    modeSelector.addEventListener("change", handleModeChange);
  }

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  bindTouchControls();
  updateTouchVisibility();
  startNewMatch(true);
  requestAnimationFrame(loop);
})();
