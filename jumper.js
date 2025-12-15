/**
 * Neon Sky Jumper - A mobile-friendly HTML5 canvas jumping game
 * Inspired by Doodle Jump with a neon cyberpunk aesthetic
 */

// ============================================
// DOM Elements
// ============================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('scoreDisplay');
const bestDisplay = document.getElementById('bestDisplay');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayDesc = document.getElementById('overlayDesc');
const overlayScore = document.getElementById('overlayScore');
const overlayBest = document.getElementById('overlayBest');
const startBtn = document.getElementById('startBtn');

// Canvas dimensions
const W = canvas.width;
const H = canvas.height;

// ============================================
// Game Constants
// ============================================
const GRAVITY = 2200;
const JUMP_VELOCITY = -900;
const BOOST_VELOCITY = -1400;
const PLAYER_RADIUS = 25;
const PLATFORM_WIDTH = 120;
const PLATFORM_HEIGHT = 20;
const HORIZONTAL_SPEED = 800; // For keyboard movement
const HORIZONTAL_LERP = 0.15; // Smoothing for pointer movement
const CAMERA_THRESHOLD = 0.4; // Player stays below 40% from top
const MIN_PLATFORM_GAP = 100;
const MAX_PLATFORM_GAP = 200;
const INITIAL_PLATFORMS = 15;
const STORAGE_KEY = 'neon-sky-jumper-best';

// Platform types
const PLATFORM_NORMAL = 'normal';
const PLATFORM_MOVING = 'moving';
const PLATFORM_BREAKABLE = 'breakable';
const PLATFORM_BOOST = 'boost';

// Colors
const COLORS = {
    normal: { fill: '#00ffcc', glow: '#00ffcc' },
    moving: { fill: '#ff00ff', glow: '#ff00ff' },
    breakable: { fill: '#ff6633', glow: '#ff6633' },
    boost: { fill: '#ffff00', glow: '#ffff00' },
    player: { fill: '#00ffcc', glow: '#00ffcc', outline: '#ffffff' }
};

// ============================================
// Game State
// ============================================
let state = {
    gameState: 'start', // 'start', 'running', 'gameover'
    score: 0,
    best: 0,
    maxHeight: 0,
    cameraY: 0,
    player: {
        x: W / 2,
        y: H - 200,
        vx: 0,
        vy: 0,
        targetX: W / 2,
        radius: PLAYER_RADIUS,
        trail: []
    },
    platforms: [],
    particles: [],
    difficulty: 1,
    pointerDown: false,
    pointerX: W / 2,
    keys: { left: false, right: false }
};

let lastTime = 0;

// ============================================
// Utility Functions
// ============================================
function lerp(a, b, t) {
    return a + (b - a) * t;
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
    return Math.floor(randomRange(min, max + 1));
}

// ============================================
// Platform Generation
// ============================================
function createPlatform(x, y, type = PLATFORM_NORMAL) {
    const platform = {
        x: x,
        y: y,
        width: PLATFORM_WIDTH,
        height: PLATFORM_HEIGHT,
        type: type,
        breaking: false,
        breakTimer: 0,
        opacity: 1
    };

    if (type === PLATFORM_MOVING) {
        platform.vx = randomRange(100, 200) * (Math.random() < 0.5 ? 1 : -1);
        platform.minX = 50;
        platform.maxX = W - 50 - PLATFORM_WIDTH;
    }

    if (type === PLATFORM_BOOST) {
        platform.width = 100;
    }

    return platform;
}

function getRandomPlatformType() {
    const rand = Math.random();
    const difficultyFactor = Math.min(state.difficulty / 10, 0.6);

    if (rand < 0.05 + difficultyFactor * 0.05) {
        return PLATFORM_BOOST;
    } else if (rand < 0.15 + difficultyFactor * 0.2) {
        return PLATFORM_BREAKABLE;
    } else if (rand < 0.3 + difficultyFactor * 0.25) {
        return PLATFORM_MOVING;
    }
    return PLATFORM_NORMAL;
}

function generateInitialPlatforms() {
    state.platforms = [];
    
    // First platform directly under player
    state.platforms.push(createPlatform(W / 2 - PLATFORM_WIDTH / 2, H - 100, PLATFORM_NORMAL));

    let lastY = H - 100;
    
    for (let i = 1; i < INITIAL_PLATFORMS; i++) {
        const gap = randomRange(MIN_PLATFORM_GAP, MAX_PLATFORM_GAP);
        lastY -= gap;
        const x = randomRange(50, W - 50 - PLATFORM_WIDTH);
        const type = i < 3 ? PLATFORM_NORMAL : getRandomPlatformType();
        state.platforms.push(createPlatform(x, lastY, type));
    }
}

