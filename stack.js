// Configuration
const CONFIG = {
  colors: {
    bg: '#0b1426',
    primary: '#39ff14', // Neon Green
    secondary: '#228b22', // Dimmer Green for debris
    perfect: '#ffffff', // White flash
    text: '#ffffff'
  },
  blockHeight: 30, // Initial block height (scaled by ratio)
  initialWidth: 200, // Initial block width (relative to design width)
  moveSpeed: 3, // Initial speed
  speedIncrement: 0.2, // Speed increase per 5 points
  widthDecrement: 2, // Width decrease per successful stack
  minWidth: 40, // Minimum block width
  gravity: 0.5, // Gravity for debris
  particleCount: 20, // Particles on place
  designWidth: 360, // Reference width for scaling
  perfectTolerance: 6, // Pixels for perfect snap
};

// Game State
const STATE = {
  MENU: 0,
  PLAYING: 1,
  GAMEOVER: 2
};

// Global Variables
let canvas, ctx;
let width, height, scale;
let audioCtx;
let game = {
  state: STATE.MENU,
  score: 0,
  best: 0,
  blocks: [],
  debris: [],
  particles: [],
  currentBlock: null,
  direction: 1, // 1 for right, -1 for left
  speed: CONFIG.moveSpeed,
  cameraY: 0,
  targetCameraY: 0,
  frameCount: 0,
  hue: 120 // Start green
};

// Setup
window.addEventListener('load', init);
window.addEventListener('resize', handleResize);

function init() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');

  // Load best score
  const savedBest = localStorage.getItem('stack-best');
  if (savedBest) {
    game.best = parseInt(savedBest, 10);
    document.getElementById('best').textContent = game.best;
    document.getElementById('final-best').textContent = game.best;
  }

  handleResize();

  // Input handling
  canvas.addEventListener('pointerdown', handleInput);
  document.getElementById('start-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    initAudio();
    startGame();
  });
  document.getElementById('restart-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    startGame();
  });
  
  // Prevent default touch actions
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  // Start Loop
  requestAnimationFrame(loop);
}

function handleResize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  // Update scale factor based on reference design width
  scale = width / CONFIG.designWidth;
}

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
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
    // High ping
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440 + (game.score * 10), now);
    osc.frequency.exponentialRampToValueAtTime(880 + (game.score * 10), now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'perfect') {
    // Harmony chord-ish
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.2);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'gameover') {
    // Low descend
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

function startGame() {
  game.state = STATE.PLAYING;
  game.score = 0;
  game.blocks = [];
  game.debris = [];
  game.particles = [];
  game.cameraY = 0;
  game.targetCameraY = 0;
  game.direction = 1;
  game.speed = CONFIG.moveSpeed;
  game.hue = 120;

  document.getElementById('score').textContent = game.score;
  document.getElementById('start-overlay').classList.add('hidden');
  document.getElementById('gameover-overlay').classList.add('hidden');
  document.getElementById('perfect-msg').classList.remove('show');

  // Base Block
  const baseBlock = {
    x: (width - CONFIG.initialWidth * scale) / 2, // Centered
    y: height - (CONFIG.blockHeight * scale) - 20,
    w: CONFIG.initialWidth * scale,
    h: CONFIG.blockHeight * scale,
    color: `hsl(${game.hue}, 100%, 50%)`
  };
  game.blocks.push(baseBlock);

  spawnNextBlock();
}

function spawnNextBlock() {
  const prevBlock = game.blocks[game.blocks.length - 1];
  
  // Decrease width slightly to increase difficulty
  let nextWidth = prevBlock.w - (CONFIG.widthDecrement * scale * 0.1); 
  if (nextWidth < CONFIG.minWidth * scale) nextWidth = CONFIG.minWidth * scale;

  const newBlock = {
    x: 0, // Will be set by slide logic
    y: prevBlock.y - (CONFIG.blockHeight * scale),
    w: nextWidth,
    h: CONFIG.blockHeight * scale,
    color: `hsl(${game.hue}, 100%, 50%)`
  };
  
  // Starting position logic
  if (game.direction === 1) {
    newBlock.x = -newBlock.w;
  } else {
    newBlock.x = width;
  }

  game.currentBlock = newBlock;
}

function handleInput(e) {
  if (e.type !== 'click') {
    // Prevent mouse emulated clicks from firing twice if we handle touch
    // But since we use pointerdown, it should be fine.
  }
  
  if (game.state === STATE.MENU) {
     // handled by HTML button
  } else if (game.state === STATE.PLAYING) {
    placeBlock();
  } else if (game.state === STATE.GAMEOVER) {
     // handled by HTML button
  }
}

function placeBlock() {
  if (!game.currentBlock) return;

  const current = game.currentBlock;
  const prev = game.blocks[game.blocks.length - 1];
  
  const overlapX = Math.max(current.x, prev.x);
  const overlapRight = Math.min(current.x + current.w, prev.x + prev.w);
  const overlapWidth = overlapRight - overlapX;

  if (overlapWidth <= 0) {
    gameOver();
    return;
  }

  // Check Perfect
  const diff = current.x - prev.x;
  let isPerfect = Math.abs(diff) <= CONFIG.perfectTolerance;
  
  if (isPerfect) {
    current.x = prev.x; // Snap
    playSound('perfect');
    game.score += 2; // Bonus
    showPerfectMsg();
    createParticles(current.x + current.w / 2, current.y + current.h / 2, true);
    // Expand block slightly or don't shrink?
    // Requirement says "Block width decreases slightly over time", so maybe we don't shrink on perfect? 
    // Or we just get bonus points. Let's stick to bonus points and snap.
  } else {
    playSound('drop');
    game.score += 1;
    
    // Trim
    current.w = overlapWidth;
    current.x = overlapX;
    
    // Create Debris
    const debrisX = (diff > 0) ? (current.x + current.w) : (current.x - Math.abs(diff));
    const debrisW = Math.abs(diff);
    game.debris.push({
      x: debrisX,
      y: current.y,
      w: debrisW,
      h: current.h,
      vx: (diff > 0) ? 2 : -2,
      vy: 0,
      color: current.color,
      alpha: 1
    });
    
    createParticles(debrisX + debrisW/2, current.y + current.h/2, false);
  }

  game.blocks.push(current);
  document.getElementById('score').textContent = game.score;

  // Progression
  // Increase speed every 5 points
  if (game.score > 0 && game.score % 5 === 0) {
    game.speed += CONFIG.speedIncrement;
  }
  
  // Decrease Width for next block (if not perfect? or always?)
  // Requirement: "Block width decreases slightly over time"
  // Usually this means the new block takes the width of the trimmed block.
  // But we can also artificially shrink it if it was perfect?
  // Let's stick to the mechanics: The NEXT block spawns with width of CURRENT block.
  // Since we trimmed CURRENT block, NEXT block is naturally smaller (unless perfect).
  // AND we can add a forced shrink if we want, but standard stack is just trim.
  // Re-reading: "Block width decreases slightly over time to increase difficulty".
  // This implies even on perfect hits it might get smaller, OR the game relies on natural trimming.
  // Given "clean, addictive", natural trimming is usually enough, but let's strictly follow:
  // "Block width decreases slightly over time". I will subtract a tiny amount on spawn if > minWidth.

  // Camera scroll
  // Keep the stack somewhat centered or lower 1/3
  if (game.blocks.length > 5) {
     game.targetCameraY += CONFIG.blockHeight * scale;
  }

  // Change Color
  game.hue += 10; 
  game.direction *= -1; // Switch direction
  spawnNextBlock();
}

function showPerfectMsg() {
  const el = document.getElementById('perfect-msg');
  el.classList.remove('show');
  void el.offsetWidth; // Trigger reflow
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 800);
}

