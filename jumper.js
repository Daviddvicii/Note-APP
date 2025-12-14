// Configuration
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;
const GRAVITY = 2200; // px/s^2
const JUMP_FORCE = -1100; // px/s (Initial upward velocity)
const PLAYER_RADIUS = 20;
const PLATFORM_WIDTH = 140;
const PLATFORM_HEIGHT = 30;
const PLATFORM_GAP_MIN = 150;
const PLATFORM_GAP_MAX = 300;
const PLAYER_SPEED = 800; // Horizontal speed for keyboard
const LERP_FACTOR = 0.15; // For smooth horizontal movement

// DOM Elements
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');
const overlayBtn = document.getElementById('overlay-btn');

// Game State
let state = {
    running: false,
    gameOver: false,
    score: 0,
    best: 0,
    cameraY: 0,
    maxHeight: 0, // Inverted world Y (starts at 0, increases as we go up)
    lastTime: 0,
    platforms: [],
    particles: [],
    player: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT - 300,
        vx: 0,
        vy: 0,
        targetX: CANVAS_WIDTH / 2,
        isDead: false
    },
    input: {
        isTouching: false,
        touchX: 0,
        keys: { left: false, right: false }
    }
};

// Initialization
function init() {
    // Load best score
    const savedBest = localStorage.getItem('neon-sky-jumper-best');
    if (savedBest) state.best = parseInt(savedBest, 10);
    bestEl.textContent = state.best;

    // Event Listeners
    window.addEventListener('resize', handleResize);
    handleResize();

    // Input Handling
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    overlayBtn.addEventListener('click', startGame);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) startGame();
    });

    // Start Loop
    requestAnimationFrame(loop);
}

function startGame() {
    if (state.running) return;

    // Reset State
    state.running = true;
    state.gameOver = false;
    state.score = 0;
    state.maxHeight = 0;
    state.cameraY = 0;
    state.platforms = [];
    state.particles = [];
    
    // Reset Player
    state.player = {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT - 300,
        vx: 0,
        vy: 0,
        targetX: CANVAS_WIDTH / 2,
        isDead: false
    };

    // Initial Platforms
    // Start with a base platform
    createPlatform(CANVAS_WIDTH / 2 - PLATFORM_WIDTH / 2, CANVAS_HEIGHT - 100, 0);
    
    // Generate initial set
    let currentY = CANVAS_HEIGHT - 100;
    while (currentY > -CANVAS_HEIGHT) {
        currentY -= (PLATFORM_GAP_MIN + Math.random() * (PLATFORM_GAP_MAX - PLATFORM_GAP_MIN));
        generatePlatform(currentY);
    }

    // UI Update
    overlay.classList.add('hidden');
    scoreEl.textContent = '0';
    state.lastTime = performance.now();
}

function gameOver() {
    state.running = false;
    state.gameOver = true;
    
    // Update Best
    if (state.score > state.best) {
        state.best = state.score;
        localStorage.setItem('neon-sky-jumper-best', state.best);
        bestEl.textContent = state.best;
    }

    // Show Overlay
    overlayTitle.textContent = "GAME OVER";
    overlayMsg.innerHTML = `Score: ${state.score}<br>Best: ${state.best}`;
    overlayBtn.textContent = "Play Again";
    overlay.classList.remove('hidden');
}

// Input Handlers
function handlePointerDown(e) {
    if (!state.running) return;
    state.input.isTouching = true;
    updateInputTarget(e);
}

function handlePointerMove(e) {
    if (!state.running || !state.input.isTouching) return;
    updateInputTarget(e);
}

function handlePointerUp() {
    state.input.isTouching = false;
}

function updateInputTarget(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const clientX = e.clientX - rect.left;
    state.player.targetX = clientX * scaleX;
}

function handleKeyDown(e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') state.input.keys.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') state.input.keys.right = true;
}

