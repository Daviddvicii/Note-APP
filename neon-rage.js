/**
 * NEON RAGE DODGE - Main Game Logic
 * Pure JS, Canvas-based, Mobile-first
 */

// --- CONFIGURATION ---
const LOGICAL_WIDTH = 720;
const LOGICAL_HEIGHT = 1280;
const LANE_LEFT_X = LOGICAL_WIDTH * 0.25;
const LANE_RIGHT_X = LOGICAL_WIDTH * 0.75;
const PLAYER_Y = LOGICAL_HEIGHT * 0.85;
const PLAYER_RADIUS = 30;
const OBSTACLE_WIDTH = 180;
const OBSTACLE_HEIGHT = 60;
const HIT_BOX_PADDING = 10; // Forgiving hit box

// Colors
const COLOR_BG = '#050011';
const COLOR_PLAYER = '#0ff'; // Cyan
const COLOR_OBSTACLE = '#f0f'; // Magenta
const COLOR_TEXT = '#fff';
const COLOR_ACCENT = '#ff0'; // Yellow

// Taunts
const TAUNTS = [
    "Skill issue.",
    "One more?",
    "Close...",
    "Not bad.",
    "Too slow.",
    "Rage quit?",
    "Nice try.",
    "Get good.",
    "Oof.",
    "Again!"
];

// --- STATE ---
const state = {
    screen: 'START', // START, PLAY, GAMEOVER
    score: 0,
    startTime: 0,
    highScore: parseInt(localStorage.getItem('neon-rage-dodge-best') || '0'),
    lane: 0, // 0 = Left, 1 = Right
    playerX: LANE_LEFT_X, // Visual position for lerping
    obstacles: [],
    particles: [],
    floaters: [], // Floating text
    streak: 0,
    spawnTimer: 0,
    difficultyTime: 0, // Time alive in seconds for difficulty ramping
    speedMultiplier: 1.0,
    bgOffset: 0,
    audioEnabled: true,
    dailySeed: 0,
    isDaily: false,
    gameOverTaunt: ""
};

// --- AUDIO SYSTEM ---
const AudioSys = {
    ctx: null,
    
    init: function() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },

    playTone: function(freq, type, duration, vol = 0.1) {
        if (!state.audioEnabled || !this.ctx) return;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },

    playSwitch: () => AudioSys.playTone(400, 'sine', 0.1, 0.1),
    playNearMiss: () => AudioSys.playTone(800, 'square', 0.15, 0.05),
    playDeath: () => {
        AudioSys.playTone(150, 'sawtooth', 0.4, 0.2);
        setTimeout(() => AudioSys.playTone(100, 'sawtooth', 0.4, 0.2), 100);
    }
};

// --- RNG FOR DAILY ---
function seededRandom(seed) {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

function getDailySeed() {
    const d = new Date();
    // Format YYYYMMDD
    return parseInt(`${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`);
}

let rngState = 0;
function random() {
    if (state.isDaily) {
        let r = seededRandom(rngState++);
        return r;
    }
    return Math.random();
}

// --- ENGINE ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for no transparency on canvas itself

// Resize handling
function resize() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const aspect = LOGICAL_WIDTH / LOGICAL_HEIGHT;
    const winAspect = winW / winH;

    let scale;
    if (winAspect < aspect) {
        // Window is taller/skinnier than game
        scale = winW / LOGICAL_WIDTH;
    } else {
        // Window is wider than game
        scale = winH / LOGICAL_HEIGHT;
    }
    
    canvas.width = LOGICAL_WIDTH;
    canvas.height = LOGICAL_HEIGHT;
    
    // Scale via CSS to fit screen
    canvas.style.width = `${LOGICAL_WIDTH * scale}px`;
    canvas.style.height = `${LOGICAL_HEIGHT * scale}px`;
}
window.addEventListener('resize', resize);
resize();

// Input handling
function handleInput(e) {
    if (e.type === 'keydown' && e.code !== 'Space') return;
    if (e.type === 'keydown') e.preventDefault(); // Stop scrolling
    
    AudioSys.init();

    if (state.screen === 'START' || state.screen === 'GAMEOVER') {
        startGame();
    } else if (state.screen === 'PLAY') {
        state.lane = state.lane === 0 ? 1 : 0;
        AudioSys.playSwitch();
        createParticles(state.playerX, PLAYER_Y, 5, COLOR_PLAYER);
    }
}
window.addEventListener('pointerdown', handleInput);
window.addEventListener('keydown', handleInput);

