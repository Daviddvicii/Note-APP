// ============================================================================
// Neon Sky Jumper - Game Logic
// ============================================================================

// DOM Elements
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMessage = document.getElementById('overlay-message');
const startButton = document.getElementById('start-button');

// Canvas dimensions
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;

// Game State
const state = {
    gameState: 'start', // 'start' | 'running' | 'gameover'
    score: 0,
    best: 0,
    maxHeight: 0,
    cameraY: 0,
    
    player: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT - 200,
        radius: 25,
        vx: 0,
        vy: 0,
        targetX: CANVAS_WIDTH / 2,
        trail: []
    },
    
    platforms: [],
    particles: [],
    
    input: {
        pointerX: null,
        pointerActive: false,
        keys: {}
    },
    
    lastTime: 0
};

// Game Constants
const GRAVITY = 2200;
const JUMP_STRENGTH = -850;
const PLAYER_SPEED = 600;
const PLAYER_SMOOTH = 0.15;
const CAMERA_THRESHOLD = CANVAS_HEIGHT * 0.4;
const PLATFORM_WIDTH = 120;
const PLATFORM_HEIGHT = 20;
const PLATFORM_SPACING_MIN = 150;
const PLATFORM_SPACING_MAX = 250;
const PLATFORM_MOVE_SPEED = 100;
const PLATFORM_MOVE_RANGE = 200;

// Platform Types
const PLATFORM_TYPES = {
    NORMAL: 0,
    MOVING: 1,
    BREAKABLE: 2,
    BOOST: 3
};

// ============================================================================
// Platform Class
// ============================================================================

class Platform {
    constructor(x, y, type = PLATFORM_TYPES.NORMAL) {
        this.x = x;
        this.y = y;
        this.width = PLATFORM_WIDTH;
        this.height = PLATFORM_HEIGHT;
        this.type = type;
        this.breaking = false;
        this.breakTimer = 0;
        this.moveDir = Math.random() > 0.5 ? 1 : -1;
        this.moveStartX = x;
    }
    
    update(dt) {
        // Moving platform logic
        if (this.type === PLATFORM_TYPES.MOVING) {
            this.x += this.moveDir * PLATFORM_MOVE_SPEED * dt;
            if (Math.abs(this.x - this.moveStartX) > PLATFORM_MOVE_RANGE) {
                this.moveDir *= -1;
            }
        }
        
        // Breakable platform logic
        if (this.breaking) {
            this.breakTimer += dt;
            if (this.breakTimer > 0.4) {
                return false; // Remove platform
            }
        }
        
        return true;
    }
    
    draw(ctx, cameraY) {
        const screenY = this.y - cameraY;
        
        // Skip if off screen
        if (screenY < -50 || screenY > CANVAS_HEIGHT + 50) return;
        
        const screenX = this.x;
        const alpha = this.breaking ? 1 - (this.breakTimer / 0.4) : 1;
        
        // Choose color based on type
        let color, glowColor;
        switch (this.type) {
            case PLATFORM_TYPES.NORMAL:
                color = '#00ffff';
                glowColor = 'rgba(0, 255, 255, 0.6)';
                break;
            case PLATFORM_TYPES.MOVING:
                color = '#ff00ff';
                glowColor = 'rgba(255, 0, 255, 0.6)';
                break;
            case PLATFORM_TYPES.BREAKABLE:
                color = '#ff8800';
                glowColor = 'rgba(255, 136, 0, 0.6)';
                break;
            case PLATFORM_TYPES.BOOST:
                color = '#00ff88';
                glowColor = 'rgba(0, 255, 136, 0.6)';
                break;
        }
        
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Glow effect
        ctx.shadowBlur = 20;
        ctx.shadowColor = glowColor;
        
        // Draw platform
        ctx.fillStyle = color;
        ctx.fillRect(screenX - this.width / 2, screenY - this.height / 2, this.width, this.height);
        
        // Outline
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX - this.width / 2, screenY - this.height / 2, this.width, this.height);
        
