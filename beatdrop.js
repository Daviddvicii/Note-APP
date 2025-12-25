// Neon Beat Drop - Game Logic

// --- Constants ---
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;
const HIT_LINE_Y = CANVAS_HEIGHT * 0.78;
const SPAWN_Y = -100;
const NOTE_TRAVEL_MS = 1400; // Time from spawn to hit line
const PERFECT_WINDOW_MS = 70; // Slightly lenient for mobile
const GOOD_WINDOW_MS = 140;
const AUTO_MISS_MS = 200; // If note passes hit line by this much, it's a miss

const SONGS = {
    golden: {
        id: 'golden',
        displayName: 'Demon Hunter - Golden',
        src: ['assets/golden.ogg', 'assets/golden.mp3'],
        bpm: 130, 
        offsetMs: 0
    },
    sodapop: {
        id: 'sodapop',
        displayName: 'Soda Pop',
        src: ['assets/sodapop.ogg', 'assets/sodapop.mp3'],
        bpm: 150,
        offsetMs: 0
    }
};

// --- State ---
const state = {
    songId: 'golden',
    status: 'start', // start, running, gameover
    score: 0,
    combo: 0,
    maxCombo: 0,
    startTimeMs: 0, // Reference for audio sync
    audioCtx: null, // For Web Audio if needed (using HTMLAudio mostly)
    audio: null,
    notes: [], // Array of { hitTime, lane (0), id, status: 'active'|'hit'|'miss' }
    particles: [], // Array of visual effects
    floatingTexts: [],
    nextBeatIndex: 0,
    isPlaying: false
};

// --- DOM Elements ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score-display');
const comboEl = document.getElementById('combo-display');
const bestEl = document.getElementById('best-display');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const songBtns = document.querySelectorAll('.song-btn');
const finalScoreEl = document.getElementById('final-score');
const finalBestEl = document.getElementById('final-best');
const resultTitle = document.getElementById('result-title');
const loadingMsg = document.getElementById('loading-msg');
const overlayStats = document.getElementById('overlay-stats');

// --- Initialization ---
function init() {
    // Canvas setup
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    // Song Selection
    songBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            selectSong(btn.dataset.id);
        });
    });

    // Start Button
    startBtn.addEventListener('click', startGame);

    // Input Handling
    // Support both mouse and touch. Prevent default on touch to avoid scrolling/zooming.
    canvas.addEventListener('touchstart', handleInput, { passive: false });
    canvas.addEventListener('mousedown', handleInput);
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && state.status === 'running') {
            handleHit();
        }
    });

    // Load initial best score
    updateBestDisplay();
    
    // Start loop
    requestAnimationFrame(gameLoop);
}

function selectSong(id) {
    if (state.status === 'running') return;
    state.songId = id;
    
    // Update UI
    songBtns.forEach(btn => {
        if (btn.dataset.id === id) btn.classList.add('selected');
        else btn.classList.remove('selected');
    });

    updateBestDisplay();
}

function updateBestDisplay() {
    const best = localStorage.getItem(`neon-beatdrop-best:${state.songId}`) || 0;
    bestEl.textContent = best;
}

// --- Audio Handling ---
async function setupAudio() {
    if (state.audio) {
        state.audio.pause();
        state.audio = null;
    }

    const song = SONGS[state.songId];
    const audio = new Audio();
    
    // Try first source
    audio.src = song.src[0];
    // Fallback logic handled by browser usually if source elements used, 
    // but here we just set src. If simple src fails, we could try the second one in onError.
    
    audio.onerror = () => {
        if (audio.src.endsWith(song.src[0].split('/').pop()) && song.src[1]) {
            console.log("Switching to fallback audio format");
            audio.src = song.src[1];
        } else {
            loadingMsg.textContent = "Error: Could not load audio file. Check assets.";
        }
    };

    state.audio = audio;
    
    // Preload
    try {
        await audio.load();
    } catch (e) {
        console.error("Audio load error", e);
    }
}

// --- Game Logic ---

async function startGame() {
    loadingMsg.textContent = "Loading...";
    
    // Prepare Audio
    await setupAudio();

    // Reset State
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.notes = [];
    state.particles = [];
    state.floatingTexts = [];
    state.nextBeatIndex = 0;
    state.status = 'running';
    
    scoreEl.textContent = '0';
    comboEl.textContent = '0';

    // Hide Overlay
    overlay.classList.add('hidden');
    overlayStats.style.display = 'none';

    // Start Audio
    try {
        await state.audio.play();
        state.startTimeMs = performance.now();
        state.isPlaying = true;
    } catch (e) {
        console.error("Play failed", e);
        loadingMsg.textContent = "Playback failed. Tap to try again.";
        state.status = 'start';
        overlay.classList.remove('hidden');
        return;
    }

    // Schedule End
    state.audio.onended = finishGame;
}

