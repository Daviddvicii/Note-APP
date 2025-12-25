/* Neon Beat Drop (plain HTML/CSS/JS)
   - Mobile-friendly portrait playfield (720x1280 canvas scaled via CSS)
   - Song select overlay (two songs)
   - Notes spawn on beats, fall toward a hit line
   - Tap/Space to hit with PERFECT/GOOD/MISS judgement
   - Combo + score with multiplier; per-song BEST in localStorage
   - Audio uses HTMLAudioElement; starts only on user interaction
*/

(() => {
  "use strict";

  // -----------------------------
  // Song metadata (easy to tweak)
  // -----------------------------
  const SONGS = {
    golden: {
      id: "golden",
      displayName: "Demon Hunter - Golden",
      audioCandidates: ["assets/golden.ogg", "assets/golden.mp3"],
      // Placeholder BPMs (adjust to match your files)
      bpm: 160,
      // Positive offset makes notes later; negative makes them earlier.
      offsetMs: 0,
      // Optional difficulty/pattern tuning
      spawnEveryNBeats: 1,
    },
    sodapop: {
      id: "sodapop",
      displayName: "Soda Pop",
      audioCandidates: ["assets/sodapop.ogg", "assets/sodapop.mp3"],
      // Placeholder BPMs (adjust to match your files)
      bpm: 128,
      offsetMs: 0,
      spawnEveryNBeats: 1,
    },
  };

  // -----------------------------
  // Timing + judgement constants
  // -----------------------------
  const PERFECT_WINDOW_MS = 60;
  const GOOD_WINDOW_MS = 120;

  // Travel model: position derived from scheduled hitTime (ms).
  const NOTE_TRAVEL_MS = 1400; // tweakable

  // Note style / geometry (canvas-space)
  const CANVAS_W = 720;
  const CANVAS_H = 1280;
  const HIT_LINE_Y = Math.floor(CANVAS_H * 0.78);
  const SPAWN_Y = -80;
  const NOTE_W = 240;
  const NOTE_H = 60;
  const NOTE_RADIUS = 18;

  // Spawn control
  const SPAWN_LOOKAHEAD_MS = NOTE_TRAVEL_MS + 700; // schedule notes ahead

  // Score values
  const SCORE_PERFECT = 100;
  const SCORE_GOOD = 60;

  // Combo multiplier: 1 + floor(combo/10)*0.1 (capped)
  const MULT_STEP = 0.1;
  const MULT_CAP = 2.0;

  // -----------------------------
  // DOM
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const canvas = $("#game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const overlay = $("#overlay");
  const startBtn = $("#start-btn");
  const overlayMsg = $("#overlay-msg");
  const finalLine = $("#final-line");

  const songBtnGolden = $("#song-golden");
  const songBtnSoda = $("#song-sodapop");

  const hudScore = $("#hud-score");
  const hudBest = $("#hud-best");
  const hudCombo = $("#hud-combo");

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    mode: "start", // "start" | "running" | "gameover"
    songId: "golden",

    audio: null,
    audioReady: false,
    audioFailed: false,

    score: 0,
    combo: 0,
    best: 0,

    // notes scheduled in "song time" ms (audio.currentTime*1000 - offsetMs)
    notes: [],
    nextBeatIndex: 0,

    particles: [],
    floaters: [],

    lastNowMs: 0,
    rafId: 0,
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

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function formatInt(n) {
    return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function bestKey(songId) {
    return `neon-beatdrop-best:${songId}`;
  }

  function loadBest(songId) {
    const v = Number(localStorage.getItem(bestKey(songId)) || "0");
    return Number.isFinite(v) ? v : 0;
  }

  function saveBest(songId, best) {
    localStorage.setItem(bestKey(songId), String(best));
  }

  function setOverlayVisible(visible) {
    overlay.hidden = !visible;
  }

  function setMessage(msg) {
    overlayMsg.textContent = msg || "";
  }

  function setFinalLine(msg) {
    finalLine.textContent = msg || "";
  }

  function setSongButtons(songId) {
    const isGolden = songId === "golden";
    songBtnGolden.setAttribute("aria-pressed", isGolden ? "true" : "false");
    songBtnSoda.setAttribute("aria-pressed", !isGolden ? "true" : "false");
  }

  function updateHud() {
    hudScore.textContent = formatInt(state.score);
    hudCombo.textContent = formatInt(state.combo);
    hudBest.textContent = formatInt(state.best);
  }

  // Returns "song time" ms = audio.currentTime*1000 - offset
  function getNowMs() {
    if (!state.audio) return 0;
    const song = SONGS[state.songId];
    return state.audio.currentTime * 1000 - (song.offsetMs || 0);
  }

  function currentMultiplier() {
    const steps = Math.floor(state.combo / 10);
    return Math.min(MULT_CAP, 1 + steps * MULT_STEP);
  }

  function resetRunState() {
    state.score = 0;
    state.combo = 0;
    state.notes = [];
    state.nextBeatIndex = 0;
    state.particles = [];
    state.floaters = [];
    state.lastNowMs = 0;
    updateHud();
  }

  // -----------------------------
  // Audio loading (no external fetch)
  // -----------------------------
  function pickAudioSrc(audioCandidates) {
    // Prefer a type the browser claims it can play.
    const test = document.createElement("audio");
    const canOgg = test.canPlayType('audio/ogg; codecs="vorbis"');
    const canMp3 = test.canPlayType("audio/mpeg");

    // candidates are ordered by priority: ogg then mp3 (per requirement).
    // We'll still validate playability if possible.
    for (const src of audioCandidates) {
      if (src.endsWith(".ogg") && canOgg) return src;
      if (src.endsWith(".mp3") && canMp3) return src;
    }
    // Fallback: just try the first candidate.
    return audioCandidates[0] || "";
  }

  function loadAudioForSong(song) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.crossOrigin = "anonymous"; // harmless for local assets
      audio.loop = false;

      const preferred = pickAudioSrc(song.audioCandidates);
      const fallbacks = song.audioCandidates.filter((s) => s !== preferred);
      const sourcesToTry = [preferred, ...fallbacks].filter(Boolean);

      let tryIndex = 0;
      let settled = false;

      const cleanup = () => {
        audio.removeEventListener("canplaythrough", onCanPlay);
        audio.removeEventListener("error", onError);
      };

      const tryNext = () => {
        if (tryIndex >= sourcesToTry.length) {
          cleanup();
          reject(new Error("Audio failed to load (no playable sources found)."));
          return;
        }
        audio.src = sourcesToTry[tryIndex++];
        audio.load();
      };

      const onCanPlay = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(audio);
      };

      const onError = () => {
        // Try next candidate source.
        if (settled) return;
        tryNext();
      };

      audio.addEventListener("canplaythrough", onCanPlay, { once: false });
      audio.addEventListener("error", onError, { once: false });

      tryNext();
    });
  }

  // -----------------------------
  // Notes + effects
  // -----------------------------
  function scheduleNotes(nowMs) {
    const song = SONGS[state.songId];
    const beatIntervalMs = 60000 / song.bpm;
    const lookaheadEnd = nowMs + SPAWN_LOOKAHEAD_MS;

    // Ensure first beat aligns at t=0 in song time (adjust with offsetMs constant).
    // Beat index i => hitTime = i * beatIntervalMs
    while (state.nextBeatIndex * beatIntervalMs <= lookaheadEnd) {
      const i = state.nextBeatIndex++;

      // Simple 1-lane pattern:
      // - spawn on every Nth beat
      // - add a little variety: skip some beats and add occasional off-beat notes
      const onBeat = i % (song.spawnEveryNBeats || 1) === 0;
      const skip = i % 16 === 12; // tiny breathing space

      if (onBeat && !skip) {
        addNote(i * beatIntervalMs);
      }

      // Optional extra: occasional off-beat (eighth note) to keep it lively
      // (kept rare so it's still "1-lane mode first".)
      const offBeatChance = i % 8 === 6; // deterministic, easy to tweak
      if (onBeat && offBeatChance && !skip) {
        addNote(i * beatIntervalMs + beatIntervalMs / 2);
      }
    }
  }

  function addNote(hitTime) {
    state.notes.push({
      id: cryptoRandomId(),
      hitTime, // ms in song time
      judged: false,
      result: null, // "PERFECT" | "GOOD" | "MISS"
    });
  }

  function cryptoRandomId() {
    // Keep it lightweight and non-invasive.
    if (globalThis.crypto?.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0].toString(16);
    }
    return Math.floor(Math.random() * 1e9).toString(16);
  }

  function noteYForTime(note, nowMs) {
    // y = HIT_LINE_Y - ((hitTime - nowMs) / NOTE_TRAVEL_MS) * (HIT_LINE_Y - SPAWN_Y)
    const t = (note.hitTime - nowMs) / NOTE_TRAVEL_MS;
    return HIT_LINE_Y - t * (HIT_LINE_Y - SPAWN_Y);
  }

  function spawnBurst(x, y, colorA, colorB) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const spd = lerp(220, 700, Math.random());
      state.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0,
        ttl: lerp(0.25, 0.55, Math.random()),
        r: lerp(1.5, 3.8, Math.random()),
        color: Math.random() < 0.5 ? colorA : colorB,
      });
    }
  }

  function spawnFloater(text, x, y, color) {
    state.floaters.push({
      text,
      x,
      y,
      life: 0,
      ttl: 0.55,
      color,
    });
  }

  function judgeTap(nowMs) {
    // Find closest unjudged note by absolute timing delta.
    let bestNote = null;
    let bestDelta = Infinity;

    for (const n of state.notes) {
      if (n.judged) continue;
      const d = Math.abs(nowMs - n.hitTime);
      if (d < bestDelta) {
        bestDelta = d;
        bestNote = n;
      }
    }

    // If no note is reasonably close, ignore tap (less punishing on mobile).
    if (!bestNote || bestDelta > GOOD_WINDOW_MS) return;

    if (bestDelta <= PERFECT_WINDOW_MS) {
      applyJudgement(bestNote, "PERFECT");
    } else {
      applyJudgement(bestNote, "GOOD");
    }
  }

  function applyJudgement(note, result) {
    note.judged = true;
    note.result = result;

    const x = CANVAS_W / 2;
    const y = HIT_LINE_Y - 14;

    if (result === "MISS") {
      state.combo = 0;
      spawnFloater("MISS", x, y, "rgba(255,255,255,0.75)");
      updateHud();
      return;
    }

    state.combo += 1;
    const mult = currentMultiplier();
    const base = result === "PERFECT" ? SCORE_PERFECT : SCORE_GOOD;
    state.score += Math.round(base * mult);

    const cA = result === "PERFECT" ? "rgba(0,229,255,0.95)" : "rgba(255,43,214,0.92)";
    const cB = "rgba(124,77,255,0.92)";
    spawnBurst(x, HIT_LINE_Y, cA, cB);
    spawnFloater(result, x, y, cA);

    if (state.score > state.best) {
      state.best = state.score;
      saveBest(state.songId, state.best);
    }

    updateHud();
  }

  function autoMiss(nowMs) {
    for (const n of state.notes) {
      if (n.judged) continue;
      if (nowMs - n.hitTime > GOOD_WINDOW_MS) {
        applyJudgement(n, "MISS");
      }
    }
  }

  function cullOldObjects(nowMs) {
    // Remove notes that are far past the hit line (judged or not).
    state.notes = state.notes.filter((n) => {
      const y = noteYForTime(n, nowMs);
      // keep if it might still be on screen, or not yet judged
      if (!n.judged) return y < CANVAS_H + 140;
      return y < CANVAS_H + 80;
    });

    // Particles + floaters updated elsewhere and removed by ttl.
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function drawBackground(nowS) {
    // Base fill (opaque for performance)
    ctx.fillStyle = "#070513";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Animated neon gradient wash
    const g = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    const t = (Math.sin(nowS * 0.7) + 1) * 0.5;
    g.addColorStop(0, `rgba(0,229,255,${0.12 + 0.08 * t})`);
    g.addColorStop(0.5, "rgba(255,43,214,0.10)");
    g.addColorStop(1, `rgba(124,77,255,${0.10 + 0.08 * (1 - t)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Faint grid lines
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;

    const grid = 48;
    for (let x = 0; x <= CANVAS_W; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_W, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Subtle center lane glow
    ctx.save();
    const cx = CANVAS_W / 2;
    const lane = ctx.createLinearGradient(cx, 0, cx, CANVAS_H);
    lane.addColorStop(0, "rgba(0,229,255,0.00)");
    lane.addColorStop(0.35, "rgba(0,229,255,0.09)");
    lane.addColorStop(1, "rgba(255,43,214,0.04)");
    ctx.strokeStyle = lane;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, CANVAS_H);
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

  function drawHitLine(nowS) {
    // Glow underlay
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(nowS * 4.0);
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 22;
    ctx.shadowColor = "rgba(0,229,255,0.55)";
    ctx.strokeStyle = `rgba(0,229,255,${0.65 + 0.20 * pulse})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(40, HIT_LINE_Y + 0.5);
    ctx.lineTo(CANVAS_W - 40, HIT_LINE_Y + 0.5);
    ctx.stroke();

    // Accent line
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(255,43,214,0.50)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, HIT_LINE_Y + 9.5);
    ctx.lineTo(CANVAS_W - 40, HIT_LINE_Y + 9.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawNotes(nowMs) {
    const cx = CANVAS_W / 2;
    for (const n of state.notes) {
      if (n.judged && n.result === "MISS") continue; // keep misses from cluttering

      const y = noteYForTime(n, nowMs);
      if (y < SPAWN_Y - 120 || y > CANVAS_H + 200) continue;

      // Slight size emphasis near hit line
      const dist = Math.abs(y - HIT_LINE_Y);
      const bump = clamp(1 - dist / 360, 0, 1);
      const w = NOTE_W * (1 + bump * 0.08);
      const h = NOTE_H * (1 + bump * 0.10);

      const x = cx - w / 2;
      const yy = y - h / 2;

      // Color changes as it approaches the line
      const t = clamp(1 - (HIT_LINE_Y - y) / (HIT_LINE_Y - SPAWN_Y), 0, 1);
      const colA = `rgba(0,229,255,${0.30 + 0.35 * t})`;
      const colB = `rgba(255,43,214,${0.14 + 0.28 * t})`;
      const stroke = "rgba(255,255,255,0.22)";

      ctx.save();
      ctx.shadowBlur = 26;
      ctx.shadowColor = "rgba(0,229,255,0.35)";

      const grad = ctx.createLinearGradient(x, yy, x + w, yy + h);
      grad.addColorStop(0, colA);
      grad.addColorStop(1, colB);

      roundRectPath(x, yy, w, h, NOTE_RADIUS);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();

      // Inner highlight
      ctx.globalAlpha = 0.45;
      roundRectPath(x + 10, yy + 10, w - 20, h - 20, NOTE_RADIUS - 8);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawParticles(dt) {
    for (const p of state.particles) {
      p.life += dt;
      const t = clamp(p.life / p.ttl, 0, 1);
      const a = 1 - easeOutCubic(t);

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.25, dt); // fast damp
      p.vy = p.vy * Math.pow(0.25, dt) + 900 * dt; // gravity

      ctx.save();
      ctx.globalAlpha = 0.75 * a;
      ctx.shadowBlur = 18;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    state.particles = state.particles.filter((p) => p.life < p.ttl);
  }

  function drawFloaters(dt) {
    for (const f of state.floaters) {
      f.life += dt;
      const t = clamp(f.life / f.ttl, 0, 1);
      const a = 1 - t;
      const yy = f.y - easeOutCubic(t) * 70;

      ctx.save();
      ctx.globalAlpha = 0.95 * a;
      ctx.font = "800 42px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 24;
      ctx.shadowColor = f.color;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, yy);
      ctx.restore();
    }
    state.floaters = state.floaters.filter((f) => f.life < f.ttl);
  }

  // -----------------------------
  // Game loop
  // -----------------------------
  let lastFrameTs = performance.now();

  function tick(ts) {
    const dt = Math.min(0.05, (ts - lastFrameTs) / 1000);
    lastFrameTs = ts;

    const nowS = ts / 1000;
    drawBackground(nowS);

    if (state.mode === "running" && state.audio) {
      const nowMs = getNowMs();
      state.lastNowMs = nowMs;

      scheduleNotes(nowMs);
      autoMiss(nowMs);
      cullOldObjects(nowMs);

      drawNotes(nowMs);
      drawHitLine(nowS);
      drawParticles(dt);
      drawFloaters(dt);
    } else {
      // Idle attract mode rendering
      drawHitLine(nowS);
      drawParticles(dt);
      drawFloaters(dt);
    }

    state.rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    cancelAnimationFrame(state.rafId);
    lastFrameTs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }

  // -----------------------------
  // Transitions
  // -----------------------------
  async function startGameFromOverlay() {
    if (state.mode === "running") return;

    setMessage("Loading audio...");
    setFinalLine("");
    startBtn.disabled = true;

    try {
      const song = SONGS[state.songId];
      const audio = await loadAudioForSong(song);

      // Stop previous audio if any
      if (state.audio) {
        try {
          state.audio.pause();
        } catch {}
      }
      state.audio = audio;
      state.audioReady = true;
      state.audioFailed = false;

      // Set up end => game over
      audio.onended = () => {
        if (state.mode === "running") endGame("Song complete!");
      };

      // Reset score/combo and note scheduler
      resetRunState();
      state.best = loadBest(state.songId);
      updateHud();

      // Autoplay-safe: play only inside this user-initiated handler
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        await playPromise;
      }

      // Switch to running only after play() succeeds
      state.mode = "running";
      setOverlayVisible(false);
      setMessage("");
    } catch (err) {
      state.audioReady = false;
      state.audioFailed = true;
      setMessage(
        "Audio failed to load. Please add your local files:\nassets/" +
          state.songId +
          ".ogg (or .mp3) and try again."
      );
    } finally {
      startBtn.disabled = false;
    }
  }

  function endGame(reason) {
    state.mode = "gameover";

    // Pause audio
    if (state.audio) {
      try {
        state.audio.pause();
      } catch {}
    }

    // Best is already maintained live
    updateHud();

    setOverlayVisible(true);
    startBtn.textContent = "Play Again";
    setFinalLine(`Final Score: ${formatInt(state.score)}  •  Best: ${formatInt(state.best)}`);
    setMessage(reason || "Game Over");
  }

  function setSong(songId) {
    if (!SONGS[songId]) return;
    state.songId = songId;
    state.best = loadBest(songId);
    updateHud();
    setSongButtons(songId);

    // If there's an existing audio element, stop and discard (force reload on start)
    if (state.audio) {
      try {
        state.audio.pause();
      } catch {}
    }
    state.audio = null;
    state.audioReady = false;
    state.audioFailed = false;

    // Overlay text reset
    startBtn.textContent = state.mode === "gameover" ? "Play Again" : "Tap to Play";
    setMessage("");
    setFinalLine("");
  }

  // -----------------------------
  // Input
  // -----------------------------
  function onTapArena(ev) {
    if (ev) ev.preventDefault();
    if (state.mode !== "running") return;
    const nowMs = getNowMs();
    judgeTap(nowMs);
  }

  function onKeyDown(ev) {
    if (ev.code === "Space") {
      ev.preventDefault();
      if (state.mode === "running") {
        judgeTap(getNowMs());
      } else if (state.mode === "start" || state.mode === "gameover") {
        // Let Space start as well
        startGameFromOverlay();
      }
    }
  }

  // -----------------------------
  // Wiring
  // -----------------------------
  function init() {
    // Canvas sanity
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    // Default song + best
    setSong(state.songId);

    // Song selection buttons
    songBtnGolden.addEventListener("click", () => setSong("golden"));
    songBtnSoda.addEventListener("click", () => setSong("sodapop"));

    // Start / Play Again
    startBtn.addEventListener("click", () => {
      // Reset button label as needed
      startBtn.textContent = "Tap to Play";
      startGameFromOverlay();
    });

    // Tap controls (pointer works for mouse + touch)
    canvas.addEventListener("pointerdown", onTapArena, { passive: false });

    // Keyboard (desktop)
    window.addEventListener("keydown", onKeyDown, { passive: false });

    // Show overlay on load
    setOverlayVisible(true);
    startBtn.textContent = "Tap to Play";
    setMessage("Add your local audio files in assets/ and tap to start.");
    setFinalLine("");

    // Start render loop
    startLoop();
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