        // Breakable platform crack effect
        if (this.breaking && this.breakTimer > 0.1) {
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            for (let i = 0; i < 5; i++) {
                const crackX = screenX - this.width / 2 + (this.width / 5) * i;
                ctx.beginPath();
                ctx.moveTo(crackX, screenY - this.height / 2);
                ctx.lineTo(crackX + (Math.random() - 0.5) * 10, screenY + this.height / 2);
                ctx.stroke();
            }
        }
        
        ctx.restore();
    }
}

// ============================================================================
// Particle Class (for effects)
// ============================================================================

class Particle {
    constructor(x, y, vx, vy, color, life = 0.5) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.life = life;
        this.maxLife = life;
        this.size = Math.random() * 4 + 2;
    }
    
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        return this.life > 0;
    }
    
    draw(ctx, cameraY) {
        const screenY = this.y - cameraY;
        const alpha = this.life / this.maxLife;
        
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, screenY, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// ============================================================================
// Game Functions
// ============================================================================

function loadBestScore() {
    const saved = localStorage.getItem('neon-sky-jumper-best');
    state.best = saved ? parseInt(saved, 10) : 0;
    bestEl.textContent = state.best;
}

function saveBestScore() {
    if (state.score > state.best) {
        state.best = state.score;
        localStorage.setItem('neon-sky-jumper-best', state.best.toString());
        bestEl.textContent = state.best;
    }
}

function generateInitialPlatforms() {
    state.platforms = [];
    
    // Start platform at player's starting position
    state.platforms.push(new Platform(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 150, PLATFORM_TYPES.NORMAL));
    
    // Generate platforms going up
    let currentY = CANVAS_HEIGHT - 150;
    while (currentY > -500) {
        currentY -= PLATFORM_SPACING_MIN + Math.random() * (PLATFORM_SPACING_MAX - PLATFORM_SPACING_MIN);
        const x = 100 + Math.random() * (CANVAS_WIDTH - 200);
        
        // Determine platform type based on height (more variety as you go up)
        let type = PLATFORM_TYPES.NORMAL;
        const rand = Math.random();
        if (currentY < -200) {
            if (rand < 0.3) type = PLATFORM_TYPES.MOVING;
            else if (rand < 0.5) type = PLATFORM_TYPES.BREAKABLE;
            else if (rand < 0.6) type = PLATFORM_TYPES.BOOST;
        } else if (currentY < 0) {
            if (rand < 0.15) type = PLATFORM_TYPES.MOVING;
            else if (rand < 0.25) type = PLATFORM_TYPES.BREAKABLE;
        }
        
        state.platforms.push(new Platform(x, currentY, type));
    }
}

function spawnPlatformsAbove() {
    if (state.platforms.length === 0) return;
    
    // Find highest platform
    let highestY = Math.min(...state.platforms.map(p => p.y));
    
    // Spawn platforms above the highest one
    while (highestY > state.cameraY - CANVAS_HEIGHT) {
        highestY -= PLATFORM_SPACING_MIN + Math.random() * (PLATFORM_SPACING_MAX - PLATFORM_SPACING_MIN);
        const x = 100 + Math.random() * (CANVAS_WIDTH - 200);
        
        // More variety as height increases
        const heightFactor = Math.abs(highestY) / 1000;
        let type = PLATFORM_TYPES.NORMAL;
        const rand = Math.random();
        
        if (heightFactor > 0.3) {
            if (rand < 0.35) type = PLATFORM_TYPES.MOVING;
            else if (rand < 0.55) type = PLATFORM_TYPES.BREAKABLE;
            else if (rand < 0.65) type = PLATFORM_TYPES.BOOST;
        } else if (heightFactor > 0.1) {
            if (rand < 0.2) type = PLATFORM_TYPES.MOVING;
            else if (rand < 0.35) type = PLATFORM_TYPES.BREAKABLE;
        }
        
        state.platforms.push(new Platform(x, highestY, type));
    }
}

function checkCollision(player, platform) {
    const playerLeft = player.x - player.radius;
    const playerRight = player.x + player.radius;
    const playerBottom = player.y + player.radius;
    const playerTop = player.y - player.radius;
    
    const platLeft = platform.x - platform.width / 2;
    const platRight = platform.x + platform.width / 2;
    const platTop = platform.y - platform.height / 2;
    const platBottom = platform.y + platform.height / 2;
    
    // Check horizontal overlap
    if (playerRight < platLeft || playerLeft > platRight) return false;
    
    // Check if player is falling and landing on top of platform
    if (player.vy > 0 && playerTop < platTop && playerBottom >= platTop && playerBottom <= platBottom) {
        return true;
    }
    
    return false;
}

function update(dt) {
    if (state.gameState !== 'running') return;
    
    const player = state.player;
    
    // Update player horizontal movement (smooth interpolation)
    const dx = player.targetX - player.x;
    player.x += dx * PLAYER_SMOOTH;
    player.vx = dx * PLAYER_SMOOTH;
    
    // Apply gravity
    player.vy += GRAVITY * dt;
    
    // Update player position
    const prevY = player.y;
    player.y += player.vy * dt;
    
    // Update player trail
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 8) {
        player.trail.shift();
    }
    
    // Check platform collisions
    for (let platform of state.platforms) {
        if (checkCollision(player, platform)) {
            // Land on platform
            player.y = platform.y - platform.height / 2 - player.radius;
            player.vy = JUMP_STRENGTH;
            
            // Handle platform types
            if (platform.type === PLATFORM_TYPES.BREAKABLE && !platform.breaking) {
                platform.breaking = true;
                // Add particles
                for (let i = 0; i < 8; i++) {
                    state.particles.push(new Particle(
                        platform.x + (Math.random() - 0.5) * platform.width,
                        platform.y,
                        (Math.random() - 0.5) * 200,
                        -Math.random() * 200,
                        '#ff8800',
                        0.5
                    ));
                }
            } else if (platform.type === PLATFORM_TYPES.BOOST) {
                player.vy = JUMP_STRENGTH * 1.5; // Extra boost
                // Add boost particles
                for (let i = 0; i < 12; i++) {
                    state.particles.push(new Particle(
                        player.x,
                        player.y,
                        (Math.random() - 0.5) * 150,
                        -Math.random() * 300 - 100,
                        '#00ff88',
                        0.6
                    ));
                }
            }
            
            // Add landing particles
            for (let i = 0; i < 5; i++) {
                state.particles.push(new Particle(
                    player.x + (Math.random() - 0.5) * 30,
                    player.y + player.radius,
                    (Math.random() - 0.5) * 100,
                    Math.random() * 100,
                    '#00ffff',
                    0.4
                ));
            }
            
            break;
        }
    }
    
    // Update camera
    const playerScreenY = player.y - state.cameraY;
    if (playerScreenY < CAMERA_THRESHOLD) {
        state.cameraY = player.y - CAMERA_THRESHOLD;
    }
    
    // Update max height and score
    const worldY = player.y;
    if (worldY < state.maxHeight) {
        state.maxHeight = worldY;
        state.score = Math.floor(Math.abs(state.maxHeight) / 10);
        scoreEl.textContent = state.score;
    }
    
    // Update platforms
    state.platforms = state.platforms.filter(platform => {
        const updated = platform.update(dt);
        // Remove platforms that are far below the screen
        if (platform.y > state.cameraY + CANVAS_HEIGHT + 200) {
            return false;
        }
        return updated;
    });
    
    // Spawn new platforms above
    spawnPlatformsAbove();
    
    // Update particles
    state.particles = state.particles.filter(particle => {
        return particle.update(dt);
    });
    
    // Check game over (player fell off bottom)
    const playerScreenYBottom = player.y - state.cameraY;
    if (playerScreenYBottom > CANVAS_HEIGHT + 100) {
        endGame();
    }
}

