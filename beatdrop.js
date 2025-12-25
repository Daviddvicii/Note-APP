
/* Neon Beat Drop Game Logic */

/**
 * Game Configuration & Constants
 */
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;
const HIT_LINE_Y = CANVAS_HEIGHT * 0.78;
const SPAWN_Y = -100;
const NOTE_TRAVEL_MS = 1400; // Time from Spawn Y to Hit Line Y
const NOTE_RADIUS = 60;
const PERFECT_WINDOW_MS = 70;
const GOOD_WINDOW_MS = 130;

const SONGS = {
    golden: {
        id: 'golden',
        displayName: 'Demon Hunter - Golden',
        bpm: 170, // Fast paced
        offsetMs: 0,
        sources: ['assets/golden.ogg', 'assets/golden.mp3']
    },
    sodapop: {
        id: 'sodapop',
        displayName: 'Soda Pop',
        bpm: 128, // Dance tempo
        offsetMs: 0,
        sources: ['assets/sodapop.ogg', 'assets/sodapop.mp3']
    }
};

/**
 * Game State
 */
const state = {
    screen: 'start', // start, running, gameover
    songId: 'golden',
    score: 0,
    combo: 0,
    best: 0,
    startTime: 0,
    audio: null,
    notes: [], // Array of note objects
    particles: [], // Visual effects
    lastBeatSpawned: -1,
    isPlaying: false,
    message: ''
};

// DOM Elements
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elBest = document.getElementById('best');
const elCombo = document.getElementById('combo');
const elOverlay = document.getElementById('overlay');
const elSongSelect = document.getElementById('song-select');
const elBtnStart = document.getElementById('btn-start');
const elMsgArea = document.getElementById('msg-area');
const elFinalScore = document.getElementById('final-score');
const elFinalBest = document.getElementById('final-best');
const elFinalMsg = document.getElementById('final-message');
const elScoreContainer = document.getElementById('score-final-container');

/**
 * Initialization
 */
function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Load saved best scores
    updateBestDisplay();

    // Event Listeners
    elSongSelect.addEventListener('change', (e) => {
        state.songId = e.target.value;
        updateBestDisplay();
    });

    elBtnStart.addEventListener('click', startGame);

    // Input handling
    // Touch/Mouse
    canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // Prevent scrolling/zoom
        handleInput();
    });
    
    // Keyboard
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && state.screen === 'running') {
            handleInput();
        }
    });

    // Start loop
    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    // The canvas has fixed internal resolution (720x1280)
    // CSS handles the display size (object-fit: contain)
    // No need to change canvas.width/height dynamically unless we wanted crisp text on high DPI,
    // but fixed resolution is better for game logic consistency here.
}

function updateBestDisplay() {
    const key = `neon-beatdrop-best:${state.songId}`;
    const saved = localStorage.getItem(key);
    state.best = saved ? parseInt(saved, 10) : 0;
    elBest.textContent = state.best;
}

/**
 * Game Control
 */
async function startGame() {
    // Reset State
    state.score = 0;
    state.combo = 0;
    state.notes = [];
    state.particles = [];
    state.lastBeatSpawned = -1;
    state.isPlaying = true;
    
    elScore.textContent = '0';
    elCombo.textContent = '0';
    elMsgArea.textContent = 'Loading audio...';
    elBtnStart.disabled = true;

    // Load Audio
    const song = SONGS[state.songId];
    if (state.audio) {
        state.audio.pause();
        state.audio = null;
    }

    state.audio = new Audio();
    // Try to load sources
    // Simple source selection: try first, if fails, it fails (browser usually handles sources via <source> tags but new Audio() takes one src)
    // Let's implement a simple fallback check or just use the first one for now as we don't have real files.
    // In a real app we might verify format support.
    state.audio.src = song.sources[0]; 
    state.audio.loop = false;

    // Audio Event Handlers
    state.audio.addEventListener('canplaythrough', onAudioReady, { once: true });
    state.audio.addEventListener('error', (e) => {
        console.error("Audio error", e);
        // Fallback or error
        if (state.audio.src.endsWith('.ogg')) {
             // Try mp3
             state.audio.src = song.sources[1];
             state.audio.load();
        } else {
            elMsgArea.textContent = "Error: Could not load audio. Ensure assets exist.";
            elBtnStart.disabled = false;
        }
    });
    state.audio.addEventListener('ended', onGameOver);
    
    state.audio.load();
}

