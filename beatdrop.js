/**
 * NEON BEAT DROP
 * A rhythm game logic implementation.
 */

// --- CONFIGURATION & CONSTANTS ---

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;

// Visual layout
const HIT_LINE_Y = CANVAS_HEIGHT * 0.78;
const SPAWN_Y = -100;
const NOTE_RADIUS = 50;
const HIT_LINE_HEIGHT = 10;

// Gameplay Timing
const NOTE_TRAVEL_MS = 1400; // Time from spawn to hit line
const PERFECT_WINDOW_MS = 70;
const GOOD_WINDOW_MS = 140;

// Scoring
const SCORE_PERFECT = 100;
const SCORE_GOOD = 60;

// Songs Database
// Note: We use relative paths for assets. 
// Fallback logic for extensions (ogg -> mp3) will be handled in audio loading.
const SONGS = {
    golden: {
        id: 'golden',
        displayName: 'Demon Hunter - Golden',
        bpm: 170, 
        offsetMs: 100, // Adjust to sync audio start with beat
        src: 'assets/golden.ogg',
        backupSrc: 'assets/golden.mp3',
        patternType: 'stream' // fast consistent beats
    },
    sodapop: {
        id: 'sodapop',
        displayName: 'Soda Pop',
        bpm: 128,
        offsetMs: 50,
        src: 'assets/sodapop.ogg',
        backupSrc: 'assets/sodapop.mp3',
        patternType: 'pop' // on-beat with some breaks
    }
};

// --- STATE MANAGEMENT ---

const state = {
    screen: 'start', // start, running, gameover
    songId: 'golden',
    score: 0,
    combo: 0,
    maxCombo: 0,
    notes: [], // { hitTime, hit: bool, missed: bool }
    particles: [], // { x, y, vx, vy, life, color }
    floatTexts: [], // { x, y, text, life, color }
    audioStartTime: 0,
    isPlaying: false,
    
    // Performance metrics
    lastFrameTime: 0
};

// --- DOM ELEMENTS ---

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false }); // Optimize
const elScore = document.getElementById('score-disp');
const elCombo = document.getElementById('combo-disp');
const elBest = document.getElementById('best-disp');
const elOverlay = document.getElementById('overlay');
const elStartBtn = document.getElementById('start-btn');
const elMsg = document.getElementById('msg-area');
const elFinalScore = document.getElementById('final-score');
const elFinalBest = document.getElementById('final-best');
const elFinalCombo = document.getElementById('final-combo');
const elGameOverStats = document.getElementById('game-over-stats');
const btnSongGolden = document.querySelector('button[data-id="golden"]');
const btnSongSoda = document.querySelector('button[data-id="sodapop"]');

const audio = new Audio();

// --- INITIALIZATION ---

function init() {
    // Setup Canvas High DPI (optional, but keep it simple for perf first)
    // We rely on CSS scaling. Internal resolution is fixed.

    // Load saved best score
    updateBestDisplay();

    // Event Listeners
    btnSongGolden.addEventListener('click', () => selectSong('golden'));
    btnSongSoda.addEventListener('click', () => selectSong('sodapop'));
    elStartBtn.addEventListener('click', attemptStartGame);

    // Input handlers (Tap anywhere)
    const triggerHit = (e) => {
        if (state.screen === 'running') {
            e.preventDefault(); // prevent zoom/scroll
            handleInput();
        }
    };
    
    // Support both mouse and touch
    document.addEventListener('pointerdown', (e) => {
        // Only trigger if inside game area or if it's a key
        if (e.target.tagName !== 'BUTTON') {
             triggerHit(e);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.key === ' ') {
            if (state.screen === 'running') {
                handleInput();
            }
        }
    });

    // Audio events
    audio.addEventListener('ended', onSongEnd);
    audio.addEventListener('error', (e) => {
        console.error("Audio error:", e);
        if (state.screen === 'running') {
            // Try fallback if not already tried? Or just show error
            elMsg.innerText = "Error loading audio. Check assets.";
        }
    });

    // Loop
    requestAnimationFrame(loop);
}

