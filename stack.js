/**
 * Neon Stack - A mobile-first HTML5 canvas game.
 * No external libraries.
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const finalScoreEl = document.getElementById('final-score');
const finalBestEl = document.getElementById('final-best');
const startOverlay = document.getElementById('start-overlay');
const gameOverOverlay = document.getElementById('game-over-overlay');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

// Game Constants
const INITIAL_WIDTH = 200;
const BLOCK_HEIGHT = 40;
const INITIAL_SPEED = 4;
const PERFECTION_TOLERANCE = 6; // pixels
const COLORS = {
  primary: '#00ff66',
  grid: 'rgba(0, 255, 102, 0.1)'
};

// State
let state = {
  mode: 'START', // START, PLAYING, GAMEOVER
  score: 0,
  best: 0,
  blocks: [],
  debris: [],
  particles: [],
  texts: [], 
  currentBlock: null,
  baseSpeed: INITIAL_SPEED,
  cameraY: 0,
  targetCameraY: 0,
  shake: 0
};

// Audio Context
let audioCtx = null;

// Persistence
function loadBest() {
  const saved = localStorage.getItem('stack-best');
  if (saved) {
    state.best = parseInt(saved, 10) || 0;
  }
  bestEl.textContent = state.best;
}

function saveBest() {
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('stack-best', state.best.toString());
    localStorage.setItem('stack-best-json', JSON.stringify({ best: state.best }));
    bestEl.textContent = state.best;
  }
}

// Resizing
function resize() {
  const container = document.getElementById('game-container');
  if (container) {
    canvas.width = container.clientWidth * window.devicePixelRatio;
    canvas.height = container.clientHeight * window.devicePixelRatio;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }
}
window.addEventListener('resize', resize);
resize();

// Audio System
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playSound(type) {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  const now = audioCtx.currentTime;
  
  if (type === 'drop') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400 + (state.score * 10), now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'perfect') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'gameover') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

// Classes
class Block {
  constructor(x, y, w, h, color) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.color = color;
    this.vx = 0;
  }
  
  draw() {
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 15;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    
    // Inner stroke for detail
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x, this.y, this.w, this.h);
  }
}

class Debris {
  constructor(x, y, w, h, color, vx) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.color = color;
    this.vx = vx;
    this.vy = 0;
    this.gravity = 0.5;
    this.alpha = 1;
  }
  
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.alpha -= 0.02;
  }
  
  draw() {
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.globalAlpha = 1;
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 5;
    this.vy = (Math.random() - 0.5) * 5;
    this.life = 1;
    this.color = color;
  }
  
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= 0.03;
  }
  
  draw() {
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, 3, 3);
    ctx.globalAlpha = 1;
  }
}

class FloatingText {
  constructor(x, y, text) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.life = 1;
    this.vy = -2;
  }
  
  update() {
    this.y += this.vy;
    this.life -= 0.02;
  }
  
  draw() {
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = COLORS.primary;
    ctx.shadowBlur = 10;
    ctx.fillText(this.text, this.x, this.y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

// Game Logic
function resetGame() {
  state.score = 0;
  state.blocks = [];
  state.debris = [];
  state.particles = [];
  state.texts = [];
  state.cameraY = 0;
  state.targetCameraY = 0;
  state.shake = 0;
  
  scoreEl.textContent = '0';
  
  // Initial base block
  const centerX = (canvas.width / window.devicePixelRatio) / 2;
  const startY = (canvas.height / window.devicePixelRatio) - 100;
  
  const baseBlock = new Block(
    centerX - INITIAL_WIDTH / 2,
    startY,
    INITIAL_WIDTH,
    BLOCK_HEIGHT,
    COLORS.primary
  );
  state.blocks.push(baseBlock);
  
  spawnNextBlock();
  
  state.mode = 'PLAYING';
}

function spawnNextBlock() {
  const prevBlock = state.blocks[state.blocks.length - 1];
  const y = prevBlock.y - BLOCK_HEIGHT;
  
  // Decrease width slightly to increase difficulty
  // But never go below 40px
  let newWidth = prevBlock.w;
  if (state.score > 0) {
     newWidth -= 0.5; // Shrink by 0.5px per block naturally
     // This makes it harder over time even if you are perfect
     // If you want perfection to NOT shrink, move this logic to "miss" part.
     // Requirement: "Block width decreases slightly over time to increase difficulty"
     if (newWidth < 40) newWidth = 40;
  }

  // Determine spawn position (left or right)
  const spawnLeft = Math.random() < 0.5;
  const gameWidth = canvas.width / window.devicePixelRatio;
  const x = spawnLeft ? -newWidth : gameWidth;
  
  // Cycle hue slightly for visual variety
  // Base green is around 140. 
  const hue = 120 + (state.score * 5) % 60; // range 120-180 (green to cyan/teal)
  const color = `hsl(${hue}, 100%, 50%)`;
  
  state.currentBlock = new Block(x, y, newWidth, BLOCK_HEIGHT, color);
  
  // Calculate speed
  const speedMultiplier = 1 + (Math.floor(state.score / 5) * 0.1);
  state.currentBlock.vx = (spawnLeft ? 1 : -1) * (INITIAL_SPEED * speedMultiplier);
}

function placeBlock() {
  if (state.mode !== 'PLAYING') return;
  
  const current = state.currentBlock;
  const prev = state.blocks[state.blocks.length - 1];
  
  const diff = current.x - prev.x;
  const absDiff = Math.abs(diff);
  const overlap = current.w - absDiff;
  
  if (overlap <= 0) {
    gameOver();
    return;
  }
  
  let scoreBonus = 1;
  let isPerfect = false;
  
  // Check perfection
  if (absDiff <= PERFECTION_TOLERANCE) {
    isPerfect = true;
    current.x = prev.x; // Snap to previous X
    playSound('perfect');
    scoreBonus = 2;
    createParticles(current.x + current.w/2, current.y + current.h/2, 20, '#fff');
    state.texts.push(new FloatingText(current.x + current.w/2, current.y, "PERFECT!"));
    state.shake = 5;
    
    // Bonus: Recover some width on perfect? 
    // Or just don't shrink?
    // Let's stick to simple logic: width is determined at spawn.
  } else {
    // Not perfect: Trim
    playSound('drop');
    
    // Create debris for the cut part
    if (diff > 0) {
      // Current is to the right of prev
      // | prev |
      //      | current |
      // Cut off the right part of current that sticks out? 
      // No, cut off the part that DOESN'T overlap.
      // Current is [current.x, current.x + w]
      // Prev is [prev.x, prev.x + w]
      
      // If diff > 0, current.x > prev.x.
      // Overlap starts at current.x, ends at prev.x + prev.w (wait, prev.w might be larger or smaller).
      // Actually simpler:
      // Overlap width is calculated above.
      // Since current.x > prev.x, the part sticking out is on the RIGHT if current extends past prev.
      // But wait, the current block becomes the new base.
      // The part that FALLS is the part that does NOT overlap.
      
      // If current.x > prev.x:
      // The overlapping part is the LEFT part of current.
      // The RIGHT part of current is sticking out?
      // No.
      // Prev:  [   ]
      // Curr:    [   ]
      // Overlap: [ ] (left part of curr matches right part of prev)
      // The part of Curr that is to the right of Prev's right edge is debris?
      // Yes.
      
      const debrisW = absDiff; 
      const debrisX = current.x + overlap; // The right side
      state.debris.push(new Debris(debrisX, current.y, debrisW, current.h, current.color, 2));
      current.w = overlap;
      // current.x remains same
    } else {
      // diff < 0, current.x < prev.x
      // Prev:    [   ]
      // Curr:  [   ]
      // The left part of Curr is sticking out.
      const debrisW = absDiff;
      const debrisX = current.x; 
      state.debris.push(new Debris(debrisX, current.y, debrisW, current.h, current.color, -2));
      current.w = overlap;
      current.x = prev.x; // The new block starts where overlap starts (which is prev.x)
    }
    
    createParticles(current.x + current.w/2, current.y + current.h/2, 10, current.color);
  }
  
  // Add to stack
  state.blocks.push(current);
  state.score += scoreBonus;
  scoreEl.textContent = state.score;
  
  // Camera Management
  // Keep the top of the stack reasonably positioned.
  // As we stack up, Y decreases.
  // We want the last block (current) to be around 60% of screen height.
  const gameHeight = canvas.height / window.devicePixelRatio;
  const desiredY = gameHeight * 0.6;
  const currentScreenY = current.y + state.targetCameraY;
  
  // If the block is physically higher (smaller Y) than desired, move camera down (increase Y)
  if (currentScreenY < desiredY) {
    state.targetCameraY += (desiredY - currentScreenY);
  }
  
  spawnNextBlock();
}

function gameOver() {
  state.mode = 'GAMEOVER';
  playSound('gameover');
  saveBest();
  finalScoreEl.textContent = state.score;
  finalBestEl.textContent = state.best;
  
  // Add falling effect to current block
  if (state.currentBlock) {
    state.debris.push(new Debris(
      state.currentBlock.x, 
      state.currentBlock.y, 
      state.currentBlock.w, 
      state.currentBlock.h, 
      state.currentBlock.color, 
      0
    ));
    state.currentBlock = null;
  }
  
  state.shake = 10;
  
  setTimeout(() => {
    gameOverOverlay.classList.remove('hidden');
  }, 500);
}

function createParticles(x, y, count, color) {
  for(let i=0; i<count; i++) {
    state.particles.push(new Particle(x, y, color));
  }
}

// Draw Functions
function drawGrid(width, height) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = 50;
  // Use camera offset for parallax or just scroll
  const offset = state.cameraY % step;
  
  for (let x = 0; x <= width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = offset; y <= height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function update() {
  if (state.mode === 'PLAYING' && state.currentBlock) {
    // Move block
    state.currentBlock.x += state.currentBlock.vx;
    
    // Bounce logic
    const gameWidth = canvas.width / window.devicePixelRatio;
    
    // Reversing at edges
    // We want the block to fully traverse before bouncing?
    // Or bounce when it hits the edge?
    // Let's bounce when the LEADING edge hits the wall + some buffer?
    // Or just simple bounce when x < 0 or x + w > width
    
    // Allow it to go slightly off screen for difficulty?
    // Typically in stack games, it just bounces.
    
    if (state.currentBlock.x + state.currentBlock.w >= gameWidth && state.currentBlock.vx > 0) {
      state.currentBlock.vx *= -1;
    } else if (state.currentBlock.x <= 0 && state.currentBlock.vx < 0) {
      state.currentBlock.vx *= -1;
    }
  }
  
  // Debris
  for (let i = state.debris.length - 1; i >= 0; i--) {
    state.debris[i].update();
    if (state.debris[i].y > canvas.height / window.devicePixelRatio + 100 || state.debris[i].alpha <= 0) {
      state.debris.splice(i, 1);
    }
  }
  
  // Particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    state.particles[i].update();
    if (state.particles[i].life <= 0) {
      state.particles.splice(i, 1);
    }
  }
  
  // Texts
  for (let i = state.texts.length - 1; i >= 0; i--) {
    state.texts[i].update();
    if (state.texts[i].life <= 0) {
      state.texts.splice(i, 1);
    }
  }
  
  // Camera smooth follow
  state.cameraY += (state.targetCameraY - state.cameraY) * 0.1;
  
  // Screen shake decay
  if (state.shake > 0) {
    state.shake *= 0.9;
    if (state.shake < 0.5) state.shake = 0;
  }
}

function draw() {
  const width = canvas.width / window.devicePixelRatio;
  const height = canvas.height / window.devicePixelRatio;
  
  ctx.clearRect(0, 0, width, height);
  
  // Shake effect
  let shakeX = 0;
  let shakeY = 0;
  if (state.shake > 0) {
    shakeX = (Math.random() - 0.5) * state.shake;
    shakeY = (Math.random() - 0.5) * state.shake;
  }
  
  ctx.save();
  ctx.translate(shakeX, shakeY);
  
  // Draw Background Grid
  drawGrid(width, height);
  
  ctx.save();
  // Apply camera translation (move world down)
  ctx.translate(0, state.cameraY);
  
  // Draw Blocks
  // Optimization: Only draw blocks that are on screen
  // block.y + state.cameraY should be > -BLOCK_HEIGHT and < height
  state.blocks.forEach(b => {
    const screenY = b.y + state.cameraY;
    if (screenY > -100 && screenY < height + 100) {
      b.draw();
    }
  });
  
  // Draw Current Block
  if (state.currentBlock) {
    state.currentBlock.draw();
  }
  
  // Draw Debris
  state.debris.forEach(d => d.draw());
  
  // Draw Particles
  state.particles.forEach(p => p.draw());
  
  // Draw Texts
  state.texts.forEach(t => t.draw());
  
  ctx.restore();
  ctx.restore();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// Input Handling
function handleInput(e) {
  if (e.type !== 'keydown') {
    e.preventDefault(); // Prevent double firing
  }
  
  // Init audio on first interaction
  if (!audioCtx) initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  
  if (state.mode === 'START') {
    startOverlay.classList.add('hidden');
    resetGame();
  } else if (state.mode === 'PLAYING') {
    placeBlock();
  } else if (state.mode === 'GAMEOVER') {
    // Optional: tap anywhere to restart if in gameover mode and delay passed
  }
}

// Event Listeners
startBtn.addEventListener('click', () => {
  initAudio();
  startOverlay.classList.add('hidden');
  resetGame();
});

restartBtn.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  resetGame();
});

// Canvas touch/click
canvas.addEventListener('mousedown', handleInput);
canvas.addEventListener('touchstart', handleInput, { passive: false });

// Keyboard
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    handleInput(e);
  }
});

// Init
loadBest();
loop();
