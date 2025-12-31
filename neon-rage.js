/**
 * Neon Rage Dodge
 * A mobile-first 2-lane reaction game.
 */

// --- Constants ---
const LOGICAL_WIDTH = 720;
const LOGICAL_HEIGHT = 1280;
const LANE_LEFT_X = LOGICAL_WIDTH * 0.25;
const LANE_RIGHT_X = LOGICAL_WIDTH * 0.75;
const PLAYER_Y = LOGICAL_HEIGHT * 0.85;
const PLAYER_RADIUS = 30;
const OBSTACLE_SIZE = 70;
const STORAGE_KEY = 'neon-rage-dodge-best';

// --- Colors ---
const COLOR_BG = '#050510';
const COLOR_PLAYER = '#0ff'; // Cyan
const COLOR_OBSTACLE = '#f0f'; // Magenta
const COLOR_OBSTACLE_ALT = '#b0f'; // Purple
const COLOR_TEXT = '#fff';

// --- Game State ---
const state = {
    screen: 'START', // START, PLAYING, GAMEOVER
    score: 0,
    bestScore: parseFloat(localStorage.getItem(STORAGE_KEY)) || 0,
    streak: 0,
    startTime: 0,
    lastFrameTime: 0,
    playerLane: 0, // 0 = Left, 1 = Right
    playerX: LANE_LEFT_X,
    lastToggleTime: 0,
    obstacles: [],
    particles: [],
    texts: [], // Floating texts
    spawnTimer: 0,
    difficultyTime: 0, // Separate timer for ramping difficulty
    audioEnabled: true,
    isMuted: false,
};

// --- DOM Elements ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false }); // Optimize
const uiScore = document.getElementById('score-display');
const uiBest = document.getElementById('best-display');
const uiStreak = document.getElementById('streak-display');
const uiStreakBox = document.getElementById('streak-box');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreEl = document.getElementById('final-score');
const finalBestEl = document.getElementById('final-best');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const tauntMsg = document.getElementById('taunt-msg');
const audioToggle = document.getElementById('audio-toggle');
const dailySeedInfo = document.getElementById('daily-seed-info');

// --- Audio System (Simple Synth) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const Sound = {
    playTone: (freq, type, duration, vol = 0.1) => {
        if (!state.audioEnabled || state.isMuted) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    },
    
    playSwitch: () => Sound.playTone(400, 'triangle', 0.1, 0.1),
    playNearMiss: () => Sound.playTone(800, 'sine', 0.15, 0.05),
    playSick: () => {
        Sound.playTone(1200, 'square', 0.1, 0.05);
        setTimeout(() => Sound.playTone(1800, 'square', 0.2, 0.05), 100);
    },
    playDeath: () => {
        Sound.playTone(150, 'sawtooth', 0.5, 0.2);
        setTimeout(() => Sound.playTone(100, 'sawtooth', 0.5, 0.2), 100);
    }
};

// --- Initialization ---
function init() {
    resize();
    window.addEventListener('resize', resize);
    
    // Inputs
    const handleInput = (e) => {
        if (e.type === 'keydown' && e.code !== 'Space') return;
        
        // Prevent spacebar scrolling
        if (e.type === 'keydown' && e.code === 'Space') {
            e.preventDefault();
        }

        if (state.screen === 'PLAYING') {
            toggleLane();
        } else if (state.screen === 'START') {
            startGame();
        } else if (state.screen === 'GAMEOVER') {
            // Debounce restart
            if (performance.now() - state.deathTime > 500) startGame();
        }
    };

    window.addEventListener('keydown', handleInput);
    document.addEventListener('pointerdown', (e) => {
        if (e.target.tagName !== 'BUTTON') {
             handleInput(e);
        }
    });

    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', startGame);
    
    audioToggle.addEventListener('click', () => {
        state.isMuted = !state.isMuted;
        audioToggle.textContent = state.isMuted ? '🔇' : '🔊';
        audioToggle.style.opacity = state.isMuted ? '0.5' : '1';
    });

    // Seed Info
    const seed = new Date().toISOString().slice(0,10).replace(/-/g,'');
    dailySeedInfo.innerText = `Daily Seed: ${seed}`;

    // Update Best Score UI
    uiBest.innerText = state.bestScore.toFixed(2);

    requestAnimationFrame(gameLoop);
}

function resize() {
    const aspect = LOGICAL_WIDTH / LOGICAL_HEIGHT;
    const windowAspect = window.innerWidth / window.innerHeight;
    
    let displayWidth, displayHeight;
    
    if (windowAspect < aspect) {
        displayWidth = window.innerWidth;
        displayHeight = window.innerWidth / aspect;
    } else {
        displayHeight = window.innerHeight;
        displayWidth = window.innerHeight * aspect;
    }
    
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    
    // Keep internal resolution fixed
    canvas.width = LOGICAL_WIDTH;
    canvas.height = LOGICAL_HEIGHT;
}