function selectSong(id) {
    state.songId = id;
    
    // UI Update
    btnSongGolden.classList.toggle('selected', id === 'golden');
    btnSongSoda.classList.toggle('selected', id === 'sodapop');
    
    updateBestDisplay();
}

function updateBestDisplay() {
    const key = `neon-beatdrop-best:${state.songId}`;
    const saved = localStorage.getItem(key) || 0;
    elBest.innerText = saved;
}

// --- GAME LOGIC ---

async function attemptStartGame() {
    const song = SONGS[state.songId];
    
    elMsg.innerText = "Loading audio...";
    elStartBtn.disabled = true;

    // Reset State
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.notes = [];
    state.particles = [];
    state.floatTexts = [];
    updateHud();

    try {
        // Try loading primary, then backup
        audio.src = song.src;
        // We wait for metadata to ensure it's playable
        await new Promise((resolve, reject) => {
            const onCanPlay = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                // Try backup
                if (audio.src.includes(song.src) && song.backupSrc) {
                     audio.src = song.backupSrc;
                     // Logic continues... simpler to just fail for this demo if both fail
                     // But let's assume one works or the browser handles it
                }
                cleanup();
                // Reject only if we really can't play
                // For this demo, we'll try to proceed or just let the audio element handle it
                resolve(); 
            };
            const cleanup = () => {
                audio.removeEventListener('canplaythrough', onCanPlay);
                audio.removeEventListener('error', onError);
            };
            audio.addEventListener('canplaythrough', onCanPlay);
            audio.addEventListener('error', onError);
            audio.load();
        });

        // Generate Notes Map
        generateNotes(song);

        // Start
        audio.play().then(() => {
            state.screen = 'running';
            state.isPlaying = true;
            // High precision start time
            // We use audio.currentTime to sync, but we need an offset baseline
            state.audioStartTime = performance.now(); 
            
            elOverlay.classList.add('hidden');
            elStartBtn.disabled = false;
            elMsg.innerText = "Headphones Recommended";
        }).catch(err => {
            console.error("Play failed", err);
            elMsg.innerText = "Tap failed to start audio. Try again.";
            elStartBtn.disabled = false;
        });

    } catch (e) {
        console.error(e);
        elMsg.innerText = "Could not load song.";
        elStartBtn.disabled = false;
    }
}

function generateNotes(song) {
    state.notes = [];
    
    // Simple beat generation based on BPM
    // duration is not always available immediately if streamed, 
    // but usually is after 'canplaythrough'
    let duration = audio.duration || 180; // fallback 3 mins
    if (!isFinite(duration)) duration = 180;

    const msPerBeat = 60000 / song.bpm;
    
    // Start spawning after a brief intro delay (e.g. 2 seconds)
    const startOffset = 2000; 
    let currentTime = startOffset;
    
    // Pattern generation
    let beatCount = 0;
    
    while (currentTime < duration * 1000) {
        // Add note
        // Logic to create interesting patterns
        let shouldSpawn = true;
        
        if (song.patternType === 'pop') {
            // Skip every 4th beat for 'pop' feel
            if (beatCount % 4 === 3) shouldSpawn = false;
        } else if (song.patternType === 'stream') {
            // Stream is continuous
        }

        if (shouldSpawn) {
            state.notes.push({
                hitTime: currentTime + song.offsetMs,
                hit: false,
                missed: false
            });
        }

        currentTime += msPerBeat;
        beatCount++;
    }
}