function createParticles(x, y, isPerfect) {
  const count = isPerfect ? 20 : 10;
  for (let i = 0; i < count; i++) {
    game.particles.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.5) * 10,
      life: 1.0,
      color: isPerfect ? '#fff' : game.blocks[game.blocks.length-1].color
    });
  }
}

function gameOver() {
  game.state = STATE.GAMEOVER;
  playSound('gameover');
  
  // Falling animation for current block
  if (game.currentBlock) {
     game.debris.push({
       x: game.currentBlock.x,
       y: game.currentBlock.y,
       w: game.currentBlock.w,
       h: game.currentBlock.h,
       vx: 0,
       vy: 0,
       color: game.currentBlock.color,
       alpha: 1
     });
     game.currentBlock = null;
  }

  if (game.score > game.best) {
    game.best = game.score;
    localStorage.setItem('stack-best', game.best);
    localStorage.setItem('stack-best-json', JSON.stringify({ best: game.best }));
  }

  document.getElementById('final-score').textContent = game.score;
  document.getElementById('final-best').textContent = game.best;
  document.getElementById('best').textContent = game.best;
  document.getElementById('gameover-overlay').classList.remove('hidden');
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

function update() {
  if (game.state === STATE.PLAYING && game.currentBlock) {
    game.currentBlock.x += game.speed * game.direction;
    
    // Reverse if hits edge? 
    // Standard stack: it flies off and comes back? Or bounces?
    // "slides horizontally on top of the tower".
    // Usually it moves back and forth.
    const limit = width;
    if (game.currentBlock.x > limit || game.currentBlock.x + game.currentBlock.w < 0) {
        // If it goes completely off screen, game over? 
        // Or bounce? Most stack games bounce.
        // Let's implement bounce logic.
    }
    
    // Easier logic: Bounce off edges of screen
    if (game.currentBlock.x + game.currentBlock.w >= width) {
        game.direction = -1;
    } else if (game.currentBlock.x <= 0) {
        game.direction = 1;
    }
  }

  // Physics for debris
  for (let i = game.debris.length - 1; i >= 0; i--) {
    const d = game.debris[i];
    d.x += d.vx;
    d.y += d.vy;
    d.vy += CONFIG.gravity;
    d.alpha -= 0.02;
    if (d.y > height || d.alpha <= 0) {
      game.debris.splice(i, 1);
    }
  }

  // Physics for particles
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.05;
    if (p.life <= 0) {
      game.particles.splice(i, 1);
    }
  }

  // Camera smooth scroll
  game.cameraY += (game.targetCameraY - game.cameraY) * 0.1;
}

function draw() {
  // Clear
  ctx.fillStyle = CONFIG.colors.bg;
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  // Apply camera translation
  ctx.translate(0, game.cameraY);

  // Draw Debris
  game.debris.forEach(d => {
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = d.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = d.color;
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  });

  // Draw Stack
  game.blocks.forEach(b => {
    ctx.fillStyle = b.color;
    // Neon glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    
    // Top highlight for 3D-ish feel
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(b.x, b.y, b.w, b.h * 0.2);
    
    ctx.shadowBlur = 0;
  });

  // Draw Current Block
  if (game.currentBlock) {
    const b = game.currentBlock;
    ctx.fillStyle = b.color;
    ctx.shadowBlur = 15;
    ctx.shadowColor = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(b.x, b.y, b.w, b.h * 0.2);
    
    ctx.shadowBlur = 0;
  }

  // Draw Particles
  game.particles.forEach(p => {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  ctx.restore();
}
