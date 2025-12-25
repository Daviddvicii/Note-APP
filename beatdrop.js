// Configuration & Constants
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;
const HIT_LINE_Y = CANVAS_HEIGHT * 0.78;
const SPAWN_Y = -100;
const NOTE_TRAVEL_MS = 1400; // Time from spawn to hit line
const PERFECT_WINDOW_MS = 60;
const GOOD_WINDOW_MS = 120;
const HOLD_DURATION = 0; // Simple taps only for now

// Song Metadata
const SONGS = {
    golden: {
        id: 'golden',
        displayName: 'Demon Hunter - Golden',
        sources: ['assets/golden.ogg', 'assets/golden.mp3'],
        bpm: 170, // Fast rock
        offsetMs: 100, // Adjust based on audio start silence
        difficulty: 1 // Modifier for spawn density
    },
    sodapop: {
        id: 'sodapop',
        displayName: 'Soda Pop',
        sources: ['assets/sodapop.ogg', 'assets/sodapop.mp3'],
        bpm: 128, // Pop/Dance
        offsetMs: 50,
        difficulty: 0.8
    }
};

// Game State
const state = {
    screen: 'start', // start, running, gameover
    songId: 'golden',
    score: 0,
    combo: 0,
    maxCombo: 0,
    bestScore: 0,
    startTime: 0, // Audio start time (performance.now)
    audio: null,
    notes: [], // Array of active notes
    particles: [], // Visual effects
    floatingTexts: [], // Judgement labels
    nextBeatIndex: 0, // Track which beat we are spawning for
    isPlaying: false,
    audioDuration: 0,
    finalGrade: 'F'
};

// DOM Elements
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const hudScore = document.getElementById('score-display');
const hudCombo = document.getElementById('combo-display');
const songBtns = document.querySelectorAll('.song-btn');
const startBtn = document.getElementById('start-btn');
const msgArea = document.getElementById('msg-area');

// Game Over Elements
const gameOverStats = document.getElementById('game-over-stats');
const finalScoreEl = document.getElementById('final-score');
const finalBestEl = document.getElementById('final-best');
const finalComboEl = document.getElementById('final-combo');
const finalGradeEl = document.getElementById('final-grade');
const selectLabel = document.getElementById('select-label');
const songSelect = document.getElementById('song-select');
const overlayTitle = document.getElementById('overlay-title');

// Initialize
function init() {
    // Canvas scaling
    resize();
    window.addEventListener('resize', resize);

    // Event Listeners
    songBtns.forEach(btn => {
        btn.addEventListener('click', (e) => selectSong(e.target.dataset.song));
    });

    startBtn.addEventListener('click', startGame);

    // Input
    const interactHandler = (e) => {
        if (state.screen === 'running') {
            e.preventDefault(); // Prevent zoom/scroll
            handleInput();
        }
    };
    
    // Support mouse and touch
    canvas.addEventListener('mousedown', interactHandler);
    canvas.addEventListener('touchstart', interactHandler, { passive: false });
    
    // Keyboard support
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && state.screen === 'running') {
            handleInput();
        }
    });

    // Load best score for default song
    loadBestScore();
}

function resize() {
    // Keep internal resolution but scale via CSS is handled. 
    // We don't need to change canvas.width/height unless we want to change resolution.
    // The CSS aspect-ratio handles the visual size.
}

function selectSong(id) {
    if (state.screen === 'running') return;
    state.songId = id;
    
    // UI Update
    songBtns.forEach(btn => {
        if (btn.dataset.song === id) btn.classList.add('selected');
        else btn.classList.remove('selected');
    });

    loadBestScore();
}

function loadBestScore() {
    const key = `neon-beatdrop-best:${state.songId}`;
    state.bestScore = parseInt(localStorage.getItem(key)) || 0;
}

function saveBestScore() {
    if (state.score > state.bestScore) {
        state.bestScore = state.score;
        localStorage.setItem(`neon-beatdrop-best:${state.songId}`, state.bestScore);
    }
}