function draw() {
    // Clear canvas
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, 'rgba(26, 26, 58, 0.8)');
    gradient.addColorStop(0.5, 'rgba(10, 10, 26, 0.4)');
    gradient.addColorStop(1, 'rgba(26, 26, 58, 0.8)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw grid lines (subtle)
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    const gridOffset = state.cameraY % 100;
    for (let y = -gridOffset; y < CANVAS_HEIGHT; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
    }
    for (let x = 0; x < CANVAS_WIDTH; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
    }
    
    // Draw platforms
    for (let platform of state.platforms) {
        platform.draw(ctx, state.cameraY);
    }
    
    // Draw particles
    for (let particle of state.particles) {
        particle.draw(ctx, state.cameraY);
    }
    
    // Draw player trail
    if (state.player.trail.length > 1) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 8;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#00ffff';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < state.player.trail.length; i++) {
            const point = state.player.trail[i];
            const screenY = point.y - state.cameraY;
            if (i === 0) {
                ctx.moveTo(point.x, screenY);
            } else {
                ctx.lineTo(point.x, screenY);
            }
        }
        ctx.stroke();
        ctx.restore();
    }
    
    // Draw player
    const playerScreenY = state.player.y - state.cameraY;
    
    // Player glow
    ctx.save();
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#00ffff';
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(state.player.x, playerScreenY, state.player.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Player inner circle
    const gradient2 = ctx.createRadialGradient(
        state.player.x, playerScreenY, 0,
        state.player.x, playerScreenY, state.player.radius
    );
    gradient2.addColorStop(0, '#ffffff');
    gradient2.addColorStop(0.5, '#00ffff');
    gradient2.addColorStop(1, '#0088ff');
    ctx.fillStyle = gradient2;
    ctx.beginPath();
    ctx.arc(state.player.x, playerScreenY, state.player.radius - 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Player outline
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(state.player.x, playerScreenY, state.player.radius, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.restore();
}

function startGame() {
    // Reset state
    state.gameState = 'running';
    state.score = 0;
    state.maxHeight = 0;
    state.cameraY = 0;
    state.player.x = CANVAS_WIDTH / 2;
    state.player.y = CANVAS_HEIGHT - 200;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.targetX = CANVAS_WIDTH / 2;
    state.player.trail = [];
    state.platforms = [];
    state.particles = [];
    
    // Generate initial platforms
    generateInitialPlatforms();
    
    // Update UI
    scoreEl.textContent = '0';
    overlay.classList.add('hidden');
    
    // Start game loop
    state.lastTime = performance.now();
    requestAnimationFrame(loop);
}

function endGame() {
    state.gameState = 'gameover';
    saveBestScore();
    
    // Update overlay
    overlayTitle.textContent = 'Game Over';
    overlayMessage.textContent = `Score: ${state.score} | Best: ${state.best}`;
    startButton.textContent = 'Play Again';
    overlay.classList.remove('hidden');
}

function loop(timestamp) {
    if (state.gameState !== 'running') return;
    
    const dt = Math.min((timestamp - state.lastTime) / 1000, 0.02); // Cap at 20ms
    state.lastTime = timestamp;
    
    update(dt);
    draw();
    
    requestAnimationFrame(loop);
}

// ============================================================================
// Input Handlers
// ============================================================================

// Pointer/Touch input
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    state.input.pointerX = (e.clientX - rect.left) * scaleX;
    state.input.pointerActive = true;
    state.player.targetX = state.input.pointerX;
});

