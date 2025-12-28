/**
 * Neon Stack - A mobile-first stacking game
 * No external libraries.
 */

// --- Configuration ---
const CONFIG = {
  BLOCK_HEIGHT: 30,  // Height of each block
  INITIAL_WIDTH: 200,// Starting width of blocks
  MIN_WIDTH: 20,     // Minimum width
  INITIAL_SPEED: 4,  // Starting speed
  SPEED_INC: 0.2,    // Speed increase per success
  PERFECT_TOLERANCE: 6, // Pixels tolerance for "Perfect"
  GRAVITY: 0.6,
  PARTICLE_LIFE: 40,
  COLORS: {
    bg: '#000000',
    primary: '#39ff14', // Neon Green
    secondary: '#32ff7e',
    perfect: '#ffffff',
    fail: '#ff003c'
  }
};

// --- Game State ---
let canvas, ctx;
let width, height, dpr;
let frameId;
let score = 0;
let bestScore = 0;
let state = 'START'; // START, PLAYING, GAMEOVER
let lastTime = 0;

// Gameplay objects
let stack = [];     // Placed blocks
let currentBlock = null; // The moving block
let debris = [];    // Falling pieces
let particles = []; // Sparkles
let cameraY = 0;    // Vertical scroll offset
let hue = 120;      // Color cycling

// Audio
let audioCtx;
let soundEnabled = true;

// DOM Elements
const scoreEl = document.getElementById('scoreVal');
const bestEl = document.getElementById('bestVal');
const startOverlay = document.getElementById('startOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const finalScoreEl = document.getElementById('finalScore');
const finalBestEl = document.getElementById('finalBest');
const toastEl = document.getElementById('toast');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');

// --- Initialization ---
function init() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d', { alpha: false });

  // Load best score
  const savedBest = localStorage.getItem('stack-best');
  if (savedBest) {
    bestScore = parseInt(savedBest, 10) || 0;
  }
  updateUI();

  // Resize handler
  window.addEventListener('resize', resize);
  resize();

  // Input handlers
  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', resetGame);
  
  // Touch/Click to drop
  // We use pointerdown on window to capture taps anywhere, 
  // but only when playing and not clicking buttons
  window.addEventListener('pointerdown', (e) => {
    if (state === 'PLAYING' && !e.target.closest('button')) {
      e.preventDefault(); // Prevent default touch behaviors
      dropBlock();
    }
  });

  // Prevent spacebar scrolling and use it to play
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === 'START') startGame();
      else if (state === 'GAMEOVER') resetGame();
      else if (state === 'PLAYING') dropBlock();
    }
  });

  // Start loop for background rendering even in menu
  requestAnimationFrame(loop);
}

function resize() {
  const container = document.getElementById('game-container');
  dpr = window.devicePixelRatio || 1;
  
  // Get CSS size
  const cssWidth = container.clientWidth;
  const cssHeight = container.clientHeight;
  
  // Set canvas actual size
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  
  // Normalize coord system
  ctx.scale(dpr, dpr);
  
  // Store logical size
  width = cssWidth;
  height = cssHeight;
  
  // Re-render immediately
  draw();
}

// --- Audio System ---
function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AC();
}

function playSound(type) {
  if (!audioCtx || !soundEnabled) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (type === 'drop') {
    // High ping
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440 + (score * 10), t);
    osc.frequency.exponentialRampToValueAtTime(880 + (score * 10), t + 0.1);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.1);
  } else if (type === 'perfect') {
    // Musical chord
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t); // A5
    osc.frequency.setValueAtTime(1108, t + 0.1); // C#6
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.3);
  } else if (type === 'fail') {
    // Low error sound
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.3);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}

// --- Game Logic ---

function startGame() {
  initAudio();
  state = 'PLAYING';
  score = 0;
  hue = 120;
  stack = [];
  debris = [];
  particles = [];
  cameraY = 0;
  
  // Base platform
  stack.push({
    x: (width - CONFIG.INITIAL_WIDTH) / 2,
    y: 0, // 0 is bottom logic, we invert in draw
    w: CONFIG.INITIAL_WIDTH,
    h: CONFIG.BLOCK_HEIGHT,
    color: `hsl(${hue}, 100%, 50%)`
  });
  
  spawnNextBlock();
  
  startOverlay.classList.remove('visible');
  gameOverOverlay.classList.remove('visible');
  updateUI();
}