// Audio Handling
function setupAudio() {
    if (state.audio) {
        state.audio.pause();
        state.audio = null;
    }

    const song = SONGS[state.songId];
    const audio = new Audio();
    
    // Try sources
    const src1 = document.createElement('source');
    src1.src = song.sources[0];
    src1.type = 'audio/ogg';
    
    const src2 = document.createElement('source');
    src2.src = song.sources[1];
    src2.type = 'audio/mpeg';

    audio.appendChild(src1);
    audio.appendChild(src2);

    audio.addEventListener('ended', endGame);
    audio.addEventListener('error', () => {
        msgArea.textContent = "Error loading audio. Check assets.";
        console.error("Audio load error");
        // End game gracefully after a delay if audio fails
        setTimeout(endGame, 2000);
    });

    return audio;
}

// Game Logic
function startGame() {
    state.audio = setupAudio();
    
    msgArea.textContent = "Loading...";
    startBtn.disabled = true;

    // Wait for canplaythrough or just play
    state.audio.play().then(() => {
        msgArea.textContent = "";
        startBtn.disabled = false;
        
        // Reset State
        state.score = 0;
        state.combo = 0;
        state.maxCombo = 0;
        state.notes = [];
        state.particles = [];
        state.floatingTexts = [];
        state.nextBeatIndex = 0;
        state.screen = 'running';
        state.isPlaying = true;
        
        // Sync time
        state.startTime = performance.now();
        state.audioDuration = state.audio.duration;

        // Hide overlay
        overlay.classList.add('hidden');
        
        // Start loop
        requestAnimationFrame(gameLoop);

    }).catch(e => {
        console.error(e);
        msgArea.textContent = "Tap again to start (Browser blocked autoplay?)";
        startBtn.disabled = false;
    });
}

function endGame() {
    state.isPlaying = false;
    state.screen = 'gameover';
    
    if (state.audio) {
        state.audio.pause();
    }

    saveBestScore();

    // Calculate Grade
    const song = SONGS[state.songId];
    // Simple grade logic based on score vs potential roughly
    // Or just S/A/B/C based on score threshold
    let grade = 'C';
    if (state.score > 5000) grade = 'B';
    if (state.score > 10000) grade = 'A';
    if (state.score > 20000) grade = 'S';
    // Better: based on misses? But simpler is fine.
    
    finalGradeEl.textContent = grade;
    finalGradeEl.style.color = grade === 'S' ? 'var(--neon-pink)' : 
                               grade === 'A' ? 'var(--neon-green)' : 
                               grade === 'B' ? 'var(--neon-blue)' : '#fff';

    finalScoreEl.textContent = state.score;
    finalBestEl.textContent = state.bestScore;
    finalComboEl.textContent = state.maxCombo;

    // Show Overlay adjusted for Game Over
    overlayTitle.textContent = "Level Complete";
    startBtn.textContent = "Play Again";
    gameOverStats.style.display = 'flex';
    selectLabel.style.display = 'block'; // Keep song select available
    songSelect.style.display = 'flex';
    
    overlay.classList.remove('hidden');
}

function gameLoop(time) {
    if (!state.isPlaying) return;

    update(time);
    draw();

    requestAnimationFrame(gameLoop);
}