canvas.addEventListener('pointermove', (e) => {
    if (!state.input.pointerActive) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    state.input.pointerX = (e.clientX - rect.left) * scaleX;
    state.player.targetX = state.input.pointerX;
});

canvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    state.input.pointerActive = false;
});

canvas.addEventListener('pointerleave', (e) => {
    e.preventDefault();
    state.input.pointerActive = false;
});

// Keyboard input (desktop fallback)
window.addEventListener('keydown', (e) => {
    state.input.keys[e.key.toLowerCase()] = true;
    
    if (state.gameState === 'running') {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            state.player.targetX = Math.max(state.player.radius, state.player.targetX - 50);
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            state.player.targetX = Math.min(CANVAS_WIDTH - state.player.radius, state.player.targetX + 50);
        }
    }
});

window.addEventListener('keyup', (e) => {
    state.input.keys[e.key.toLowerCase()] = false;
});

// Start button and overlay click
startButton.addEventListener('click', () => {
    if (state.gameState === 'start' || state.gameState === 'gameover') {
        startGame();
    }
});

overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === overlayTitle || e.target === overlayMessage) {
        if (state.gameState === 'start' || state.gameState === 'gameover') {
            startGame();
        }
    }
});

// ============================================================================
// Initialize
// ============================================================================

loadBestScore();
draw(); // Draw initial screen