// Helper Classes
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        const angle = random() * Math.PI * 2;
        const speed = random() * 10 + 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1.0;
        this.decay = random() * 0.03 + 0.02;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }
    draw(ctx) {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class Floater {
    constructor(text, x, y, color = '#fff') {
        this.text = text;
        this.x = x;
        this.y = y;
        this.vy = -3;
        this.life = 1.0;
        this.color = color;
    }
    update() {
        this.y += this.vy;
        this.life -= 0.02;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.font = 'bold 40px Courier New';
        ctx.textAlign = 'center';
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;
        ctx.fillText(this.text, this.x, this.y);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
    }
}

// --- GAME LOGIC ---

function startGame() {
    state.screen = 'PLAY';
    state.score = 0;
    state.streak = 0;
    state.obstacles = [];
    state.particles = [];
    state.floaters = [];
    state.startTime = Date.now();
    state.difficultyTime = 0;
    state.spawnTimer = 0;
    state.lane = 0;
    state.playerX = LANE_LEFT_X;
    
    // Check for daily challenge
    // Note: We don't force daily mode, but if we wanted to toggle:
    // state.isDaily = true; 
    if (state.isDaily) {
        state.dailySeed = getDailySeed();
        rngState = state.dailySeed;
    }
}

function gameOver() {
    state.screen = 'GAMEOVER';
    AudioSys.playDeath();
    
    // Save High Score
    if (state.score > state.highScore) {
        state.highScore = state.score;
        localStorage.setItem('neon-rage-dodge-best', state.highScore);
    }

    state.gameOverTaunt = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
    
    // Explosion
    createParticles(state.playerX, PLAYER_Y, 30, COLOR_OBSTACLE);
}

function createParticles(x, y, count, color) {
    for(let i=0; i<count; i++) {
        state.particles.push(new Particle(x, y, color));
    }
}

function spawnObstacle() {
    // Difficulty curve
    // Base speed: 10. Max speed: 25.
    // Base spawn rate: 1.5s. Min rate: 0.4s.
    
    const difficultyFactor = Math.min(state.difficultyTime / 60, 1); // Max difficulty at 60s
    
    const speed = 10 + (15 * difficultyFactor); 
    const spawnRate = 90 - (60 * difficultyFactor); // Frames between spawns (60fps)
    
    if (state.spawnTimer <= 0) {
        // Spawn Pattern
        const patternRoll = random();
        const baseSpeed = speed * (1 + random() * 0.2); // Slight variance
        
        let type = 'SINGLE';
        if (difficultyFactor > 0.2 && patternRoll > 0.7) type = 'DOUBLE';
        if (difficultyFactor > 0.5 && patternRoll > 0.9) type = 'FAKE';

        if (type === 'SINGLE') {
            const lane = random() > 0.5 ? 0 : 1;
            state.obstacles.push({
                x: lane === 0 ? LANE_LEFT_X : LANE_RIGHT_X,
                y: -100,
                lane: lane,
                speed: baseSpeed,
                passed: false,
                width: OBSTACLE_WIDTH,
                height: OBSTACLE_HEIGHT
            });
            state.spawnTimer = spawnRate;
        } else if (type === 'DOUBLE') {
            // Spawn one then another quickly
             const lane1 = random() > 0.5 ? 0 : 1;
             state.obstacles.push({
                x: lane1 === 0 ? LANE_LEFT_X : LANE_RIGHT_X,
                y: -100,
                lane: lane1,
                speed: baseSpeed,
                passed: false,
                width: OBSTACLE_WIDTH,
                height: OBSTACLE_HEIGHT
            });
            // Queue next one closer than usual
            state.spawnTimer = 15; // very quick follow up
        } else if (type === 'FAKE') {
             // Rhythm break
             state.spawnTimer = spawnRate * 1.5; 
        } else {
             state.spawnTimer = spawnRate;
        }
    }
    state.spawnTimer--;
}

function update(dt) {
    if (state.screen !== 'PLAY') return;
    
    // Update Score (Time based)
    const now = Date.now();
    state.score = Math.floor((now - state.startTime) / 100); // 10 points per sec roughly
    state.difficultyTime = (now - state.startTime) / 1000;

    // Player Movement (Lerp)
    const targetX = state.lane === 0 ? LANE_LEFT_X : LANE_RIGHT_X;
    state.playerX += (targetX - state.playerX) * 0.3;

    // Spawning
    spawnObstacle();

    // Update Obstacles
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
        const obs = state.obstacles[i];
        obs.y += obs.speed;

        // Collision Check (AABB)
        // Player hitbox: Circle-ish
        const px = state.playerX;
        const py = PLAYER_Y;
        const ox = obs.x;
        const oy = obs.y;
        
        // Simple dist check for X, range check for Y
        const xDist = Math.abs(px - ox);
        const yDist = Math.abs(py - oy);
        
        // Hitbox sizes
        const pRadius = PLAYER_RADIUS - 5; 
        const oHalfW = obs.width / 2;
        const oHalfH = obs.height / 2;

        if (yDist < oHalfH + pRadius && xDist < oHalfW + pRadius) {
            gameOver();
        }

        // Near Miss & Scoring
        if (!obs.passed && obs.y > PLAYER_Y) {
            obs.passed = true;
            
            // Check near miss (if we are in the OTHER lane)
            // Actually, near miss is defined as: We are safe, but it was close?
            // In a 2-lane game, every dodge is technically a "miss".
            // Let's define "SICK" bonus if we switch lanes JUST before it hits.
            // But that's hard to track without history.
            // Let's just give points for passing.
            
            // Streak logic: simple pass gives streak?
            // Or near miss logic: distance check?
            // Since lanes are far apart, "Near Miss" is just dodging successfully.
            
            state.streak++;
            if (state.streak % 10 === 0) {
                state.floaters.push(new Floater(`${state.streak} STREAK!`, LOGICAL_WIDTH/2, LOGICAL_HEIGHT/2, COLOR_ACCENT));
                AudioSys.playNearMiss();
            } else if (state.streak > 5) {
                // AudioSys.playNearMiss(); // Maybe too noisy
            }
        }

        // Cleanup
        if (obs.y > LOGICAL_HEIGHT + 100) {
            state.obstacles.splice(i, 1);
        }
    }

    // Update Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        state.particles[i].update();
        if (state.particles[i].life <= 0) state.particles.splice(i, 1);
    }
    
    // Update Floaters
    for (let i = state.floaters.length - 1; i >= 0; i--) {
        state.floaters[i].update();
        if (state.floaters[i].life <= 0) state.floaters.splice(i, 1);
    }
    
    // Background animation
    state.bgOffset = (state.bgOffset + 2 + (state.difficultyTime * 0.1)) % 100;
}