function handleKeyUp(e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') state.input.keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') state.input.keys.right = false;
}

function handleResize() {
    // Canvas is scaled by CSS, we just need to ensure resolution is correct
    // The constants are already set, so nothing complex here.
}

// Game Logic
function update(dt) {
    if (!state.running) return;

    const player = state.player;

    // Input Processing
    // Keyboard overrides targetX if keys are pressed
    if (state.input.keys.left) {
        player.targetX -= PLAYER_SPEED * dt;
    }
    if (state.input.keys.right) {
        player.targetX += PLAYER_SPEED * dt;
    }

    // Constrain targetX
    player.targetX = Math.max(PLAYER_RADIUS, Math.min(CANVAS_WIDTH - PLAYER_RADIUS, player.targetX));

    // Smooth movement
    player.x += (player.targetX - player.x) * (dt / 0.05); // Frame-independent-ish lerp approximation

    // Gravity
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;

    // Wrap around screen horizontally? 
    // Prompt says "Left/Right to move". Usually Doodle Jump wraps. 
    // Prompt didn't explicitly ask for wrap, but it's standard.
    // "If player falls off bottom... game over".
    // I will implement screen wrapping for X.
    if (player.x < -PLAYER_RADIUS) {
        player.x = CANVAS_WIDTH + PLAYER_RADIUS;
        player.targetX = player.x; // Sync target
    } else if (player.x > CANVAS_WIDTH + PLAYER_RADIUS) {
        player.x = -PLAYER_RADIUS;
        player.targetX = player.x;
    }

    // Camera Logic
    // If player is above 40% of screen, move camera up (decrease cameraY)
    const threshold = CANVAS_HEIGHT * 0.4;
    const playerScreenY = player.y - state.cameraY;
    
    if (playerScreenY < threshold) {
        const diff = threshold - playerScreenY;
        state.cameraY -= diff;
        // Score based on max height reached (inverted Y)
        // Initial player Y is around CANVAS_HEIGHT - 300.
        // As player goes UP, Y decreases.
        // Let's calculate score based on total climbed distance.
        const currentHeight = (CANVAS_HEIGHT - 300) - player.y;
        if (currentHeight > state.maxHeight) {
            state.maxHeight = currentHeight;
            state.score = Math.floor(state.maxHeight / 10);
            scoreEl.textContent = state.score;
        }
    }

    // Platform Logic
    updatePlatforms(dt);
    checkCollisions();
    
    // Death Check
    // If player falls below camera view
    if (player.y - state.cameraY > CANVAS_HEIGHT) {
        gameOver();
    }
}

function createPlatform(x, y, type) {
    state.platforms.push({
        x: x,
        y: y,
        w: PLATFORM_WIDTH,
        h: PLATFORM_HEIGHT,
        type: type, // 0: Normal, 1: Moving, 2: Breakable
        vx: type === 1 ? (Math.random() > 0.5 ? 100 : -100) : 0,
        breaking: false,
        breakTimer: 0
    });
}

function generatePlatform(y) {
    // Determine type based on score/height difficulty
    // Basic progression
    let type = 0;
    const difficulty = state.score / 1000; // Increases over time
    const rand = Math.random();
    
    if (rand < 0.2 + Math.min(0.3, difficulty * 0.1)) type = 1; // Moving
    else if (rand < 0.3 + Math.min(0.4, difficulty * 0.1)) type = 2; // Breakable
    
    const x = Math.random() * (CANVAS_WIDTH - PLATFORM_WIDTH);
    createPlatform(x, y, type);
}