function resetGame() {
  startGame();
}

function spawnNextBlock() {
  const prev = stack[stack.length - 1];
  const y = (stack.length) * CONFIG.BLOCK_HEIGHT;
  
  hue = (hue + 10) % 360;
  
  // Decide spawn position (left or right)
  const dir = Math.random() > 0.5 ? 1 : -1;
  const x = dir === 1 ? -prev.w : width + prev.w;
  
  currentBlock = {
    x: x,
    y: y,
    w: prev.w,
    h: CONFIG.BLOCK_HEIGHT,
    color: `hsl(${hue}, 100%, 50%)`,
    dir: dir,
    speed: CONFIG.INITIAL_SPEED + (score * CONFIG.SPEED_INC)
  };
}

function dropBlock() {
  if (!currentBlock) return;
  
  const prev = stack[stack.length - 1];
  const curr = currentBlock;
  
  // Calculate overlap
  const diff = curr.x - prev.x;
  const absDiff = Math.abs(diff);
  
  // Perfect hit?
  if (absDiff <= CONFIG.PERFECT_TOLERANCE) {
    curr.x = prev.x; // Snap
    score += 2; // Bonus
    showToast("PERFECT!");
    createParticles(curr.x + curr.w/2, curr.y + curr.h/2, 20, '#fff');
    playSound('perfect');
    shakeScreen(5);
  } 
  // Missed completely?
  else if (absDiff >= curr.w) {
    gameOver();
    return;
  } 
  // Partial hit
  else {
    score += 1;
    playSound('drop');
    
    // Trim logic
    if (diff > 0) {
      // Overhanging to the right
      // |  PREV  |
      //      |  CURR  |
      // Cut the right part of current
      const overlap = curr.w - diff;
      curr.w = overlap;
      // No change to curr.x needed
      
      // Create debris for the right part
      createDebris(curr.x + curr.w, curr.y, diff, curr.h, curr.color);
    } else {
      // Overhanging to the left
      //      |  PREV  |
      // |  CURR  |
      // Cut the left part
      const overlap = curr.w - absDiff;
      createDebris(curr.x, curr.y, absDiff, curr.h, curr.color);
      
      curr.w = overlap;
      curr.x = prev.x; // Shift to align with prev left edge
    }
    
    createParticles(curr.x + curr.w/2, curr.y, 10, curr.color);
  }

  // Push to stack
  stack.push(curr);
  currentBlock = null;
  
  // Save High Score
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('stack-best', bestScore);
    // Robust object save for menu compatibility
    localStorage.setItem('stack-best-json', JSON.stringify({ best: bestScore }));
  }
  
  updateUI();
  spawnNextBlock();
}

function gameOver() {
  state = 'GAMEOVER';
  playSound('fail');
  shakeScreen(10);
  
  // Let the current block fall as debris
  if (currentBlock) {
    createDebris(currentBlock.x, currentBlock.y, currentBlock.w, currentBlock.h, currentBlock.color);
    currentBlock = null;
  }
  
  finalScoreEl.textContent = score;
  finalBestEl.textContent = bestScore;
  gameOverOverlay.classList.add('visible');
}

// --- Physics & Effects ---

function createDebris(x, y, w, h, color) {
  debris.push({
    x, y, w, h,
    color,
    vx: 0,
    vy: 0,
    rot: 0,
    rotSpeed: (Math.random() - 0.5) * 0.2
  });
}

function createParticles(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      life: CONFIG.PARTICLE_LIFE,
      color: color
    });
  }
}

let shake = 0;
function shakeScreen(amount) {
  shake = amount;
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // Trigger reflow
  toastEl.classList.add('show');
}

function updateUI() {
  scoreEl.textContent = score;
  bestEl.textContent = bestScore;
}

// --- Main Loop ---

function loop(timestamp) {
  const dt = timestamp - lastTime;
  lastTime = timestamp;
  
  update(dt);
  draw();
  
  frameId = requestAnimationFrame(loop);
}

