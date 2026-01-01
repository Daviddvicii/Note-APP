/**
 * Neon Rage Dodge
 * A mobile-first reaction game.
 */

// Configuration
const LOGICAL_WIDTH = 720;
const LOGICAL_HEIGHT = 1280;
const LANE_LEFT_X = LOGICAL_WIDTH * 0.25;
const LANE_RIGHT_X = LOGICAL_WIDTH * 0.75;
const PLAYER_Y = LOGICAL_HEIGHT - 200;
const PLAYER_SIZE = 60;
const OBSTACLE_WIDTH = 200; // Slightly wider than player
const OBSTACLE_HEIGHT = 60;
const HITBOX_PADDING = 10; // Forgive slightly
const SPAWN_Y = -100;

// Game State
let canvas, ctx;
let lastTime = 0;
let score = 0;
let highScore = parseFloat(localStorage.getItem('neon-rage-dodge-best')) || 0;
let gameActive = false;
let gameOver = false;
let frames = 0;
let timeSurvived = 0; // in seconds
let difficultyLevel = 1;
let soundEnabled = true;

// Daily Challenge Seed
const today = new Date();
const seed = parseInt(`${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`);
// Simple seeded random for daily patterns (optional usage)
let seedState = seed;
function seededRandom() {
    seedState = (seedState * 9301 + 49297) % 233280;
    return seedState / 233280;
}

// Entities
let player = {
    lane: 0, // 0 = left, 1 = right
    x: LANE_LEFT_X,
    y: PLAYER_Y,
    targetX: LANE_LEFT_X,
    color: '#0ff',
    trail: []
};

let obstacles = [];
let particles = [];
let floatingTexts = [];

// Audio Context
let audioCtx;
const AUDIO_FREQS = {
    toggle: 440,
    bonus: 880,
    die: 150
};

// Difficulty Tuning
let spawnTimer = 0;
let nextSpawnTime = 1000;
let currentSpeed = 500; // pixels per second
let lastSwitchTime = 0; // for near-miss calc

// Pattern System
// A pattern returns the delay until the next spawn
function spawnPattern() {
    // Difficulty Ramp
    // Every 10 seconds, increase speed
    const level = Math.floor(timeSurvived / 10) + 1;
    if (level > difficultyLevel) {
        difficultyLevel = level;
        currentSpeed = Math.min(1800, 600 + (level * 80)); // Cap speed
        createFloatingText("SPEED UP!", LOGICAL_WIDTH/2, LOGICAL_HEIGHT/2);
    }

    const r = Math.random();
    // Increase pattern complexity with time
    const allowDouble = timeSurvived > 10;
    const allowFakeout = timeSurvived > 20;

    let delay = Math.max(400, 1200 - (difficultyLevel * 50)); // Base delay decreases

    if (allowFakeout && r > 0.85) {
        // Fake-out: Gap then rapid fire
        spawnEntity(Math.random() < 0.5 ? 0 : 1);
        return delay * 1.5; // Longer gap
    } 
    else if (allowDouble && r > 0.7) {
        // Double: Spawn one now, and another VERY soon in opposite lane usually
        const lane1 = Math.random() < 0.5 ? 0 : 1;
        spawnEntity(lane1);
        
        // Queue the second one strictly
        setTimeout(() => {
            if (gameActive && !gameOver) {
                // Determine safe logic: if we spawn SAME lane, it's just a stream.
                // If we spawn OPPOSITE lane, it requires quick toggle if the first one forced a move.
                // Let's just spawn random to keep it chaotic but fair (player has 400ms+)
                spawnEntity(Math.random() < 0.5 ? 0 : 1);
            }
        }, delay * 0.4); 
        
        return delay;
    } 
    else {
        // Single
        spawnEntity(Math.random() < 0.5 ? 0 : 1);
        return delay;
    }
}

function spawnEntity(lane) {
    const x = lane === 0 ? LANE_LEFT_X : LANE_RIGHT_X;
    obstacles.push({
        x: x,
        y: SPAWN_Y,
        width: OBSTACLE_WIDTH,
        height: OBSTACLE_HEIGHT,
        color: '#f0f',
        passed: false,
        lane: lane
    });
}

// DOM Elements
const scoreEl = document.getElementById('score-display');
const bestEl = document.getElementById('best-display');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreEl = document.getElementById('final-score');
const finalBestEl = document.getElementById('final-best');
const tauntEl = document.getElementById('taunt-msg');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const soundBtn = document.getElementById('sound-btn');
const dailySeedEl = document.getElementById('daily-seed-start');