function onAudioReady() {
    elMsgArea.textContent = '';
    elBtnStart.disabled = false;
    
    // Hide overlay
    elOverlay.classList.add('hidden');
    elScoreContainer.style.display = 'none';

    state.screen = 'running';
    state.audio.play().catch(e => {
        console.error("Play failed", e);
        elOverlay.classList.remove('hidden');
        elMsgArea.textContent = "Tap again to enable audio";
    });
}

function onGameOver() {
    state.screen = 'gameover';
    state.isPlaying = false;
    elOverlay.classList.remove('hidden');
    elScoreContainer.style.display = 'block';
    elBtnStart.textContent = "PLAY AGAIN";

    // Save Best
    if (state.score > state.best) {
        state.best = state.score;
        localStorage.setItem(`neon-beatdrop-best:${state.songId}`, state.best);
        elBest.textContent = state.best;
    }

    elFinalScore.textContent = state.score;
    elFinalBest.textContent = state.best;
    
    // Rank message
    let grade = "C";
    if (state.score > 5000) grade = "B";
    if (state.score > 10000) grade = "A";
    if (state.score > 20000) grade = "S";
    if (state.score === 0) grade = "F";
    elFinalMsg.textContent = `RANK: ${grade}`;
}

/**
 * Logic Loop
 */
function gameLoop() {
    if (state.screen === 'running') {
        update();
    }
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    const song = SONGS[state.songId];
    // Current time in ms
    const currentTimeMs = (state.audio.currentTime * 1000) - song.offsetMs;

    // Spawn Notes
    // Beat interval
    const beatInterval = 60000 / song.bpm;
    
    // Look ahead: spawn notes that will arrive at HIT_LINE_Y at future beats
    // We want to spawn a note if its spawn time has passed.
    // Note Spawn Time = Note Hit Time - NOTE_TRAVEL_MS
    // We iterate beats starting from lastBeatSpawned + 1
    
    const nextBeatIdx = state.lastBeatSpawned + 1;
    const nextBeatHitTime = nextBeatIdx * beatInterval;
    const nextBeatSpawnTime = nextBeatHitTime - NOTE_TRAVEL_MS;

    if (currentTimeMs >= nextBeatSpawnTime) {
        // Spawn note
        spawnNote(nextBeatIdx, nextBeatHitTime);
        state.lastBeatSpawned = nextBeatIdx;
    }

    // Update Notes
    // Remove notes that have gone off screen or were hit
    for (let i = state.notes.length - 1; i >= 0; i--) {
        const note = state.notes[i];
        
        if (note.hit) {
            state.notes.splice(i, 1);
            continue;
        }

        // Check for Miss
        // If note passes the "Good" window late, it's a miss
        const delta = currentTimeMs - note.hitTime;
        if (delta > GOOD_WINDOW_MS && !note.missed) {
            triggerMiss(note);
            note.missed = true; 
        }

        // Cleanup very old notes
        if (delta > 1000) {
            state.notes.splice(i, 1);
        }
    }

    // Update Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.life -= 0.02;
        p.x += p.vx;
        p.y += p.vy;
        if (p.life <= 0) {
            state.particles.splice(i, 1);
        }
    }
}

function spawnNote(beatIndex, hitTime) {
    // Pattern logic: simple 1/1 beat for now
    // Could add variety here (e.g., skip every 8th beat)
    state.notes.push({
        beatIndex,
        hitTime,
        missed: false,
        hit: false,
        lane: 0 // Center lane
    });
}

/**
 * Input & Judgement
 */
function handleInput() {
    if (state.screen !== 'running') return;

    const song = SONGS[state.songId];
    const currentTimeMs = (state.audio.currentTime * 1000) - song.offsetMs;

    // Find closest unhit, unmissed note
    let closestNote = null;
    let minDelta = Infinity;

    for (const note of state.notes) {
        if (note.hit || note.missed) continue;
        
        const delta = Math.abs(currentTimeMs - note.hitTime);
        if (delta < minDelta) {
            minDelta = delta;
            closestNote = note;
        }
    }

    // Judge
    if (closestNote) {
        if (minDelta <= PERFECT_WINDOW_MS) {
            triggerHit(closestNote, 'PERFECT');
        } else if (minDelta <= GOOD_WINDOW_MS) {
            triggerHit(closestNote, 'GOOD');
        } else {
            // Tap too early or late but within detection range? 
            // Usually rhythm games ignore taps that are way off unless they are "Bad".
            // If it's outside GOOD_WINDOW, we might ignore it to prevent accidental misfires, 
            // OR we can penalize spamming. For simplicity, we ignore unless really close.
            
            // Actually, if we tap and nothing is close, maybe reset combo? 
            // Let's just ignore "ghost taps" for a casual experience.
        }
    }
}

