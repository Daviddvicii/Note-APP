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
  const linesPillEl = document.getElementById("lines-pill");
  const touchControls = document.getElementById("touch-controls");
  const touchButtons = touchControls?.querySelectorAll(".touch-btn") || [];
  const coarseMediaQuery = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;

  const defaultHint = "←/→ move · ↑ rotate · ↓ soft drop · Space hard drop · P pause · R restart";
  const scoreTable = { 1: 100, 2: 300, 3: 500, 4: 800 };

  const diff = localStorage.getItem('retro_difficulty') || 'normal';
  const gBase = diff==='easy'?1200 : diff==='hard'?600 : 900;

  const config = {
    cols: 10,
    rows: 20,
    das: 150, // first horizontal repeat delay (ms)
    arr: 45, // horizontal repeat interval (ms)
    lockDelay: 550,
    gravityBase: gBase,
    gravityDecay: 0.92,
    gravityMin: 70,
    softDropDivider: 6,
  };

  const colors = {
    I: "#51f6ff",
    O: "#f5ff6a",
    T: "#ff66f9",
    S: "#63ffb7",
    Z: "#ff6b6b",
    J: "#5a7dff",
    L: "#ffb347",
  };

  const defaultKicks = [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-2, 0],
    [2, 0],
  ];

  const iKicks = [
    [0, 0],
    [-2, 0],
    [2, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  const tetrominoes = {
    I: {
      rotations: [
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [3, 1],
        ],
        [
          [2, 0],
          [2, 1],
          [2, 2],
          [2, 3],
        ],
      ],
      kicks: iKicks,
    },
    O: {
      rotations: [
        [
          [1, 0],
          [2, 0],
          [1, 1],
          [2, 1],
        ],
      ],
      kicks: [[0, 0]],
    },
    T: {
      rotations: [
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [1, 0],
        ],
        [
          [1, 0],
          [1, 1],
          [1, 2],
          [2, 1],
        ],
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [1, 2],
        ],
        [
          [1, 0],
          [1, 1],
          [1, 2],
          [0, 1],
        ],
      ],
      kicks: defaultKicks,
    },
    S: {
      rotations: [
        [
          [1, 0],
          [2, 0],
          [0, 1],
          [1, 1],
        ],
        [
          [1, 0],
          [1, 1],
          [2, 1],
          [2, 2],
        ],
        [
          [1, 1],
          [2, 1],
          [0, 2],
          [1, 2],
        ],
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 2],
        ],
      ],
      kicks: defaultKicks,
    },
    Z: {
      rotations: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [2, 1],
        ],
        [
          [2, 0],
          [1, 1],
          [2, 1],
          [1, 2],
        ],
        [
          [0, 1],
          [1, 1],
          [1, 2],
          [2, 2],
        ],
        [
          [1, 0],
          [0, 1],
          [1, 1],
          [0, 2],
        ],
      ],
      kicks: defaultKicks,
    },
    J: {
      rotations: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        [
          [1, 0],
          [2, 0],
          [1, 1],
          [1, 2],
        ],
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [2, 2],
        ],
        [
          [1, 0],
          [1, 1],
          [0, 2],
          [1, 2],
        ],
      ],
      kicks: defaultKicks,
    },
    L: {
      rotations: [
        [
          [2, 0],
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        [
          [1, 0],
          [1, 1],
          [1, 2],
          [2, 2],
        ],
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [0, 2],
        ],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [1, 2],
        ],
      ],
      kicks: defaultKicks,
    },
  };

  const state = {
    board: buildEmptyBoard(),
    currentPiece: null,
    score: 0,
    lines: 0,
    level: 1,
  };

  let phase = "idle"; // idle | running | paused | over
  let bag = [];
  let lastFrameTime = performance.now();
  let dropAccumulator = 0;
  let lockTimer = 0;

  const inputState = {
    keyLeft: false,
    keyRight: false,
    pointerDir: 0,
    keySoft: false,
    pointerSoft: false,
  };

  const pointerMoveMap = new Map();
  const pointerSoftSet = new Set();

  const moveRepeatState = {
    activeDir: 0,
    timer: 0,
    firstStep: true,
  };

  function buildEmptyBoard() {
    return Array.from({ length: config.rows }, () => Array(config.cols).fill(0));
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function refillBag() {
    bag = shuffle(["I", "O", "T", "S", "Z", "J", "L"]);
  }

  function drawFromBag() {
    if (!bag.length) {
      refillBag();
    }
    return bag.pop();
  }

  function spawnPiece() {
    const type = drawFromBag();
    const piece = {
      type,
      rotation: 0,
      x: Math.floor(config.cols / 2) - 2,
      y: -2,
    };
    if (!isPositionValid(piece)) {
      handleGameOver();
      return false;
    }
    state.currentPiece = piece;
    lockTimer = 0;
    dropAccumulator = 0;
    return true;
  }

  function isPositionValid(piece, offsetX = 0, offsetY = 0, rotationIndex = piece.rotation) {
    const shape = tetrominoes[piece.type].rotations[rotationIndex];
    for (const [cellX, cellY] of shape) {
      const x = piece.x + cellX + offsetX;
      const y = piece.y + cellY + offsetY;
      if (x < 0 || x >= config.cols || y >= config.rows) {
        return false;
      }
      if (y >= 0 && state.board[y][x]) {
        return false;
      }
    }
    return true;
  }

  function tryMove(dx, dy) {
    if (!state.currentPiece) return false;
    if (!isPositionValid(state.currentPiece, dx, dy)) {
      return false;
    }
    state.currentPiece.x += dx;
    state.currentPiece.y += dy;
    return true;
  }

  function attemptShift(direction) {
    if (!state.currentPiece) return;
    if (tryMove(direction, 0)) {
      lockTimer = 0;
    }
  }

  function rotatePiece(direction = 1) {
    if (!state.currentPiece) return;
    const piece = state.currentPiece;
    const def = tetrominoes[piece.type];
    const rotations = def.rotations.length;
    const nextRotation = (piece.rotation + direction + rotations) % rotations;
    const kicks = def.kicks || defaultKicks;
    for (const [offsetX, offsetY] of kicks) {
      if (isPositionValid(piece, offsetX, offsetY, nextRotation)) {
        piece.rotation = nextRotation;
        piece.x += offsetX;
        piece.y += offsetY;
        lockTimer = 0;
        return true;
      }
    }
    return false;
  }

  function hardDrop() {
    if (phase !== "running" || !state.currentPiece) return;
    let steps = 0;
    while (tryMove(0, 1)) {
      steps += 1;
    }
    if (steps > 0) {
      state.score += steps * 2;
      updateHud();
    }
    lockCurrentPiece();
  }

  function lockCurrentPiece() {
    if (!state.currentPiece) return;
    const shape = tetrominoes[state.currentPiece.type].rotations[state.currentPiece.rotation];
    for (const [cellX, cellY] of shape) {
      const x = state.currentPiece.x + cellX;
      const y = state.currentPiece.y + cellY;
      if (y >= 0 && y < config.rows && x >= 0 && x < config.cols) {
        state.board[y][x] = state.currentPiece.type;
      } else if (y < 0) {
        handleGameOver();
        return;
      }
    }
    lockTimer = 0;
    dropAccumulator = 0;
    state.currentPiece = null;
    const cleared = clearLines();
    if (cleared > 0) {
      state.lines += cleared;
      state.score += scoreTable[cleared] || cleared * 100;
      const newLevel = Math.floor(state.lines / 10) + 1;
      if (newLevel !== state.level) {
        state.level = newLevel;
      }
      updateHud();
    }
    if (!spawnPiece()) {
      return;
    }
  }

  function clearLines() {
    let cleared = 0;
    for (let row = config.rows - 1; row >= 0; row -= 1) {
      if (state.board[row].every((cell) => cell)) {
        cleared += 1;
        state.board.splice(row, 1);
        state.board.unshift(Array(config.cols).fill(0));
        row += 1;
      }
    }
    return cleared;
  }

  function currentGravityInterval() {
    const base = Math.max(
      config.gravityMin,
      config.gravityBase * Math.pow(config.gravityDecay, state.level - 1)
    );
    const isSoft = inputState.keySoft || inputState.pointerSoft;
    return isSoft ? Math.max(35, base / config.softDropDivider) : base;
  }

  function update(delta) {
    if (phase !== "running" || !state.currentPiece) return;
    updateHorizontalMovement(delta);
    const interval = currentGravityInterval();
    dropAccumulator += delta;
    let processed = 0;
    while (dropAccumulator >= interval && processed < 5) {
      dropAccumulator -= interval;
      processed += 1;
      if (!tryMove(0, 1)) {
        lockTimer += interval;
        if (lockTimer >= config.lockDelay) {
          lockCurrentPiece();
          break;
        } else {
          break;
        }
      } else {
        lockTimer = 0;
      }
    }
  }

  function updateHorizontalMovement(delta) {
    if (!moveRepeatState.activeDir) return;
    moveRepeatState.timer += delta;
    const threshold = moveRepeatState.firstStep ? config.das : config.arr;
    if (moveRepeatState.timer >= threshold) {
      moveRepeatState.timer -= threshold;
      moveRepeatState.firstStep = false;
      attemptShift(moveRepeatState.activeDir);
    }
  }

  function refreshHorizontalInput() {
    const keyDir =
      inputState.keyLeft === inputState.keyRight
        ? 0
        : inputState.keyLeft
        ? -1
        : 1;
    const pointerDir = inputState.pointerDir;
    const desiredDir = pointerDir || keyDir;
    if (desiredDir === moveRepeatState.activeDir) {
      return;
    }
    moveRepeatState.activeDir = desiredDir;
    moveRepeatState.timer = 0;
    moveRepeatState.firstStep = true;
    if (desiredDir !== 0) {
      attemptShift(desiredDir);
    }
  }

  function updateSoftDropPointer() {
    inputState.pointerSoft = pointerSoftSet.size > 0;
  }

  function updatePointerDirection() {
    let dir = 0;
    pointerMoveMap.forEach((value) => {
      dir = value;
    });
    inputState.pointerDir = dir;
    refreshHorizontalInput();
  }

  function showOverlay(message, hint = defaultHint) {
    if (!overlay) return;
    overlay.replaceChildren(message);
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
    if (scoreEl) scoreEl.textContent = state.score.toString();
    if (linesEl) linesEl.textContent = state.lines.toString();
    if (levelEl) levelEl.textContent = state.level.toString();
    if (linesPillEl) linesPillEl.textContent = state.lines.toString();
  }

  function resetGame() {
    state.board = buildEmptyBoard();
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.currentPiece = null;
    bag = [];
    dropAccumulator = 0;
    lockTimer = 0;
    spawnPiece();
    updateHud();
    phase = "idle";
    showOverlay("Press Space or Tap to Start", defaultHint);
  }

  function startGame() {
    if (phase === "running") return;
    if (phase === "over") {
      resetGame();
    }
    hideOverlay();
    phase = "running";
    lastFrameTime = performance.now();
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

  function handleGameOver() {
    phase = "over";
    showOverlay("Game Over — Press Space or Tap to Restart", defaultHint);
  }

  function handlePrimaryAction() {
    if (phase === "idle") {
      startGame();
    } else if (phase === "paused") {
      resumeGame();
    } else if (phase === "over") {
      resetGame();
      startGame();
    }
  }

  function renderBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#020602");
    gradient.addColorStop(1, "#000000");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.strokeStyle = "rgba(57, 255, 20, 0.08)";
    ctx.lineWidth = 1;
    const cellHeight = canvas.height / config.rows;
    for (let y = 0; y <= config.rows; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellHeight);
      ctx.lineTo(canvas.width, y * cellHeight);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCell(x, y, type, alpha = 1, outlineAlpha = 0.25) {
    const cellWidth = canvas.width / config.cols;
    const cellHeight = canvas.height / config.rows;
    const px = x * cellWidth;
    const py = y * cellHeight;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colors[type] || colors.T;
    ctx.fillRect(px + 0.6, py + 0.6, cellWidth - 1.2, cellHeight - 1.2);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(px + 1, py + 1, cellWidth - 2, cellHeight / 3);
    ctx.strokeStyle = `rgba(0, 0, 0, ${outlineAlpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.6, py + 0.6, cellWidth - 1.2, cellHeight - 1.2);
    ctx.restore();
  }

  function drawBoard() {
    for (let y = 0; y < config.rows; y += 1) {
      for (let x = 0; x < config.cols; x += 1) {
        const cell = state.board[y][x];
        if (cell) {
          drawCell(x, y, cell);
        }
      }
    }
  }

  function drawGhostPiece() {
    if (!state.currentPiece) return;
    const ghost = {
      ...state.currentPiece,
    };
    while (isPositionValid(ghost, 0, 1)) {
      ghost.y += 1;
    }
    const shape = tetrominoes[ghost.type].rotations[ghost.rotation];
    for (const [cellX, cellY] of shape) {
      const drawY = ghost.y + cellY;
      if (drawY < 0 || drawY >= config.rows) continue;
      drawCell(ghost.x + cellX, drawY, ghost.type, 0.18, 0.15);
    }
  }

  function drawActivePiece() {
    if (!state.currentPiece) return;
    const shape = tetrominoes[state.currentPiece.type].rotations[state.currentPiece.rotation];
    for (const [cellX, cellY] of shape) {
      const drawY = state.currentPiece.y + cellY;
      if (drawY < 0 || drawY >= config.rows) continue;
      drawCell(state.currentPiece.x + cellX, drawY, state.currentPiece.type);
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderBackground();
    drawBoard();
    drawGhostPiece();
    drawActivePiece();
  }

  function loop(now) {
    const delta = Math.min(now - lastFrameTime, 120);
    lastFrameTime = now;
    update(delta);
    render();
    requestAnimationFrame(loop);
  }

  function handleKeyDown(event) {
    const { code } = event;
    switch (code) {
      case "ArrowLeft":
        event.preventDefault();
        inputState.keyLeft = true;
        refreshHorizontalInput();
        break;
      case "ArrowRight":
        event.preventDefault();
        inputState.keyRight = true;
        refreshHorizontalInput();
        break;
      case "ArrowDown":
        event.preventDefault();
        inputState.keySoft = true;
        break;
      case "ArrowUp":
      case "KeyX":
        event.preventDefault();
        if (phase === "running") {
          rotatePiece(1);
        }
        break;
      case "Space":
        event.preventDefault();
        if (phase === "running") {
          hardDrop();
        } else {
          handlePrimaryAction();
        }
        break;
      case "KeyP":
      case "Escape":
        event.preventDefault();
        if (phase === "running") {
          pauseGame();
        } else if (phase === "paused") {
          resumeGame();
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
    const { code } = event;
    switch (code) {
      case "ArrowLeft":
        inputState.keyLeft = false;
        refreshHorizontalInput();
        break;
      case "ArrowRight":
        inputState.keyRight = false;
        refreshHorizontalInput();
        break;
      case "ArrowDown":
        inputState.keySoft = false;
        break;
      default:
        break;
    }
  }

  function bindTouchControls() {
    if (!touchButtons.length) return;
    touchButtons.forEach((button) => {
      const action = button.dataset.action;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        if (action === "left") {
          pointerMoveMap.set(event.pointerId, -1);
          updatePointerDirection();
        } else if (action === "right") {
          pointerMoveMap.set(event.pointerId, 1);
          updatePointerDirection();
        } else if (action === "soft") {
          pointerSoftSet.add(event.pointerId);
          updateSoftDropPointer();
        } else if (action === "rotate") {
          rotatePiece(1);
        } else if (action === "hard") {
          hardDrop();
        }
      });

      const clearPointer = (event) => {
        if (action === "left" || action === "right") {
          pointerMoveMap.delete(event.pointerId);
          updatePointerDirection();
        } else if (action === "soft") {
          pointerSoftSet.delete(event.pointerId);
          updateSoftDropPointer();
        }
      };

      button.addEventListener("pointerup", (event) => {
        button.releasePointerCapture(event.pointerId);
        clearPointer(event);
      });

      ["pointerleave", "pointercancel"].forEach((type) => {
        button.addEventListener(type, clearPointer);
      });
    });
  }

  function syncTouchVisibility() {
    if (!touchControls) return;
    const shouldShow = coarseMediaQuery ? coarseMediaQuery.matches : false;
    touchControls.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  }

  function handleVisibilityChange() {
    if (document.hidden && phase === "running") {
      pauseGame("Paused (tab inactive) — Press Space or Tap to Resume");
    }
  }

  overlay?.addEventListener("click", handlePrimaryAction);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  bindTouchControls();
  syncTouchVisibility();
  coarseMediaQuery?.addEventListener?.("change", syncTouchVisibility);

  resetGame();
  requestAnimationFrame(loop);
})();