function spawnPlatformsAbove() {
    // Find the highest platform
    let highestY = Infinity;
    for (const p of state.platforms) {
        if (p.y < highestY) highestY = p.y;
    }

    // Spawn platforms above the visible area
    const visibleTop = state.cameraY;
    const spawnThreshold = visibleTop - 200;

    while (highestY > spawnThreshold) {
        const gap = randomRange(
            MIN_PLATFORM_GAP + state.difficulty * 2,
            MAX_PLATFORM_GAP + state.difficulty * 5
        );
        highestY -= gap;
        const x = randomRange(50, W - 50 - PLATFORM_WIDTH);
        const type = getRandomPlatformType();
        state.platforms.push(createPlatform(x, highestY, type));
    }
}

function removeOffscreenPlatforms() {
    const bottomThreshold = state.cameraY + H + 100;
    state.platforms = state.platforms.filter(p => p.y < bottomThreshold);
}

// ============================================
// Particle Effects
// ============================================
function createJumpParticles(x, y) {
    for (let i = 0; i < 8; i++) {
        state.particles.push({
            x: x + randomRange(-20, 20),
            y: y,
            vx: randomRange(-100, 100),
            vy: randomRange(-50, 50),
            life: 0.5,
            maxLife: 0.5,
            color: COLORS.player.glow,
            size: randomRange(3, 6)
        });
    }
}

function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) {
            state.particles.splice(i, 1);
        }
    }
}