function triggerHit(note, judgement) {
    note.hit = true;
    
    // Score
    let points = 0;
    if (judgement === 'PERFECT') points = 100;
    else if (judgement === 'GOOD') points = 60;

    // Combo multiplier
    state.combo++;
    const multiplier = 1 + Math.floor(state.combo / 10) * 0.1;
    // Cap multiplier at 3x
    const finalMult = Math.min(3, multiplier);
    
    const addedScore = Math.floor(points * finalMult);
    state.score += addedScore;

    // Update HUD
    elScore.textContent = state.score;
    elCombo.textContent = state.combo;

    // FX
    createExplosion(CANVAS_WIDTH / 2, HIT_LINE_Y, judgement === 'PERFECT' ? '#00f3ff' : '#ff00ff');
    showFloatingText(judgement, CANVAS_WIDTH / 2, HIT_LINE_Y - 50);
}

function triggerMiss(note) {
    state.combo = 0;
    elCombo.textContent = 0;
    showFloatingText('MISS', CANVAS_WIDTH / 2, HIT_LINE_Y + 20, '#ff4444');
}

/**
 * Visuals
 */
function draw() {
    // Clear
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Background Grid effect
    drawGrid();

    // Hit Line
    ctx.beginPath();
    ctx.moveTo(0, HIT_LINE_Y);
    ctx.lineTo(CANVAS_WIDTH, HIT_LINE_Y);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#fff';
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (state.screen === 'running') {
        const song = SONGS[state.songId];
        const currentTimeMs = (state.audio.currentTime * 1000) - song.offsetMs;

        // Draw Notes
        state.notes.forEach(note => {
            if (note.hit) return; // Don't draw hit notes

            // Calculate Y
            // y = HIT_LINE_Y - ((hitTime - nowMs) / NOTE_TRAVEL_MS) * distance
            // distance = HIT_LINE_Y - SPAWN_Y
            
            const timeToHit = note.hitTime - currentTimeMs;
            const progress = 1 - (timeToHit / NOTE_TRAVEL_MS);
            
            const startY = SPAWN_Y;
            const endY = HIT_LINE_Y;
            const y = startY + (progress * (endY - startY));

            // Don't draw if way off screen
            if (y > CANVAS_HEIGHT + 100) return;

            // Determine color
            const isPerfectRange = Math.abs(timeToHit) <= PERFECT_WINDOW_MS;
            const color = isPerfectRange ? '#ffffff' : '#00f3ff';
            
            // Draw Note (Circle/Rounded Rect)
            ctx.beginPath();
            ctx.arc(CANVAS_WIDTH / 2, y, NOTE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = '#050510'; // Fill black to cover grid
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(CANVAS_WIDTH / 2, y, NOTE_RADIUS - 5, 0, Math.PI * 2);
            ctx.lineWidth = 8;
            ctx.strokeStyle = color;
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#00f3ff';
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Inner glow core
            ctx.beginPath();
            ctx.arc(CANVAS_WIDTH / 2, y, NOTE_RADIUS * 0.3, 0, Math.PI * 2);
            ctx.fillStyle = '#ff00ff';
            ctx.fill();
        });

        // Draw Particles
        state.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            
            // Text particles
            if (p.text) {
                ctx.save();
                ctx.globalAlpha = p.life;
                ctx.font = 'bold 60px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = p.color;
                ctx.shadowBlur = 10;
                ctx.shadowColor = p.color;
                ctx.fillText(p.text, p.x, p.y);
                ctx.restore();
            }
        });
    }
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(188, 19, 254, 0.2)';
    ctx.lineWidth = 2;
    
    // Vertical Perspective Lines
    const centerX = CANVAS_WIDTH / 2;
    // Only one center line for 1-lane
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, CANVAS_HEIGHT);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX - 150, 0);
    ctx.lineTo(centerX - 150, CANVAS_HEIGHT);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX + 150, 0);
    ctx.lineTo(centerX + 150, CANVAS_HEIGHT);
    ctx.stroke();

    // Horizontal moving lines could be cool, but static for now
    for (let i = 0; i < CANVAS_HEIGHT; i += 100) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(CANVAS_WIDTH, i);
        ctx.stroke();
    }
}

function createExplosion(x, y, color) {
    for (let i = 0; i < 15; i++) {
        state.particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15,
            size: Math.random() * 5 + 2,
            color: color,
            life: 1.0
        });
    }
}

function showFloatingText(text, x, y, color = '#fff') {
    state.particles.push({
        x: x,
        y: y,
        vx: 0,
        vy: -2, // Float up
        text: text,
        color: color,
        life: 1.0,
        size: 0 // Unused for text
    });
}

// Start
init();
