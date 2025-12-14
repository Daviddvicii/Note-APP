// ===========================
// Neon Sky Jumper - Game Logic
// ===========================

// === DOM Elements ===
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMessage = document.getElementById('overlay-message');
const overlayButton = document.getElementById('overlay-button');
const scoreDisplay = document.getElementById('score-display');
const bestDisplay = document.getElementById('best-display');

// === Constants ===
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;
const GRAVITY = 2200;
const JUMP_STRENGTH = -950;
const BOOST_JUMP_STRENGTH = -1400;
const PLAYER_MOVE_SPEED = 12;
const SCROLL_THRESHOLD = CANVAS_HEIGHT * 0.4;
const PLATFORM_WIDTH = 120;
const PLATFORM_HEIGHT = 18;
const PLAYER_RADIUS = 28;
const BEST_SCORE_KEY = 'neon-sky-jumper-best';

// Platform types
const PLATFORM_TYPES = {
  NORMAL: 'normal',
  MOVING: 'moving',
  BREAKABLE: 'breakable',
  BOOST: 'boost'
};

// === Game State ===
const state = {
  gameState: 'start', // 'start', 'running', 'gameover'
  score: 0,
  best: 0,
  player: {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT - 300,
    targetX: CANVAS_WIDTH / 2,
    radius: PLAYER_RADIUS,
    vx: 0,
    vy: 0,
    color: '#00ffff'
  },
  platforms: [],
  cameraY: 0,
  maxHeight: 0,
  keys: {
    left: false,
    right: false
  },
  pointer: {
    active: false,
    x: 0
  },
  particles: [],
  lastTime: 0
};

// === Platform Class ===
class Platform {
  constructor(x, y, type = PLATFORM_TYPES.NORMAL) {
    this.x = x;
    this.y = y;
    this.width = PLATFORM_WIDTH;
    this.height = PLATFORM_HEIGHT;
    this.type = type;
    this.broken = false;
    this.breakTimer = 0;
    
    // Moving platform properties
    if (type === PLATFORM_TYPES.MOVING) {
      this.vx = 150 + Math.random() * 100;
      this.direction = Math.random() > 0.5 ? 1 : -1;
      this.vx *= this.direction;
    }
    
    // Set colors based on type
    switch (type) {
      case PLATFORM_TYPES.NORMAL:
        this.color = '#00ffff';
        break;
      case PLATFORM_TYPES.MOVING:
        this.color = '#ff00ff';
        break;
      case PLATFORM_TYPES.BREAKABLE:
        this.color = '#ff6600';
        break;
      case PLATFORM_TYPES.BOOST:
        this.color = '#00ff88';
        break;
    }
  }
  
  update(dt) {
    // Move moving platforms
    if (this.type === PLATFORM_TYPES.MOVING) {
      this.x += this.vx * dt;
      
      // Bounce off walls
      if (this.x <= 0 || this.x + this.width >= CANVAS_WIDTH) {
        this.vx *= -1;
        this.x = Math.max(0, Math.min(CANVAS_WIDTH - this.width, this.x));
      }
    }
    
    // Update break timer
    if (this.broken) {
      this.breakTimer += dt;
    }
  }
  
  draw(cameraY) {
    const screenY = this.y - cameraY;
    
    // Don't draw if off-screen
    if (screenY < -100 || screenY > CANVAS_HEIGHT + 100) return;
    
    ctx.save();
    
    // Fade out if breaking
    if (this.broken) {
      const fadeAmount = Math.min(1, this.breakTimer / 0.3);
      ctx.globalAlpha = 1 - fadeAmount;
    }
    
    // Draw platform with glow
    const gradient = ctx.createLinearGradient(this.x, screenY, this.x + this.width, screenY);
    gradient.addColorStop(0, this.color + '80');
    gradient.addColorStop(0.5, this.color);
    gradient.addColorStop(1, this.color + '80');
    
    // Outer glow
    ctx.shadowBlur = 20;
    ctx.shadowColor = this.color;
    
    // Platform body
    ctx.fillStyle = gradient;
    ctx.fillRect(this.x, screenY, this.width, this.height);
    
    // Edge highlights
    ctx.shadowBlur = 0;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x, screenY, this.width, this.height);
    
