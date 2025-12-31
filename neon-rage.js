// Neon Rage Dodge - Game Logic

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Logical resolution (mobile portrait)
const GAME_WIDTH = 720;
const GAME_HEIGHT = 1280;

// Game State
let currentState = 'MENU'; // MENU, PLAYING, GAMEOVER
let lastTime = 0;
let score = 0;
let bestScore = localStorage.getItem('neon-rage-dodge-best') || 0;
let startTime = 0;
let streak = 0;

// Configuration
const LANES = [GAME_WIDTH * 0.25, GAME_WIDTH * 0.75]; // Center X of two lanes
const PLAYER_Y = GAME_HEIGHT - 200;
const PLAYER_SIZE = 40;
const OBSTACLE_WIDTH = 180; // Slightly wider than player
const OBSTACLE_HEIGHT = 80;

// Player
const player = {
    lane: 0, // 0 = Left, 1 = Right
    x: LANES[0],
    y: PLAYER_Y,
    width: PLAYER_SIZE,
    height: PLAYER_SIZE,
    targetX: LANES[0],
    color: '#0ff',
    trail: []
};

// Entities
let obstacles = [];
let particles = [];

// Difficulty & Spawning
let spawnTimer = 0;
let spawnInterval = 1000; // Starting spawn interval (ms)
let gameSpeed = 600; // Pixels per second
let difficultyTimer = 0;

// Audio
let audioCtx = null;
let soundEnabled = true;

// UI Elements
const scoreDisplay = document.getElementById('score-display');
const streakDisplay = document.getElementById('streak-display');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreSpan = document.getElementById('final-score');
const finalBestSpan = document.getElementById('final-best');
const startBestSpan = document.getElementById('start-best');
const tauntMsg = document.getElementById('taunt-msg');
const flashMsg = document.getElementById('flash-msg');
const soundToggle = document.getElementById('sound-toggle');

const TAUNTS = [
    "Skill issue.",
    "One more?",
    "Close...",
    "Not bad.",
    "So close!",
    "Rage quit?",
    "Too slow.",
    "Nice try.",
    "Git gud.",
    "Oof."
];

// Initialization
function init() {
    resize();
    window.addEventListener('resize', resize);
    
    // Inputs
    window.addEventListener('keydown', handleInput);
    document.getElementById('game-container').addEventListener('pointerdown', handleInput);
    
    // UI Buttons
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', startGame);
    soundToggle.addEventListener('click', toggleSound);

    startBestSpan.textContent = Math.floor(bestScore);
    
    requestAnimationFrame(gameLoop);
}

function resize() {
    // Keep logical resolution, scale via CSS is handled by container
    // But we need to set the canvas internal resolution
    canvas.width = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;
}

function toggleSound(e) {
    e.stopPropagation();
    soundEnabled = !soundEnabled;
    soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
}

function initAudio() {
    if (!audioCtx && soundEnabled) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playSound(type) {
    if (!soundEnabled || !audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'switch') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'score') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'bonus') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.15);
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } else if (type === 'death') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.4);
        gainNode.gain.setValueAtTime(0.5, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
    }
}

function handleInput(e) {
    if (e.type === 'keydown' && e.code !== 'Space') return;
    if (e.type === 'pointerdown' && e.target.closest('.btn')) return; // Ignore button clicks
    if (e.type === 'pointerdown' && e.target.id === 'sound-toggle') return;

    e.preventDefault(); // Prevent scrolling/highlighting

    if (currentState === 'MENU' || currentState === 'GAMEOVER') {
        // Start game handled by buttons, but space can trigger too if desired
        // keeping it strictly buttons for now to avoid accidental restarts
        if (currentState === 'GAMEOVER' && e.code === 'Space') {
            startGame();
        }
    } else if (currentState === 'PLAYING') {
        // Toggle Lane
        player.lane = player.lane === 0 ? 1 : 0;
        player.targetX = LANES[player.lane];
        playSound('switch');
        
        // Add particle trail
        createParticles(player.x, player.y, 5, player.color);
    }
}

function startGame() {
    initAudio();
    currentState = 'PLAYING';
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    
    // Reset Stats
    score = 0;
    streak = 0;
    startTime = Date.now();
    difficultyTimer = 0;
    
    // Reset Entities
    obstacles = [];
    particles = [];
    player.lane = 0; // Always start left? or random? Left is fine.
    player.targetX = LANES[0];
    player.x = LANES[0];
    
    // Reset Difficulty params
    gameSpeed = 700;
    spawnInterval = 1200;
    spawnTimer = 0;
    
    scoreDisplay.textContent = '0';
    streakDisplay.textContent = '0';
    
    lastTime = performance.now();
}

function gameOver() {
    currentState = 'GAMEOVER';
    playSound('death');
    
    // High Score Logic
    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('neon-rage-dodge-best', Math.floor(bestScore));
    }
    
    // Particles explosion
    createParticles(player.x, player.y, 50, '#f00');
    
    // UI Update
    finalScoreSpan.textContent = Math.floor(score);
    finalBestSpan.textContent = Math.floor(bestScore);
    tauntMsg.textContent = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
    
    gameOverScreen.classList.remove('hidden');
}

