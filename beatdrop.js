/* Neon Beat Drop (plain HTML/CSS/JS)
   - 1-lane rhythm gameplay (tap anywhere)
   - Timing uses audio.currentTime for sync
   - Notes are scheduled by BPM; position computed from hitTime
*/

(() => {
  "use strict";

  // ----------------------------
  // Song metadata (easy to tweak)
  // ----------------------------
  const SONGS = {
    golden: {
      id: "golden",
      displayName: "Demon Hunter - Golden",
      audioCandidates: ["assets/golden.ogg", "assets/golden.mp3"],
      bpm: 160,        // placeholder; tweak as needed
      offsetMs: 0,     // positive = shift judgement later; tweak as needed
    },
    sodapop: {
      id: "sodapop",
      displayName: "Soda Pop",
      audioCandidates: ["assets/sodapop.ogg", "assets/sodapop.mp3"],
      bpm: 128,        // placeholder; tweak as needed
      offsetMs: 0,     // tweak as needed
    },
  };

  // ----------------------------
  // Gameplay constants (tweakable)
  // ----------------------------
  const CANVAS_W = 720;
  const CANVAS_H = 1280;
  const SPAWN_Y = -80;
  const HIT_LINE_Y = CANVAS_H * 0.78;
  const NOTE_TRAVEL_MS = 1400;

  const PERFECT_WINDOW_MS = 60;
  const GOOD_WINDOW_MS = 120;

  const PERFECT_SCORE = 100;
  const GOOD_SCORE = 60;
  const MAX_MULTIPLIER = 2.0; // capped

  const LEAD_IN_BEATS = 4; // silence before first notes (relative song time)
  const SPAWN_LOOKAHEAD_MS = NOTE_TRAVEL_MS + 900;

  // ----------------------------
  // DOM
  // ----------------------------
  const $ = (id) => document.getElementById(id);

  const canvas = $("game");
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

  const overlay = $("overlay");
  const startBtn = $("startBtn");
  const secondaryBtn = $("secondaryBtn");
  const statusEl = $("status");
  const finalStats = $("finalStats");
  const finalScoreEl = $("finalScore");
  const finalBestEl = $("finalBest");
  const finalMaxComboEl = $("finalMaxCombo");

  const hudScoreEl = $("hudScore");
  const hudBestEl = $("hudBest");
  const hudComboEl = $("hudCombo");

  const songBtnGolden = $("songBtn-golden");
  const songBtnSoda = $("songBtn-sodapop");

  const songMetaGolden = $("songMeta-golden");
  const songMetaSoda = $("songMeta-sodapop");

  // ----------------------------
  // State
  // ----------------------------
  const state = {
    phase: "start", // start | running | gameover
    songId: "golden",

    // score
    score: 0,
    combo: 0,
    maxCombo: 0,
    best: 0,

    // timing / objects
    notes: [],
    particles: [],
    floaters: [],
    nextBeatIndex: 0,
    lastFrameTs: performance.now(),

    // audio
    audio: null,
    audioReady: false,
    audioPlayPromise: null,
  };

  // ----------------------------
  // Helpers
  // ----------------------------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function bestKey(songId) {
    return `neon-beatdrop-best:${songId}`;
  }

  function loadBest(songId) {
    const raw = localStorage.getItem(bestKey(songId));
    const v = raw ? Number(raw) : 0;
    return Number.isFinite(v) ? v : 0;
  }

  function saveBest(songId, score) {
    localStorage.setItem(bestKey(songId), String(score));
  }

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function showOverlay(show) {
    overlay.style.display = show ? "flex" : "none";
  }

  function setSongSelection(songId) {
    state.songId = songId;

    songBtnGolden.dataset.selected = String(songId === "golden");
    songBtnSoda.dataset.selected = String(songId === "sodapop");

    state.best = loadBest(songId);
    hudBestEl.textContent = String(state.best);

    finalStats.classList.remove("show");
    secondaryBtn.hidden = true;
    startBtn.textContent = "Tap to Play";
    startBtn.disabled = false;
    setStatus("");
  }

  function updateHUD() {
    hudScoreEl.textContent = String(state.score);
    hudComboEl.textContent = String(state.combo);
    hudBestEl.textContent = String(state.best);
  }

  function getMultiplier(combo) {
    // 1.0, 1.1 at 10, 1.2 at 20, ... capped
    const step = Math.floor(combo / 10) * 0.1;
    return clamp(1 + step, 1, MAX_MULTIPLIER);
  }

  function songTimeMs() {
    // Song time derived from audio clock (best for sync)
    const song = SONGS[state.songId];
    const a = state.audio;
    if (!a) return 0;
    return (a.currentTime * 1000) - song.offsetMs;
  }

  function isAudioActuallyPlaying(a) {
    return a && !a.paused && !a.ended && a.readyState >= 2;
  }

  // ----------------------------
  // Audio loading with fallback
  // ----------------------------
  function loadAudioForSong(songId) {
    const song = SONGS[songId];
    const candidates = song.audioCandidates.slice();

    // Reuse element if possible, but always reset handlers.
    const audio = state.audio || new Audio();
    audio.preload = "auto";
    audio.loop = false;
    audio.crossOrigin = "anonymous"; // harmless for local, helpful if hosted later

    state.audio = audio;
    state.audioReady = false;

    return new Promise((resolve, reject) => {
      let idx = 0;

      const cleanup = () => {
        audio.oncanplaythrough = null;
        audio.onerror = null;
      };

      const tryNext = () => {
        if (idx >= candidates.length) {
          cleanup();
          reject(new Error("Audio failed to load (missing file or unsupported codec)."));
          return;
        }

        const src = candidates[idx++];
        setStatus(`Loading audio: ${src}`);

        // Force reload.
        audio.src = src;
        audio.load();

        audio.oncanplaythrough = () => {
          cleanup();
          state.audioReady = true;
          resolve(audio);
        };

        audio.onerror = () => {
          // Try the next candidate (ogg -> mp3 fallback).
          tryNext();
        };
      };

      tryNext();
    });
  }

  // ----------------------------
  // Notes & Judgement
  // ----------------------------
  function scheduleNotes(nowMs) {
    const song = SONGS[state.songId];
    const beatIntervalMs = 60000 / song.bpm;

    // Ensure our first scheduled beat has a lead-in.
    const startHitTime = LEAD_IN_BEATS * beatIntervalMs;

    while (true) {
      const hitTime = startHitTime + state.nextBeatIndex * beatIntervalMs;
      if (hitTime > nowMs + SPAWN_LOOKAHEAD_MS) break;

      // Simple pattern variety: mostly every beat, with occasional skips and doubles.
      const r = pseudoRand(hitTime * 0.001);
      const spawnMain = r > 0.12; // ~88% of beats spawn a note
      if (spawnMain) {
        state.notes.push({
          hitTime,
          judged: false,
          result: null, // PERFECT/GOOD/MISS
        });
      }

      // Occasionally add an off-beat ("+ half beat") for spice.
      const addOffbeat = r < 0.10;
      if (addOffbeat) {
        state.notes.push({
          hitTime: hitTime + beatIntervalMs * 0.5,
          judged: false,
          result: null,
        });
      }

      state.nextBeatIndex++;
    }
  }

  // Deterministic-ish pseudo-random based on time (so it feels consistent per song).
  function pseudoRand(x) {
    // https://www.shadertoy.com/view/4djSRW style hash
    const s = Math.sin(x * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  function noteYAtTime(hitTime, nowMs) {
    const span = HIT_LINE_Y - SPAWN_Y;
    // y = HIT_LINE_Y - ((hitTime - nowMs) / NOTE_TRAVEL_MS) * span
    return HIT_LINE_Y - ((hitTime - nowMs) / NOTE_TRAVEL_MS) * span;
  }

  function judgeTap(nowMs) {
    // Find closest unjudged note by absolute delta.
    let bestIdx = -1;
    let bestDelta = Infinity;

    for (let i = 0; i < state.notes.length; i++) {
      const n = state.notes[i];
      if (n.judged) continue;
      const d = Math.abs(nowMs - n.hitTime);
      if (d < bestDelta) {
        bestDelta = d;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return; // nothing to judge

    if (bestDelta <= PERFECT_WINDOW_MS) {
      applyJudgement(bestIdx, "PERFECT", nowMs);
    } else if (bestDelta <= GOOD_WINDOW_MS) {
      applyJudgement(bestIdx, "GOOD", nowMs);
    } else {
      // Miss tap (optional by spec). Keep it mild, but reset combo to make it meaningful.
      registerMiss(nowMs, true);
    }
  }

  function applyJudgement(noteIndex, result, nowMs) {
    const n = state.notes[noteIndex];
    if (!n || n.judged) return;

    n.judged = true;
    n.result = result;

    if (result === "PERFECT" || result === "GOOD") {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);

      const base = (result === "PERFECT") ? PERFECT_SCORE : GOOD_SCORE;
      const mult = getMultiplier(state.combo);
      state.score += Math.round(base * mult);

      spawnHitFX(result, nowMs);
    } else {
      registerMiss(nowMs, false);
    }

    updateHUD();
  }

  function registerMiss(nowMs, fromTap) {
    state.combo = 0;
    updateHUD();

    const x = CANVAS_W * 0.5;
    const y = HIT_LINE_Y - 40;
    spawnFloater("MISS", x, y, "rgba(255,120,120,.95)");
    spawnMissPulse(nowMs);

    // If it was a tap-miss, add a subtle particle drizzle (no score impact).
    if (fromTap) spawnTapMissFX();
  }

  function autoMissPasses(nowMs) {
    // Notes miss automatically if nowMs - hitTime > GOOD_WINDOW_MS.
    for (const n of state.notes) {
      if (n.judged) continue;
      if (nowMs - n.hitTime > GOOD_WINDOW_MS) {
        n.judged = true;
        n.result = "MISS";
        registerMiss(nowMs, false);
      }
    }
  }

  // ----------------------------
  // Visual FX
  // ----------------------------
  function spawnHitFX(result, nowMs) {
    const x = CANVAS_W * 0.5;
    const y = HIT_LINE_Y;

    const color = (result === "PERFECT")
      ? "rgba(0,245,255,.95)"
      : "rgba(255,43,214,.90)";

    spawnFloater(result, x, y - 44, color);

    // Particle burst
    const count = (result === "PERFECT") ? 22 : 16;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + pseudoRand(nowMs + i) * 0.6;
      const sp = lerp(240, 520, Math.random());
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 90,
        life: 0,
        ttl: lerp(220, 420, Math.random()),
        size: lerp(3, 7, Math.random()),
        color,
      });
    }
  }

  function spawnTapMissFX() {
    const x = CANVAS_W * 0.5;
    const y = HIT_LINE_Y;
    for (let i = 0; i < 10; i++) {
      const a = (-Math.PI / 2) + (Math.random() - 0.5) * 0.9;
      const sp = lerp(120, 260, Math.random());
      state.particles.push({
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        ttl: lerp(140, 220, Math.random()),
        size: lerp(2, 5, Math.random()),
        color: "rgba(255,120,120,.70)",
      });
    }
  }

  function spawnMissPulse(nowMs) {
    // A single “shock” particle
    const x = CANVAS_W * 0.5;
    const y = HIT_LINE_Y;
    state.particles.push({
      x, y,
      vx: 0, vy: 0,
      life: 0,
      ttl: 260,
      size: 44,
      color: "rgba(255,120,120,.25)",
      pulse: true,
      seed: nowMs,
    });
  }

  function spawnFloater(text, x, y, color) {
    state.floaters.push({
      text,
      x,
      y,
      vy: -90,
      life: 0,
      ttl: 520,
      color,
    });
  }

  // ----------------------------
  // Rendering
  // ----------------------------
  function clearCanvas() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  }

  function drawBackdrop() {
    // Faint animated-ish grid and lane glow
    const t = performance.now() * 0.001;

    // grid lines
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    const step = 64;
    const yOff = ((t * 40) % step);
    for (let y = -step; y < CANVAS_H + step; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + yOff);
      ctx.lineTo(CANVAS_W, y + yOff);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.14;
    for (let x = 0; x <= CANVAS_W; x += 72) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }
    ctx.restore();

    // lane glow (center)
    ctx.save();
    const grad = ctx.createLinearGradient(CANVAS_W * 0.5, 0, CANVAS_W * 0.5, CANVAS_H);
    grad.addColorStop(0.0, "rgba(0,245,255,.07)");
    grad.addColorStop(0.5, "rgba(255,43,214,.05)");
    grad.addColorStop(1.0, "rgba(139,92,255,.06)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }

  function drawHitLine() {
    ctx.save();
    ctx.lineWidth = 6;
    ctx.shadowBlur = 24;
    ctx.shadowColor = "rgba(0,245,255,.55)";
    ctx.strokeStyle = "rgba(0,245,255,.80)";
    ctx.beginPath();
    ctx.moveTo(48, HIT_LINE_Y);
    ctx.lineTo(CANVAS_W - 48, HIT_LINE_Y);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.shadowBlur = 14;
    ctx.shadowColor = "rgba(255,43,214,.35)";
    ctx.strokeStyle = "rgba(255,43,214,.55)";
    ctx.beginPath();
    ctx.moveTo(48, HIT_LINE_Y + 14);
    ctx.lineTo(CANVAS_W - 48, HIT_LINE_Y + 14);
    ctx.stroke();
    ctx.restore();
  }

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawNotes(nowMs) {
    const centerX = CANVAS_W * 0.5;
    const noteW = 190;
    const noteH = 56;

    for (const n of state.notes) {
      const y = noteYAtTime(n.hitTime, nowMs);

      // Skip far-offscreen notes for efficiency.
      if (y < -140) continue;
      if (y > CANVAS_H + 160) continue;

      // Fade out judged notes quickly.
      let alpha = 1;
      if (n.judged) {
        const age = nowMs - n.hitTime;
        alpha = clamp(1 - age / 320, 0, 1);
      }

      const x = centerX - noteW / 2;
      const base = Math.abs(nowMs - n.hitTime);
      const near = clamp(1 - (base / 260), 0, 1);

      ctx.save();
      ctx.globalAlpha = 0.92 * alpha;

      // outer glow
      ctx.shadowBlur = lerp(14, 34, near);
      ctx.shadowColor = "rgba(0,245,255,.40)";

      // gradient fill
      const g = ctx.createLinearGradient(x, y, x + noteW, y + noteH);
      g.addColorStop(0, "rgba(0,245,255,.85)");
      g.addColorStop(0.55, "rgba(255,43,214,.78)");
      g.addColorStop(1, "rgba(139,92,255,.80)");
      ctx.fillStyle = g;

      roundRectPath(x, y - noteH / 2, noteW, noteH, 18);
      ctx.fill();

      // inner highlight
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      roundRectPath(x + 3, y - noteH / 2 + 3, noteW - 6, noteH - 6, 16);
      ctx.stroke();

      // center dot
      ctx.globalAlpha = 0.70 * alpha;
      ctx.fillStyle = "rgba(255,255,255,.82)";
      ctx.beginPath();
      ctx.arc(centerX, y, 5.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  function drawParticles(dtMs) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life += dtMs;

      if (p.life >= p.ttl) {
        state.particles.splice(i, 1);
        continue;
      }

      const t = p.life / p.ttl;

      if (p.pulse) {
        // Expanding ring pulse
        const r = lerp(10, 120, t);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = lerp(6, 1, t);
        ctx.shadowBlur = 20;
        ctx.shadowColor = "rgba(255,120,120,.30)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      // Motion + gravity
      p.vy += 1050 * (dtMs / 1000);
      p.x += p.vx * (dtMs / 1000);
      p.y += p.vy * (dtMs / 1000);

      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.95;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 18;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lerp(p.size, 0.5, t), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFloaters(dtMs) {
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const f = state.floaters[i];
      f.life += dtMs;
      if (f.life >= f.ttl) {
        state.floaters.splice(i, 1);
        continue;
      }

      const t = f.life / f.ttl;
      f.y += f.vy * (dtMs / 1000);

      ctx.save();
      ctx.globalAlpha = clamp(1 - t, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = "900 42px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 22;
      ctx.shadowColor = f.color;
      ctx.fillText(f.text, f.x, f.y);

      // subtle outline
      ctx.globalAlpha *= 0.65;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,.30)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  function pruneOldNotes(nowMs) {
    // Remove notes long after they're judged/past.
    const keep = [];
    for (const n of state.notes) {
      const y = noteYAtTime(n.hitTime, nowMs);
      const tooOld = (nowMs - n.hitTime) > 1800;
      const offscreen = y > CANVAS_H + 220;
      if (n.judged && (tooOld || offscreen)) continue;
      keep.push(n);
    }
    state.notes = keep;
  }

  // ----------------------------
  // Game lifecycle
  // ----------------------------
  function resetRun() {
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.notes = [];
    state.particles = [];
    state.floaters = [];
    state.nextBeatIndex = 0;
    state.lastFrameTs = performance.now();

    updateHUD();
  }

  async function startGame() {
    if (state.phase === "running") return;

    startBtn.disabled = true;
    secondaryBtn.hidden = true;
    finalStats.classList.remove("show");
    setStatus("");

    resetRun();

    try {
      const audio = await loadAudioForSong(state.songId);
      audio.currentTime = 0;

      // game over when song ends
      audio.onended = () => {
        if (state.phase === "running") endGame();
      };

      // Autoplay restrictions: must be called in user gesture chain (button tap)
      setStatus("Starting…");
      state.audioPlayPromise = audio.play();
      if (state.audioPlayPromise && typeof state.audioPlayPromise.then === "function") {
        await state.audioPlayPromise;
      }

      state.phase = "running";
      showOverlay(false);
      setStatus("");

      // Kick the loop
      requestAnimationFrame(frame);
    } catch (err) {
      state.phase = "start";
      startBtn.disabled = false;
      showOverlay(true);
      setStatus(`Audio error: ${err && err.message ? err.message : String(err)}`);
    }
  }

  function endGame() {
    state.phase = "gameover";

    // update best per song
    const prevBest = loadBest(state.songId);
    if (state.score > prevBest) {
      saveBest(state.songId, state.score);
      state.best = state.score;
    } else {
      state.best = prevBest;
    }
    updateHUD();

    // stop audio (optional; if ended naturally, it's already ended)
    if (state.audio && !state.audio.paused) {
      try { state.audio.pause(); } catch { /* ignore */ }
    }

    // show overlay with final stats
    finalScoreEl.textContent = String(state.score);
    finalBestEl.textContent = String(state.best);
    finalMaxComboEl.textContent = String(state.maxCombo);
    finalStats.classList.add("show");

    startBtn.textContent = "Tap to Play";
    startBtn.disabled = false;
    secondaryBtn.hidden = false;
    secondaryBtn.textContent = "Play Again";
    setStatus("Run complete.");

    showOverlay(true);
  }

  // ----------------------------
  // Main loop
  // ----------------------------
  function frame(ts) {
    if (state.phase !== "running") return;

    const dtMs = clamp(ts - state.lastFrameTs, 0, 48);
    state.lastFrameTs = ts;

    const a = state.audio;
    if (!a) return;

    // If audio stalls (e.g., buffering), still render but don't advance scheduling too aggressively.
    const nowMs = songTimeMs();

    scheduleNotes(nowMs);
    autoMissPasses(nowMs);

    clearCanvas();
    drawBackdrop();
    drawNotes(nowMs);
    drawHitLine();
    drawParticles(dtMs);
    drawFloaters(dtMs);

    pruneOldNotes(nowMs);

    // If audio stopped unexpectedly, treat as end.
    if (!isAudioActuallyPlaying(a) && a.ended) {
      endGame();
      return;
    }

    requestAnimationFrame(frame);
  }

  // ----------------------------
  // Input
  // ----------------------------
  function onHitInput() {
    if (state.phase !== "running") return;
    judgeTap(songTimeMs());
  }

  // Pointer/touch: tap anywhere in canvas/arena
  canvas.addEventListener("pointerdown", (e) => {
    // prevent double-tap zoom on some mobile browsers
    e.preventDefault();
    onHitInput();
  }, { passive: false });

  // Desktop keyboard: Space
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      onHitInput();
    }
  }, { passive: false });

  // ----------------------------
  // UI wiring
  // ----------------------------
  songMetaGolden.textContent = `BPM ${SONGS.golden.bpm}`;
  songMetaSoda.textContent = `BPM ${SONGS.sodapop.bpm}`;

  songBtnGolden.addEventListener("click", () => {
    if (state.phase === "running") return;
    setSongSelection("golden");
  });

  songBtnSoda.addEventListener("click", () => {
    if (state.phase === "running") return;
    setSongSelection("sodapop");
  });

  startBtn.addEventListener("click", () => startGame());
  secondaryBtn.addEventListener("click", () => startGame());

  // Initial selection + HUD
  setSongSelection(state.songId);
  updateHUD();
  showOverlay(true);
  setStatus("Select a song, then tap to play.");

  // Draw an initial idle frame so the arena isn't blank.
  (function drawIdle() {
    clearCanvas();
    drawBackdrop();
    drawHitLine();
  })();
})();