    // Special indicators
    if (this.type === PLATFORM_TYPES.BOOST) {
      // Draw arrows for boost
      ctx.fillStyle = '#ffffff';
      const arrowY = screenY + this.height / 2;
      const arrowX = this.x + this.width / 2;
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY - 5);
      ctx.lineTo(arrowX - 4, arrowY + 2);
      ctx.lineTo(arrowX + 4, arrowY + 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
}

// === Particle Class ===
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 200;
    this.vy = (Math.random() - 0.5) * 200;
    this.life = 1;
    this.decay = 2 + Math.random() * 2;
    this.radius = 3 + Math.random() * 3;
    this.color = color;
  }
  
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= this.decay * dt;
    return this.life > 0;
  }
  
  draw(cameraY) {
    const screenY = this.y - cameraY;
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, screenY, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// === Initialization ===
function init() {
  // Load best score
  state.best = parseInt(localStorage.getItem(BEST_SCORE_KEY) || '0', 10);
  bestDisplay.textContent = state.best;
  
  // Event listeners
  overlayButton.addEventListener('click', handleStartGame);
  overlay.addEventListener('click', handleStartGame);
  
  // Canvas input
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  
  // Keyboard
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  
  // Start animation loop
  requestAnimationFrame(loop);
}

// === Game Control ===
function handleStartGame(e) {
  if (e) e.stopPropagation();
  
  if (state.gameState === 'start' || state.gameState === 'gameover') {
    startGame();
  }
}

function startGame() {
  // Reset state
  state.gameState = 'running';
  state.score = 0;
  state.cameraY = 0;
  state.maxHeight = 0;
  state.particles = [];
  
  // Reset player
  state.player.x = CANVAS_WIDTH / 2;
  state.player.y = CANVAS_HEIGHT - 300;
  state.player.targetX = CANVAS_WIDTH / 2;
  state.player.vx = 0;
  state.player.vy = 0;
  
  // Generate initial platforms
  state.platforms = [];
  generateInitialPlatforms();
  
  // Hide overlay
  overlay.classList.add('hidden');
  
  // Update display
  scoreDisplay.textContent = state.score;
}

function endGame() {
  state.gameState = 'gameover';
  
  // Update best score
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem(BEST_SCORE_KEY, state.best.toString());
    bestDisplay.textContent = state.best;
  }
  
  // Show overlay
  overlayTitle.textContent = 'Game Over';
  overlayMessage.innerHTML = `
    Your score: <strong>${state.score}</strong><br>
    Best score: <strong>${state.best}</strong><br><br>
    Try to jump higher next time!
  `;
  overlayButton.textContent = 'Play Again';
  overlay.classList.remove('hidden');
}

// === Platform Generation ===
function generateInitialPlatforms() {
  // Starting platform
  state.platforms.push(new Platform(
    CANVAS_WIDTH / 2 - PLATFORM_WIDTH / 2,
    CANVAS_HEIGHT - 200,
    PLATFORM_TYPES.NORMAL
  ));
  
  // Generate platforms up the screen
  let lastY = CANVAS_HEIGHT - 200;
  while (lastY > -500) {
    const x = Math.random() * (CANVAS_WIDTH - PLATFORM_WIDTH);
    const gap = 140 + Math.random() * 60;
    lastY -= gap;
    
    const platform = new Platform(x, lastY, getRandomPlatformType(lastY));
    state.platforms.push(platform);
  }
}

function getRandomPlatformType(height) {
  // Difficulty increases with height
  const heightFactor = Math.max(0, -height / 2000);
  const rand = Math.random();
  
  // 60% normal, 20% moving, 15% breakable, 5% boost
  if (rand < 0.60 - heightFactor * 0.2) {
    return PLATFORM_TYPES.NORMAL;
  } else if (rand < 0.80) {
    return PLATFORM_TYPES.MOVING;
  } else if (rand < 0.95) {
    return PLATFORM_TYPES.BREAKABLE;
  } else {
    return PLATFORM_TYPES.BOOST;
  }
}

