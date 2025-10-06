/* Flappy Bird-like game implemented on HTML5 Canvas. */

const WORLD_WIDTH = 288;
const WORLD_HEIGHT = 512;
const GROUND_HEIGHT = 112; // ground strip area
const SKY_HEIGHT = WORLD_HEIGHT - GROUND_HEIGHT;

// Physics
const GRAVITY_ACC = 2000; // units/s^2
const FLAP_VELOCITY = -520; // units/s (negative = upward)
const MAX_FALL_SPEED = 900; // clamp falling speed

// Pipes
const PIPE_WIDTH = 52;
const PIPE_SPEED = 120; // units/s
const PIPE_SPAWN_INTERVAL_S = 1.25; // seconds between pipe pairs
const PIPE_GAP_BASE = 140; // starting gap size
const PIPE_GAP_MIN = 95; // minimum gap size as difficulty increases

// Drawing
const BACKGROUND_COLOR_TOP = "#5fc0ff";
const BACKGROUND_COLOR_BOTTOM = "#2c65c8";
const PIPE_COLOR = "#4CAF50";
const PIPE_DARK = "#2e7d32";
const GROUND_COLOR = "#d8b36a";
const BIRD_COLOR = "#ffd166";
const TEXT_COLOR = "#ffffff";

// Game states
const GameState = Object.freeze({
  Ready: "ready",
  Running: "running",
  Over: "over",
});

/** Utility **/
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function circleRectCollision(cx, cy, radius, rx, ry, rw, rh) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

/** Canvas + responsive scaling **/
const canvas = document.getElementById("game");
/** @type {CanvasRenderingContext2D} */
const ctx = canvas.getContext("2d");

let devicePixelRatioValue = 1;
let screenScale = 1;
let screenOffsetX = 0;
let screenOffsetY = 0;

function updateCanvasTransform() {
  devicePixelRatioValue = window.devicePixelRatio || 1;
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;

  // Backing store size for crisp rendering
  canvas.width = Math.max(1, Math.floor(cssWidth * devicePixelRatioValue));
  canvas.height = Math.max(1, Math.floor(cssHeight * devicePixelRatioValue));

  const scaleX = cssWidth / WORLD_WIDTH;
  const scaleY = cssHeight / WORLD_HEIGHT;
  screenScale = Math.min(scaleX, scaleY);
  screenOffsetX = (cssWidth - WORLD_WIDTH * screenScale) / 2;
  screenOffsetY = (cssHeight - WORLD_HEIGHT * screenScale) / 2;

  // Map world units -> device pixels
  ctx.setTransform(
    devicePixelRatioValue * screenScale,
    0,
    0,
    devicePixelRatioValue * screenScale,
    devicePixelRatioValue * screenOffsetX,
    devicePixelRatioValue * screenOffsetY
  );
}

window.addEventListener("resize", updateCanvasTransform);
updateCanvasTransform();

/** Entities **/
class Bird {
  constructor() {
    this.radius = 12;
    this.reset();
  }

  reset() {
    this.x = Math.floor(WORLD_WIDTH * 0.35);
    this.y = Math.floor(SKY_HEIGHT * 0.5);
    this.velocityY = 0;
  }

  flap() {
    this.velocityY = FLAP_VELOCITY;
  }

  update(dt, state) {
    if (state === GameState.Ready) {
      // Gentle bobbing while waiting to start
      const wobble = Math.sin(performance.now() / 200) * 10;
      this.y = Math.floor(SKY_HEIGHT * 0.5 + wobble);
      return;
    }

    // Apply gravity
    this.velocityY += GRAVITY_ACC * dt;
    this.velocityY = clamp(this.velocityY, FLAP_VELOCITY, MAX_FALL_SPEED);
    this.y += this.velocityY * dt;

    // Prevent going above sky ceiling
    if (this.y - this.radius < 0) {
      this.y = this.radius;
      this.velocityY = 0;
    }
  }