function drawParticles() {
    for (const p of state.particles) {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y - state.cameraY, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
}

// ============================================
// Player Functions
// ============================================
function updatePlayerTrail() {
    const trail = state.player.trail;
    
    // Add current position to trail when moving up
    if (state.player.vy < -100) {
        trail.push({
            x: state.player.x,
            y: state.player.y,
            life: 0.3
        });
    }

    // Limit trail length
    while (trail.length > 10) {
        trail.shift();
    }
}

function drawPlayerTrail() {
    const trail = state.player.trail;
    for (let i = 0; i < trail.length; i++) {
        const t = trail[i];
        const alpha = (i / trail.length) * 0.5;
        const size = state.player.radius * (i / trail.length) * 0.8;
        
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COLORS.player.glow;
        ctx.shadowColor = COLORS.player.glow;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(t.x, t.y - state.cameraY, size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
}

function drawPlayer() {
    const p = state.player;
    const screenY = p.y - state.cameraY;

    // Draw trail
    drawPlayerTrail();

    // Main glow
    ctx.shadowColor = COLORS.player.glow;
    ctx.shadowBlur = 30;

    // Outer glow circle
    const gradient = ctx.createRadialGradient(p.x, screenY, 0, p.x, screenY, p.radius * 1.5);
    gradient.addColorStop(0, 'rgba(0, 255, 204, 0.8)');
    gradient.addColorStop(0.5, 'rgba(0, 255, 204, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 255, 204, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, screenY, p.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Main body
    const bodyGradient = ctx.createRadialGradient(
        p.x - p.radius * 0.3, screenY - p.radius * 0.3, 0,
        p.x, screenY, p.radius
    );
    bodyGradient.addColorStop(0, '#88ffee');
    bodyGradient.addColorStop(0.5, COLORS.player.fill);
    bodyGradient.addColorStop(1, '#008866');
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.arc(p.x, screenY, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.strokeStyle = COLORS.player.outline;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Eyes
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(p.x - 8, screenY - 5, 5, 0, Math.PI * 2);
    ctx.arc(p.x + 8, screenY - 5, 5, 0, Math.PI * 2);
    ctx.fill();

    // Eye shine
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x - 6, screenY - 7, 2, 0, Math.PI * 2);
    ctx.arc(p.x + 10, screenY - 7, 2, 0, Math.PI * 2);
    ctx.fill();
}

// ============================================
// Platform Drawing
// ============================================
function drawPlatform(platform) {
    const screenY = platform.y - state.cameraY;
    
    // Skip if off screen
    if (screenY < -50 || screenY > H + 50) return;

    const colors = COLORS[platform.type];
    let alpha = platform.opacity;

    // Breaking animation
    if (platform.breaking) {
        alpha = Math.max(0, 1 - platform.breakTimer / 0.4);
        // Shake effect
        platform.x += randomRange(-2, 2);
    }

    ctx.globalAlpha = alpha;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 15;

    // Platform body
    const gradient = ctx.createLinearGradient(
        platform.x, screenY,
        platform.x, screenY + platform.height
    );
    gradient.addColorStop(0, colors.fill);
    gradient.addColorStop(1, shadeColor(colors.fill, -30));
    ctx.fillStyle = gradient;

    // Rounded rectangle
    const radius = platform.height / 2;
    ctx.beginPath();
    ctx.roundRect(platform.x, screenY, platform.width, platform.height, radius);
    ctx.fill();

    // Top highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(platform.x + radius, screenY + 2);
    ctx.lineTo(platform.x + platform.width - radius, screenY + 2);
    ctx.stroke();

    // Boost platform indicator (arrow)
    if (platform.type === PLATFORM_BOOST) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        const cx = platform.x + platform.width / 2;
        ctx.moveTo(cx, screenY - 10);
        ctx.lineTo(cx - 10, screenY + 5);
        ctx.lineTo(cx + 10, screenY + 5);
        ctx.closePath();
        ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
}

function shadeColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = clamp((num >> 16) + amt, 0, 255);
    const G = clamp((num >> 8 & 0x00FF) + amt, 0, 255);
    const B = clamp((num & 0x0000FF) + amt, 0, 255);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// ============================================
// Background Drawing
// ============================================
function drawBackground() {
    // Main gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#0a0a2a');
    gradient.addColorStop(0.5, '#1a1a4a');
    gradient.addColorStop(1, '#0a0a2a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    // Grid lines (scrolling)
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.1)';
    ctx.lineWidth = 1;

    const gridSpacing = 60;
    const offsetY = (state.cameraY * 0.3) % gridSpacing;

    // Horizontal lines
    for (let y = -offsetY; y < H; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    }

    // Vertical lines
    for (let x = 0; x < W; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }

    // Side gradient overlays for depth
    const sideGradientLeft = ctx.createLinearGradient(0, 0, 100, 0);
    sideGradientLeft.addColorStop(0, 'rgba(10, 10, 26, 0.8)');
    sideGradientLeft.addColorStop(1, 'rgba(10, 10, 26, 0)');
    ctx.fillStyle = sideGradientLeft;
    ctx.fillRect(0, 0, 100, H);

    const sideGradientRight = ctx.createLinearGradient(W - 100, 0, W, 0);
    sideGradientRight.addColorStop(0, 'rgba(10, 10, 26, 0)');
    sideGradientRight.addColorStop(1, 'rgba(10, 10, 26, 0.8)');
    ctx.fillStyle = sideGradientRight;
    ctx.fillRect(W - 100, 0, 100, H);
}

// ============================================
// Collision Detection
// ============================================
function checkPlatformCollision(player, platform, prevY) {
    const playerBottom = player.y + player.radius;
    const playerTop = player.y - player.radius;
    const prevBottom = prevY + player.radius;

    // Only check collision when falling
    if (player.vy <= 0) return false;

    // Check if player was above platform and now overlaps
    if (prevBottom <= platform.y && playerBottom >= platform.y) {
        // Check horizontal overlap
        const playerLeft = player.x - player.radius * 0.8;
        const playerRight = player.x + player.radius * 0.8;
        const platLeft = platform.x;
        const platRight = platform.x + platform.width;

        if (playerRight > platLeft && playerLeft < platRight) {
            return true;
        }
    }
    return false;
}

// ============================================
// Game Update
// ============================================
function update(dt) {
    if (state.gameState !== 'running') return;

    const player = state.player;
    const prevY = player.y;

    // Handle keyboard input
    if (state.keys.left) {
        player.targetX -= HORIZONTAL_SPEED * dt;
    }
    if (state.keys.right) {
        player.targetX += HORIZONTAL_SPEED * dt;
    }

    // Clamp target position
    player.targetX = clamp(player.targetX, player.radius, W - player.radius);

    // Smooth horizontal movement
    player.x = lerp(player.x, player.targetX, HORIZONTAL_LERP);

    // Apply gravity
    player.vy += GRAVITY * dt;

    // Update position
    player.y += player.vy * dt;

    // Wrap around horizontally
    if (player.x < -player.radius) {
        player.x = W + player.radius;
        player.targetX = W + player.radius;
    } else if (player.x > W + player.radius) {
        player.x = -player.radius;
        player.targetX = -player.radius;
    }

    // Update moving platforms
    for (const platform of state.platforms) {
        if (platform.type === PLATFORM_MOVING && !platform.breaking) {
            platform.x += platform.vx * dt;
            if (platform.x <= platform.minX || platform.x >= platform.maxX) {
                platform.vx *= -1;
                platform.x = clamp(platform.x, platform.minX, platform.maxX);
            }
        }

        // Update breaking platforms
        if (platform.breaking) {
            platform.breakTimer += dt;
        }
    }

    // Remove fully broken platforms
    state.platforms = state.platforms.filter(p => !p.breaking || p.breakTimer < 0.4);

    // Check platform collisions
    for (const platform of state.platforms) {
        if (platform.breaking) continue;

        if (checkPlatformCollision(player, platform, prevY)) {
            // Land on platform
            player.y = platform.y - player.radius;

            if (platform.type === PLATFORM_BOOST) {
                player.vy = BOOST_VELOCITY;
                createJumpParticles(player.x, player.y + player.radius);
            } else if (platform.type === PLATFORM_BREAKABLE) {
                player.vy = JUMP_VELOCITY;
                platform.breaking = true;
                platform.breakTimer = 0;
                createJumpParticles(player.x, player.y + player.radius);
            } else {
                player.vy = JUMP_VELOCITY;
                createJumpParticles(player.x, player.y + player.radius);
            }
            break;
        }
    }

    // Update camera (scroll when player goes above threshold)
    const scrollThreshold = state.cameraY + H * CAMERA_THRESHOLD;
    if (player.y < scrollThreshold) {
        state.cameraY = player.y - H * CAMERA_THRESHOLD;
    }

    // Track max height and score
    const height = H - player.y;
    if (height > state.maxHeight) {
        state.maxHeight = height;
        state.score = Math.floor(state.maxHeight / 10);
        state.difficulty = 1 + Math.floor(state.maxHeight / 2000);
        scoreDisplay.textContent = state.score;
    }

    // Spawn new platforms above
    spawnPlatformsAbove();

    // Remove platforms below screen
    removeOffscreenPlatforms();

    // Update player trail
    updatePlayerTrail();

    // Update particles
    updateParticles(dt);

    // Check for death (fell below screen)
    const screenBottom = state.cameraY + H;
    if (player.y > screenBottom + player.radius * 2) {
        endGame();
    }
}

// ============================================
// Game Draw
// ============================================
function draw() {
    // Clear canvas
    ctx.clearRect(0, 0, W, H);

    // Draw background
    drawBackground();

    // Draw platforms
    for (const platform of state.platforms) {
        drawPlatform(platform);
    }

    // Draw particles
    drawParticles();

    // Draw player
    if (state.gameState === 'running') {
        drawPlayer();
    }
}

// ============================================
// Game Loop
// ============================================
function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // Cap delta time
    lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(loop);
}

// ============================================
// Game State Management
// ============================================
function startGame() {
    // Reset state
    state.gameState = 'running';
    state.score = 0;
    state.maxHeight = 0;
    state.cameraY = 0;
    state.difficulty = 1;
    state.particles = [];

    // Reset player
    state.player = {
        x: W / 2,
        y: H - 150,
        vx: 0,
        vy: 0,
        targetX: W / 2,
        radius: PLAYER_RADIUS,
        trail: []
    };

    // Generate platforms
    generateInitialPlatforms();

    // Update UI
    scoreDisplay.textContent = '0';
    overlay.classList.add('hidden');
}

function endGame() {
    state.gameState = 'gameover';

    // Update best score
    if (state.score > state.best) {
        state.best = state.score;
        localStorage.setItem(STORAGE_KEY, state.best.toString());
        bestDisplay.textContent = state.best;
    }

    // Show overlay
    overlayTitle.textContent = 'Game Over';
    overlayDesc.classList.add('hidden');
    overlayScore.textContent = `Score: ${state.score}`;
    overlayScore.classList.remove('hidden');
    overlayBest.textContent = `Best: ${state.best}`;
    overlayBest.classList.remove('hidden');
    startBtn.textContent = 'Play Again';
    overlay.classList.remove('hidden');
}

function loadBestScore() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        state.best = parseInt(saved, 10) || 0;
        bestDisplay.textContent = state.best;
    }
}

// ============================================
// Input Handlers
// ============================================
function getCanvasPosition(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

// Pointer events for touch/mouse
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.pointerDown = true;
    const pos = getCanvasPosition(e.clientX, e.clientY);
    state.pointerX = pos.x;
    state.player.targetX = pos.x;
});

canvas.addEventListener('pointermove', (e) => {
    e.preventDefault();
    if (state.pointerDown || true) { // Always track for responsive controls
        const pos = getCanvasPosition(e.clientX, e.clientY);
        state.pointerX = pos.x;
        if (state.gameState === 'running') {
            state.player.targetX = pos.x;
        }
    }
});

canvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    state.pointerDown = false;
});

canvas.addEventListener('pointerleave', (e) => {
    state.pointerDown = false;
});

// Prevent context menu on long press
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Keyboard events
window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        state.keys.left = true;
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        state.keys.right = true;
    }
    // Start game with space or enter
    if ((e.key === ' ' || e.key === 'Enter') && state.gameState !== 'running') {
        startGame();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        state.keys.left = false;
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        state.keys.right = false;
    }
});

// Button click
startBtn.addEventListener('click', () => {
    startGame();
});

// Also start on overlay click
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
        startGame();
    }
});

// ============================================
// Initialize Game
// ============================================
function init() {
    loadBestScore();
    generateInitialPlatforms();
    draw(); // Draw initial state
    lastTime = performance.now();
    requestAnimationFrame(loop);
}

// Start when page loads
init();