function spawnPlatformsAbove() {
  // Find highest platform
  let highestY = Math.min(...state.platforms.map(p => p.y));
  
  // Spawn new platforms if needed
  while (highestY > state.cameraY - 500) {
    const x = Math.random() * (CANVAS_WIDTH - PLATFORM_WIDTH);
    const gap = 140 + Math.random() * 70 + Math.max(0, -highestY / 5000) * 30;
    highestY -= gap;
    
    const platform = new Platform(x, highestY, getRandomPlatformType(highestY));
    state.platforms.push(platform);
  }
}

function cleanupPlatforms() {
  // Remove platforms far below camera
  state.platforms = state.platforms.filter(p => {
    if (p.broken && p.breakTimer > 0.5) return false;
    return p.y < state.cameraY + CANVAS_HEIGHT + 200;
  });
}

// === Input Handlers ===
function handlePointerDown(e) {
  if (state.gameState !== 'running') return;
  
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_WIDTH / rect.width;
  state.pointer.active = true;
  state.pointer.x = (e.clientX - rect.left) * scaleX;
  state.player.targetX = state.pointer.x;
}

function handlePointerMove(e) {
  if (state.gameState !== 'running' || !state.pointer.active) return;
  
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_WIDTH / rect.width;
  state.pointer.x = (e.clientX - rect.left) * scaleX;
  state.player.targetX = state.pointer.x;
}

function handlePointerUp(e) {
  state.pointer.active = false;
}

function handleKeyDown(e) {
  if (state.gameState !== 'running') return;
  
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    state.keys.left = true;
  }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    state.keys.right = true;
  }
}

function handleKeyUp(e) {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    state.keys.left = false;
  }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    state.keys.right = false;
  }
}

// === Update Logic ===
function update(dt) {
  if (state.gameState !== 'running') return;
  
  // Update player horizontal movement
  if (state.keys.left) {
    state.player.targetX = Math.max(state.player.radius, state.player.targetX - PLAYER_MOVE_SPEED);
  }
  if (state.keys.right) {
    state.player.targetX = Math.min(CANVAS_WIDTH - state.player.radius, state.player.targetX + PLAYER_MOVE_SPEED);
  }
  
  // Smooth interpolation to target X
  const dx = state.player.targetX - state.player.x;
  state.player.x += dx * Math.min(1, dt * 8);
  
  // Wrap around screen edges
  if (state.player.x < -state.player.radius) {
    state.player.x = CANVAS_WIDTH + state.player.radius;
    state.player.targetX = state.player.x;
  }
  if (state.player.x > CANVAS_WIDTH + state.player.radius) {
    state.player.x = -state.player.radius;
    state.player.targetX = state.player.x;
  }
  
  // Apply gravity
  state.player.vy += GRAVITY * dt;
  
  // Update player position
  const oldY = state.player.y;
  state.player.y += state.player.vy * dt;
  
  // Check platform collisions (only when falling)
  if (state.player.vy > 0) {
    for (const platform of state.platforms) {
      if (platform.broken && platform.breakTimer > 0.1) continue;
      
      // Check if player is overlapping platform horizontally
      const playerLeft = state.player.x - state.player.radius;
      const playerRight = state.player.x + state.player.radius;
      const platformLeft = platform.x;
      const platformRight = platform.x + platform.width;
      
      if (playerRight > platformLeft && playerLeft < platformRight) {
        // Check if player crossed platform from above
        const playerBottom = state.player.y + state.player.radius;
        const oldPlayerBottom = oldY + state.player.radius;
        
        if (oldPlayerBottom <= platform.y && playerBottom >= platform.y) {
          // Land on platform!
          state.player.y = platform.y - state.player.radius;
          
          // Apply jump based on platform type
          if (platform.type === PLATFORM_TYPES.BOOST) {
            state.player.vy = BOOST_JUMP_STRENGTH;
            spawnParticles(state.player.x, state.player.y, platform.color, 20);
          } else {
            state.player.vy = JUMP_STRENGTH;
            spawnParticles(state.player.x, state.player.y, platform.color, 10);
          }
          
          // Break platform if breakable
          if (platform.type === PLATFORM_TYPES.BREAKABLE) {
            platform.broken = true;
          }
          
          break;
        }
      }
    }
  }
  
  // Camera scrolling when player is above threshold
  const playerScreenY = state.player.y - state.cameraY;
  if (playerScreenY < SCROLL_THRESHOLD) {
    const scrollAmount = SCROLL_THRESHOLD - playerScreenY;
    state.cameraY -= scrollAmount;
  }
  
  // Update max height and score
  if (state.player.y < state.maxHeight) {
    state.maxHeight = state.player.y;
    state.score = Math.floor(-state.maxHeight / 10);
    scoreDisplay.textContent = state.score;
  }
  
  // Check if player fell below screen
  if (state.player.y - state.cameraY > CANVAS_HEIGHT + 100) {
    endGame();
    return;
  }
  
  // Update platforms
  for (const platform of state.platforms) {
    platform.update(dt);
  }
  
  // Spawn new platforms and cleanup
  spawnPlatformsAbove();
  cleanupPlatforms();
  
  // Update particles
  state.particles = state.particles.filter(p => p.update(dt));
}

