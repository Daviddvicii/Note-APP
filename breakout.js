(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  // Match your HTML IDs
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const levelEl = document.getElementById("level");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls?.querySelectorAll(".touch-btn");

  const config = {
    width: canvas.width,
    height: canvas.height,
    paddleWidth: 90,
    paddleHeight: 16,
    paddleSpeed: 420,
    ballRadius: 7,
    baseBallSpeed: 320,
    maxBallSpeed: 520,
    brickRows: 5,
    brickCols: 9,
    brickGap: 4,
    topOffset: 40,
    sidePadding: 20,
    lives: 3,
  };

  const state = {
    paddleX: 0,
    ballX: 0,
    ballY: 0,
    ballVX: 0,
    ballVY: 0,
    bricks: [],
    score: 0,
    lives: config.lives,
    level: 1,
    phase: "idle", // idle | running | paused | over
    moveDir: 0,     // keyboard: -1 left, 1 right
    pointerDir: 0,  // touch buttons
  };

  let lastTime = performance.now();

  // -------- HUD / overlay --------

  function updateHud() {
    if (scoreEl) scoreEl.textContent = state.score;
    if (livesEl) livesEl.textContent = state.lives;
    if (levelEl) levelEl.textContent = state.level;
  }

  function showOverlay(msg, sub) {
    if (!overlay) return;
    overlay.replaceChildren();

    const p = document.createElement("p");
    p.textContent = msg;
    overlay.appendChild(p);

    if (sub) {
      const span = document.createElement("span");
      span.textContent = sub;
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

  // -------- Level + bricks --------

  function buildBricks() {
    state.bricks = [];
    const brickWidth =
      (config.width - config.sidePadding * 2 - config.brickGap * (config.brickCols - 1)) /
      config.brickCols;
    const brickHeight = 18;

    for (let row = 0; row < config.brickRows; row++) {
      for (let col = 0; col < config.brickCols; col++) {
        const x = config.sidePadding + col * (brickWidth + config.brickGap);
        const y = config.topOffset + row * (brickHeight + config.brickGap);
        state.bricks.push({
          x,
          y,
          w: brickWidth,
          h: brickHeight,
          alive: true,
          value: (config.brickRows - row) * 10, // higher rows = more points
        });
      }
    }
  }

  function resetPaddleAndBall() {
    state.paddleX = (config.width - config.paddleWidth) / 2;
    state.ballX = config.width / 2;
    state.ballY = config.height - 60;

    const angle = (Math.random() * Math.PI) / 3 + Math.PI / 6; // 30°–90°
    const speed = config.baseBallSpeed;
    const dir = Math.random() < 0.5 ? 1 : -1;

    state.ballVX = Math.cos(angle) * speed * dir;
    state.ballVY = -Math.abs(Math.sin(angle) * speed);
  }

  function newGame() {
    state.score = 0;
    state.lives = config.lives;
    state.level = 1;
    config.brickRows = 5;
    buildBricks();
    resetPaddleAndBall();
    updateHud();
    state.phase = "idle";
    showOverlay(
      "Press Space or Tap to Start",
      "←/→ or A/D to move · Space to start/pause · R to restart"
    );
  }

  function nextLevel() {
    state.level += 1;
    config.brickRows = Math.min(config.brickRows + 1, 8);
    buildBricks();
    resetPaddleAndBall();
    updateHud();
    state.phase = "idle";
    showOverlay(`Level ${state.level}`, "Press Space or Tap to begin");
  }

  // -------- Input --------

  function effectiveDirection() {
    // Touch has priority over keyboard
    if (state.pointerDir !== 0) return state.pointerDir;
    return state.moveDir;
  }

  function handleKeyDown(e) {
    const { code } = e;

    if (code === "Space") {
      e.preventDefault();
      if (state.phase === "idle" || state.phase === "over") {
        hideOverlay();
        state.phase = "running";
        return;
      }
      if (state.phase === "paused") {
        hideOverlay();
        state.phase = "running";
        return;
      }
      if (state.phase === "running") {
        state.phase = "paused";
        showOverlay("Paused", "Press Space or Tap to resume");
        return;
      }
    }

    if (code === "KeyR") {
      e.preventDefault();
      newGame();
      return;
    }

    if (code === "ArrowLeft" || code === "KeyA") {
      state.moveDir = -1;
    } else if (code === "ArrowRight" || code === "KeyD") {
      state.moveDir = 1;
    }
  }

  function handleKeyUp(e) {
    const { code } = e;
    if ((code === "ArrowLeft" || code === "KeyA") && state.moveDir === -1) {
      state.moveDir = 0;
    }
    if ((code === "ArrowRight" || code === "KeyD") && state.moveDir === 1) {
      state.moveDir = 0;
    }
  }

  function bindTouch() {
    if (!touchButtons) return;

    touchButtons.forEach((btn) => {
      const dir = Number(btn.dataset.direction);
      if (!dir) return;

      btn.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        btn.setPointerCapture(ev.pointerId);
        state.pointerDir = dir;
      });

      const stop = (ev) => {
        try {
          btn.releasePointerCapture(ev.pointerId);
        } catch {}
        if (state.pointerDir === dir) state.pointerDir = 0;
      };

      ["pointerup", "pointercancel", "pointerleave"].forEach((type) =>
        btn.addEventListener(type, stop)
      );
    });
  }

  // -------- Game update --------

  function update(dt) {
    if (state.phase !== "running") return;

    // Paddle movement
    const dir = effectiveDirection();
    if (dir !== 0) {
      state.paddleX += dir * config.paddleSpeed * dt;
      if (state.paddleX < 0) state.paddleX = 0;
      if (state.paddleX + config.paddleWidth > config.width) {
        state.paddleX = config.width - config.paddleWidth;
      }
    }

    // Ball movement
    state.ballX += state.ballVX * dt;
    state.ballY += state.ballVY * dt;

    const r = config.ballRadius;

    // Walls
    if (state.ballX - r <= 0 && state.ballVX < 0) {
      state.ballX = r;
      state.ballVX *= -1;
    }
    if (state.ballX + r >= config.width && state.ballVX > 0) {
      state.ballX = config.width - r;
      state.ballVX *= -1;
    }
    if (state.ballY - r <= 0 && state.ballVY < 0) {
      state.ballY = r;
      state.ballVY *= -1;
    }

    // Paddle collision
    const paddleY = config.height - 40;
    if (
      state.ballY + r >= paddleY &&
      state.ballY + r <= paddleY + config.paddleHeight &&
      state.ballX >= state.paddleX &&
      state.ballX <= state.paddleX + config.paddleWidth &&
      state.ballVY > 0
    ) {
      state.ballY = paddleY - r;

      // Where did we hit the paddle? -1 (left) .. 1 (right)
      const hitPos =
        (state.ballX - (state.paddleX + config.paddleWidth / 2)) /
        (config.paddleWidth / 2);

      const angle = (hitPos * Math.PI) / 3; // ±60°
      const speed = Math.min(
        Math.hypot(state.ballVX, state.ballVY) * 1.04,
        config.maxBallSpeed
      );

      state.ballVX = speed * Math.sin(angle);
      state.ballVY = -Math.abs(speed * Math.cos(angle));
    }

    // Brick collisions
    let bricksLeft = 0;
    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      bricksLeft++;

      if (
        state.ballX + r >= brick.x &&
        state.ballX - r <= brick.x + brick.w &&
        state.ballY + r >= brick.y &&
        state.ballY - r <= brick.y + brick.h
      ) {
        brick.alive = false;
        state.score += brick.value;
        updateHud();

        // Decide which side we hit for bounce
        const overlapLeft = state.ballX + r - brick.x;
        const overlapRight = brick.x + brick.w - (state.ballX - r);
        const overlapTop = state.ballY + r - brick.y;
        const overlapBottom = brick.y + brick.h - (state.ballY - r);
        const minOverlap = Math.min(
          overlapLeft,
          overlapRight,
          overlapTop,
          overlapBottom
        );

        if (minOverlap === overlapLeft || minOverlap === overlapRight) {
          state.ballVX *= -1;
        } else {
          state.ballVY *= -1;
        }
        break;
      }
    }

    // Level clear
    if (bricksLeft === 0) {
      nextLevel();
      return;
    }

    // Ball lost
    if (state.ballY - r > config.height + 10) {
      state.lives -= 1;
      updateHud();

      if (state.lives <= 0) {
        state.phase = "over";
        showOverlay("Game Over", "Press Space or R to restart");
      } else {
        resetPaddleAndBall();
        state.phase = "idle";
        showOverlay("Life Lost", "Press Space or Tap to continue");
      }
    }
  }

  // -------- Render --------

  function render() {
    ctx.clearRect(0, 0, config.width, config.height);

    // Base background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, config.width, config.height);

    // Radial glow
    const g = ctx.createRadialGradient(
      config.width / 2,
      config.height / 2,
      0,
      config.width / 2,
      config.height / 2,
      config.width / 1.2
    );
    g.addColorStop(0, "rgba(57,255,20,0.08)");
    g.addColorStop(1, "rgba(0,0,0,0.98)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, config.width, config.height);

    ctx.save();
    ctx.fillStyle = "#39ff14";
    ctx.shadowColor = "#39ff14";
    ctx.shadowBlur = 18;

    // Paddle
    const paddleY = config.height - 40;
    ctx.fillRect(
      state.paddleX,
      paddleY,
      config.paddleWidth,
      config.paddleHeight
    );

    // Ball
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, config.ballRadius, 0, Math.PI * 2);
    ctx.fill();

    // Bricks
    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
    }

    ctx.restore();
  }

  // -------- Loop --------

  function loop(ts) {
    const dt = Math.min((ts - lastTime) / 1000, 0.03);
    lastTime = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // -------- Init --------

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  if (overlay) {
    overlay.addEventListener("click", () => {
      if (state.phase === "idle" || state.phase === "paused") {
        hideOverlay();
        state.phase = "running";
      } else if (state.phase === "over") {
        newGame();
      }
    });
  }

  bindTouch();
  newGame();
  requestAnimationFrame(loop);
})();
