(() => {
  const canvas = document.querySelector('#pong-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.querySelector('#overlay');
  const touchControlsRoot = document.querySelector('#touch-controls');
  const scoreLeftEl = document.querySelector('#score-left');
  const scoreRightEl = document.querySelector('#score-right');
  const rightLabelEl = document.querySelector('#right-label');
  const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));

  const CONFIG = {
    width: 800,
    height: 450,
    paddle: {
      width: 12,
      height: 90,
      padding: 24,
      speed: 420,
    },
    ball: {
      radius: 8,
      speed: 420,
      maxBounceAngle: (60 * Math.PI) / 180,
    },
    ai: {
      speed: 360,
      reactionDelay: 0.08,
    },
    winningScore: 10,
  };

  const paddles = {
    left: {
      x: CONFIG.paddle.padding,
      y: CONFIG.height / 2 - CONFIG.paddle.height / 2,
      width: CONFIG.paddle.width,
      height: CONFIG.paddle.height,
      velocity: 0,
    },
    right: {
      x: CONFIG.width - CONFIG.paddle.padding - CONFIG.paddle.width,
      y: CONFIG.height / 2 - CONFIG.paddle.height / 2,
      width: CONFIG.paddle.width,
      height: CONFIG.paddle.height,
      velocity: 0,
    },
  };

  const ball = {
    x: CONFIG.width / 2,
    y: CONFIG.height / 2,
    radius: CONFIG.ball.radius,
    vx: CONFIG.ball.speed,
    vy: 0,
  };

  const inputState = {
    p1: { up: false, down: false },
    p2: { up: false, down: false },
  };

  let mode = 'single'; // 'single' | 'dual'
  let scores = { left: 0, right: 0 };
  let state = 'idle'; // 'idle' | 'running' | 'paused' | 'over'
  let lastTime = 0;
  let aiCooldown = 0;
  let serveDirection = Math.random() > 0.5 ? 1 : -1;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CONFIG.width * dpr;
    canvas.height = CONFIG.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  function resetBall(direction = serveDirection) {
    ball.x = CONFIG.width / 2;
    ball.y = CONFIG.height / 2;
    serveDirection = direction >= 0 ? 1 : -1;
    const angle = (Math.random() * 0.5 - 0.25) * Math.PI; // -45deg to 45deg
    ball.vx = Math.cos(angle) * CONFIG.ball.speed * serveDirection;
    ball.vy = Math.sin(angle) * CONFIG.ball.speed;
  }

  function resetPaddles() {
    paddles.left.y = CONFIG.height / 2 - CONFIG.paddle.height / 2;
    paddles.right.y = CONFIG.height / 2 - CONFIG.paddle.height / 2;
    paddles.left.velocity = 0;
    paddles.right.velocity = 0;
  }

  function resetMatch() {
    scores.left = 0;
    scores.right = 0;
    updateScoreboard();
    resetPaddles();
    resetBall(Math.random() > 0.5 ? 1 : -1);
  }

  function updateScoreboard() {
    scoreLeftEl.textContent = scores.left;
    scoreRightEl.textContent = scores.right;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function showOverlay(main, hint) {
    overlay.innerHTML = `
      <strong>${main}</strong>
      <small>${hint}</small>
    `;
    overlay.classList.add('visible');
  }

  function hideOverlay() {
    overlay.classList.remove('visible');
  }

  function setState(nextState, options = {}) {
    state = nextState;
    if (state === 'idle') {
      showOverlay('Press Space or Tap to Start', 'Use W/S or ↑/↓ · R to reset');
    } else if (state === 'paused') {
      showOverlay('Paused', 'Press Space or Tap to Resume');
    } else if (state === 'over') {
      const { winner = 'Player 1' } = options;
      showOverlay(`${winner} Wins!`, 'Press Space or Tap to Restart');
    } else {
      hideOverlay();
    }
  }

  function startGame() {
    resetPaddles();
    resetBall(serveDirection);
    setState('running');
    lastTime = performance.now();
  }

  function completePoint(scoringSide) {
    if (scoringSide === 'left') {
      scores.left += 1;
      serveDirection = 1;
    } else {
      scores.right += 1;
      serveDirection = -1;
    }
    updateScoreboard();

    if (scores.left >= CONFIG.winningScore || scores.right >= CONFIG.winningScore) {
      const winner =
        scores.left > scores.right
          ? 'Player 1'
          : mode === 'single'
          ? 'CPU'
          : 'Player 2';
      setState('over', { winner });
      return;
    }

    resetPaddles();
    resetBall(serveDirection);
    aiCooldown = CONFIG.ai.reactionDelay;
    lastTime = performance.now();
  }

  function handlePaddleMovement(delta) {
    const targetSpeed = CONFIG.paddle.speed;

    paddles.left.velocity = 0;
    if (inputState.p1.up) paddles.left.velocity -= targetSpeed;
    if (inputState.p1.down) paddles.left.velocity += targetSpeed;
    paddles.left.y += paddles.left.velocity * delta;
    paddles.left.y = clamp(paddles.left.y, 0, CONFIG.height - CONFIG.paddle.height);

    if (mode === 'dual') {
      paddles.right.velocity = 0;
      if (inputState.p2.up) paddles.right.velocity -= targetSpeed;
      if (inputState.p2.down) paddles.right.velocity += targetSpeed;
      paddles.right.y += paddles.right.velocity * delta;
    } else {
      aiCooldown -= delta;
      if (aiCooldown <= 0 && ball.vx > 0) {
        const targetY = ball.y;
        const paddleCenter = paddles.right.y + paddles.right.height / 2;
        const direction = targetY > paddleCenter + 6 ? 1 : targetY < paddleCenter - 6 ? -1 : 0;
        paddles.right.velocity = direction * CONFIG.ai.speed;
        aiCooldown = CONFIG.ai.reactionDelay;
      }
      paddles.right.y += paddles.right.velocity * delta;
    }

    paddles.right.y = clamp(
      paddles.right.y,
      0,
      CONFIG.height - CONFIG.paddle.height,
    );
  }

  function handleBall(delta) {
    ball.x += ball.vx * delta;
    ball.y += ball.vy * delta;

    // Top / bottom collision
    if (ball.y - ball.radius <= 0) {
      ball.y = ball.radius;
      ball.vy *= -1;
    } else if (ball.y + ball.radius >= CONFIG.height) {
      ball.y = CONFIG.height - ball.radius;
      ball.vy *= -1;
    }

    // Paddle collision
    const left = paddles.left;
    const right = paddles.right;

    if (
      ball.x - ball.radius <= left.x + left.width &&
      ball.y >= left.y &&
      ball.y <= left.y + left.height &&
      ball.vx < 0
    ) {
      const relativeIntersectY = ball.y - (left.y + left.height / 2);
      const normalized = relativeIntersectY / (left.height / 2);
      const bounceAngle = normalized * CONFIG.ball.maxBounceAngle;
      const speed = Math.hypot(ball.vx, ball.vy) * 1.03; // slight speed up
      ball.vx = Math.cos(bounceAngle) * speed;
      ball.vy = Math.sin(bounceAngle) * speed;
      if (ball.vx < CONFIG.ball.radius) ball.vx = CONFIG.ball.radius;
      // Ensure ball leaves paddle
      ball.x = left.x + left.width + ball.radius;
    }

    if (
      ball.x + ball.radius >= right.x &&
      ball.y >= right.y &&
      ball.y <= right.y + right.height &&
      ball.vx > 0
    ) {
      const relativeIntersectY = ball.y - (right.y + right.height / 2);
      const normalized = relativeIntersectY / (right.height / 2);
      const bounceAngle = normalized * CONFIG.ball.maxBounceAngle;
      const speed = Math.hypot(ball.vx, ball.vy) * 1.03;
      ball.vx = -Math.cos(bounceAngle) * speed;
      ball.vy = Math.sin(bounceAngle) * speed;
      if (ball.vx > -CONFIG.ball.radius) ball.vx = -CONFIG.ball.radius;
      ball.x = right.x - ball.radius;
    }

    // Scoring
    if (ball.x + ball.radius < 0) {
      completePoint('right');
    } else if (ball.x - ball.radius > CONFIG.width) {
      completePoint('left');
    }
  }

  function draw() {
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    // Center line
    ctx.strokeStyle = '#00ffaa';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 16]);
    ctx.beginPath();
    ctx.moveTo(CONFIG.width / 2, 0);
    ctx.lineTo(CONFIG.width / 2, CONFIG.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Paddles
    ctx.fillStyle = '#00ffcc';
    ctx.shadowColor = 'rgba(0,255,204,0.7)';
    ctx.shadowBlur = 12;
    ctx.fillRect(leftPaddleX(), paddles.left.y, paddles.left.width, paddles.left.height);
    ctx.fillRect(paddles.right.x, paddles.right.y, paddles.right.width, paddles.right.height);
    ctx.shadowBlur = 0;

    // Ball
    ctx.beginPath();
    ctx.fillStyle = '#7fffd4';
    ctx.shadowColor = 'rgba(127,255,212,0.8)';
    ctx.shadowBlur = 10;
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function leftPaddleX() {
    return paddles.left.x;
  }

  function loop(timestamp) {
    const delta = (timestamp - lastTime) / 1000 || 0;
    lastTime = timestamp;

    if (state === 'running') {
      handlePaddleMovement(delta);
      handleBall(delta);
    }

    draw();
    requestAnimationFrame(loop);
  }

  function handleModeChange(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    rightLabelEl.textContent = mode === 'single' ? 'CPU' : 'Player 2';
    resetMatch();
    setState('idle');
    setupTouchControls();
  }

  function handleKey(value, isDown) {
    switch (value) {
      case 'KeyW':
      case 'w':
      case 'W':
        inputState.p1.up = isDown;
        break;
      case 'KeyS':
      case 's':
      case 'S':
        inputState.p1.down = isDown;
        break;
      case 'ArrowUp':
        if (mode === 'dual') {
          inputState.p2.up = isDown;
        } else {
          inputState.p1.up = isDown;
        }
        break;
      case 'ArrowDown':
        if (mode === 'dual') {
          inputState.p2.down = isDown;
        } else {
          inputState.p1.down = isDown;
        }
        break;
      default:
        break;
    }
  }

  function handleGlobalKey(event, isDown) {
    if (event.repeat) return;
    const key = event.code || event.key;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
    }
    handleKey(key, isDown);
  }

  function handleActionKey(event) {
    const code = event.code || event.key;
    if (code === 'Space') {
      event.preventDefault();
      if (state === 'idle') {
        startGame();
      } else if (state === 'running') {
        setState('paused');
      } else if (state === 'paused') {
        setState('running');
        lastTime = performance.now();
      } else if (state === 'over') {
        resetMatch();
        startGame();
      }
    } else if ((code === 'KeyR' || code === 'Keyr' || code === 'r' || code === 'R') && isFocusableState(state)) {
      resetMatch();
      setState('idle');
    }
  }

  function isFocusableState(currentState) {
    return currentState === 'idle' || currentState === 'running' || currentState === 'paused';
  }

  function createControlPad(playerKey, label) {
    const pad = document.createElement('div');
    pad.className = 'control-pad';
    pad.setAttribute('data-player', playerKey);

    const title = document.createElement('h2');
    title.textContent = label;
    pad.appendChild(title);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'control-buttons';

    const upBtn = document.createElement('button');
    upBtn.className = 'control-btn';
    upBtn.textContent = 'Up';
    upBtn.setAttribute('data-direction', 'up');
    const downBtn = document.createElement('button');
    downBtn.className = 'control-btn';
    downBtn.textContent = 'Down';
    downBtn.setAttribute('data-direction', 'down');

    buttonGroup.appendChild(upBtn);
    buttonGroup.appendChild(downBtn);
    pad.appendChild(buttonGroup);

    [upBtn, downBtn].forEach((btn) => {
      btn.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        btn.setPointerCapture(ev.pointerId);
        setTouchState(playerKey, btn.dataset.direction, true);
      });
      const clear = (ev) => {
        ev.preventDefault();
        if (btn.hasPointerCapture(ev.pointerId)) {
          btn.releasePointerCapture(ev.pointerId);
        }
        setTouchState(playerKey, btn.dataset.direction, false);
      };
      btn.addEventListener('pointerup', clear);
      btn.addEventListener('pointercancel', clear);
      btn.addEventListener('pointerleave', clear);
    });

    return pad;
  }

  function setTouchState(playerKey, direction, active) {
    const target = inputState[playerKey];
    if (!target) return;
    if (direction === 'up') {
      target.up = active;
      if (active) target.down = false;
    } else {
      target.down = active;
      if (active) target.up = false;
    }
  }

  function setupTouchControls() {
    touchControlsRoot.innerHTML = '';
    const pads = [createControlPad('p1', 'P1')];
    if (mode === 'dual') {
      pads.push(createControlPad('p2', 'P2'));
    }
    pads.forEach((pad) => touchControlsRoot.appendChild(pad));
  }

  function centreGameOnTap(event) {
    if (state === 'idle') {
      startGame();
    } else if (state === 'paused') {
      setState('running');
      lastTime = performance.now();
    } else if (state === 'over') {
      resetMatch();
      startGame();
    }
  }

  // Event wiring
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  document.addEventListener('keydown', (event) => {
    handleGlobalKey(event, true);
    handleActionKey(event);
  });

  document.addEventListener('keyup', (event) => {
    handleGlobalKey(event, false);
  });

  overlay.addEventListener('click', centreGameOnTap);
  overlay.addEventListener('touchstart', (event) => {
    event.preventDefault();
    centreGameOnTap(event);
  });

  canvas.addEventListener('pointerdown', () => {
    if (state === 'idle') {
      startGame();
    }
  });

  modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        handleModeChange(input.value);
      }
    });
  });

  // initialize
  setupTouchControls();
  updateScoreboard();
  setState('idle');
  requestAnimationFrame(loop);
})();
