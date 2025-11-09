function syncLeaderboard(name, score) {
  console.log(name, score);
}

window.addEventListener("DOMContentLoaded", () => {
  const gridSize = 20;
  const tickInterval = 130;
  const storageKey = "snake_best_score";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const gameArea = document.getElementById("game-area");
  const dpadButtons = document.querySelectorAll(".pad-button[data-direction]");

  const directions = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  let cellSize = canvas.width / gridSize;
  let snake = [];
  let direction = { ...directions.right };
  let nextDirection = { ...directions.right };
  let apple = { x: 0, y: 0 };
  let score = 0;
  let best = loadBestScore();
  let running = false;
  let lastTime = 0;
  let accumulator = 0;
  let animationFrameId = null;

  updateScoreDisplay();
  updateBestDisplay();
  resizeCanvas();
  attachEventListeners();
  startGame();

  function startGame() {
    snake = createInitialSnake();
    direction = { ...directions.right };
    nextDirection = { ...directions.right };
    score = 0;
    updateScoreDisplay();
    spawnApple();
    overlay.classList.remove("visible");
    running = true;
    lastTime = 0;
    accumulator = 0;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
  }

  function createInitialSnake() {
    const center = Math.floor(gridSize / 2);
    return [
      { x: center + 1, y: center },
      { x: center, y: center },
      { x: center - 1, y: center },
    ];
  }

  function gameLoop(timestamp) {
    if (!running) {
      return;
    }

    if (!lastTime) {
      lastTime = timestamp;
    }

    const delta = timestamp - lastTime;
    lastTime = timestamp;
    accumulator += delta;

    while (accumulator >= tickInterval) {
      if (!step()) {
        running = false;
        break;
      }
      accumulator -= tickInterval;
    }

    draw();

    if (running) {
      animationFrameId = requestAnimationFrame(gameLoop);
    }
  }

  function step() {
    direction = { ...nextDirection };
    const newHead = {
      x: snake[0].x + direction.x,
      y: snake[0].y + direction.y,
    };

    if (hitsWall(newHead) || hitsSelf(newHead)) {
      handleGameOver();
      return false;
    }

    snake.unshift(newHead);

    const ateApple = newHead.x === apple.x && newHead.y === apple.y;
    if (ateApple) {
      score += 10;
      updateScoreDisplay();
      if (score > best) {
        best = score;
        updateBestDisplay();
        saveBestScore(best);
        syncLeaderboard("Player", best);
      }
      spawnApple();
    } else {
      snake.pop();
    }

    return true;
  }

  function hitsWall(segment) {
    return (
      segment.x < 0 ||
      segment.x >= gridSize ||
      segment.y < 0 ||
      segment.y >= gridSize
    );
  }

  function hitsSelf(segment) {
    return snake.some(
      (part, index) => index !== 0 && part.x === segment.x && part.y === segment.y
    );
  }

  function spawnApple() {
    let position;
    do {
      position = {
        x: Math.floor(Math.random() * gridSize),
        y: Math.floor(Math.random() * gridSize),
      };
    } while (snake.some((segment) => segment.x === position.x && segment.y === position.y));
    apple = position;
  }

  function handleGameOver() {
    overlay.classList.add("visible");
    running = false;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();
    drawGrid();
    drawApple();
    drawSnake();
  }

  function drawBackground() {
    ctx.fillStyle = "rgba(127, 255, 212, 0.06)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(127, 255, 212, 0.08)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let i = 1; i < gridSize; i += 1) {
      const offset = Math.round(i * cellSize) + 0.5;
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset, canvas.height);
      ctx.moveTo(0, offset);
      ctx.lineTo(canvas.width, offset);
    }
    ctx.stroke();
  }

  function drawSnake() {
    snake.forEach((segment, index) => {
      const x = segment.x * cellSize;
      const y = segment.y * cellSize;
      ctx.fillStyle = index === 0 ? "#bafff0" : "#7fffd4";
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    });
  }

  function drawApple() {
    const radius = (cellSize * 0.5);
    const centerX = apple.x * cellSize + cellSize / 2;
    const centerY = apple.y * cellSize + cellSize / 2;
    ctx.fillStyle = "#7fffd4";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateScoreDisplay() {
    scoreEl.textContent = String(score);
  }

  function updateBestDisplay() {
    bestEl.textContent = String(best);
  }

  function loadBestScore() {
    const stored = localStorage.getItem(storageKey);
    const parsed = Number.parseInt(stored ?? "0", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function saveBestScore(value) {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch (error) {
      console.warn("Unable to save best score:", error);
    }
  }

  function resizeCanvas() {
    const available = Math.min(gameArea.clientWidth, gameArea.clientHeight);
    const unit = Math.max(1, Math.floor(available / gridSize));
    const size = unit * gridSize;

    if (size <= 0) {
      return;
    }

    canvas.width = size;
    canvas.height = size;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    cellSize = size / gridSize;
  }

  function attachEventListeners() {
    document.addEventListener("keydown", handleKeydown, { passive: false });
    overlay.addEventListener("click", () => {
      if (!running) {
        startGame();
      }
    });
    window.addEventListener("resize", () => {
      resizeCanvas();
      draw();
    });

    dpadButtons.forEach((button) => {
      const dirKey = button.dataset.direction;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        handleDirectionChange(dirKey);
      });
    });
  }

  function handleKeydown(event) {
    const key = event.key;
    switch (key) {
      case "ArrowUp":
        event.preventDefault();
        handleDirectionChange("up");
        break;
      case "ArrowDown":
        event.preventDefault();
        handleDirectionChange("down");
        break;
      case "ArrowLeft":
        event.preventDefault();
        handleDirectionChange("left");
        break;
      case "ArrowRight":
        event.preventDefault();
        handleDirectionChange("right");
        break;
      case " ":
        if (!running) {
          event.preventDefault();
          startGame();
        }
        break;
      default:
        break;
    }
  }

  function handleDirectionChange(dirKey) {
    const newDirection = directions[dirKey];
    if (!newDirection) {
      return;
    }
    if (newDirection.x === -direction.x && newDirection.y === -direction.y) {
      return;
    }
    nextDirection = { ...newDirection };
  }
});