function update(time) {
    const song = SONGS[state.songId];
    // Current song time in ms
    // We rely on audio.currentTime to prevent drift, but smooth it if needed.
    // However, direct usage is requested.
    let nowMs = (state.audio.currentTime * 1000) - song.offsetMs;

    // Safety check for end of song if event didn't fire
    if (state.audio.ended) {
        endGame();
        return;
    }

    // Spawning Logic
    const beatInterval = 60000 / song.bpm;
    
    // Look ahead to spawn notes that will arrive at hit line later
    // We want to spawn a note if its hitTime is within range
    // Actually, we can just iterate beats.
    // Next beat time:
    const nextBeatTime = state.nextBeatIndex * beatInterval;
    
    // If the next beat needs to be spawned (i.e. it needs to appear at SPAWN_Y now-ish)
    // A note spawned now (nowMs) arrives at HIT_LINE_Y at nowMs + NOTE_TRAVEL_MS.
    // So if we want it to arrive at `nextBeatTime`, we must spawn it at `nextBeatTime - NOTE_TRAVEL_MS`.
    // Wait, "Spawn notes on beats" implies the HIT time is on the beat.
    
    // We spawn if: nowMs >= nextBeatTime - NOTE_TRAVEL_MS
    // And we check a bit into the future to ensure we don't miss any frame gaps
    
    while (nowMs >= nextBeatTime - NOTE_TRAVEL_MS) {
        // Spawn this beat
        // Simple pattern: Every beat for now
        // Optional: skip every 4th beat for rhythm variety
        if (state.nextBeatIndex % 8 !== 7) { 
            spawnNote(nextBeatTime);
        }
        
        state.nextBeatIndex++;
        // Recalculate for while loop
        // (variable shadowing warning: use new var or just re-eval expression in loop condition)
        if ((state.nextBeatIndex * beatInterval) - NOTE_TRAVEL_MS > nowMs) break;
    }

    // Update Notes
    for (let i = state.notes.length - 1; i >= 0; i--) {
        const note = state.notes[i];
        
        // Check for Miss (passed too far)
        // Hit line is Y, if (nowMs - note.hitTime) > GOOD_WINDOW_MS
        if (!note.isHit && (nowMs - note.hitTime > GOOD_WINDOW_MS)) {
            triggerMiss(note);
            state.notes.splice(i, 1);
            continue;
        }

        // Clean up already hit notes (visual linger if needed, else remove)
        if (note.isHit) {
            // we might keep them for a frame to show explosion? 
            // handled by particles instead.
            state.notes.splice(i, 1);
            continue;
        }
    }

    // Update Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.life -= 0.05; // Fade out
        p.x += p.vx;
        p.y += p.vy;
        if (p.life <= 0) state.particles.splice(i, 1);
    }

    // Update Floating Texts
    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
        const t = state.floatingTexts[i];
        t.life -= 0.02;
        t.y -= 1; // Float up
        if (t.life <= 0) state.floatingTexts.splice(i, 1);
    }
}

function spawnNote(hitTime) {
    state.notes.push({
        hitTime: hitTime,
        isHit: false,
        // Could add type/lane here
    });
}

function handleInput() {
    const song = SONGS[state.songId];
    const nowMs = (state.audio.currentTime * 1000) - song.offsetMs;
    
    // Find closest unhit note
    let closestNote = null;
    let minDiff = Infinity;

    for (const note of state.notes) {
        if (note.isHit) continue;
        const diff = Math.abs(nowMs - note.hitTime);
        if (diff < minDiff) {
            minDiff = diff;
            closestNote = note;
        }
    }

    // Judgement
    if (closestNote) {
        if (minDiff <= PERFECT_WINDOW_MS) {
            triggerHit(closestNote, 'PERFECT');
        } else if (minDiff <= GOOD_WINDOW_MS) {
            triggerHit(closestNote, 'GOOD');
        } else {
            // Tapped, but nothing close enough valid.
            // Could count as a 'BAD' or just ignore to be forgiving.
            // Usually simpler rhythm games ignore stray taps unless they are very close to a "ghost" miss.
            // Let's ignore for now to avoid frustration on touch.
        }
    }
}

function triggerHit(note, judgement) {
    note.isHit = true;
    
    // Score
    const baseScore = judgement === 'PERFECT' ? 100 : 60;
    const multiplier = 1 + Math.min(Math.floor(state.combo / 10) * 0.1, 2.0); // Cap at 3x
    const scoreAdd = Math.floor(baseScore * multiplier);
    
    state.score += scoreAdd;
    state.combo++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;

    // Visuals
    spawnFloatingText(judgement, judgement === 'PERFECT' ? '#ff00ff' : '#00f3ff');
    spawnExplosion(CANVAS_WIDTH/2, HIT_LINE_Y, judgement === 'PERFECT' ? 20 : 10);

    // Update HUD
    hudScore.innerText = state.score;
    hudCombo.innerText = state.combo;
}

function triggerMiss(note) {
    state.combo = 0;
    hudCombo.innerText = state.combo;
    spawnFloatingText("MISS", "#ff4444");
}

function spawnFloatingText(text, color) {
    state.floatingTexts.push({
        text: text,
        x: CANVAS_WIDTH / 2,
        y: HIT_LINE_Y - 50,
        color: color,
        life: 1.0
    });
}

function spawnExplosion(x, y, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 10 + 5;
        state.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: `hsl(${Math.random()*60 + 180}, 100%, 70%)`, // Cyan/Blueish
            life: 1.0,
            size: Math.random() * 5 + 2
        });
    }
}

