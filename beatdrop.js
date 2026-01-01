/* Neon Beat Drop
 * Plain HTML/CSS/JS 1-lane rhythm game.
 * Audio is loaded from local files in /assets (no external fetch).
 */

(() => {
  "use strict";

  // -----------------------------
  // Tunable constants (game feel)
  // -----------------------------
  const CANVAS_W = 720;
  const CANVAS_H = 1280;

  const HIT_LINE_Y = CANVAS_H * 0.78;
  const SPAWN_Y = -80;
  const NOTE_TRAVEL_MS = 1400; // time from SPAWN_Y to HIT_LINE_Y

  const PERFECT_WINDOW_MS = 60;
  const GOOD_WINDOW_MS = 120;
  const TAP_MISS_WINDOW_MS = 170; // optional: only penalize taps reasonably close

  const LEAD_IN_MS = 1500; // give player a moment before first beat
  const LOOKAHEAD_MS = 2200; // how far ahead to schedule notes
  const NOTE_SIZE = { w: 260, h: 64, r: 18 };

  const SCORE_PERFECT = 100;
  const SCORE_GOOD = 60;
  const MULT_STEP = 0.1; // per 10 combo
  const MULT_CAP = 2.0; // max multiplier

  // -----------------------------
  // Song metadata (easy to tweak)
  // -----------------------------
  const SONGS = {
  golden: {
    displayName: "Demon Hunter - Golden",
    // Use relative paths so it works on GitHub Pages (subpaths) and locally.
    audioCandidates: ["assets/golden.ogg", "assets/golden.mp3"],
    bpm: 140,
    offsetMs: 0,
  },
  sodapop: {
    displayName: "Soda Pop",
    audioCandidates: ["assets/sodapop.ogg", "assets/sodapop.mp3"],
    bpm: 128,
    offsetMs: 0,
  },
};

  // -----------------------------
  // DOM
  // -----------------------------
  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d", { alpha: false });

  const overlay = document.getElementById("overlay");
  const overlayMessage = document.getElementById("overlayMessage");
  const startBtn = document.getElementById("startBtn");
  const btnGolden = document.getElementById("songBtn-golden");
  const btnSoda = document.getElementById("songBtn-sodapop");
  const metaGolden = document.getElementById("songMeta-golden");
  const metaSoda = document.getElementById("songMeta-sodapop");

  const hudScore = document.getElementById("hudScore");
  const hudBest = document.getElementById("hudBest");
  const hudCombo = document.getElementById("hudCombo");

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    phase: "start", // "start" | "running" | "gameover"
    songId: "golden",

    // audio
    audio: null,
    audioReady: false,
    audioErrored: false,

    // time
    songStartPerfNow: 0,
    songStartAudioTime: 0,

    // gameplay
    score: 0,
    combo: 0,
    best: 0,
    lastJudge: null, // {text, t, x, y}

    notes: [], // {id, hitTimeMs, hit: boolean, judged: "PERFECT"|"GOOD"|"MISS"|null}
    nextBeatIndex: 0,
    beatIntervalMs: 0,

    particles: [], // {x,y,vx,vy,life,ttl,color}
    floaters: [], // {text,x,y,vy,life,ttl,color}

    runningRaf: 0,
  };

  // Ensure canvas fixed resolution (crisp shapes)
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  // -----------------------------
  // Helpers
  // -----------------------------
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
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
    overlay.classList.toggle("hidden", !visible);
  }

  function setOverlayMessage(msg) {
    overlayMessage.textContent = msg || "";
  }

  function updateHud() {
    hudScore.textContent = String(state.score);
    hudCombo.textContent = String(state.combo);
    hudBest.textContent = String(state.best);
  }

  function setSelectedSong(songId) {
    state.songId = songId;
    btnGolden.classList.toggle("selected", songId === "golden");
    btnSoda.classList.toggle("selected", songId === "sodapop");

    const s = SONGS[songId];
    state.best = loadBest(songId);
    updateHud();

    // Reset overlay text on selection
    setOverlayMessage("");
    startBtn.textContent = state.phase === "gameover" ? "Play Again" : "Tap to Play";
    startBtn.disabled = false;

    // Preload audio element (without playing)
    prepareAudioForSong(s).catch(() => {
      // prepareAudioForSong already sets a message if needed
    });
  }

  function pickPlayableSrc(audioEl, candidates) {
    // Prefer a candidate that likely matches canPlayType.
    // This is a heuristic (paths don't guarantee MIME), but good enough for local assets.
    const canOgg = audioEl.canPlayType("audio/ogg; codecs=vorbis") || audioEl.canPlayType("audio/ogg");
    const canMp3 = audioEl.canPlayType("audio/mpeg") || audioEl.canPlayType("audio/mp3");

    const ogg = candidates.find((p) => p.toLowerCase().endsWith(".ogg"));
    const mp3 = candidates.find((p) => p.toLowerCase().endsWith(".mp3"));

    if (ogg && canOgg) return ogg;
    if (mp3 && canMp3) return mp3;

    // Fallback to first candidate (may still work)
    return candidates[0];
  }

  async function prepareAudioForSong(song) {
    // Stop prior audio if any
    if (state.audio) {
      try {
        state.audio.pause();
      } catch (_) {}
    }

    state.audioReady = false;
    state.audioErrored = false;

    const audio = new Audio();
    audio.preload = "auto";
    audio.loop = false;
    audio.crossOrigin = "anonymous"; // safe even for local; avoids some platform quirks

    // Resolve relative URLs against the document base (handles subpaths correctly).
    const src = new URL(pickPlayableSrc(audio, song.audioCandidates), document.baseURI).toString();
    audio.src = src;

    state.audio = audio;

    // Wire events
    audio.onended = () => {
      if (state.phase === "running") {
        endRun("Song ended");
      }
    };

    audio.onerror = () => {
      state.audioErrored = true;
      state.audioReady = false;
      setOverlayMessage(
        `Couldn't load audio. Put a local file at "${song.audioCandidates.join('" or "')}".`
      );
    };

    // Try to load metadata so duration/time works and play is more reliable after tap
    await new Promise((resolve) => {
      const done = () => resolve();
      audio.onloadedmetadata = done;
      audio.oncanplaythrough = done;
      // Trigger load
      try {
        audio.load();
      } catch (_) {
        // Some browsers ignore; that's okay.
      }
      // Hard timeout so we don't hang the UI
      setTimeout(done, 1200);
    });

    // If error fired, keep message.
    if (!state.audioErrored) {
      state.audioReady = true;
      setOverlayMessage("");
    }
  }

  function nowSongMs() {
    // Primary sync: audio time is the clock.
    // Apply offset to align beats.
    if (!state.audio) return 0;
    const song = SONGS[state.songId];
    return state.audio.currentTime * 1000 - (song.offsetMs || 0);
  }

  function computeNoteY(hitTimeMs, nowMs) {
    // y = HIT_LINE_Y - ((hitTime - now) / TRAVEL) * (HIT_LINE_Y - SPAWN_Y)
    const span = HIT_LINE_Y - SPAWN_Y;
    const t = (hitTimeMs - nowMs) / NOTE_TRAVEL_MS;
    return HIT_LINE_Y - t * span;
  }

  function comboMultiplier() {
    const step = Math.floor(state.combo / 10);
    return clamp(1 + step * MULT_STEP, 1, MULT_CAP);
  }

  function addFloater(text, x, y, color) {
    state.floaters.push({
      text,
      x,
      y,
      vy: -0.18,
      life: 0,
      ttl: 900,
      color,
    });
  }

  function burst(x, y, colorA, colorB) {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.25;
      const sp = 0.25 + Math.random() * 0.85;
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.25,
        life: 0,
        ttl: 520 + Math.random() * 260,
        color: Math.random() < 0.5 ? colorA : colorB,
      });
    }
  }

  function resetRunState() {
    state.score = 0;
    state.combo = 0;
    state.notes = [];
    state.particles = [];
    state.floaters = [];
    state.nextBeatIndex = 0;
    state.lastJudge = null;

    const song = SONGS[state.songId];
    state.beatIntervalMs = 60000 / song.bpm;
  }

  function patternAllowsBeat(i) {
    // A simple pattern: mostly every beat, with occasional gaps and doubles.
    // Deterministic (no RNG) so it feels consistent.
    if (i < 2) return false; // keep lead-in quiet
    if (i % 16 === 12 || i % 16 === 13) return false; // small break
    return true; // otherwise spawn on beat
  }

  function scheduleNotes(nowMs) {
    // Schedule notes ahead of time (based on beats) so drawing doesn't depend on FPS.
    const horizon = nowMs + LOOKAHEAD_MS;
    const firstBeatMs = LEAD_IN_MS;

    while (true) {
      const hitTimeMs = firstBeatMs + state.nextBeatIndex * state.beatIntervalMs;
      if (hitTimeMs > horizon) break;

      if (patternAllowsBeat(state.nextBeatIndex)) {
        const id = `${state.songId}:${state.nextBeatIndex}`;
        state.notes.push({
          id,
          hitTimeMs,
          hit: false,
          judged: null,
        });

        // Add a "double" on every 8th beat (a very close extra note)
        if (state.nextBeatIndex % 8 === 4) {
          state.notes.push({
            id: `${id}:b`,
            hitTimeMs: hitTimeMs + state.beatIntervalMs * 0.5, // off-beat
            hit: false,
            judged: null,
          });
        }
      }

      state.nextBeatIndex++;
    }
  }

  function getClosestPendingNote(nowMs) {
    let best = null;
    let bestDelta = Infinity;
    for (const n of state.notes) {
      if (n.hit || n.judged) continue;
      const d = Math.abs(nowMs - n.hitTimeMs);
      if (d < bestDelta) {
        bestDelta = d;
        best = n;
      }
    }
    return { note: best, delta: bestDelta };
  }

  function judgeTap() {
    if (state.phase !== "running") return;
    const t = nowSongMs();
    const { note, delta } = getClosestPendingNote(t);

    // Optional: ignore taps far from any note (prevents spam penalties).
    if (!note || delta > TAP_MISS_WINDOW_MS) {
      return;
    }

    if (delta <= PERFECT_WINDOW_MS) {
      registerHit(note, "PERFECT", SCORE_PERFECT, t);
    } else if (delta <= GOOD_WINDOW_MS) {
      registerHit(note, "GOOD", SCORE_GOOD, t);
    } else {
      // Close but outside good: count as miss
      registerMiss(note, t);
    }
  }

  function registerHit(note, label, baseScore, nowMs) {
    note.hit = true;
    note.judged = label;

    state.combo += 1;
    const mult = comboMultiplier();
    state.score += Math.round(baseScore * mult);

    // feedback near hit line (center lane)
    const x = CANVAS_W * 0.5;
    const y = HIT_LINE_Y - 90;

    const color = label === "PERFECT" ? "rgba(0,245,255,1)" : "rgba(255,43,214,1)";
    addFloater(label, x, y, color);
    burst(x, HIT_LINE_Y, "rgba(0,245,255,0.95)", "rgba(255,43,214,0.95)");

    updateHud();
  }

  function registerMiss(note, nowMs) {
    note.hit = false;
    note.judged = "MISS";
    state.combo = 0;

    const x = CANVAS_W * 0.5;
    const y = HIT_LINE_Y - 90;
    addFloater("MISS", x, y, "rgba(255,110,110,1)");
    burst(x, HIT_LINE_Y, "rgba(255,110,110,0.9)", "rgba(155,92,255,0.9)");

    updateHud();
  }

  function autoMiss(nowMs) {
    for (const n of state.notes) {
      if (n.hit || n.judged) continue;
      if (nowMs - n.hitTimeMs > GOOD_WINDOW_MS) {
        // Late beyond GOOD: miss automatically
        n.judged = "MISS";
        state.combo = 0;
        addFloater("MISS", CANVAS_W * 0.5, HIT_LINE_Y - 90, "rgba(255,110,110,1)");
      }
    }
  }

  function pruneOld(nowMs) {
    // Remove notes that are far past the hit line to keep arrays small.
    state.notes = state.notes.filter((n) => nowMs - n.hitTimeMs < 2200);
    state.particles = state.particles.filter((p) => p.life < p.ttl);
    state.floaters = state.floaters.filter((f) => f.life < f.ttl);
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function drawBackground(nowPerf) {
    // Gradient backplate (in-canvas, separate from page bg)
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, "#06061a");
    g.addColorStop(0.45, "#12002f");
    g.addColorStop(1, "#001a2a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Faint grid lines
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    const spacing = 52;
    for (let x = -CANVAS_H; x < CANVAS_W + CANVAS_H; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + CANVAS_H, CANVAS_H);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = "rgba(0,245,255,0.35)";
    for (let y = 0; y <= CANVAS_H; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_W, y);
      ctx.stroke();
    }
    ctx.restore();

    // Soft scanline shimmer
    const scan = (nowPerf * 0.05) % CANVAS_H;
    const sg = ctx.createLinearGradient(0, scan - 120, 0, scan + 120);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(0.5, "rgba(255,255,255,0.08)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, scan - 120, CANVAS_W, 240);
  }

  function drawHitLine() {
    ctx.save();
    ctx.lineWidth = 5;
    ctx.shadowColor = "rgba(0,245,255,0.8)";
    ctx.shadowBlur = 20;
    ctx.strokeStyle = "rgba(0,245,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(40, HIT_LINE_Y);
    ctx.lineTo(CANVAS_W - 40, HIT_LINE_Y);
    ctx.stroke();

    // Secondary magenta glow
    ctx.shadowColor = "rgba(255,43,214,0.55)";
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,43,214,0.55)";
    ctx.beginPath();
    ctx.moveTo(40, HIT_LINE_Y + 9);
    ctx.lineTo(CANVAS_W - 40, HIT_LINE_Y + 9);
    ctx.stroke();
    ctx.restore();
  }

  function drawNotes(nowMs) {
    const laneX = CANVAS_W * 0.5;
    const w = NOTE_SIZE.w;
    const h = NOTE_SIZE.h;
    const r = NOTE_SIZE.r;

    for (const n of state.notes) {
      if (n.hit || n.judged === "MISS") continue;
      const y = computeNoteY(n.hitTimeMs, nowMs);
      if (y < SPAWN_Y - 200 || y > CANVAS_H + 200) continue;

      // Approach glow based on timing
      const delta = Math.abs(nowMs - n.hitTimeMs);
      const hot = 1 - clamp(delta / 220, 0, 1);
      const neonA = `rgba(0,245,255,${lerp(0.25, 0.95, hot)})`;
      const neonB = `rgba(255,43,214,${lerp(0.20, 0.80, hot)})`;

      ctx.save();
      ctx.translate(laneX - w / 2, y - h / 2);

      // Outer glow
      ctx.shadowBlur = 30;
      ctx.shadowColor = neonA;
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      roundRectPath(ctx, 0, 0, w, h, r);
      ctx.fill();

      // Neon fill
      ctx.shadowBlur = 18;
      ctx.shadowColor = neonB;
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "rgba(0,245,255,0.85)");
      grad.addColorStop(0.55, "rgba(255,43,214,0.75)");
      grad.addColorStop(1, "rgba(155,92,255,0.70)");
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.82;
      roundRectPath(ctx, 8, 10, w - 16, h - 20, r - 6);
      ctx.fill();

      // Inner stripe
      ctx.globalAlpha = 0.45;
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      roundRectPath(ctx, 18, 22, w - 36, 10, 8);
      ctx.fill();

      ctx.restore();
    }
  }

  function drawParticles(dtMs) {
    for (const p of state.particles) {
      p.life += dtMs;
      p.x += p.vx * dtMs;
      p.y += p.vy * dtMs;
      p.vy += 0.0012 * dtMs; // gravity-ish

      const t = clamp(p.life / p.ttl, 0, 1);
      const a = 1 - t;
      ctx.save();
      ctx.globalAlpha = 0.9 * a;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lerp(6, 1.5, t), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFloaters(dtMs) {
    for (const f of state.floaters) {
      f.life += dtMs;
      f.y += f.vy * dtMs;
      const t = clamp(f.life / f.ttl, 0, 1);
      const a = 1 - t;

      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = "900 46px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.35 * a;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(f.text, f.x, f.y + 2);
      ctx.restore();
    }
  }

  function drawLaneHints(nowMs) {
    // A subtle pulsing lane aura around the hit zone
    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.008);
    const a = 0.12 + 0.08 * pulse;

    ctx.save();
    const x = CANVAS_W * 0.5;
    const w = NOTE_SIZE.w + 110;
    const h = 240;
    const y = HIT_LINE_Y - 150;

    const rg = ctx.createRadialGradient(x, HIT_LINE_Y, 20, x, HIT_LINE_Y, 250);
    rg.addColorStop(0, `rgba(0,245,255,${a})`);
    rg.addColorStop(0.55, `rgba(255,43,214,${a * 0.65})`);
    rg.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = rg;
    roundRectPath(ctx, x - w / 2, y - h / 2, w, h, 28);
    ctx.fill();
    ctx.restore();
  }

  function renderFrame(nowPerf, dtMs) {
    const songMs = state.phase === "running" ? nowSongMs() : 0;
    drawBackground(nowPerf);
    drawLaneHints(songMs);
    drawHitLine();
    if (state.phase === "running") {
      drawNotes(songMs);
      drawParticles(dtMs);
      drawFloaters(dtMs);
    } else {
      // Idle animation in start/gameover: draw a faint hit line pulses
      drawParticles(dtMs);
      drawFloaters(dtMs);
    }

    // Minimal in-canvas footer hint (kept subtle)
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.font = "700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "center";
    ctx.fillText("Tap to the beat", CANVAS_W / 2, CANVAS_H - 40);
    ctx.restore();
  }

  // -----------------------------
  // Game loop
  // -----------------------------
  let lastPerf = performance.now();
  function tick(nowPerf) {
    const dtMs = clamp(nowPerf - lastPerf, 0, 34);
    lastPerf = nowPerf;

    if (state.phase === "running") {
      const t = nowSongMs();
      scheduleNotes(t);
      autoMiss(t);
      pruneOld(t);
    } else {
      pruneOld(0);
    }

    renderFrame(nowPerf, dtMs);
    state.runningRaf = requestAnimationFrame(tick);
  }

  function startLoopIfNeeded() {
    if (state.runningRaf) return;
    lastPerf = performance.now();
    state.runningRaf = requestAnimationFrame(tick);
  }

  // -----------------------------
  // Run control
  // -----------------------------
  async function beginRun() {
    setOverlayMessage("");
    startBtn.disabled = true;

    const song = SONGS[state.songId];
    resetRunState();

    if (!state.audio || state.audioErrored) {
      await prepareAudioForSong(song);
    }

    if (!state.audio || state.audioErrored) {
      startBtn.disabled = false;
      return;
    }

    // Rewind
    try {
      state.audio.currentTime = 0;
    } catch (_) {}

    // Required: must only start after user interaction.
    try {
      const p = state.audio.play();
      if (p && typeof p.then === "function") {
        await p;
      }
    } catch (err) {
      startBtn.disabled = false;
      setOverlayMessage(
        "Audio couldn't start (autoplay restriction or missing file). Tap again or verify assets/*.ogg or *.mp3."
      );
      return;
    }

    // Start
    state.phase = "running";
    setOverlayVisible(false);
    startBtn.textContent = "Tap to Play";
    startBtn.disabled = false;
    setOverlayMessage("");

    // Reference times (kept for debugging / future enhancements)
    state.songStartPerfNow = performance.now();
    state.songStartAudioTime = state.audio.currentTime;
  }

  function endRun(reason) {
    state.phase = "gameover";
    setOverlayVisible(true);

    // Best per-song
    if (state.score > state.best) {
      state.best = state.score;
      saveBest(state.songId, state.best);
    }
    updateHud();

    // Overlay copy
    const song = SONGS[state.songId];
    const msg = `${reason || "Game over"} • ${song.displayName} • Score: ${state.score} • Best: ${state.best}`;
    setOverlayMessage(msg);
    startBtn.textContent = "Play Again";
  }

  // -----------------------------
  // Inputs
  // -----------------------------
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      // Only accept hits when running, but allow pointerdown to focus.
      if (state.phase === "running") {
        judgeTap();
      }
      // Avoid double-tap zoom on some mobile browsers
      try {
        e.preventDefault();
      } catch (_) {}
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      if (state.phase === "running") {
        e.preventDefault();
        judgeTap();
      }
    }
    if (e.code === "Enter") {
      if (state.phase !== "running") {
        // Enter to start / restart
        beginRun().catch(() => {});
      }
    }
  });

  startBtn.addEventListener("click", () => {
    beginRun().catch(() => {});
  });

  btnGolden.addEventListener("click", () => setSelectedSong("golden"));
  btnSoda.addEventListener("click", () => setSelectedSong("sodapop"));

  // -----------------------------
  // Init
  // -----------------------------
  metaGolden.textContent = `BPM: ${SONGS.golden.bpm}`;
  metaSoda.textContent = `BPM: ${SONGS.sodapop.bpm}`;

  setSelectedSong(state.songId);
  setOverlayVisible(true);
  updateHud();
  startLoopIfNeeded();

  // If the page loses visibility, pause audio to keep sync sane.
  document.addEventListener("visibilitychange", () => {
    if (!state.audio) return;
    if (document.hidden && state.phase === "running") {
      try {
        state.audio.pause();
      } catch (_) {}
      endRun("Paused");
    }
  });
})();

