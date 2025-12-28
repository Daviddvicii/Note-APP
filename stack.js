// Configuration
const COLORS = {
  bg: '#0b1426',
  neon: '#00ff66',
  neonDim: '#00cc52', // Slightly dimmer for falling pieces
  neonBright: '#ccffdd',
  perfect: '#ffffff', // Flash color for perfect drops
  grid: 'rgba(0, 255, 102, 0.05)'
};

const GAME_CONFIG = {
  baseSpeed: 5, // Horizontal speed
  speedIncrement: 0.5, // Speed increase per level
  levelStep: 5, // Increase speed every N points
  initialBlockWidth: 200, // Will be scaled relative to canvas width
  minBlockWidth: 40,
  blockHeight: 30,
  perfectTolerance: 8, // Pixels tolerance for perfect match
  flashDuration: 150, // ms
  gravity: 0.6, // For falling debris
  shrinkRate: 0.5, // Pixels to shrink per successful drop to add difficulty
};

// State
let state = {
  mode: 'start', // start, playing, gameover
  score: 0,
  best: 0,
  blocks: [], // The stack
  debris: [], // Falling pieces
  currentBlock: null, // The moving block
  direction: 1, // 1 or -1
  speed: 0,
  cameraY: 0,
  targetCameraY: 0,
  hue: 140, // Color cycling hue
  particles: [],
  perfectCombo: 0,
  message: null, // "PERFECT!", etc.
  messageTimer: 0
};

// DOM Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score-display');
const bestDisplay = document.getElementById('best-display');
const finalScoreDisplay = document.getElementById('final-score');
const finalBestDisplay = document.getElementById('final-best');
const startOverlay = document.getElementById('start-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

// Audio Context
let audioCtx = null;
let soundEnabled = true;

// Initialization
function init() {
  resize();
  window.addEventListener('resize', resize);
  
  // Load best score
  loadBestScore();
  updateUI();

  // Input listeners
  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', resetGame);
  
  // Canvas input (Touch/Mouse)
  const handleInput = (e) => {
    // Prevent default touch behaviors (zooming, etc.)
    if (e.type === 'touchstart') e.preventDefault();
    
    if (state.mode === 'start') {
      startGame();
    } else if (state.mode === 'playing') {
      placeBlock();
    } else if (state.mode === 'gameover') {
      // Optional: tap to restart on game over (debounced)
      // resetGame(); 
    }
  };

  canvas.addEventListener('mousedown', handleInput);
  canvas.addEventListener('touchstart', handleInput, { passive: false });

  // Start loop
  requestAnimationFrame(loop);
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement; 
  if (!parent) return; // Guard against early call
  
  const rect = parent.getBoundingClientRect();
  
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  ctx.scale(dpr, dpr);
  
  // Determine logical width/height for calculations
  state.width = rect.width;
  state.height = rect.height;
  
  // If game hasn't started, center the view
  if (state.mode === 'start') {
    state.cameraY = 0;
  }
}

function loadBestScore() {
  const saved = localStorage.getItem('stack-best');
  if (saved) {
    state.best = parseInt(saved, 10) || 0;
  }
  
  // Robust check for JSON object as requested
  try {
    const jsonSaved = localStorage.getItem('stack-best-json');
    if (jsonSaved) {
      const obj = JSON.parse(jsonSaved);
      if (obj && obj.best > state.best) {
        state.best = obj.best;
      }
    }
  } catch (e) {
    // Ignore errors
  }
}

function saveBestScore() {
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('stack-best', state.best.toString());
    localStorage.setItem('stack-best-json', JSON.stringify({ best: state.best }));
  }
}

function initAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext();
}

function playSound(type) {
  if (!audioCtx || !soundEnabled) return;
  
  // Resume context if suspended (browser policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'drop') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440 + (state.score * 10), now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.1);
    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'perfect') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(880 + (state.score * 20), now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.15);
    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'gameover') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

function startGame() {
  initAudio();
  state.mode = 'playing';
  state.score = 0;
  state.blocks = [];
  state.debris = [];
  state.particles = [];
  state.cameraY = 0;
  state.targetCameraY = 0;
  state.speed = GAME_CONFIG.baseSpeed;
  state.perfectCombo = 0;
  state.hue = 140; // Neon green start
  
  // Base platform
  // Scale initial block width relative to screen width, but clamp
  const startWidth = Math.min(state.width * 0.6, 250); 
  
  const baseBlock = {
    x: (state.width - startWidth) / 2,
    y: state.height - 100, // Start a bit up from bottom
    width: startWidth,
    height: GAME_CONFIG.blockHeight,
    color: `hsl(${state.hue}, 100%, 50%)`
  };
  state.blocks.push(baseBlock);

  spawnBlock();
  
  startOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  updateUI();
}