// Initialization
function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d', { alpha: false }); // Optimize
    
    // Resize handler
    window.addEventListener('resize', resize);
    resize();

    // Inputs
    const handleInput = (e) => {
        if (e.type === 'keydown' && e.code !== 'Space') return;
        if (e.type === 'keydown') e.preventDefault(); // Stop scrolling
        
        if (!audioCtx && soundEnabled) initAudio(); // Resume/Start audio context on first interaction

        if (gameActive && !gameOver) {
            toggleLane();
        } else if (gameOver) {
            resetGame();
        }
    };

    window.addEventListener('pointerdown', handleInput);
    window.addEventListener('keydown', handleInput);

    startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!audioCtx && soundEnabled) initAudio();
        startGame();
    });

    restartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetGame();
    });
    
    soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        soundEnabled = !soundEnabled;
        soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
    });

    dailySeedEl.textContent = `Daily Seed: ${seed}`;
    bestEl.textContent = `BEST: ${highScore.toFixed(2)}s`;

    // Start Loop
    requestAnimationFrame(loop);
}

function resize() {
    // Fit to window while maintaining aspect ratio
    const aspect = LOGICAL_WIDTH / LOGICAL_HEIGHT;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const winAspect = winW / winH;

    let finalW, finalH;

    if (winAspect < aspect) {
        // Window is taller/thinner than game
        finalW = winW;
        finalH = winW / aspect;
    } else {
        // Window is wider than game
        finalH = winH;
        finalW = winH * aspect;
    }

    canvas.style.width = `${finalW}px`;
    canvas.style.height = `${finalH}px`;
    
    // Internal resolution
    canvas.width = LOGICAL_WIDTH;
    canvas.height = LOGICAL_HEIGHT;
}

function initAudio() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    } catch (e) {
        console.warn('Web Audio API not supported');
    }
}

function playSound(type) {
    if (!soundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'toggle') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'bonus') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    } else if (type === 'die') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.5);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
    }
}

function startGame() {
    startScreen.classList.add('hidden');
    gameActive = true;
    gameOver = false;
    score = 0;
    timeSurvived = 0;
    obstacles = [];
    particles = [];
    player.lane = 0;
    player.x = LANE_LEFT_X;
    player.targetX = LANE_LEFT_X;
    lastTime = performance.now();
    
    // Reset difficulty
    currentSpeed = 600;
    currentSpawnInterval = 1200;
    difficultyLevel = 1;
}

function resetGame() {
    gameOverScreen.classList.add('hidden');
    startGame();
}

function toggleLane() {
    player.lane = player.lane === 0 ? 1 : 0;
    player.targetX = player.lane === 0 ? LANE_LEFT_X : LANE_RIGHT_X;
    lastSwitchTime = performance.now(); // Track switch time for near-miss
    
    // Visual pop
    createParticles(player.x, player.y, 5, '#0ff');
    playSound('toggle');
}

function createParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 400,
            vy: (Math.random() - 0.5) * 400,
            life: 1.0,
            color: color
        });
    }
}

function createFloatingText(text, x, y) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.left = (canvas.getBoundingClientRect().left + (x / LOGICAL_WIDTH) * canvas.getBoundingClientRect().width) + 'px';
    // Approximate Y position in viewport
    // Better to use a simpler HTML overlay approach but for now let's just use canvas draw or stick to simple HUD
    // Actually, let's use the UI layer.
    // We need to map Canvas X/Y to Screen X/Y.
    // Simplification: Just center it or put it near the player.
    
    // Let's implement floating text in Canvas for performance and easier coordinate mapping.
    floatingTexts.push({
        text: text,
        x: x,
        y: y,
        life: 1.0,
        vy: -100
    });
}


function showGameOver() {
    gameActive = false;
    gameOver = true;
    playSound('die');
    
    if (timeSurvived > highScore) {
        highScore = timeSurvived;
        localStorage.setItem('neon-rage-dodge-best', highScore);
    }

    finalScoreEl.textContent = timeSurvived.toFixed(2) + 's';
    finalBestEl.textContent = highScore.toFixed(2) + 's';
    
    const taunts = [
        "Skill issue.",
        "One more?",
        "Close...",
        "Not bad.",
        "Reflexes?",
        "Too slow.",
        "Again!",
        "Rage quit?"
    ];
    tauntEl.textContent = taunts[Math.floor(Math.random() * taunts.length)];
    
    gameOverScreen.classList.remove('hidden');
}