function update(dt) {
  if (state === 'PLAYING' && currentBlock) {
    currentBlock.x += currentBlock.speed * currentBlock.dir;
    
    // Bounce off walls (or wrap? Standard stack is bounce)
    // Actually standard stack is just pass through and reverse or spawn
    // But user wants "slides horizontally on top".
    // Let's make it bounce for endless opportunity to drop
    if (currentBlock.x + currentBlock.w > width) {
      currentBlock.dir = -1;
    } else if (currentBlock.x < 0) {
      currentBlock.dir = 1;
    }
  }
  
  // Debris physics
  for (let i = debris.length - 1; i >= 0; i--) {
    const p = debris[i];
    p.vy += CONFIG.GRAVITY;
    p.y -= p.vy; 
    p.rot += p.rotSpeed; // Rotate
    if (p.y < -500) debris.splice(i, 1);
  }
  
  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy; // Logic Y
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
  
  // Camera follow
  // We want the stack top to be around 1/3 or 1/2 of screen height
  const targetY = (stack.length * CONFIG.BLOCK_HEIGHT);
  // Ideally, top block should be at ~ 30% from bottom? No, higher.
  // We want to see the stack growing.
  // Let's say we want the current block to be at height/2 on screen.
  
  // If stack gets high, cameraY increases
  const desiredCamY = Math.max(0, targetY - (height * 0.4));
  cameraY += (desiredCamY - cameraY) * 0.1; // Smooth follow
  
  // Screen shake decay
  if (shake > 0) shake *= 0.9;
  if (shake < 0.5) shake = 0;
}

function draw() {
  // Clear
  ctx.fillStyle = CONFIG.COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height); // Use raw canvas dims to clear all
  
  ctx.save();
  // Apply logic scaling (dpr handled in resize)
  
  // Apply shake
  const sx = (Math.random() - 0.5) * shake;
  const sy = (Math.random() - 0.5) * shake;
  ctx.translate(sx, sy);
  
  // Coordinate system transformation:
  // We want logic y=0 to be at the bottom of the screen.
  // Canvas y=0 is top.
  // So drawY = height - logicY - cameraY
  
  // Helper to transform Y
  const toScreenY = (logicY) => height - (logicY - cameraY) - CONFIG.BLOCK_HEIGHT - 50; 
  // -50 padding from bottom
  
  // Background Grid (subtle)
  ctx.strokeStyle = 'rgba(57, 255, 20, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const gridSize = 40;
  // Moving grid effect based on cameraY
  const gridOffsetY = cameraY % gridSize;
  
  for (let gx = 0; gx <= width; gx += gridSize) {
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
  }
  for (let gy = 0; gy <= height; gy += gridSize) {
    const y = gy + (gridOffsetY); // Move down as camera goes up
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Draw Stack
  stack.forEach(b => {
    drawBlock(b, toScreenY(b.y));
  });
  
  // Draw Current Block
  if (currentBlock && state === 'PLAYING') {
    drawBlock(currentBlock, toScreenY(currentBlock.y));
  }
  
  // Draw Debris
  debris.forEach(d => {
    drawBlock(d, toScreenY(d.y), true);
  });
  
  // Draw Particles
  particles.forEach(p => {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life / CONFIG.PARTICLE_LIFE;
    ctx.beginPath();
    const py = toScreenY(p.y);
    ctx.arc(p.x, py, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  
  ctx.restore();
}

function drawBlock(b, screenY, isDebris = false) {
  ctx.save();
  ctx.fillStyle = b.color;
  
  if (isDebris) {
    // Rotation for debris
    ctx.translate(b.x + b.w/2, screenY + b.h/2);
    ctx.rotate(b.rot);
    ctx.translate(-(b.x + b.w/2), -(screenY + b.h/2));
    
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.8;
  } else {
    // Neon Glow effect
    ctx.shadowBlur = 15;
    ctx.shadowColor = b.color;
  }
  
  ctx.fillRect(b.x, screenY, b.w, b.h);
  
  // Inner highlight/stroke for "retro" feel
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, screenY, b.w, b.h);
  
  ctx.restore();
}


// Boot
init();