// --- Game Logic ---
function startGame() {
    state.screen = 'PLAYING';
    state.score = 0;
    state.streak = 0;
    state.startTime = performance.now();
    state.obstacles = [];
    state.particles = [];
    state.texts = [];
    state.spawnTimer = 0;
    state.difficultyTime = 0;
    state.playerLane = 0; // Reset to left
    state.playerX = LANE_LEFT_X; // Instant reset
    state.lastToggleTime = 0;
    
    // Hide UI
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    uiStreakBox.classList.add('hidden');
    
    // Resume audio context if needed
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function toggleLane() {
    state.playerLane = 1 - state.playerLane; // 0 -> 1, 1 -> 0
    state.lastToggleTime = performance.now();
    createParticles(state.playerX, PLAYER_Y, COLOR_PLAYER, 5); // Trail effect
    Sound.playSwitch();
}

function gameOver() {
    state.screen = 'GAMEOVER';
    state.deathTime = performance.now();
    
    if (state.score > state.bestScore) {
        state.bestScore = state.score;
        localStorage.setItem(STORAGE_KEY, state.bestScore);
    }
    
    Sound.playDeath();
    createParticles(state.playerX, PLAYER_Y, COLOR_PLAYER, 30); // Explosion
    
    // Taunts
    const taunts = [
        "Skill issue.", "Too slow.", "One more?", "Not bad...", "Almost had it.", 
        "Reflexes check failed.", "Rage quit?", "Better luck next time.", "So close!"
    ];
    tauntMsg.innerText = taunts[Math.floor(Math.random() * taunts.length)];
    
    finalScoreEl.innerText = state.score.toFixed(2);
    finalBestEl.innerText = state.bestScore.toFixed(2);
    
    setTimeout(() => {
        gameOverScreen.classList.remove('hidden');
    }, 500);
}

// --- Update ---
function update(dt) {
    if (state.screen !== 'PLAYING') return;

    // Difficulty Ramp
    state.difficultyTime += dt;
    const timeSec = state.difficultyTime;
    
    // Speed: Start 700, Max 2000
    const currentSpeed = Math.min(700 + (timeSec * 25), 2000);
    
    // Spawn Rate: Start 1.0s, Min 0.25s
    let spawnInterval = Math.max(0.25, 1.0 - (timeSec * 0.015)); 
    
    // Patterns logic overrides pure random sometimes
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
        spawnObstacle(timeSec);
        state.spawnTimer = spawnInterval;
    }

    // Player Movement
    const targetX = state.playerLane === 0 ? LANE_LEFT_X : LANE_RIGHT_X;
    // Super snappy lerp
    state.playerX += (targetX - state.playerX) * 25 * dt; 

    // Update Obstacles
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
        const obs = state.obstacles[i];
        obs.y += currentSpeed * dt;
        
        // Collision Detection
        const dy = Math.abs(obs.y - PLAYER_Y);
        const dx = Math.abs(obs.x - state.playerX);
        const pRadius = PLAYER_RADIUS * 0.7; // Forgiving hitbox
        const oRadius = OBSTACLE_SIZE / 2 * 0.8;
        
        if (dy < (pRadius + oRadius) && dx < (pRadius + oRadius)) {
            gameOver();
            return;
        }
        
        // Passing Player
        if (!obs.passed && obs.y > PLAYER_Y + PLAYER_RADIUS) {
            obs.passed = true;
            
            // Check for Active Dodge (SICK bonus)
            // If player switched lanes in the last 400ms, it's a "SICK" dodge
            const isActiveDodge = (performance.now() - state.lastToggleTime) < 400;
            
            if (isActiveDodge) {
                state.streak++;
                state.score += 5.0; // Big bonus
                spawnFloatingText("SICK", LANE_LEFT_X + (LOGICAL_WIDTH/2 - LANE_LEFT_X), PLAYER_Y - 100, '#f0f');
                Sound.playSick();
            } else {
                // Passive survival
                state.score += 1.0; 
                state.streak++;
            }
            
            // Streak visual
            if (state.streak % 10 === 0) {
                spawnFloatingText(`${state.streak}x`, state.playerX, PLAYER_Y - 50, '#0ff');
                Sound.playNearMiss();
            } 
        }
        
        // Remove off-screen
        if (obs.y > LOGICAL_HEIGHT + 100) {
            state.obstacles.splice(i, 1);
        }
    }
    
    // Update Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;
        p.life -= dt;
        if (p.life <= 0) state.particles.splice(i, 1);
    }
    
    // Update Floating Texts
    for (let i = state.texts.length - 1; i >= 0; i--) {
        const t = state.texts[i];
        t.y -= 150 * dt;
        t.life -= dt * 1.5;
        if (t.life <= 0) state.texts.splice(i, 1);
    }

    // Score based on time (10 points per second)
    state.score += dt * 10;
    
    // UI Update
    uiScore.innerText = Math.floor(state.score);
    if (state.streak > 2) {
        uiStreakBox.classList.remove('hidden');
        uiStreak.innerText = state.streak;
        uiStreak.style.transform = `scale(${1 + Math.sin(performance.now() * 0.01) * 0.1})`;
    } else {
        uiStreakBox.classList.add('hidden');
    }
}