  draw(ctx) {
    // Body
    ctx.fillStyle = BIRD_COLOR;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = "#fca311";
    ctx.beginPath();
    const beakSize = 7;
    ctx.moveTo(this.x + this.radius, this.y);
    ctx.lineTo(this.x + this.radius + beakSize, this.y - 3);
    ctx.lineTo(this.x + this.radius + beakSize, this.y + 3);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(this.x + 3, this.y - 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

class PipePair {
  constructor(x, gapCenterY, gapSize) {
    this.x = x;
    this.gapCenterY = gapCenterY;
    this.gapSize = gapSize;
    this.passed = false; // score awarded?
  }

  get topRect() {
    const height = this.gapCenterY - this.gapSize / 2;
    return { x: this.x, y: 0, w: PIPE_WIDTH, h: height };
  }

  get bottomRect() {
    const topHeight = this.gapCenterY - this.gapSize / 2;
    const bottomY = topHeight + this.gapSize;
    const bottomHeight = SKY_HEIGHT - bottomY;
    return { x: this.x, y: bottomY, w: PIPE_WIDTH, h: bottomHeight };
  }

  update(dt, isRunning) {
    if (isRunning) {
      this.x -= PIPE_SPEED * dt;
    }
  }

  draw(ctx) {
    const top = this.topRect;
    const bot = this.bottomRect;

    // Top pipe
    ctx.fillStyle = PIPE_COLOR;
    ctx.fillRect(top.x, top.y, top.w, top.h);
    ctx.fillStyle = PIPE_DARK;
    ctx.fillRect(top.x, top.h - 6, top.w, 6);

    // Bottom pipe
    ctx.fillStyle = PIPE_COLOR;
    ctx.fillRect(bot.x, bot.y, bot.w, bot.h);
    ctx.fillStyle = PIPE_DARK;
    ctx.fillRect(bot.x, bot.y, bot.w, 6);
  }
}

/** Game controller **/
class GameController {
  constructor() {
    this.bird = new Bird();
    this.pipes = [];
    this.state = GameState.Ready;
    this.score = 0;
    this.bestScore = this.loadBestScore();
    this.timeSinceLastPipe = 0;
  }

  loadBestScore() {
    try {
      const raw = localStorage.getItem("flappy_best_score");
      return raw ? parseInt(raw, 10) || 0 : 0;
    } catch (_) {
      return 0;
    }
  }

  saveBestScore() {
    try {
      localStorage.setItem("flappy_best_score", String(this.bestScore));
    } catch (_) {
      // ignore storage errors
    }
  }

  reset() {
    this.bird.reset();
    this.pipes.length = 0;
    this.score = 0;
    this.timeSinceLastPipe = 0;
  }

  start() {
    if (this.state === GameState.Running) return;
    this.reset();
    this.state = GameState.Running;
  }

  gameOver() {
    if (this.state === GameState.Over) return;
    this.state = GameState.Over;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.saveBestScore();
    }
  }

  spawnPipe() {
    const difficulty = clamp(this.score, 0, 20);
    const gapSize = clamp(PIPE_GAP_BASE - difficulty * 2, PIPE_GAP_MIN, PIPE_GAP_BASE);

    const minCenter = 40 + gapSize / 2;
    const maxCenter = SKY_HEIGHT - 40 - gapSize / 2;
    const gapCenterY = Math.round(minCenter + Math.random() * (maxCenter - minCenter));
    const x = WORLD_WIDTH + 10; // spawn slightly off-screen

    this.pipes.push(new PipePair(x, gapCenterY, gapSize));
  }

  update(dt) {
    // Update bird physics regardless, but with different behavior when ready
    this.bird.update(dt, this.state);

    // Collide with ground if below
    if (this.bird.y + this.bird.radius >= SKY_HEIGHT) {
      this.bird.y = SKY_HEIGHT - this.bird.radius;
      this.bird.velocityY = 0;
      if (this.state === GameState.Running) this.gameOver();
    }

    if (this.state === GameState.Running) {
      // Spawn pipes
      this.timeSinceLastPipe += dt;
      if (this.timeSinceLastPipe >= PIPE_SPAWN_INTERVAL_S) {
        this.timeSinceLastPipe = 0;
        this.spawnPipe();
      }

      // Update pipes, check scoring and collisions
      for (const pipe of this.pipes) {
        pipe.update(dt, true);

        // Score when passed
        if (!pipe.passed && pipe.x + PIPE_WIDTH < this.bird.x) {
          pipe.passed = true;
          this.score += 1;
        }

        // Collisions (bird circle vs both rects)
        const top = pipe.topRect;
        const bot = pipe.bottomRect;
        if (
          circleRectCollision(this.bird.x, this.bird.y, this.bird.radius, top.x, top.y, top.w, top.h) ||
          circleRectCollision(this.bird.x, this.bird.y, this.bird.radius, bot.x, bot.y, bot.w, bot.h)
        ) {
          this.gameOver();
        }
      }

      // Remove off-screen pipes
      if (this.pipes.length && this.pipes[0].x + PIPE_WIDTH < -20) {
        this.pipes.shift();
      }
    } else if (this.state === GameState.Over) {
      // Let pipes keep drifting a little after game over for polish
      for (const pipe of this.pipes) {
        pipe.update(dt, true);
      }
      if (this.pipes.length && this.pipes[0].x + PIPE_WIDTH < -20) {
        this.pipes.shift();
      }
    }
  }

  drawBackground() {
    // Clear entire canvas, including letterbox areas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Back to world transform for drawing
    ctx.setTransform(
      devicePixelRatioValue * screenScale,
      0,
      0,
      devicePixelRatioValue * screenScale,
      devicePixelRatioValue * screenOffsetX,
      devicePixelRatioValue * screenOffsetY
    );

    // Sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, SKY_HEIGHT);
    g.addColorStop(0, BACKGROUND_COLOR_TOP);
    g.addColorStop(1, BACKGROUND_COLOR_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_WIDTH, SKY_HEIGHT);

    // Ground
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, SKY_HEIGHT, WORLD_WIDTH, GROUND_HEIGHT);
  }

  drawHUD() {
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";

    if (this.state === GameState.Running) {
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.fillText(String(this.score), WORLD_WIDTH / 2, 40);
    }

    if (this.state === GameState.Ready) {
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.fillText("Tap / Space to start", WORLD_WIDTH / 2, SKY_HEIGHT / 2 - 20);
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("Tap / Space to flap", WORLD_WIDTH / 2, SKY_HEIGHT / 2 + 6);
    }

    if (this.state === GameState.Over) {
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.fillText("Game Over", WORLD_WIDTH / 2, SKY_HEIGHT / 2 - 40);
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.fillText(`Score: ${this.score}`, WORLD_WIDTH / 2, SKY_HEIGHT / 2 - 8);
      ctx.fillText(`Best: ${this.bestScore}`, WORLD_WIDTH / 2, SKY_HEIGHT / 2 + 22);
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("Tap / Space to restart", WORLD_WIDTH / 2, SKY_HEIGHT / 2 + 52);
    }
  }

  draw() {
    this.drawBackground();

    // Pipes
    for (const pipe of this.pipes) {
      pipe.draw(ctx);
    }

    // Bird
    this.bird.draw(ctx);

    // HUD
    this.drawHUD();
  }
}

const game = new GameController();

// Input handling
function isFlapKey(e) {
  return (
    e.code === "Space" ||
    e.code === "ArrowUp" ||
    e.code === "KeyW" ||
    e.key === " " // some browsers
  );
}

window.addEventListener("keydown", (e) => {
  if (!isFlapKey(e)) return;
  e.preventDefault();
  handlePress();
});

window.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  handlePress();
});

function handlePress() {
  if (game.state === GameState.Ready) {
    game.start();
    game.bird.flap();
    return;
  }
  if (game.state === GameState.Running) {
    game.bird.flap();
    return;
  }
  if (game.state === GameState.Over) {
    game.reset();
    game.state = GameState.Ready;
    return;
  }
}

// Main loop
let lastTime = performance.now();
function frame(now) {
  // Re-apply transform each frame in case DPR changed (e.g., browser zoom)
  updateCanvasTransform();

  const dt = Math.min((now - lastTime) / 1000, 0.033); // clamp to 30 FPS delta
  lastTime = now;

  game.update(dt);
  game.draw();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