function finishGame() {
    state.status = 'gameover';
    state.isPlaying = false;
    
    // Save Best
    const currentBest = parseInt(localStorage.getItem(`neon-beatdrop-best:${state.songId}`) || '0');
    if (state.score > currentBest) {
        localStorage.setItem(`neon-beatdrop-best:${state.songId}`, state.score);
    }
    
    // Update Overlay UI
    resultTitle.textContent = "SONG COMPLETE";
    finalScoreEl.textContent = state.score;
    finalBestEl.textContent = Math.max(state.score, currentBest);
    startBtn.textContent = "Play Again";
    overlayStats.style.display = 'block';
    
    overlay.classList.remove('hidden');
    updateBestDisplay();
}

function getAudioTimeMs() {
    if (!state.audio || !state.isPlaying) return 0;
    // Use audio.currentTime for sync, smoothed if necessary.
    // Simple version:
    return (state.audio.currentTime * 1000) - SONGS[state.songId].offsetMs;
}

function spawnNotes(currentMsg) {
    const song = SONGS[state.songId];
    const beatInterval = 60000 / song.bpm;
    
    // Look ahead window for spawning (e.g. 2000ms)
    const lookAhead = 2000;
    const spawnWindowEnd = currentMsg + NOTE_TRAVEL_MS + lookAhead;

    // Determine the time of the next note to spawn
    // We start spawning from time 0
    let nextNoteTime = state.nextBeatIndex * beatInterval;

    while (nextNoteTime < spawnWindowEnd) {
        // Spawn note
        // Add variety: Skip some beats or double up?
        // Simple pattern: Every beat.
        // For variety: 
        // - if index % 8 === 0: maybe a hold (not implemented), stick to taps.
        // - simple: 100% density.
        
        state.notes.push({
            hitTime: nextNoteTime,
            status: 'active',
            id: state.nextBeatIndex
        });

        state.nextBeatIndex++;
        nextNoteTime = state.nextBeatIndex * beatInterval;
    }
}

function handleInput(e) {
    if (state.status !== 'running') return;
    if (e.type === 'touchstart') e.preventDefault(); // Prevent double firing if mouse events also bound

    handleHit();
}

function handleHit() {
    const now = getAudioTimeMs();
    
    // Find closest active note
    // Filter active notes and sort by delta
    const visibleNotes = state.notes.filter(n => n.status === 'active');
    
    let closestNote = null;
    let minDelta = Infinity;

    for (const note of visibleNotes) {
        const delta = Math.abs(now - note.hitTime);
        if (delta < minDelta) {
            minDelta = delta;
            closestNote = note;
        }
    }

    if (!closestNote) return;

    // Check windows
    if (minDelta <= PERFECT_WINDOW_MS) {
        triggerHit(closestNote, 'PERFECT', minDelta);
    } else if (minDelta <= GOOD_WINDOW_MS) {
        triggerHit(closestNote, 'GOOD', minDelta);
    } else {
        // Too early or too late but within "miss" range? 
        // Actually usually if you tap too early, you just miss hitting anything (empty tap).
        // If you tap very late, the note is probably already missed.
        // We only punish if it's kinda close but terrible?
        // For simplicity: ignore taps that aren't GOOD or PERFECT.
    }
}

function triggerHit(note, judgment, delta) {
    note.status = 'hit'; // Mark as handled

    // Score
    let points = 0;
    let comboInc = 1;
    
    if (judgment === 'PERFECT') {
        points = 100;
    } else {
        points = 60;
    }

    // Combo multiplier logic
    state.combo++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    
    const multiplier = 1 + Math.floor(state.combo / 10) * 0.1;
    // Cap multiplier
    const cappedMultiplier = Math.min(multiplier, 3.0);
    
    const finalPoints = Math.round(points * cappedMultiplier);
    state.score += finalPoints;

    // Update UI
    scoreEl.textContent = state.score;
    comboEl.textContent = state.combo;

    // Visuals
    spawnParticles(HIT_LINE_Y, judgment);
    spawnFloatingText(judgment);
}