function resetGame() {
  startGame();
}

function spawnBlock() {
  const prevBlock = state.blocks[state.blocks.length - 1];
  const y = prevBlock.y - GAME_CONFIG.blockHeight;
  
  // Cycle hue within green/cyan range (100-170)
  state.hue += 2;
  if (state.hue > 170) state.hue = 100;
  
  state.currentBlock = {
    x: -prevBlock.width, // Start off-screen
    y: y,
    width: prevBlock.width,
    height: GAME_CONFIG.blockHeight,
    color: `hsl(${state.hue}, 100%, 50%)`
  };
  
  // Randomize start side
  if (Math.random() > 0.5) {
    state.currentBlock.x = state.width;
    state.direction = -1;
  } else {
    state.currentBlock.x = -state.currentBlock.width;
    state.direction = 1;
  }
  
  // Update camera target if stack gets high
  // We want the current block to be around 60% down the screen
  const idealY = state.height * 0.6;
  if (y < idealY) {
    state.targetCameraY = idealY - y;
  }
}

function placeBlock() {
  if (!state.currentBlock) return;
  
  const current = state.currentBlock;
  const prev = state.blocks[state.blocks.length - 1];
  
  // Calculate overlap
  const delta = current.x - prev.x;
  const absDelta = Math.abs(delta);
  
  // Check for Game Over (miss)
  if (absDelta >= prev.width) {
    gameOver();
    return;
  }
  
  let isPerfect = false;
  let placedWidth = prev.width;
  let placedX = prev.x; 
  
  // Check for Perfect
  if (absDelta < GAME_CONFIG.perfectTolerance) {
    isPerfect = true;
    placedWidth = prev.width; // Keep same width
    placedX = prev.x; // Snap to exact position
    
    // Reward
    state.score += 1; // Bonus +1 (total +2)
    state.perfectCombo++;
    createParticles(current.x + current.width/2, current.y + current.height/2, 20, '#fff');
    showMessage("PERFECT!");
    playSound('perfect');
  } else {
    // Normal placement (trim)
    state.perfectCombo = 0;
    playSound('drop');
    
    placedWidth = prev.width - absDelta;
    if (delta > 0) {
      placedX = current.x;
      addDebris(current.x + placedWidth, current.y, delta, current.height, current.color);
    } else {
      placedX = prev.x;
      addDebris(current.x, current.y, Math.abs(delta), current.height, current.color);
    }
  }

  // Artificial difficulty: shrink block slightly
  // But ensure it doesn't go below min width (except by natural cutting)
  if (placedWidth > GAME_CONFIG.minBlockWidth) {
    placedWidth = Math.max(GAME_CONFIG.minBlockWidth, placedWidth - GAME_CONFIG.shrinkRate);
    // If we shrunk it artificially, we need to center it or adjust X?
    // Usually simpler to just shrink it from both sides or right side?
    // If we change width without changing X, it shrinks from right.
    // To shrink from center: x += shrink/2.
    if (isPerfect) {
        placedX += GAME_CONFIG.shrinkRate / 2;
    }
    // If not perfect, the "natural" cut already happened. 
    // If we shrink further, it might feel unfair visually if not animated or accounted for.
    // Let's only apply shrink bonus on Perfect hits to force eventual loss?
    // Or just apply it generally.
  }
  
  const newBlock = {
    x: placedX,
    y: current.y,
    width: placedWidth,
    height: current.height,
    color: isPerfect ? '#fff' : current.color // Flash white on perfect, else keep color
  };
  
  state.blocks.push(newBlock);
  if (isPerfect) {
    setTimeout(() => { newBlock.color = current.color; }, 150);
  } else {
     createParticles(placedX + placedWidth/2, current.y + current.height/2, 10, current.color);
  }

  state.score++;
  state.currentBlock = null;
  
  // Increase speed
  if (state.score % GAME_CONFIG.levelStep === 0) {
    state.speed += GAME_CONFIG.speedIncrement;
  }
  
  updateUI();
  spawnBlock();
}

function addDebris(x, y, w, h, color) {
  state.debris.push({
    x, y, w, h, color,
    vx: state.direction * (2 + Math.random() * 2), // inherit momentum
    vy: -2 - Math.random(),
    rot: 0,
    rotSpeed: (Math.random() - 0.5) * 0.2
  });
}