function update(dt) {
    if (!gameActive) return;

    // Time
    timeSurvived += dt;
    scoreEl.textContent = timeSurvived.toFixed(2) + 's';

    // Player Move (Lerp for smoothness but fast)
    player.x += (player.targetX - player.x) * 15 * dt;

    // Spawning
    spawnTimer += dt * 1000;
    if (spawnTimer > nextSpawnTime) {
        nextSpawnTime = spawnPattern();
        spawnTimer = 0;
    }

    // Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        let obs = obstacles[i];
        obs.y += currentSpeed * dt;

        // Collision
        // Simple AABB? 
        // Player is roughly a point/circle at bottom. 
        // Let's use Rect vs Rect
        const pRect = { x: player.x - PLAYER_SIZE/2, y: player.y - PLAYER_SIZE/2, w: PLAYER_SIZE, h: PLAYER_SIZE };
        const oRect = { x: obs.x - obs.width/2, y: obs.y - obs.height/2, w: obs.width, h: obs.height };

        if (pRect.x < oRect.x + oRect.w &&
            pRect.x + pRect.w > oRect.x &&
            pRect.y < oRect.y + oRect.h &&
            pRect.y + pRect.h > oRect.y) {
            
            // Allow a small grace margin (hitbox reduction)
            const grace = 15;
            if (pRect.x + grace < oRect.x + oRect.w - grace &&
                pRect.x + pRect.w - grace > oRect.x + grace &&
                pRect.y + grace < oRect.y + oRect.h - grace &&
                pRect.y + pRect.h - grace > oRect.y + grace) {
                 
                 createParticles(player.x, player.y, 20, '#f0f');
                 showGameOver();
            }
        }

        // Passing Bonus / Near Miss
        if (!obs.passed && obs.y > player.y) {
            obs.passed = true;
            
            // Check for Close Call (switching lanes just before pass)
            // If player switched within last 300ms, it's a close call
            // OR if the obstacle is in the other lane and we are safe
            
            const timeSinceSwitch = performance.now() - lastSwitchTime;
            if (timeSinceSwitch < 400) {
                 createFloatingText("SICK!", player.x, player.y - 100);
                 playSound('bonus');
                 // Maybe add extra score?
                 timeSurvived += 0.5; // Bonus survival time
            } else {
                 // createFloatingText("+1", obs.x, obs.y); 
                 // playSound('bonus'); // Optional: too much noise?
            }
        }

        // Cleanup
        if (obs.y > LOGICAL_HEIGHT + 100) {
            obstacles.splice(i, 1);
        }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 2;
        if (p.life <= 0) particles.splice(i, 1);
    }
    
    // Floating Texts
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        let ft = floatingTexts[i];
        ft.y += ft.vy * dt;
        ft.life -= dt;
        if (ft.life <= 0) floatingTexts.splice(i, 1);
    }
}

function draw() {
    // Clear
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // Draw Grid (Cybervibe)
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    // Moving horizontal lines
    const gridOffset = (Date.now() / 2) % 100;
    for (let y = gridOffset; y < LOGICAL_HEIGHT; y += 100) {
        ctx.moveTo(0, y);
        ctx.lineTo(LOGICAL_WIDTH, y);
    }
    
    // Vertical Perspective Lines
    // Center point for perspective is roughly mid-top? 
    // Just 3 vertical lines for lanes
    ctx.moveTo(LANE_LEFT_X, 0);
    ctx.lineTo(LANE_LEFT_X, LOGICAL_HEIGHT);
    ctx.moveTo(LANE_RIGHT_X, 0);
    ctx.lineTo(LANE_RIGHT_X, LOGICAL_HEIGHT);
    ctx.moveTo(LOGICAL_WIDTH/2, 0);
    ctx.lineTo(LOGICAL_WIDTH/2, LOGICAL_HEIGHT);
    
    ctx.stroke();

    // Lanes (Subtle rails)
    ctx.strokeStyle = 'rgba(255, 0, 255, 0.2)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(LANE_LEFT_X - 100, 0);
    ctx.lineTo(LANE_LEFT_X - 100, LOGICAL_HEIGHT);
    ctx.moveTo(LANE_RIGHT_X + 100, 0);
    ctx.lineTo(LANE_RIGHT_X + 100, LOGICAL_HEIGHT);
    ctx.stroke();


    // Draw Player
    ctx.shadowBlur = 20;
    ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
    
    // Simple Ship Shape
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - PLAYER_SIZE/2);
    ctx.lineTo(player.x - PLAYER_SIZE/2, player.y + PLAYER_SIZE/2);
    ctx.lineTo(player.x + PLAYER_SIZE/2, player.y + PLAYER_SIZE/2);
    ctx.closePath();
    ctx.fill();
    
    // Reset Shadow
    ctx.shadowBlur = 0;

    // Draw Obstacles
    for (let obs of obstacles) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = obs.color;
        ctx.fillStyle = obs.color;
        ctx.fillRect(obs.x - obs.width/2, obs.y - obs.height/2, obs.width, obs.height);
        
        // Inner highlight
        ctx.fillStyle = '#fff';
        ctx.fillRect(obs.x - obs.width/2 + 5, obs.y - obs.height/2 + 5, obs.width - 10, obs.height - 10);
        ctx.shadowBlur = 0;
    }

    // Draw Particles
    for (let p of particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fillRect(p.x, p.y, 5, 5);
        ctx.globalAlpha = 1;
    }
    
    // Draw Floating Texts
    ctx.font = 'bold 40px Courier New';
    ctx.textAlign = 'center';
    for (let ft of floatingTexts) {
        ctx.fillStyle = `rgba(255, 255, 0, ${ft.life})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'orange';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.shadowBlur = 0;
    }
}

function loop(timestamp) {
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(loop);
}

// Kickoff
window.onload = init;