// === Particle System ===
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    state.particles.push(new Particle(x, y, color));
  }
}

// === Drawing ===
function draw() {
  // Clear canvas
  ctx.fillStyle = '#0a0820';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // Draw background grid
  drawBackground();
  
  if (state.gameState === 'running') {
    // Draw platforms
    for (const platform of state.platforms) {
      platform.draw(state.cameraY);
    }
    
    // Draw particles
    for (const particle of state.particles) {
      particle.draw(state.cameraY);
    }
    
    // Draw player
    drawPlayer();
  }
}

function drawBackground() {
  ctx.save();
  
  // Vertical gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#1a1040');
  gradient.addColorStop(0.5, '#0a0820');
  gradient.addColorStop(1, '#1a1040');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // Grid lines (scrolling with camera)
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  
  const gridSize = 80;
  const offsetY = (state.cameraY % gridSize);
  
  // Horizontal lines
  for (let y = -offsetY; y < CANVAS_HEIGHT; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_WIDTH, y);
    ctx.stroke();
  }
  
  // Vertical lines
  for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_HEIGHT);
    ctx.stroke();
  }
  
  ctx.restore();
}

function drawPlayer() {
  const screenY = state.player.y - state.cameraY;
  
  // Don't draw if off-screen
  if (screenY < -100 || screenY > CANVAS_HEIGHT + 100) return;
  
  ctx.save();
  
  // Glow effect
  ctx.shadowBlur = 30;
  ctx.shadowColor = state.player.color;
  
  // Player body - gradient
  const gradient = ctx.createRadialGradient(
    state.player.x, screenY, 0,
    state.player.x, screenY, state.player.radius
  );
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.3, state.player.color);
  gradient.addColorStop(1, state.player.color + '40');
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(state.player.x, screenY, state.player.radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Outline
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(state.player.x, screenY, state.player.radius - 1, 0, Math.PI * 2);
  ctx.stroke();
  
  // Inner circle for detail
  ctx.strokeStyle = state.player.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(state.player.x, screenY, state.player.radius * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.restore();
}

// === Main Loop ===
function loop(timestamp) {
  // Calculate delta time
  const dt = state.lastTime ? Math.min((timestamp - state.lastTime) / 1000, 0.1) : 0;
  state.lastTime = timestamp;
  
  // Update and draw
  update(dt);
  draw();
  
  // Continue loop
  requestAnimationFrame(loop);
}

// === Start ===
init();