function gameOver() {
  state.mode = 'gameover';
  const missed = state.currentBlock;
  state.currentBlock = null; // Hide moving block
  
  if (missed) {
    // Convert the entire missed block into debris
    addDebris(missed.x, missed.y, missed.width, missed.height, missed.color);
  }

  playSound('gameover');
  
  saveBestScore();
  updateUI();
  
  gameoverOverlay.classList.remove('hidden');
}

function createParticles(x, y, count, color) {
  for(let i=0; i<count; i++) {
    state.particles.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      life: 1.0,
      color: color
    });
  }
}

function showMessage(text) {
  state.message = text;
  state.messageTimer = 60; // frames
}

function updateUI() {
  scoreDisplay.textContent = state.score;
  bestDisplay.textContent = state.best;
  finalScoreDisplay.textContent = state.score;
  finalBestDisplay.textContent = state.best;
}

// Game Loop
function loop() {
  // Update
  if (state.mode === 'playing') {
    // Move block
    if (state.currentBlock) {
      state.currentBlock.x += state.speed * state.direction;
      
      // Reverse direction at edges (with some buffer)
      // Allow it to go fully off screen before reversing?
      // No, usually it bounces or wraps. Bouncing is better for timing.
      // Let's reverse when it goes too far.
      if (state.currentBlock.x > state.width - 10 && state.direction > 0) {
         state.direction = -1;
      } else if (state.currentBlock.x < -state.currentBlock.width + 10 && state.direction < 0) {
         state.direction = 1;
      }
      
      // Actually standard stacker: moves back and forth within a range wider than screen
      if (state.currentBlock.x > state.width && state.direction > 0) {
          state.direction = -1;
      } else if (state.currentBlock.x < -state.currentBlock.width && state.direction < 0) {
          state.direction = 1;
      }
    }
  }
  
  // Physics (Debris)
  for (let i = state.debris.length - 1; i >= 0; i--) {
    const d = state.debris[i];
    d.x += d.vx;
    d.y += d.vy;
    d.vy += GAME_CONFIG.gravity;
    d.rot += d.rotSpeed;
    
    if (d.y > state.height + 200) {
      state.debris.splice(i, 1);
    }
  }
  
  // Particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.02;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
  
  // Camera Smooth Follow
  state.cameraY += (state.targetCameraY - state.cameraY) * 0.1;
  
  // Render
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, state.width, state.height);
  
  // Grid Background
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const gridSize = 40;
  const offset = state.cameraY % gridSize;
  
  // Vertical lines
  for (let x = 0; x < state.width; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.height);
  }
  // Horizontal lines
  for (let y = offset; y < state.height; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(state.width, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(0, state.cameraY);
  
  // Draw Blocks
  state.blocks.forEach(block => {
    drawBlock(block);
  });
  
  // Draw Current Block
  if (state.currentBlock) {
    drawBlock(state.currentBlock);
  }
  
  // Draw Debris
  state.debris.forEach(d => {
    ctx.save();
    ctx.translate(d.x + d.w/2, d.y + d.h/2);
    ctx.rotate(d.rot);
    ctx.fillStyle = COLORS.neonDim; // Use dim color for debris
    ctx.shadowBlur = 5;
    ctx.shadowColor = COLORS.neonDim;
    ctx.fillRect(-d.w/2, -d.h/2, d.w, d.h);
    // Stroke debris too
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-d.w/2, -d.h/2, d.w, d.h);
    ctx.restore();
  });
  
  // Draw Particles
  state.particles.forEach(p => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
  });
  
  ctx.restore();
  
  // HUD Messages
  if (state.message) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, state.messageTimer / 20);
    ctx.font = 'bold 40px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = COLORS.neon;
    ctx.shadowBlur = 20;
    ctx.fillText(state.message, state.width / 2, state.height / 3);
    ctx.restore();
    
    state.messageTimer--;
    if (state.messageTimer <= 0) state.message = null;
  }
  
  requestAnimationFrame(loop);
}

function drawBlock(block) {
  ctx.fillStyle = block.color;
  ctx.shadowBlur = 15;
  ctx.shadowColor = block.color;
  
  // Main rect
  ctx.fillRect(block.x, block.y, block.width, block.height);
  
  // Highlight top edge
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.shadowBlur = 0;
  ctx.fillRect(block.x, block.y, block.width, 3);
  
  // Stroke
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(block.x, block.y, block.width, block.height);
}

// Start
init();