// Rendering
function draw() {
    // Clear
    ctx.fillStyle = '#000000'; // Or transparent if background handled by CSS? 
    // Best to clear to avoid trails
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Grid (Perspective style - optional, but helps depth)
    drawGrid();

    // Draw Hit Line
    ctx.beginPath();
    ctx.moveTo(0, HIT_LINE_Y);
    ctx.lineTo(CANVAS_WIDTH, HIT_LINE_Y);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#fff';
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset

    // Hit Line Glow Area
    ctx.fillStyle = 'rgba(0, 243, 255, 0.1)';
    ctx.fillRect(0, HIT_LINE_Y - 10, CANVAS_WIDTH, 20);

    // Calc nowMs for position
    const song = SONGS[state.songId];
    const nowMs = (state.audio.currentTime * 1000) - song.offsetMs;

    // Draw Notes
    state.notes.forEach(note => {
        // Calculate Y
        // y = HIT_LINE_Y - ((hitTime - nowMs) / NOTE_TRAVEL_MS) * (HIT_LINE_Y - SPAWN_Y)
        const timeToHit = note.hitTime - nowMs;
        const distRatio = timeToHit / NOTE_TRAVEL_MS;
        const y = HIT_LINE_Y - (distRatio * (HIT_LINE_Y - SPAWN_Y));

        // Don't draw if off screen (too high)
        if (y < SPAWN_Y) return;

        // Draw Note
        drawNote(CANVAS_WIDTH/2, y);
    });

    // Draw Particles
    state.particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    });

    // Draw Floating Text
    state.floatingTexts.forEach(t => {
        ctx.globalAlpha = t.life;
        ctx.font = "bold 60px 'Segoe UI'";
        ctx.textAlign = "center";
        ctx.fillStyle = t.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = t.color;
        ctx.fillText(t.text, t.x, t.y);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
    });
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.2)';
    ctx.lineWidth = 2;
    
    // Vertical lines
    const mid = CANVAS_WIDTH / 2;
    // Perspective lines faking depth
    // Center line
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid, CANVAS_HEIGHT);
    ctx.stroke();

    // Side lines
    ctx.beginPath();
    ctx.moveTo(mid - 150, 0);
    ctx.lineTo(mid - 250, CANVAS_HEIGHT);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(mid + 150, 0);
    ctx.lineTo(mid + 250, CANVAS_HEIGHT);
    ctx.stroke();

    // Horizon?
}

function drawNote(x, y) {
    const width = 120;
    const height = 40;
    const radius = 20;
    
    ctx.save();
    ctx.translate(x, y);
    
    // Glow
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00f3ff';
    ctx.fillStyle = '#fff';
    
    // Rounded rect manually for compatibility
    ctx.beginPath();
    ctx.moveTo(-width/2 + radius, -height/2);
    ctx.lineTo(width/2 - radius, -height/2);
    ctx.quadraticCurveTo(width/2, -height/2, width/2, -height/2 + radius);
    ctx.lineTo(width/2, height/2 - radius);
    ctx.quadraticCurveTo(width/2, height/2, width/2 - radius, height/2);
    ctx.lineTo(-width/2 + radius, height/2);
    ctx.quadraticCurveTo(-width/2, height/2, -width/2, height/2 - radius);
    ctx.lineTo(-width/2, -height/2 + radius);
    ctx.quadraticCurveTo(-width/2, -height/2, -width/2 + radius, -height/2);
    ctx.closePath();
    ctx.fill();
    
    // Inner color
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00f3ff';
    const innerW = width - 8;
    const innerH = height - 8;
    const innerR = 16;
    
    ctx.beginPath();
    ctx.moveTo(-innerW/2 + innerR, -innerH/2);
    ctx.lineTo(innerW/2 - innerR, -innerH/2);
    ctx.quadraticCurveTo(innerW/2, -innerH/2, innerW/2, -innerH/2 + innerR);
    ctx.lineTo(innerW/2, innerH/2 - innerR);
    ctx.quadraticCurveTo(innerW/2, innerH/2, innerW/2 - innerR, innerH/2);
    ctx.lineTo(-innerW/2 + innerR, innerH/2);
    ctx.quadraticCurveTo(-innerW/2, innerH/2, -innerW/2, innerH/2 - innerR);
    ctx.lineTo(-innerW/2, -innerH/2 + innerR);
    ctx.quadraticCurveTo(-innerW/2, -innerH/2, -innerW/2 + innerR, -innerH/2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

// Start
init();