function handleInput() {
    const nowMs = getSongTimeMs();
    
    // Find closest unhit, not-missed note
    // Sort by proximity? Notes are already sorted by time.
    // We just look at the first few.
    
    // Filter candidates within window
    // We iterate to find the best candidate
    let bestNote = null;
    let minDelta = Infinity;

    for (let note of state.notes) {
        if (note.hit || note.missed) continue;
        
        const delta = note.hitTime - nowMs; // + means note is in future, - means passed
        
        // If note is too far in future (waiting to fall), we can stop checking subsequent ones
        if (delta > GOOD_WINDOW_MS) break; 
        
        // If note is way past (should have been missed by update loop, but just in case)
        if (delta < -GOOD_WINDOW_MS) continue;

        const absDelta = Math.abs(delta);
        if (absDelta < minDelta) {
            minDelta = absDelta;
            bestNote = note;
        }
    }

    if (bestNote) {
        // Judge it
        if (minDelta <= PERFECT_WINDOW_MS) {
            scoreHit(bestNote, 'PERFECT');
        } else if (minDelta <= GOOD_WINDOW_MS) {
            scoreHit(bestNote, 'GOOD');
        } else {
            // Tapped too early or too late but within "hittable" range?
            // Usually rhythm games don't punish tapping unless it's a specific mechanic (ghost tapping)
            // We'll treat it as a miss if it's a "bad" hit, OR just ignore it to be lenient
            // Let's ignore "almost" hits to prevent frustration, 
            // but if they spam, they won't hit anything because closest note is taken
            scoreHit(bestNote, 'MISS');
        }
    } else {
        // Ghost tap (tapped when no note is near)
        // Optional: Reset combo? keeping it simple: do nothing.
    }
}

function scoreHit(note, judgement) {
    if (judgement === 'MISS') {
        note.missed = true;
        comboBreak();
        createFloatText("MISS", HIT_LINE_Y, '#ff0000');
    } else {
        note.hit = true;
        
        let points = 0;
        let text = "";
        let color = "";
        
        if (judgement === 'PERFECT') {
            points = SCORE_PERFECT;
            text = "PERFECT";
            color = '#00f3ff'; // cyan
            createParticleBurst(CANVAS_WIDTH/2, HIT_LINE_Y, color);
        } else {
            points = SCORE_GOOD;
            text = "GOOD";
            color = '#00ff00'; // green
            createParticleBurst(CANVAS_WIDTH/2, HIT_LINE_Y, color); // smaller burst?
        }
        
        // Combo Multiplier
        state.combo++;
        if (state.combo > state.maxCombo) state.maxCombo = state.combo;
        
        const multiplier = 1 + Math.floor(state.combo / 10) * 0.1;
        state.score += Math.floor(points * Math.min(multiplier, 3.0)); // Cap multiplier at 3x
        
        createFloatText(text, HIT_LINE_Y - 50, color);
    }
    
    updateHud();
}

function comboBreak() {
    state.combo = 0;
    updateHud();
}

function updateHud() {
    elScore.innerText = state.score;
    elCombo.innerText = state.combo;
}

function onSongEnd() {
    state.isPlaying = false;
    state.screen = 'gameover';
    
    // Save Best
    const key = `neon-beatdrop-best:${state.songId}`;
    const currentBest = parseInt(localStorage.getItem(key) || '0');
    if (state.score > currentBest) {
        localStorage.setItem(key, state.score);
        elFinalBest.innerText = state.score + " (NEW!)";
    } else {
        elFinalBest.innerText = currentBest;
    }
    
    elFinalScore.innerText = state.score;
    elFinalCombo.innerText = state.maxCombo;
    
    elGameOverStats.style.display = 'block';
    elOverlay.classList.remove('hidden');
    elStartBtn.innerText = "PLAY AGAIN";
    elMsg.innerText = "";
}

function getSongTimeMs() {
    if (!state.isPlaying) return 0;
    // Use audio.currentTime for sync
    // currentTime is in seconds
    return audio.currentTime * 1000;
}

// --- VISUALS & LOOP ---

function createParticleBurst(x, y, color) {
    for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 10 + 5;
        state.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            color: color
        });
    }
}

function createFloatText(text, y, color) {
    state.floatTexts.push({
        x: CANVAS_WIDTH / 2,
        y: y,
        text: text,
        life: 1.0,
        color: color
    });
}

