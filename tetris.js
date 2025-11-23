(() => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const linesEl = document.getElementById("lines");
  const levelEl = document.getElementById("level");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls ? touchControls.querySelectorAll(".touch-btn") : null;
  const coarseMediaQuery = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;

  const defaultHint = "←/→ move · ↑ rotate · ↓ soft drop · Space hard drop/pause · R restart";

  const config = {
    cols: 10,
    rows: 20,
    baseDropInterval: 900,
    minDropInterval: 100,
    dropIntervalStep: 65,
    softDropInterval: 60,
    moveRepeatDelay: 180,
    moveRepeatInterval: 55,
  };

  const colorMap = {
    I: "#1ad4ff",
    O: "#ffe066",
    T: "#b943ff",
    S: "#52ffa7",
    Z: "#ff5f7a",
    J: "#3c8dff",
    L: "#ffb347",
  };

  const shapes = {
    I: [
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      [
        { x: 1, y: -1 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
    ],
    O: [
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    ],
    T: [
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
      ],
      [
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ],
    ],
    S: [
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      [
        { x: 1, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
    ],
    Z: [
      [
        { x: -1, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    ],
    J: [
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 1 },
      ],
      [
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: -1 },
      ],
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: -1 },
      ],
      [
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 1 },
      ],
    ],
    L: [
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      [
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      [
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: -1 },
      ],
      [
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: -1 },
      ],
    ],
  };

  const spawnPositions = {
    I: { x: 3, y: -1 },
    O: { x: 4, y: -1 },
    default: { x: 4, y: -2 },
  };

  const scoringTable = {
    1: 100,
    2: 300,
    3: 500,
    4: 800,
  };

  const state = {
    board: createEmptyBoard(),
    currentPiece: null,
    score: 0,
    lines: 0,
    level: 1,
    dropInterval: config.baseDropInterval,
    dropAccumulator: 0,
    softDropActive: false,
  };

  let phase = "idle"; // idle | running | paused | over
  let bag = [];
  let lastFrameTime = performance.now();

  const moveState = {
    left: { active: false, timer: 0, repeated: false, priority: 0 },
    right: { active: false, timer: 0, repeated: false, priority: 0 },
  };
  let movePriorityCounter = 0;
  let activeMoveDirection = null;

  function createEmptyBoard() {
    return Array.from({ length: config.rows }, () => Array(config.cols).fill(null));
  }

  function refillBag() {
    bag = Object.keys(shapes);
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }

  function drawNextType() {
    if (bag.length === 0) {
      refillBag();
    }
    return bag.pop();
  }

  function spawnPiece() {
    const type = drawNextType();
    const spawn = spawnPositions[type] || spawnPositions.default;
    const piece = {
      type,
      rotationIndex: 0,
      x: spawn.x,
      y: spawn.y,
    };
    state.currentPiece = piece;
    if (collides(piece, 0, 0, piece.rotationIndex)) {
      handleGameOver();
      return false;
    }
    return true;
  }

  function collides(piece, offsetX = 0, offsetY = 0, rotationIndex = piece.rotationIndex) {
    const definition = shapes[piece.type][rotationIndex];
    for (const block of definition) {
      const x = piece.x + block.x + offsetX;
      const y = piece.y + block.y + offsetY;
      if (x < 0 || x >= config.cols || y >= config.rows) {
        return true;
      }
      if (y >= 0 && state.board[y][x]) {
        return true;
      }
    }
    return false;
  }

  function movePiece(deltaX) {
    if (!state.currentPiece || phase === "over") return false;
    if (collides(state.currentPiece, deltaX, 0)) {
      return false;
    }
    state.currentPiece.x += deltaX;
    return true;
  }

  function rotatePiece(direction = 1) {
    if (!state.currentPiece || phase === "over") return false;
    const { currentPiece } = state;
    const rotations = shapes[currentPiece.type];
    const nextIndex = (currentPiece.rotationIndex + direction + rotations.length) % rotations.length;
    const kicks = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: -1 },
    ];
    for (const kick of kicks) {
      if (!collides(currentPiece, kick.x, kick.y, nextIndex)) {
        currentPiece.rotationIndex = nextIndex;
        currentPiece.x += kick.x;
        currentPiece.y += kick.y;
        return true;
      }
    }
    return false;
  }

  function softDropStep() {
    if (!state.currentPiece || phase !== "running") return false;
    if (!collides(state.currentPiece, 0, 1)) {
      state.currentPiece.y += 1;
      return true;
    }
    lockPiece();
    return false;
  }

  function hardDrop() {
    if (!state.currentPiece || phase !== "running") return;
    while (!collides(state.currentPiece, 0, 1)) {
      state.currentPiece.y += 1;
    }
    lockPiece();
  }

  function lockPiece() {
    if (!state.currentPiece) return;
    const definition = shapes[state.currentPiece.type][state.currentPiece.rotationIndex];
    for (const block of definition) {
      const x = state.currentPiece.x + block.x;
      const y = state.currentPiece.y + block.y;
      if (y >= 0 && y < config.rows && x >= 0 && x < config.cols) {
        state.board[y][x] = state.currentPiece.type;
      } else if (y < 0) {
        handleGameOver();
        return;
      }
    }
    const cleared = clearLines();
    if (cleared > 0) {
      state.lines += cleared;
      state.score += scoringTable[cleared] || 0;
      updateLevelAndSpeed();
    }
    updateHud();
    state.currentPiece = null;
    state.dropAccumulator = 0;
    spawnPiece();
  }

  function clearLines() {
    let cleared = 0;
    for (let row = config.rows - 1; row >= 0; row -= 1) {
      if (state.board[row].every((cell) => cell)) {
        state.board.splice(row, 1);
        state.board.unshift(Array(config.cols).fill(null));
        cleared += 1;
        row += 1;
      }
    }
    return cleared;
  }

  function updateLevelAndSpeed() {
    const newLevel = Math.floor(state.lines / 10) + 1;
    state.level = newLevel;
    const interval = Math.max(
      config.baseDropInterval - (newLevel - 1) * config.dropIntervalStep,
      config.minDropInterval
    );
    state.dropInterval = interval;
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = state.score.toString();
    if (linesEl) linesEl.textContent = state.lines.toString();
    if (levelEl) levelEl.textContent = state.level.toString();
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

  function handleGameOver() {
    phase = "over";
    state.softDropActive = false;
    showOverlay("Game Over — Press Space or Tap to Restart");
  }

  function pauseGame(message = "Paused — Press Space or Tap to Resume") {
    if (phase !== "running") return;
    phase = "paused";
    state.softDropActive = false;
    showOverlay(message);
  }

  function resumeGame() {
    if (phase !== "paused") return;
    hideOverlay();
    phase = "running";
    lastFrameTime = performance.now();
  }

  function beginGame() {
    if (phase === "running") return;
    hideOverlay();
    if (!state.currentPiece) {
      spawnPiece();
    }
    state.dropAccumulator = 0;
    phase = "running";
    lastFrameTime = performance.now();
  }

  function resetGame() {
    state.board = createEmptyBoard();
    state.currentPiece = null;
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.dropInterval = config.baseDropInterval;
    state.dropAccumulator = 0;
    state.softDropActive = false;
    moveState.left = { active: false, timer: 0, repeated: false, priority: 0 };
    moveState.right = { active: false, timer: 0, repeated: false, priority: 0 };
    activeMoveDirection = null;
    movePriorityCounter = 0;
    bag = [];
    refillBag();
    spawnPiece();
    updateHud();
    phase = "idle";
    showOverlay("Press Space or Tap to Start");
  }

  function handlePrimaryAction() {
    switch (phase) {
      case "idle":
        beginGame();
        break;
      case "running":
        pauseGame();
        break;
      case "paused":
        resumeGame();
        break;
      case "over":
        resetGame();
        break;
      default:
        break;
    }
  }

  function engageMove(direction) {
    const entry = moveState[direction];
    movePriorityCounter += 1;
    entry.priority = movePriorityCounter;
    if (!entry.active) {
      entry.active = true;
      entry.timer = 0;
      entry.repeated = false;
      if (phase !== "over") {
        movePiece(direction === "left" ? -1 : 1);
      }
    }
  }

  function releaseMove(direction) {
    const entry = moveState[direction];
    entry.active = false;
    entry.timer = 0;
    entry.repeated = false;
    if (activeMoveDirection === direction) {
      activeMoveDirection = null;
    }
  }

  function resolveDirection() {
    const leftActive = moveState.left.active;
    const rightActive = moveState.right.active;
    if (leftActive && rightActive) {
      return moveState.left.priority > moveState.right.priority ? "left" : "right";
    }
    if (leftActive) return "left";
    if (rightActive) return "right";
    return null;
  }

  function processHorizontalInput(deltaMs) {
    const direction = resolveDirection();
    if (!direction) {
      activeMoveDirection = null;
      return;
    }
    if (activeMoveDirection !== direction) {
      activeMoveDirection = direction;
      moveState[direction].timer = 0;
      moveState[direction].repeated = false;
    }
    const entry = moveState[direction];
    entry.timer += deltaMs;
    const threshold = entry.repeated ? config.moveRepeatInterval : config.moveRepeatDelay;
    if (entry.timer >= threshold) {
      movePiece(direction === "left" ? -1 : 1);
      entry.timer -= threshold;
      entry.repeated = true;
    }
  }

  function setSoftDrop(active) {
    state.softDropActive = active && phase === "running";
  }

  function rotateActivePiece() {
    if (!state.currentPiece || phase === "over") return;
    rotatePiece(1);
  }

  function handleKeyDown(event) {
    const { code } = event;
    if (code === "Space") {
      event.preventDefault();
      if (phase === "running") {
        hardDrop();
      } else {
        handlePrimaryAction();
      }
      return;
    }
    if (code === "KeyR") {
      event.preventDefault();
      resetGame();
      return;
    }
    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        event.preventDefault();
        engageMove("left");
        break;
      case "ArrowRight":
      case "KeyD":
        event.preventDefault();
        engageMove("right");
        break;
      case "ArrowDown":
      case "KeyS":
        event.preventDefault();
        setSoftDrop(true);
        break;
      case "ArrowUp":
      case "KeyW":
        event.preventDefault();
        rotateActivePiece();
        break;
      case "KeyP":
        event.preventDefault();
        if (phase === "running") {
          pauseGame();
        } else if (phase === "paused") {
          resumeGame();
        }
        break;
      default:
        break;
    }
  }

  function handleKeyUp(event) {
    const { code } = event;
    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        releaseMove("left");
        break;
      case "ArrowRight":
      case "KeyD":
        releaseMove("right");
        break;
      case "ArrowDown":
      case "KeyS":
        setSoftDrop(false);
        break;
      default:
        break;
    }
  }

  function bindTouchControls() {
    if (!touchButtons) return;
    touchButtons.forEach((button) => {
      const action = button.dataset.action;
      if (!action) return;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        handleTouchAction(action, true);
      });
      button.addEventListener("pointerup", (event) => {
        button.releasePointerCapture(event.pointerId);
        handleTouchAction(action, false);
      });
      ["pointerleave", "pointercancel"].forEach((type) => {
        button.addEventListener(type, () => {
          handleTouchAction(action, false);
        });
      });
    });
  }

  function handleTouchAction(action, active) {
    switch (action) {
      case "left":
        if (active) {
          engageMove("left");
        } else {
          releaseMove("left");
        }
        break;
      case "right":
        if (active) {
          engageMove("right");
        } else {
          releaseMove("right");
        }
        break;
      case "rotate":
        if (active) {
          rotateActivePiece();
        }
        break;
      case "soft":
        setSoftDrop(active);
        break;
      case "hard":
        if (active) {
          if (phase === "running") {
            hardDrop();
          } else {
            handlePrimaryAction();
          }
        }
        break;
      default:
        break;
    }
  }

  function syncTouchVisibility() {
    if (!touchControls) return;
    const isCoarse = coarseMediaQuery ? coarseMediaQuery.matches : false;
    touchControls.setAttribute("aria-hidden", isCoarse ? "false" : "true");
  }

  function handleVisibilityChange() {
    if (document.hidden && phase === "running") {
      pauseGame("Paused — Tab inactive. Press Space or Tap to Resume");
    }
  }

  function update(deltaMs) {
    processHorizontalInput(deltaMs);
    if (phase !== "running") {
      return;
    }

    const interval = state.softDropActive ? config.softDropInterval : state.dropInterval;
    state.dropAccumulator += deltaMs;
    while (state.dropAccumulator >= interval && phase === "running") {
      state.dropAccumulator -= interval;
      const moved = softDropStep();
      if (!moved) {
        break;
      }
    }
  }

  function renderBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#021002");
    gradient.addColorStop(1, "#000000");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.strokeStyle = "rgba(57, 255, 20, 0.12)";
    ctx.lineWidth = 1;
    const cellH = canvas.height / config.rows;
    const cellW = canvas.width / config.cols;
    for (let y = 1; y < config.rows; y += 1) {
      const lineY = Math.round(y * cellH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(canvas.width, lineY);
      ctx.stroke();
    }
    for (let x = 1; x < config.cols; x += 1) {
      const lineX = Math.round(x * cellW) + 0.5;
      ctx.beginPath();
      ctx.moveTo(lineX, 0);
      ctx.lineTo(lineX, canvas.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCell(x, y, type, alpha = 1) {
    if (!type) return;
    const cellWidth = canvas.width / config.cols;
    const cellHeight = canvas.height / config.rows;
    const color = colorMap[type] || "#39ff14";
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillRect(x * cellWidth + 1, y * cellHeight + 1, cellWidth - 2, cellHeight - 2);
    ctx.restore();
  }

  function drawBoard() {
    for (let row = 0; row < config.rows; row += 1) {
      for (let col = 0; col < config.cols; col += 1) {
        const cell = state.board[row][col];
        if (cell) {
          drawCell(col, row, cell);
        }
      }
    }
  }

  function drawGhostPiece(piece) {
    if (!piece) return;
    const ghost = { ...piece };
    while (!collides(ghost, 0, 1)) {
      ghost.y += 1;
    }
    const definition = shapes[ghost.type][ghost.rotationIndex];
    for (const block of definition) {
      const x = ghost.x + block.x;
      const y = ghost.y + block.y;
      if (y >= 0) {
        drawCell(x, y, ghost.type, 0.18);
      }
    }
  }

  function drawCurrentPiece() {
    if (!state.currentPiece) return;
    drawGhostPiece(state.currentPiece);
    const definition = shapes[state.currentPiece.type][state.currentPiece.rotationIndex];
    for (const block of definition) {
      const x = state.currentPiece.x + block.x;
      const y = state.currentPiece.y + block.y;
      if (y >= 0) {
        drawCell(x, y, state.currentPiece.type);
      }
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderBackground();
    drawBoard();
    drawCurrentPiece();
  }

  function loop(now) {
    const delta = Math.min(now - lastFrameTime, 40);
    lastFrameTime = now;
    update(delta);
    render();
    requestAnimationFrame(loop);
  }

  overlay?.addEventListener("click", () => {
    if (phase === "running") {
      pauseGame();
    } else {
      handlePrimaryAction();
    }
  });

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  bindTouchControls();
  syncTouchVisibility();
  coarseMediaQuery?.addEventListener?.("change", syncTouchVisibility);

  resetGame();
  render();
  requestAnimationFrame(loop);
})();
