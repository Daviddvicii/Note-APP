/* Neon Beat Drop - plain HTML/CSS/JS rhythm game (1-lane)
   - No external libraries
   - Audio loads from local assets only (ogg preferred, mp3 fallback)
   - Notes are scheduled on beat; y-position derived from hitTime for stable timing
*/

(() => {
  "use strict";

  // -----------------------------
  // Tunables (timing + visuals)
  // -----------------------------
  const CANVAS_W = 720;
  const CANVAS_H = 1280;

  const HIT_LINE_Y = Math.floor(CANVAS_H * 0.78);
  const SPAWN_Y = -80;
  const NOTE_TRAVEL_MS = 1400; // time from spawn to hit line (tweak for feel)

  const PERFECT_WINDOW_MS = 60;
  const GOOD_WINDOW_MS = 120;

  const SCORE_PERFECT = 100;
  const SCORE_GOOD = 60;
  const MULTI_STEP = 0.1;      // +0.1 every 10 combo
  const MULTI_CAP = 2.0;       // max multiplier

  const LOOKAHEAD_MS = NOTE_TRAVEL_MS + 900; // schedule notes ahead of time

  // Song metadata (placeholder BPM/offsets are easy to tweak)
  const SONGS = {
    golden: {
      displayName: "Demon Hunter - Golden",
      audioSrc: ["assets/golden.ogg", "assets/golden.mp3"],
      bpm: 160,
      offsetMs: 0,
    },
    sodapop: {
      displayName: "Soda Pop",
      audioSrc: ["assets/sodapop.ogg", "assets/sodapop.mp3"],
      bpm: 128,
      offsetMs: 0,
    },
  };

  // -----------------------------
  // DOM
  // -----------------------------
  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d", { alpha: true });

  const elOverlay = document.getElementById("overlay");
  const elStartBtn = document.getElementById("btn-start");
  const elSongGrid = document.getElementById("song-grid");
  const elOverlayMsg = document.getElementById("overlay-message");
  const elResults = document.getElementById("results");
  const elResScore = document.getElementById("result-score");
  const elResBest = document.getElementById("result-best");
  const elResMaxCombo = document.getElementById("result-max-combo");

  const elHudScore = document.getElementById("hud-score");
  const elHudBest = document.getElementById("hud-best");
  const elHudCombo = document.getElementById("hud-combo");

  const elMetaGolden = document.getElementById("meta-golden");
  const elMetaSoda = document.getElementById("meta-sodapop");

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    phase: "start", // "start" | "running" | "gameover"
    songId: "golden",
    score: 0,
    best: 0,
    combo: 0,
    maxCombo: 0,
    lastJudgement: null,
    lastJudgeAtMs: -999999,

    // note scheduling
    beatIntervalMs: 60000 / SONGS.golden.bpm,
    nextBeatIndex: 0,
    notes: [], // {id, hitTime, judged:false, result:null}

    particles: [], // {x,y,vx,vy,life,age,color,sz}
    floaters: [],  // {x,y,vy,life,age,text,color,scale}

    // audio
    audio: null,
    audioReady: false,
    audioLoadError: null,
    runStarted: false,
  };

  // -----------------------------
  // Utilities
  // -----------------------------
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function fmtInt(n) {
    return String(Math.max(0, Math.floor(n)));
  }

  function bestKey(songId) {
    return `neon-beatdrop-best:${songId}`;
  }

  function loadBest(songId) {
    const raw = localStorage.getItem(bestKey(songId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function saveBest(songId, best) {
    localStorage.setItem(bestKey(songId), String(Math.max(0, Math.floor(best))));
  }

  function setOverlayMessage(msg) {
    if (!msg) {
      elOverlayMsg.textContent = "";
      elOverlayMsg.classList.add("hidden");
      return;
    }
    elOverlayMsg.textContent = msg;
    elOverlayMsg.classList.remove("hidden");
  }

  function showOverlay(show) {
    elOverlay.classList.toggle("hidden", !show);
  }

  function showResults(show) {
    elResults.classList.toggle("show", !!show);
  }

  function setStartButtonText(txt) {
    elStartBtn.textContent = txt;
  }

  // Simple deterministic pattern: mostly on-beat, with occasional rests/doubles.
  // 1-lane mode still benefits from “breathing” so it feels musical.
  function shouldSpawnNote(beatIndex) {
    // Every beat, but occasionally skip (rests) or add extra (syncopation).
    // This is deterministic per beatIndex (no RNG state).
    if (beatIndex % 16 === 12) return false; // rest
    if (beatIndex % 16 === 4) return true;
    if (beatIndex % 8 === 6) return true;
    return true;
  }

  // Optional extra note between beats for variety (still easy).
  function extraNoteOffsetMs(beatIndex, beatIntervalMs) {
    // Add a single “&” note on certain beats (offbeat eighth)
    if (beatIndex % 16 === 2 || beatIndex % 16 === 10) return beatIntervalMs * 0.5;
    return null;
  }

  function roundedRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function nowSongMs() {
    // Audio sync: time relative to song start with per-song offset adjustment.
    // When audio is paused/not ready, return 0 to keep visuals sane.
    const a = state.audio;
    if (!a || !state.runStarted) return 0;
    return (a.currentTime * 1000) - SONGS[state.songId].offsetMs;
  }

  function updateHud() {
    elHudScore.textContent = fmtInt(state.score);
    elHudBest.textContent = fmtInt(state.best);
    elHudCombo.textContent = fmtInt(state.combo);
  }

  function setSong(songId) {
    if (!SONGS[songId]) return;
    state.songId = songId;
    state.beatIntervalMs = 60000 / SONGS[songId].bpm;
    state.best = loadBest(songId);
    updateHud();

    // Highlight selected song button
    for (const btn of elSongGrid.querySelectorAll("button.song")) {
      btn.classList.toggle("active", btn.dataset.song === songId);
    }

    // Reset overlay content state if needed
    setOverlayMessage("");
    showResults(state.phase === "gameover");
  }

  // -----------------------------
  // Audio loading (local only)
  // -----------------------------
  function canLikelyPlay(url) {
    // Very lightweight: prefer ogg if supported.
    const a = document.createElement("audio");
    if (url.endsWith(".ogg")) return a.canPlayType('audio/ogg; codecs="vorbis"') !== "";
    if (url.endsWith(".mp3")) return a.canPlayType("audio/mpeg") !== "";
    return true;
  }

  function loadAudioForSong(songId) {
    const song = SONGS[songId];
    const audio = new Audio();
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 0.95;

    state.audioReady = false;
    state.audioLoadError = null;

    const candidates = song.audioSrc.slice();
    // Prefer types the browser claims it can play.
    candidates.sort((a, b) => Number(canLikelyPlay(b)) - Number(canLikelyPlay(a)));

    let idx = 0;

    return new Promise((resolve, reject) => {
      const tryNext = () => {
        if (idx >= candidates.length) {
          reject(new Error("Audio files not found or unsupported. Expected local assets in /assets."));
          return;
        }
        const src = candidates[idx++];
        audio.src = src;
        audio.load();

        const onReady = () => {
          cleanup();
          state.audioReady = true;
          resolve(audio);
        };

        const onErr = () => {
          cleanup();
          // Try next fallback
          tryNext();
        };

        const cleanup = () => {
          audio.removeEventListener("canplaythrough", onReady);
          audio.removeEventListener("error", onErr);
        };

        audio.addEventListener("canplaythrough", onReady, { once: true });
        audio.addEventListener("error", onErr, { once: true });
      };

      tryNext();
    });
  }

  // -----------------------------
  // Gameplay
  // -----------------------------
  function resetRun() {
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.lastJudgement = null;
    state.lastJudgeAtMs = -999999;

    state.notes.length = 0;
    state.particles.length = 0;
    state.floaters.length = 0;
    state.nextBeatIndex = 0;

    state.runStarted = false;
    updateHud();
  }

  function startRun() {
    resetRun();
    state.phase = "running";
    showOverlay(false);
    showResults(false);
    setOverlayMessage("");

    const a = state.audio;
    if (!a) {
      setOverlayMessage("Audio not loaded.");
      state.phase = "start";
      showOverlay(true);
      return;
    }

    // Ensure we always start from the beginning.
    try { a.pause(); } catch (_) {}
    try { a.currentTime = 0; } catch (_) {}
    state.runStarted = true;

    // Schedule begins at 0ms song time.
    state.nextBeatIndex = 0;

    // Mobile autoplay restriction: must be inside user gesture (Start button handler).
    const playPromise = a.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch((err) => {
        state.audioLoadError = err;
        state.runStarted = false;
        state.phase = "start";
        showOverlay(true);
        setOverlayMessage("Tap to play failed (autoplay restriction or missing audio). Try again after interacting.");
      });
    }
  }

  function endRun() {
    if (state.phase !== "running") return;
    state.phase = "gameover";

    // Stop audio
    if (state.audio) {
      try { state.audio.pause(); } catch (_) {}
    }

    // Save best per song
    const newBest = Math.max(state.best, state.score);
    if (newBest !== state.best) {
      state.best = newBest;
      saveBest(state.songId, newBest);
    }
    updateHud();

    // Results overlay
    elResScore.textContent = fmtInt(state.score);
    elResBest.textContent = fmtInt(state.best);
    elResMaxCombo.textContent = fmtInt(state.maxCombo);
    showResults(true);
    setStartButtonText("Play Again");
    showOverlay(true);
    setOverlayMessage("");
  }

  function scoreMultiplier() {
    const steps = Math.floor(state.combo / 10);
    return clamp(1 + steps * MULTI_STEP, 1, MULTI_CAP);
  }

  function addJudgement(text, color) {
    state.floaters.push({
      x: CANVAS_W * 0.5,
      y: HIT_LINE_Y - 90,
      vy: -0.10,
      life: 850,
      age: 0,
      text,
      color,
      scale: 1.0,
    });
  }

  function addParticleBurst(x, y, hueBase) {
    const count = 16;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const spd = lerp(0.25, 1.25, Math.random());
      state.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 0.55,
        life: lerp(380, 700, Math.random()),
        age: 0,
        color: `hsla(${hueBase + (Math.random() * 24 - 12)}, 100%, 70%, 1)`,
        sz: lerp(2.5, 6.5, Math.random()),
      });
    }
  }

  function registerHit(judgement, deltaMs) {
    state.lastJudgement = judgement;
    state.lastJudgeAtMs = performance.now();

    if (judgement === "PERFECT") {
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const add = Math.round(SCORE_PERFECT * scoreMultiplier());
      state.score += add;
      addJudgement("PERFECT", "rgba(0,229,255,1)");
      addParticleBurst(CANVAS_W * 0.5, HIT_LINE_Y, 190);
    } else if (judgement === "GOOD") {
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const add = Math.round(SCORE_GOOD * scoreMultiplier());
      state.score += add;
      addJudgement("GOOD", "rgba(255,61,242,1)");
      addParticleBurst(CANVAS_W * 0.5, HIT_LINE_Y, 305);
    } else {
      state.combo = 0;
      addJudgement("MISS", "rgba(255,120,120,1)");
    }

    updateHud();
  }

  function tapHit() {
    if (state.phase !== "running") return;

    const t = nowSongMs();
    let bestNote = null;
    let bestDelta = Infinity;

    for (const n of state.notes) {
      if (n.judged) continue;
      const d = Math.abs(t - n.hitTime);
      if (d < bestDelta) {
        bestDelta = d;
        bestNote = n;
      }
    }

    if (!bestNote) {
      // No scheduled notes (edge case); treat as miss feedback.
      registerHit("MISS", 9999);
      return;
    }

    if (bestDelta <= PERFECT_WINDOW_MS) {
      bestNote.judged = true;
      bestNote.result = "PERFECT";
      registerHit("PERFECT", bestDelta);
    } else if (bestDelta <= GOOD_WINDOW_MS) {
      bestNote.judged = true;
      bestNote.result = "GOOD";
      registerHit("GOOD", bestDelta);
    } else {
      // Tap far from any note: you can either ignore or count as MISS.
      // This implementation counts it as MISS to make feedback clear.
      registerHit("MISS", bestDelta);
    }
  }

  function autoMissLateNotes() {
    const t = nowSongMs();
    for (const n of state.notes) {
      if (n.judged) continue;
      if (t - n.hitTime > GOOD_WINDOW_MS) {
        n.judged = true;
        n.result = "MISS";
        registerHit("MISS", t - n.hitTime);
        // Only register one miss per frame to avoid combo nuking too aggressively on lag.
        break;
      }
    }
  }

  function scheduleNotes() {
    const t = nowSongMs();
    const beatMs = state.beatIntervalMs;

    // Schedule notes ahead of time so they can travel to the hit line.
    while ((state.nextBeatIndex * beatMs) < (t + LOOKAHEAD_MS)) {
      const hitTime = state.nextBeatIndex * beatMs;

      if (shouldSpawnNote(state.nextBeatIndex)) {
        state.notes.push({
          id: `${state.songId}:${state.nextBeatIndex}`,
          hitTime,
          judged: false,
          result: null,
        });
      }

      const extra = extraNoteOffsetMs(state.nextBeatIndex, beatMs);
      if (extra != null) {
        state.notes.push({
          id: `${state.songId}:${state.nextBeatIndex}:e`,
          hitTime: hitTime + extra,
          judged: false,
          result: null,
        });
      }

      state.nextBeatIndex++;
    }

    // Prune old notes (keep memory bounded)
    const pruneBefore = t - 5000;
    if (state.notes.length > 220) {
      state.notes = state.notes.filter((n) => n.hitTime >= pruneBefore);
    } else {
      // Also drop very old judged notes gradually.
      while (state.notes.length && state.notes[0].hitTime < pruneBefore && state.notes[0].judged) {
        state.notes.shift();
      }
    }
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function drawBackground() {
    // Subtle arena gradient (page already has neon background)
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, "rgba(6,7,20,0.84)");
    g.addColorStop(0.45, "rgba(8,10,30,0.62)");
    g.addColorStop(1, "rgba(5,7,18,0.78)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Faint grid lines
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    const step = 64;
    for (let x = 0; x <= CANVAS_W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_W, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Soft center glow lane
    ctx.save();
    const laneGlow = ctx.createRadialGradient(
      CANVAS_W * 0.5,
      HIT_LINE_Y - 200,
      10,
      CANVAS_W * 0.5,
      HIT_LINE_Y - 200,
      520
    );
    laneGlow.addColorStop(0, "rgba(0,229,255,0.14)");
    laneGlow.addColorStop(0.55, "rgba(255,61,242,0.06)");
    laneGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = laneGlow;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }

  function noteYFromHitTime(hitTime, tNow) {
    // Required formula (timing is tied to hitTime, not frame rate):
    // y = HIT_LINE_Y - ((hitTime - nowMs) / NOTE_TRAVEL_MS) * (HIT_LINE_Y - SPAWN_Y)
    const p = (hitTime - tNow) / NOTE_TRAVEL_MS;
    return HIT_LINE_Y - p * (HIT_LINE_Y - SPAWN_Y);
  }

  function drawHitLine() {
    ctx.save();
    // Underglow
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = "rgba(0,229,255,0.65)";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "rgba(0,229,255,0.95)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(36, HIT_LINE_Y + 0.5);
    ctx.lineTo(CANVAS_W - 36, HIT_LINE_Y + 0.5);
    ctx.stroke();

    // Accent line
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(255,61,242,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(36, HIT_LINE_Y - 10 + 0.5);
    ctx.lineTo(CANVAS_W - 36, HIT_LINE_Y - 10 + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawNotes() {
    const t = nowSongMs();
    const laneX = CANVAS_W * 0.5;
    const w = 210;
    const h = 54;

    for (const n of state.notes) {
      if (n.judged && n.result !== "MISS") continue; // fade out hits by skipping (particles show impact)

      const y = noteYFromHitTime(n.hitTime, t);
      if (y < SPAWN_Y - 200 || y > CANVAS_H + 180) continue;

      const x = laneX - w * 0.5;
      const distToLine = Math.abs(y - HIT_LINE_Y);
      const near = 1 - clamp(distToLine / 240, 0, 1);

      const glow = lerp(8, 22, near);
      const alpha = n.judged && n.result === "MISS" ? 0.25 : 1.0;

      // Two-tone neon fill
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, `rgba(0,229,255,${0.26 * alpha + 0.12 * near})`);
      grad.addColorStop(1, `rgba(255,61,242,${0.18 * alpha + 0.10 * near})`);

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = glow;
      ctx.shadowColor = `rgba(0,229,255,${0.40 * alpha})`;
      ctx.fillStyle = grad;
      roundedRectPath(ctx, x, y - h * 0.5, w, h, 18);
      ctx.fill();

      // Bright outline
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,255,255,${0.16 * alpha + 0.14 * near})`;
      ctx.stroke();

      // Inner core
      ctx.globalAlpha = 0.9 * alpha;
      ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.10 * near})`;
      roundedRectPath(ctx, x + 12, y - h * 0.5 + 10, w - 24, h - 20, 14);
      ctx.fill();

      ctx.restore();
    }
  }

  function tickParticles(dtMs) {
    for (const p of state.particles) {
      p.age += dtMs;
      p.x += p.vx * dtMs;
      p.y += p.vy * dtMs;
      p.vy += 0.0012 * dtMs;
    }
    state.particles = state.particles.filter((p) => p.age < p.life);
  }

  function drawParticles() {
    ctx.save();
    for (const p of state.particles) {
      const t = clamp(p.age / p.life, 0, 1);
      const a = (1 - t) * 0.95;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz * (1 - t * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function tickFloaters(dtMs) {
    for (const f of state.floaters) {
      f.age += dtMs;
      f.y += f.vy * dtMs;
    }
    state.floaters = state.floaters.filter((f) => f.age < f.life);
  }

  function drawFloaters() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of state.floaters) {
      const t = clamp(f.age / f.life, 0, 1);
      const a = (1 - t) * (t < 0.08 ? lerp(0, 1, t / 0.08) : 1);
      const y = f.y;
      ctx.globalAlpha = a;
      ctx.font = `900 ${Math.floor(44 * (1.02 - t * 0.10))}px ui-sans-serif, system-ui`;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);

      ctx.shadowBlur = 0;
      ctx.globalAlpha = a * 0.6;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(f.text, f.x, y + 2);
    }
    ctx.restore();
  }

  function drawTopHint() {
    // Tiny hint when running (subtle)
    if (state.phase !== "running") return;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 16px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Tap on the beat", CANVAS_W * 0.5, 46);
    ctx.restore();
  }

  // -----------------------------
  // Main loop
  // -----------------------------
  let lastFrameAt = performance.now();
  function frame() {
    const now = performance.now();
    const dt = clamp(now - lastFrameAt, 0, 50);
    lastFrameAt = now;

    // Advance gameplay based on audio time (not wall time)
    if (state.phase === "running") {
      scheduleNotes();
      autoMissLateNotes();
    }

    // Visual updates
    tickParticles(dt);
    tickFloaters(dt);

    // Render
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawBackground();
    drawNotes();
    drawHitLine();
    drawParticles();
    drawFloaters();
    drawTopHint();

    requestAnimationFrame(frame);
  }

  // -----------------------------
  // Input
  // -----------------------------
  function installControls() {
    // Tap anywhere inside the canvas (1-lane)
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // Capture pointer to avoid scroll/gesture interruption on mobile
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      tapHit();
    }, { passive: false });

    // Desktop keyboard optional
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        tapHit();
      }
    }, { passive: false });
  }

  // -----------------------------
  // Overlay + song selection
  // -----------------------------
  function installOverlayUI() {
    elSongGrid.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button.song") : null;
      if (!btn) return;
      const songId = btn.dataset.song;
      if (!songId || songId === state.songId) return;
      if (state.phase === "running") return;

      setSong(songId);
      // Preload audio for newly selected song while overlay is visible
      setOverlayMessage("Loading audio…");
      setStartButtonText(state.phase === "gameover" ? "Play Again" : "Tap to Play");
      showResults(state.phase === "gameover");

      preloadAudio().catch(() => {
        // message set inside preloadAudio
      });
    });

    elStartBtn.addEventListener("click", async () => {
      // Start button must be a user gesture: load audio (if needed) then play.
      if (state.phase === "running") return;

      setOverlayMessage("Preparing audio…");
      const ok = await preloadAudio();
      if (!ok) return;

      // Bind ended handler each run
      if (state.audio) {
        state.audio.onended = () => endRun();
      }

      startRun();
    });
  }

  async function preloadAudio() {
    // If we already have audio for this song and it’s usable, keep it.
    // Otherwise create a new element and attempt candidates.
    const wanted = state.songId;

    // Always re-create to keep behavior predictable across song changes.
    if (state.audio) {
      try { state.audio.pause(); } catch (_) {}
    }
    state.audio = null;
    state.audioReady = false;
    state.audioLoadError = null;

    try {
      const a = await loadAudioForSong(wanted);
      state.audio = a;
      setOverlayMessage("");
      return true;
    } catch (err) {
      state.audioLoadError = err;
      const friendly =
        "Couldn't load audio. Please add local files:\n" +
        `- ${SONGS[wanted].audioSrc.join(" or ")}\n` +
        "Then reload the page.";
      setOverlayMessage(friendly);
      return false;
    }
  }

  // -----------------------------
  // Boot
  // -----------------------------
  function boot() {
    // Canvas sanity (fixed internal resolution; CSS scales proportionally)
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    // Populate BPM meta labels
    elMetaGolden.textContent = `BPM: ${SONGS.golden.bpm}`;
    elMetaSoda.textContent = `BPM: ${SONGS.sodapop.bpm}`;

    installControls();
    installOverlayUI();

    // Initial song selection + best score
    setSong(state.songId);
    setStartButtonText("Tap to Play");
    showOverlay(true);
    showResults(false);
    setOverlayMessage("");

    // Attempt to preload (allowed without autoplay). If it fails, overlay explains.
    preloadAudio().catch(() => {});

    // Start rendering loop
    requestAnimationFrame(frame);
  }

  // Start when DOM is ready (script is at bottom, but safe anyway)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