function triggerMiss(note) {
    note.status = 'miss';
    state.combo = 0;
    comboEl.textContent = '0';
    spawnFloatingText('MISS');
}

// --- Visuals & Loop ---

function spawnParticles(y, type) {
    const count = type === 'PERFECT' ? 15 : 8;
    const color = type === 'PERFECT' ? '#00ffff' : '#ff00ff';
    
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI; // Upwards
        const speed = Math.random() * 10 + 5;
        state.particles.push({
            x: CANVAS_WIDTH / 2, // Single lane: center
            y: y,
            vx: Math.cos(angle) * speed * (Math.random() - 0.5) * 5, // Spread X
            vy: -Math.sin(angle) * speed,
            life: 1.0,
            color: color
        });
    }
}

function spawnFloatingText(text) {
    state.floatingTexts.push({
        text: text,
        x: CANVAS_WIDTH / 2,
        y: HIT_LINE_Y - 50,
        life: 1.0,
        scale: 1.0
    });
}

function update() {
    if (state.status !== 'running') return;

    const now = getAudioTimeMs();
    spawnNotes(now);

    // Update Notes
    state.notes.forEach(note => {
        if (note.status !== 'active') return;

        // Auto Miss
        if (now - note.hitTime > GOOD_WINDOW_MS + 50) { // Slight buffer
            triggerMiss(note);
        }
    });

    // Clean up old notes to save memory
    if (state.notes.length > 100) {
        state.notes = state.notes.filter(n => !(n.status !== 'active' && now - n.hitTime > 2000));
    }

    // Update Particles
    state.particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.5; // Gravity
        p.life -= 0.02;
    });
    state.particles = state.particles.filter(p => p.life > 0);

    // Update Texts
    state.floatingTexts.forEach(t => {
        t.y -= 2;
        t.life -= 0.02;
        if (t.life > 0.8) t.scale += 0.05; // Pop in
        else t.scale = Math.max(0, t.scale - 0.01);
    });
    state.floatingTexts = state.floatingTexts.filter(t => t.life > 0);
}

function draw() {
    // Clear
    ctx.fillStyle = '#0a0a12'; // Clear with bg color just in case, but usually gradient covers it? 
    // Actually we want transparent so HTML bg shows? No, canvas covers area.
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // We can rely on CSS background if we use clearRect, but let's draw some grid lines for game feel
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    
    // Vertical lanes (just center one mainly, but lets draw 3 for aesthetics)
    const centerX = CANVAS_WIDTH / 2;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, CANVAS_HEIGHT);
    ctx.stroke();

    // Hit Line
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00ffff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, HIT_LINE_Y);
    ctx.lineTo(CANVAS_WIDTH, HIT_LINE_Y);
    ctx.stroke();
    
    // Reset shadow for performance if needed, but for neon we want it
    // Draw Notes
    const now = getAudioTimeMs();
    
    state.notes.forEach(note => {
        if (note.status !== 'active') return;

        // Calculate Y
        // y = HIT_LINE_Y - ((hitTime - nowMs) / NOTE_TRAVEL_MS) * (HIT_LINE_Y - SPAWN_Y)
        const timeToHit = note.hitTime - now;
        const dist = (timeToHit / NOTE_TRAVEL_MS) * (HIT_LINE_Y - SPAWN_Y);
        const y = HIT_LINE_Y - dist;

        if (y > CANVAS_HEIGHT + 50) return; // Off screen bottom
        if (y < -150) return; // Off screen top (shouldn't happen with correct spawn logic)

        // Draw Note
        const size = 100;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ff00ff';
        ctx.fillStyle = '#ffffff';
        
        ctx.beginPath();
        ctx.arc(centerX, y, 40, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner color
        ctx.fillStyle = '#ff00ff';
        ctx.beginPath();
        ctx.arc(centerX, y, 30, 0, Math.PI * 2);
        ctx.fill();
    });

    // Particles
    state.particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Floating Text
    state.floatingTexts.forEach(t => {
        ctx.globalAlpha = t.life;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.scale(t.scale, t.scale);
        
        ctx.font = "bold 60px 'Courier New'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        if (t.text === 'PERFECT') ctx.fillStyle = '#00ffff';
        else if (t.text === 'GOOD') ctx.fillStyle = '#00ff00';
        else ctx.fillStyle = '#ff0000';
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.fillStyle;
        
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
    });
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// Start Init
init();