function updatePlatforms(dt) {
    // Filter out platforms that are too low
    state.platforms = state.platforms.filter(p => p.y - state.cameraY < CANVAS_HEIGHT + 100);

    // Spawn new platforms
    // Find highest platform (lowest Y)
    let minY = Infinity;
    for (const p of state.platforms) {
        if (p.y < minY) minY = p.y;
    }

    // If highest platform is within generation range (e.g. within 1 screen height above view), spawn more
    // cameraY is the top of the viewport in world space.
    // We want to generate platforms above the camera.
    // Current top of screen is state.cameraY.
    // Generate up to state.cameraY - CANVAS_HEIGHT (buffer)
    while (minY > state.cameraY - 100) {
        const gap = PLATFORM_GAP_MIN + Math.random() * (PLATFORM_GAP_MAX - PLATFORM_GAP_MIN);
        minY -= gap;
        generatePlatform(minY);
    }

    // Update Moving/Breaking platforms
    for (const p of state.platforms) {
        if (p.type === 1) { // Moving
            p.x += p.vx * dt;
            if (p.x <= 0 || p.x + p.w >= CANVAS_WIDTH) {
                p.vx *= -1;
                p.x = Math.max(0, Math.min(CANVAS_WIDTH - p.w, p.x));
            }
        }
        if (p.breaking) {
            p.breakTimer += dt;
        }
    }
    
    // Remove broken platforms
    state.platforms = state.platforms.filter(p => !(p.breaking && p.breakTimer > 0.3));
}

function checkCollisions() {
    const player = state.player;
    
    // Only collide if falling
    if (player.vy < 0) return; // Moving up

    // Simple AABB / Circle collision
    // Check foot position
    const feetX = player.x;
    const feetY = player.y + PLAYER_RADIUS;

    for (const p of state.platforms) {
        // Platform bounds
        // Allow a bit of leeway
        if (
            feetX + PLAYER_RADIUS/2 > p.x && 
            feetX - PLAYER_RADIUS/2 < p.x + p.w &&
            feetY >= p.y &&
            feetY <= p.y + p.h + 20 && // +20 tolerance for high speed
            player.y - player.vy * 0.016 < p.y // Was previously above platform
        ) {
            // Bounce!
            player.vy = JUMP_FORCE;
            
            if (p.type === 2) { // Breakable
                p.breaking = true;
            }
            break; // Handle one collision per frame
        }
    }
}

// Rendering
function draw() {
    // Clear screen
    ctx.fillStyle = '#050510'; // Match CSS --bg-dark
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Background Grid/Gradient
    const gridOffset = Math.floor(state.cameraY) % 50;
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Vertical lines
    for (let x = 0; x <= CANVAS_WIDTH; x += 100) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
    }
    // Horizontal lines (scrolling)
    for (let y = -gridOffset; y < CANVAS_HEIGHT; y += 100) {
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
    }
    ctx.stroke();

    ctx.save();
    // Apply camera transform
    // We want to draw relative to cameraY.
    // If cameraY is -100 (moved up 100px), an object at -100 should be at 0 on screen.
    // screenY = objectY - cameraY.
    ctx.translate(0, -state.cameraY);

    // Draw Platforms
    for (const p of state.platforms) {
        // Styles based on type
        let color = '#00ffcc'; // Normal --accent
        let shadow = '#00ffcc';
        
        if (p.type === 1) { // Moving
            color = '#ff00ff'; // --accent-2
            shadow = '#ff00ff';
        } else if (p.type === 2) { // Breakable
            color = '#ffff00'; // --accent-3
            shadow = '#ffff00';
            if (p.breaking) {
                ctx.globalAlpha = 1 - (p.breakTimer / 0.3);
            }
        }

        // Glow
        ctx.shadowBlur = 15;
        ctx.shadowColor = shadow;
        ctx.fillStyle = color;
        
        // Rounded rect
        roundRect(ctx, p.x, p.y, p.w, p.h, 5);
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }

    // Draw Player
    const p = state.player;
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00ffcc';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    
    // Player inner detail
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS * 0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Main Loop
function loop(timestamp) {
    const dt = Math.min((timestamp - state.lastTime) / 1000, 0.05); // Cap dt
    state.lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(loop);
}

// Start
init();