function spawnObstacle() {
    const laneIdx = Math.random() < 0.5 ? 0 : 1;
    // Simple Pattern Logic
    // 20% chance of double spawn (if speed allows)
    // 10% chance of fake out (switch lane expectation) - handled by randomness mostly
    
    const type = 'rect'; // Future: different shapes
    
    obstacles.push({
        lane: laneIdx,
        x: LANES[laneIdx],
        y: -OBSTACLE_HEIGHT,
        width: OBSTACLE_WIDTH,
        height: OBSTACLE_HEIGHT,
        color: '#f0f',
        passed: false,
        id: Math.random()
    });
}

function createParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1.0,
            color: color,
            size: Math.random() * 4 + 2
        });
    }
}

function showFlash(text) {
    flashMsg.textContent = text;
    flashMsg.classList.remove('pop-anim');
    void flashMsg.offsetWidth; // Trigger reflow
    flashMsg.classList.add('pop-anim');
}

function update(dt) {
    if (currentState !== 'PLAYING') return;

    const now = Date.now();
    const timeAlive = (now - startTime) / 1000;
    
    // Score based on time (10 pts per second)
    score += dt * 10;
    scoreDisplay.textContent = Math.floor(score);
    
    // Difficulty Ramp
    difficultyTimer += dt;
    if (difficultyTimer > 1) {
        gameSpeed += 5 * dt; // Slowly increase speed
        spawnInterval = Math.max(400, 1200 - (timeAlive * 20)); // Cap min spawn interval
    }

    // Player Movement (Lerp)
    player.x += (player.targetX - player.x) * 15 * dt;

    // Obstacle Spawning
    spawnTimer -= dt * 1000;
    if (spawnTimer <= 0) {
        spawnObstacle();
        
        // Sometimes spawn a second one quickly for patterns
        // Basic pattern logic: if survival > 15s, introduce doubles
        if (timeAlive > 15 && Math.random() < 0.3) {
             // Spawn another in 200ms
             setTimeout(() => {
                 if (currentState === 'PLAYING') spawnObstacle();
             }, 200);
        }
        
        spawnTimer = spawnInterval;
    }

    // Update Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        let obs = obstacles[i];
        obs.y += gameSpeed * dt;

        // Collision Detection
        // Simple AABB (Axis-Aligned Bounding Box) reduced slightly for fairness
        const hitMargin = 10;
        if (
            player.x < obs.x + obs.width - hitMargin &&
            player.x + player.width > obs.x + hitMargin &&
            player.y < obs.y + obs.height - hitMargin &&
            player.y + player.height > obs.y + hitMargin
        ) {
            gameOver();
            return;
        }

        // Near Miss / Passed Logic
        if (!obs.passed && obs.y > player.y + player.height) {
            obs.passed = true;
            
            // Check near miss: if obstacle was in the other lane (which it must be if we didn't hit it)
            // But we want to reward active play.
            // If the player is in the OTHER lane, it's a dodge.
            // Let's count every pass as a point, but bonus for streaks.
            
            streak++;
            streakDisplay.textContent = streak;
            
            // Bonus points for high streak
            if (streak % 10 === 0) {
                score += 100;
                showFlash("STREAK " + streak);
                playSound('bonus');
            } else if (streak > 5) {
                // Determine if it was "close" in X? No, fixed lanes.
                // Just random flavor text or based on speed?
                if (Math.random() < 0.2) {
                     showFlash("SICK");
                     playSound('bonus');
                }
            } else {
                playSound('score');
            }
        }

        // Remove off-screen
        if (obs.y > GAME_HEIGHT) {
            obstacles.splice(i, 1);
        }
    }

    // Update Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 2 * dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function draw() {
    // Clear Background
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Draw Grid/Floor lines for depth (retro sun vibe)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Vertical lanes
    ctx.moveTo(GAME_WIDTH * 0.25, 0);
    ctx.lineTo(GAME_WIDTH * 0.25, GAME_HEIGHT);
    ctx.moveTo(GAME_WIDTH * 0.75, 0);
    ctx.lineTo(GAME_WIDTH * 0.75, GAME_HEIGHT);
    ctx.moveTo(GAME_WIDTH * 0.5, 0);
    ctx.lineTo(GAME_WIDTH * 0.5, GAME_HEIGHT);
    ctx.stroke();
    ctx.restore();

    // Draw Player
    ctx.save();
    ctx.translate(player.x, player.y);
    
    // Glow
    ctx.shadowBlur = 20;
    ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
    
    // Player Shape (Triangle/Ship)
    ctx.beginPath();
    ctx.moveTo(0, -player.height/2);
    ctx.lineTo(player.width/2, player.height/2);
    ctx.lineTo(-player.width/2, player.height/2);
    ctx.closePath();
    ctx.fill();
    
    // Inner bright core
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI*2);
    ctx.fill();
    
    ctx.restore();

    // Draw Obstacles
    ctx.save();
    for (let obs of obstacles) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = obs.color;
        ctx.fillStyle = obs.color;
        // Centered drawing
        ctx.fillRect(obs.x - obs.width/2, obs.y - obs.height/2, obs.width, obs.height);
        
        // Detail lines
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 0;
        ctx.fillRect(obs.x - obs.width/2 + 5, obs.y - obs.height/2 + 5, obs.width - 10, obs.height - 10);
        ctx.fillStyle = obs.color;
        ctx.fillRect(obs.x - obs.width/2 + 10, obs.y - obs.height/2 + 10, obs.width - 20, obs.height - 20);
    }
    ctx.restore();

    // Draw Particles
    ctx.save();
    for (let p of particles) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.restore();
}

function gameLoop(timestamp) {
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(gameLoop);
}

// Start
init();
