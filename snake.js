function syncLeaderboard(name, score) {
  console.log("syncLeaderboard placeholder:", name, score);
}

(function () {
  "use strict";

  const GRID_SIZE = 20;
  const TICK_INTERVAL = 130; // milliseconds
  const SCORE_PER_APPLE = 10;
  const STORAGE_KEY = "snake_best_score";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best-score");
  const dpad = document.querySelector(".dpad");

  const COLORS = {
    background: "#020808",
    grid: "rgba(127, 255, 212, 0.08)",
    snakeBody: "#7fffd4",
    snakeHead: "#a2fff0",
    apple: "#ff5ab7",
  };

  let cellSize = 24;
  let snake = [];
  let direction = { x: 1, y: 0 };
  let queuedDirection = { x: 1, y: 0 };
  let apple = { x: 0, y: 0 };
  let score = 0;
  let bestScore = 0;
  let lastTick = 0;
  let animationId = null;
  let isRunning = false;
  let isGameOver = false;

  function init() {
    bestScore = loadBestScore();
    bestEl.textContent = bestScore;
    attachEvents();
    resizeCanvas();
    resetGame();
  }

  function attachEvents() {
    window.addEventListener("keydown", handleKeydown, { passive: false });
    window.addEventListener("resize", handleResize);

    overlay.addEventListener("click", tryRestart);
    overlay.addEventListener("touchend", tryRestart, { passive: true });

    if (dpad) {
      dpad.addEventListener("pointerdown", (event) => {
        const directionName = event.target.dataset.direction;
        if (!directionName) {
          return;
        }
        event.preventDefault();
        handleDirectionInput(directionName);
      });
    }
  }

  function handleKeydown(event) {
    if (event.key === " " || event.code === "Space") {
      if (isGameOver) {
        event.preventDefault();
        restartGame();
      }
      return;
    }

    const keyMap = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      W: "up",
      s: "down",
      S: "down",
      a: "left",
      A: "left",
      d: "right",
      D: "right",
    };

    const directionName = keyMap[event.key];
    if (directionName) {
      event.preventDefault();
      handleDirectionInput(directionName);
    }
  }

  function handleDirectionInput(directionName) {
    const dirVectors = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };

    const next = dirVectors[directionName];
    if (!next) {
      return;
    }

    // Prevent reversing into itself
    if (snake.length > 1 && next.x === -direction.x && next.y === -direction.y) {
      return;
    }

    queuedDirection = next;
  }

  function handleResize() {
    resizeCanvas();
    // Force redraw without waiting for next tick
    draw();
  }

  function resizeCanvas() {
    const maxSize = Math.min(
      window.innerWidth - 32,
      window.innerHeight - 200
    );
    const safeSize = Math.max(320, maxSize);
    const size = isFinite(safeSize) ? safeSize : 480;
    cellSize = Math.max(12, Math.floor(size / GRID_SIZE));
    canvas.width = canvas.height = cellSize * GRID_SIZE;
  }

  function resetGame() {
    snake = [
      { x: Math.floor(GRID_SIZE / 2) + 1, y: Math.floor(GRID_SIZE / 2) },
      { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) },
      { x: Math.floor(GRID_SIZE / 2) - 1, y: Math.floor(GRID_SIZE / 2) },
    ];
    direction = { x: 1, y: 0 };
    queuedDirection = { x: 1, y: 0 };
    score = 0;
    updateScoreboard();
    spawnApple();
    overlay.classList.remove("visible");
    isGameOver = false;
    startLoop();
  }

  function startLoop() {
    isRunning = true;
    lastTick = 0;
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
    animationId = requestAnimationFrame(loop);
  }

  function loop(timestamp) {
    if (!isRunning) {
      return;
    }

    if (!lastTick) {
      lastTick = timestamp;
    }

    const delta = timestamp - lastTick;
    if (delta >= TICK_INTERVAL) {
      lastTick = timestamp;
      tick();
    }

    animationId = requestAnimationFrame(loop);
  }

  function tick() {
    direction = queuedDirection;
    const head = snake[0];
    const newHead = { x: head.x + direction.x, y: head.y + direction.y };

    if (isCollision(newHead)) {
      return endGame();
    }

    snake.unshift(newHead);

    if (newHead.x === apple.x && newHead.y === apple.y) {
      score += SCORE_PER_APPLE;
      updateScoreboard();
      spawnApple();
    } else {
      snake.pop();
    }

    draw();
  }

  function isCollision(position) {
    const outOfBounds =
      position.x < 0 ||
      position.y < 0 ||
      position.x >= GRID_SIZE ||
      position.y >= GRID_SIZE;
    if (outOfBounds) {
      return true;
    }

    return snake.some(
      (segment) => segment.x === position.x && segment.y === position.y
    );
  }

  function spawnApple() {
    let newApple;
    do {
      newApple = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (snake.some((segment) => segment.x === newApple.x && segment.y === newApple.y));
    apple = newApple;
  }

  function draw() {
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid();
    drawApple();
    drawSnake();
  }

  function drawGrid() {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID_SIZE; i++) {
      const pos = i * cellSize;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, canvas.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(canvas.width, pos);
      ctx.stroke();
    }
  }

  function drawSnake() {
    ctx.fillStyle = COLORS.snakeBody;
    snake.forEach((segment, index) => {
      if (index === 0) {
        ctx.fillStyle = COLORS.snakeHead;
      } else {
        ctx.fillStyle = COLORS.snakeBody;
      }
      ctx.fillRect(
        segment.x * cellSize,
        segment.y * cellSize,
        cellSize,
        cellSize
      );
    });
  }

  function drawApple() {
    ctx.fillStyle = COLORS.apple;
    const padding = Math.max(2, Math.floor(cellSize * 0.15));
    ctx.beginPath();
    ctx.roundRect(
      apple.x * cellSize + padding,
      apple.y * cellSize + padding,
      cellSize - padding * 2,
      cellSize - padding * 2,
      Math.min(10, padding * 2)
    );
    ctx.fill();
  }

  function updateScoreboard() {
    scoreEl.textContent = score;
    if (score > bestScore) {
      bestScore = score;
      bestEl.textContent = bestScore;
      saveBestScore(bestScore);
    } else {
      bestEl.textContent = bestScore;
    }
  }

  function endGame() {
    isRunning = false;
    isGameOver = true;
    overlay.classList.add("visible");
    syncLeaderboard("You", score);
  }

  function tryRestart() {
    if (isGameOver) {
      restartGame();
    }
  }

  function restartGame() {
    resetGame();
    draw();
  }

  function loadBestScore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const value = parseInt(raw, 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (error) {
      console.warn("Unable to load best score:", error);
      return 0;
    }
  }

  function saveBestScore(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch (error) {
      console.warn("Unable to save best score:", error);
    }
  }

  // Polyfill roundRect if needed for older browsers
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (
      x,
      y,
      width,
      height,
      radius
    ) {
      const r = Math.min(width, height) / 2;
      const corner = typeof radius === "number" ? radius : r;
      this.beginPath();
      this.moveTo(x + corner, y);
      this.lineTo(x + width - corner, y);
      this.quadraticCurveTo(x + width, y, x + width, y + corner);
      this.lineTo(x + width, y + height - corner);
      this.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
      this.lineTo(x + corner, y + height);
      this.quadraticCurveTo(x, y + height, x, y + height - corner);
      this.lineTo(x, y + corner);
      this.quadraticCurveTo(x, y, x + corner, y);
      this.closePath();
    };
  }

  init();
})();