function update(dt) {
    if (state.screen !== 'running') return;
    
    const nowMs = getSongTimeMs();

    // Check for missed notes
    state.notes.forEach(note => {
        if (!note.hit && !note.missed) {
            // If note passed hit line by good window
            if (nowMs > note.hitTime + GOOD_WINDOW_MS) {
                note.missed = true;
                comboBreak();
                createFloatText("MISS", HIT_LINE_Y, '#666');
            }
        }
    });

    // Update Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05; // fade out
        if (p.life <= 0) state.particles.splice(i, 1);
    }

    // Update Text
    for (let i = state.floatTexts.length - 1; i >= 0; i--) {
        const t = state.floatTexts[i];
        t.y -= 2; // float up
        t.life -= 0.02;
        if (t.life <= 0) state.floatTexts.splice(i, 1);
    }
}

function draw() {
    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Background Grid effect
    drawGrid();

    // Hit Line
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00f3ff';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, HIT_LINE_Y - HIT_LINE_HEIGHT/2, CANVAS_WIDTH, HIT_LINE_HEIGHT);
    
    // Draw Notes
    if (state.screen === 'running') {
        const nowMs = getSongTimeMs();
        
        ctx.shadowBlur = 15;
        
        state.notes.forEach(note => {
            if (note.hit || note.missed) return;
            
            // Calculate Y
            // Linear interpolation based on time
            // Start: hitTime - NOTE_TRAVEL_MS
            // End: hitTime
            // Progress = (nowMs - (hitTime - NOTE_TRAVEL_MS)) / NOTE_TRAVEL_MS
            
            const timeToHit = note.hitTime - nowMs;
            
            // Optimization: Don't draw if off screen
            if (timeToHit > NOTE_TRAVEL_MS + 500) return; // Not yet spawned (with buffer)
            if (timeToHit < -200) return; // Passed

            // y = HIT_LINE_Y - (timeToHit / NOTE_TRAVEL_MS) * (HIT_LINE_Y - SPAWN_Y)
            // If timeToHit is positive (future), y is less than HIT_LINE_Y (higher up)
            
            const dist = HIT_LINE_Y - SPAWN_Y;
            const y = HIT_LINE_Y - (timeToHit / NOTE_TRAVEL_MS) * dist;

            // Draw Note
            ctx.fillStyle = '#ff00ff'; // Pink notes
            ctx.shadowColor = '#ff00ff';
            
            // Circle/Rounded Rect
            ctx.beginPath();
            ctx.arc(CANVAS_WIDTH/2, y, NOTE_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            
            // Inner white core
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(CANVAS_WIDTH/2, y, NOTE_RADIUS * 0.4, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Draw Particles
    state.particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    });

    // Draw Floating Text
    state.floatTexts.forEach(t => {
        ctx.globalAlpha = t.life;
        ctx.fillStyle = t.color;
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 10;
        ctx.font = "bold 60px Courier New";
        ctx.textAlign = "center";
        ctx.fillText(t.text, t.x, t.y);
        ctx.globalAlpha = 1.0;
    });
    
    ctx.shadowBlur = 0;
}

function drawGrid() {
    // Simple prospective grid or just vertical lines
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.1)';
    ctx.lineWidth = 2;
    
    // Vertical lines
    const lanes = 5;
    const gap = CANVAS_WIDTH / lanes;
    for (let i = 1; i < lanes; i++) {
        ctx.beginPath();
        ctx.moveTo(i * gap, 0);
        ctx.lineTo(i * gap, CANVAS_HEIGHT);
        ctx.stroke();
    }
    
    // Moving horizontal lines?
    // Based on time
    const now = performance.now();
    const speed = 0.2;
    const offset = (now * speed) % 100;
    
    for (let y = offset; y < CANVAS_HEIGHT; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
    }
}

function loop() {
    const now = performance.now();
    // const dt = now - state.lastFrameTime; // unused for now, basic updates
    state.lastFrameTime = now;

    update();
    draw();
    
    requestAnimationFrame(loop);
}

// Start
init();