function spawnObstacle(timeSec) {
    // Basic Logic: Random lane
    let lane = Math.random() < 0.5 ? 0 : 1;
    
    // Pattern: Double Beat (Quick succession)
    // If we just spawned, sometimes schedule another one very soon?
    // Handled by modifying spawnTimer in update loop? 
    // Simplify: just spawn one for now, maybe sometimes 2 in quick succession logic is too complex for this block.
    // Instead, rely on decreasing spawnInterval to create density.
    
    const obs = {
        x: lane === 0 ? LANE_LEFT_X : LANE_RIGHT_X,
        y: -100,
        type: Math.random() < 0.5 ? 'RECT' : 'CIRCLE',
        passed: false
    };
    
    state.obstacles.push(obs);
}

function spawnFloatingText(text, x, y, color) {
    state.texts.push({
        text, x, y, color, life: 1.0
    });
}

function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 2;
        state.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color,
            life: Math.random() * 0.5 + 0.3,
            size: Math.random() * 6 + 2
        });
    }
}

// --- Rendering ---
function draw() {
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    
    drawGrid();

    // Draw Lane Indicators
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(LANE_LEFT_X, 0); ctx.lineTo(LANE_LEFT_X, LOGICAL_HEIGHT);
    ctx.moveTo(LANE_RIGHT_X, 0); ctx.lineTo(LANE_RIGHT_X, LOGICAL_HEIGHT);
    ctx.stroke();

    // Draw Player
    ctx.shadowBlur = 25;
    ctx.shadowColor = COLOR_PLAYER;
    ctx.fillStyle = COLOR_PLAYER;
    
    const px = state.playerX;
    const py = PLAYER_Y;
    
    ctx.beginPath();
    ctx.moveTo(px, py - PLAYER_RADIUS);
    ctx.lineTo(px - PLAYER_RADIUS + 10, py + PLAYER_RADIUS);
    ctx.lineTo(px + PLAYER_RADIUS - 10, py + PLAYER_RADIUS);
    ctx.closePath();
    ctx.fill();
    
    // Draw Hit Zone Pulse
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(0, 255, 255, ${0.3 + Math.sin(performance.now() * 0.015) * 0.2})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, PLAYER_RADIUS * 1.4, 0, Math.PI * 2);
    ctx.stroke();

    // Draw Obstacles
    for (const obs of state.obstacles) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = obs.type === 'RECT' ? COLOR_OBSTACLE : COLOR_OBSTACLE_ALT;
        ctx.fillStyle = obs.type === 'RECT' ? COLOR_OBSTACLE : COLOR_OBSTACLE_ALT;
        
        if (obs.type === 'RECT') {
            ctx.fillRect(obs.x - OBSTACLE_SIZE/2, obs.y - OBSTACLE_SIZE/2, OBSTACLE_SIZE, OBSTACLE_SIZE);
        } else {
            ctx.beginPath();
            ctx.arc(obs.x, obs.y, OBSTACLE_SIZE/2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Draw Particles
    for (const p of state.particles) {
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life; 
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
    
    // Draw Floating Texts
    for (const t of state.texts) {
        ctx.shadowBlur = 10;
        ctx.shadowColor = t.color;
        ctx.fillStyle = t.color;
        ctx.globalAlpha = t.life;
        ctx.font = 'bold 60px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText(t.text, t.x, t.y);
        ctx.globalAlpha = 1.0;
    }

    ctx.shadowBlur = 0; 
}

function drawGrid() {
    const time = performance.now() * 0.001;
    const gridSpeed = 400; 
    const offsetY = (time * gridSpeed) % 150;
    
    ctx.strokeStyle = 'rgba(180, 0, 255, 0.1)'; 
    ctx.lineWidth = 2;
    
    // Horizontal Lines
    for (let y = offsetY; y < LOGICAL_HEIGHT; y += 150) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(LOGICAL_WIDTH, y);
        ctx.stroke();
    }
    
    // Vertical Lines (Perspective-ish)
    // Actually, simple vertical lines work better for this 2D style
    // ctx.beginPath();
    // ctx.moveTo(LOGICAL_WIDTH * 0.25, 0); ctx.lineTo(LOGICAL_WIDTH * 0.25, LOGICAL_HEIGHT);
    // ctx.stroke();
}

function gameLoop(timestamp) {
    const dt = (timestamp - state.lastFrameTime) / 1000;
    state.lastFrameTime = timestamp;
    
    const safeDt = Math.min(dt, 0.1);
    
    update(safeDt);
    draw();
    
    requestAnimationFrame(gameLoop);
}

// Start
init();