// --- RENDER ---
function draw() {
    // Clear Background
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // Draw Grid
    ctx.strokeStyle = 'rgba(255, 0, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    // Vertical Lines (Lanes)
    ctx.moveTo(LANE_LEFT_X, 0); ctx.lineTo(LANE_LEFT_X, LOGICAL_HEIGHT);
    ctx.moveTo(LANE_RIGHT_X, 0); ctx.lineTo(LANE_RIGHT_X, LOGICAL_HEIGHT);
    
    // Horizontal Moving Lines
    for (let y = state.bgOffset; y < LOGICAL_HEIGHT; y += 100) {
        ctx.moveTo(0, y);
        ctx.lineTo(LOGICAL_WIDTH, y);
    }
    ctx.stroke();

    // Draw Obstacles
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLOR_OBSTACLE;
    ctx.fillStyle = COLOR_OBSTACLE;
    
    state.obstacles.forEach(obs => {
        // Draw centered rect
        ctx.fillRect(obs.x - obs.width/2, obs.y - obs.height/2, obs.width, obs.height);
        
        // Inner highlight
        ctx.fillStyle = '#fff';
        ctx.fillRect(obs.x - obs.width/2 + 5, obs.y - obs.height/2 + 5, obs.width - 10, obs.height - 10);
        ctx.fillStyle = COLOR_OBSTACLE;
    });

    // Draw Player
    ctx.shadowColor = COLOR_PLAYER;
    ctx.fillStyle = COLOR_PLAYER;
    
    ctx.beginPath();
    ctx.arc(state.playerX, PLAYER_Y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    
    // Player inner
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(state.playerX, PLAYER_Y, PLAYER_RADIUS * 0.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Draw Particles
    state.particles.forEach(p => p.draw(ctx));
    
    // Draw Floaters
    state.floaters.forEach(f => f.draw(ctx));

    // UI Overlay
    drawUI();
}

function drawUI() {
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = 'bold 40px Courier New';
    ctx.textAlign = 'left';
    
    if (state.screen === 'PLAY') {
        // HUD
        ctx.fillText(`SCORE: ${state.score}`, 40, 60);
        if (state.streak > 1) {
             ctx.textAlign = 'right';
             ctx.fillStyle = COLOR_ACCENT;
             ctx.fillText(`x${state.streak}`, LOGICAL_WIDTH - 40, 60);
        }
    } else if (state.screen === 'START') {
        // Title Screen
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        
        ctx.fillStyle = COLOR_PLAYER;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 20;
        ctx.shadowColor = COLOR_PLAYER;
        ctx.font = 'bold 80px Courier New';
        ctx.fillText("NEON RAGE", LOGICAL_WIDTH/2, LOGICAL_HEIGHT/3);
        ctx.font = 'bold 60px Courier New';
        ctx.fillText("DODGE", LOGICAL_WIDTH/2, LOGICAL_HEIGHT/3 + 80);
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = '30px Courier New';
        ctx.fillText("TAP Left/Right to Dodge", LOGICAL_WIDTH/2, LOGICAL_HEIGHT/2);
        
        ctx.fillStyle = COLOR_ACCENT;
        ctx.font = 'bold 40px Courier New';
        ctx.fillText("TAP TO START", LOGICAL_WIDTH/2, LOGICAL_HEIGHT * 0.7);
        
        // Blink effect
        if (Math.floor(Date.now() / 500) % 2 === 0) {
             ctx.fillStyle = '#fff';
             ctx.fillText("TAP TO START", LOGICAL_WIDTH/2, LOGICAL_HEIGHT * 0.7);
        }

        ctx.fillStyle = '#aaa';
        ctx.font = '24px Courier New';
        ctx.fillText(`BEST: ${state.highScore}`, LOGICAL_WIDTH/2, LOGICAL_HEIGHT - 100);

    } else if (state.screen === 'GAMEOVER') {
        // Game Over Screen
        ctx.fillStyle = 'rgba(5, 0, 17, 0.9)';
        ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f00';
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#f00';
        ctx.font = 'bold 80px Courier New';
        ctx.fillText("GAME OVER", LOGICAL_WIDTH/2, LOGICAL_HEIGHT/3);
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = '40px Courier New';
        ctx.fillText(`SCORE: ${state.score}`, LOGICAL_WIDTH/2, LOGICAL_HEIGHT/2);
        
        if (state.score >= state.highScore && state.score > 0) {
             ctx.fillStyle = COLOR_ACCENT;
             ctx.fillText("NEW HIGH SCORE!", LOGICAL_WIDTH/2, LOGICAL_HEIGHT/2 + 50);
        } else {
             ctx.fillStyle = '#aaa';
             ctx.fillText(`BEST: ${state.highScore}`, LOGICAL_WIDTH/2, LOGICAL_HEIGHT/2 + 50);
        }

        ctx.fillStyle = COLOR_OBSTACLE;
        ctx.font = 'italic 30px Courier New';
        ctx.fillText(`"${state.gameOverTaunt}"`, LOGICAL_WIDTH/2, LOGICAL_HEIGHT * 0.65);

        ctx.fillStyle = COLOR_PLAYER;
        ctx.font = 'bold 50px Courier New';
        ctx.fillText("TAP TO RETRY", LOGICAL_WIDTH/2, LOGICAL_HEIGHT * 0.8);
    }
}

// Loop
let lastTime = 0;
function loop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    update(dt);
    draw();
    
    requestAnimationFrame(loop);
}

// Start Loop
requestAnimationFrame(loop);
