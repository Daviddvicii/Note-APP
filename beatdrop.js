/* Neon Beat Drop (Cytus-style)
 * Tap the circles on the beat. Beat grid sync is per-song (BPM + offset).
 * Audio is loaded from local files in ./assets.
 */

(() => {
  "use strict";

  // -----------------------------
  // Tunable constants (game feel)
  // -----------------------------
  const CANVAS_W = 720;
  const CANVAS_H = 1280;

  // Judgement windows (timing)
  const PERFECT_WINDOW_MS = 65;
  const GOOD_WINDOW_MS = 135;
  const TAP_MISS_WINDOW_MS = 190; // ignore taps far from any circle

  // Circle visuals
  const CIRCLE_R = 62;
  const APPROACH_MS = 900; // how long the approach ring shrinks
  const DESPAWN_MS = 1400; // keep after hit time for auto-miss / fade
  const SAFE_MARGIN = 95; // keep circles away from edges

  // Beat scheduling
  const LEAD_IN_MS = 900; // delay before first circle appears (after start)
  const LOOKAHEAD_MS = 2200; // schedule ahead of current song time

  // Scoring
  const SCORE_PERFECT = 100;
  const SCORE_GOOD = 60;
  const MULT_STEP = 0.1; // per 10 combo
  const MULT_CAP = 2.0; // max multiplier

  // -----------------------------
  // Song metadata (easy to tweak)
  // -----------------------------
  const ASSETS_DIR = new URL("./assets/", document.baseURI);
  function assetUrl(filename) {
    return new URL(filename, ASSETS_DIR).toString();
  }

  const SONGS = {
    golden: {
      displayName: "Demon Hunter - Golden",
      audioCandidates: [assetUrl("golden.mp3")],
      bpm: 140,
      offsetMs: 0,
    },
    sodapop: {
      displayName: "Soda Pop",
      audioCandidates: [assetUrl("sodapop.mp3")],
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

  const syncBpm = document.getElementById("syncBpm");
  const syncOffset = document.getElementById("syncOffset");
  const bpmDownBtn = document.getElementById("bpmDownBtn");
  const bpmUpBtn = document.getElementById("bpmUpBtn");
  const offsetDownBtn = document.getElementById("offsetDownBtn");
  const offsetUpBtn = document.getElementById("offsetUpBtn");
  const calibrateBtn = document.getElementById("calibrateBtn");

  const hudScore = document.getElementById("hudScore");
  const hudBest = document.getElementById("hudBest");
  const hudCombo = document.getElementById("hudCombo");

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
  function dist2(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
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

  function syncKey(songId) {
    return `neon-beatdrop-sync:${songId}`;
  }
  function loadSync(songId) {
    const base = SONGS[songId];
    try {
      const raw = localStorage.getItem(syncKey(songId));
      if (!raw) return { bpm: base.bpm, offsetMs: base.offsetMs || 0 };
      const parsed = JSON.parse(raw);
      const bpm = Number(parsed?.bpm);
      const offsetMs = Number(parsed?.offsetMs);
      return {
        bpm: Number.isFinite(bpm) ? clamp(bpm, 60, 220) : base.bpm,
        offsetMs: Number.isFinite(offsetMs) ? clamp(offsetMs, -2000, 2000) : (base.offsetMs || 0),
      };
    } catch (_) {
      return { bpm: base.bpm, offsetMs: base.offsetMs || 0 };
    }
  }
  function saveSync(songId, sync) {
    localStorage.setItem(syncKey(songId), JSON.stringify(sync));
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

  // Deterministic pseudo-random for stable circle positions per beat
  function hash01(n) {
    // xorshift-ish -> [0,1)
    let x = (n | 0) + 0x6d2b79f5;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  function circlePosForId(idNum) {
    const rx = hash01(idNum * 7919);
    const ry = hash01(idNum * 104729);
    const x = lerp(SAFE_MARGIN, CANVAS_W - SAFE_MARGIN, rx);
    const y = lerp(SAFE_MARGIN + 90, CANVAS_H - SAFE_MARGIN - 60, ry);
    return { x, y };
  }

  function pointerToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    return { x, y };
  }

  function comboMultiplier() {
    const step = Math.floor(state.combo / 10);
    return clamp(1 + step * MULT_STEP, 1, MULT_CAP);
  }

  function addFloater(text, x, y, color) {
    state.floaters.push({ text, x, y, vy: -0.18, life: 0, ttl: 900, color });
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

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    phase: "start", // "start" | "running" | "gameover"
    songId: "golden",

    // beat sync (effective values used by gameplay)
    bpm: SONGS.golden.bpm,
    offsetMs: SONGS.golden.offsetMs || 0,
    beatIntervalMs: 60000 / SONGS.golden.bpm,

    // audio
    audio: null,
    audioReady: false,
    audioErrored: false,

    // gameplay
    score: 0,
    combo: 0,
    best: 0,

    circles: [], // {id, hitTimeMs, x, y, judged:null|"PERFECT"|"GOOD"|"MISS", hit:boolean}
    nextBeatIndex: 0,

    particles: [], // {x,y,vx,vy,life,ttl,color}
    floaters: [], // {text,x,y,vy,life,ttl,color}

    // calibration mode
    calibrating: false,
    calibTaps: [], // audio ms timestamps

    runningRaf: 0,
  };

  function applySyncToState(songId) {
    const s = loadSync(songId);
    state.bpm = s.bpm;
    state.offsetMs = s.offsetMs;
    state.beatIntervalMs = 60000 / state.bpm;
    syncBpm.textContent = String(Math.round(state.bpm));
    syncOffset.textContent = String(Math.round(state.offsetMs));
  }

  function updateSongMeta() {
    const g = loadSync("golden");
    const s = loadSync("sodapop");
    metaGolden.textContent = `BPM: ${Math.round(g.bpm)}`;
    metaSoda.textContent = `BPM: ${Math.round(s.bpm)}`;
  }

  function setSelectedSong(songId) {
    state.songId = songId;
    btnGolden.classList.toggle("selected", songId === "golden");
    btnSoda.classList.toggle("selected", songId === "sodapop");

    state.best = loadBest(songId);
    applySyncToState(songId);
    updateSongMeta();
    updateHud();

    // Reset overlay text on selection
    setOverlayMessage("");
    startBtn.textContent = state.phase === "gameover" ? "Play Again" : "Tap to Play";
    startBtn.disabled = false;

    // Preload audio element (without playing)
    prepareAudioForSong(SONGS[songId]).catch(() => {});
  }

  // -----------------------------
  // Audio load
  // -----------------------------
  function pickPlayableSrc(audioEl, candidates) {
    const canMp3 = audioEl.canPlayType("audio/mpeg") || audioEl.canPlayType("audio/mp3");
    const mp3 = candidates.find((p) => p.toLowerCase().endsWith(".mp3"));
    if (mp3 && canMp3) return mp3;
    return candidates[0];
  }

  async function prepareAudioForSong(song) {
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
    audio.crossOrigin = "anonymous";
    audio.src = pickPlayableSrc(audio, song.audioCandidates);

    state.audio = audio;

    audio.onended = () => {
      if (state.phase === "running") endRun("Song ended");
    };

    audio.onerror = () => {
      state.audioErrored = true;
      state.audioReady = false;
      setOverlayMessage(`Couldn't load audio. Expected "${song.audioCandidates.join('" or "')}".`);
    };

    await new Promise((resolve) => {
      const done = () => resolve();
      audio.onloadedmetadata = done;
      audio.oncanplaythrough = done;
      try {
        audio.load();
      } catch (_) {}
      setTimeout(done, 1200);
    });

    if (!state.audioErrored) {
      state.audioReady = true;
      setOverlayMessage("");
    }
  }

  function nowSongMs() {
    if (!state.audio) return 0;
    // offsetMs shifts beat grid relative to audio time
    return state.audio.currentTime * 1000 - (state.offsetMs || 0);
  }

  // -----------------------------
  // Beat scheduling + circles
  // -----------------------------
  function patternAllowsBeat(i) {
    // Deterministic pattern: mostly on-beat, some rests.
    if (i < 2) return false;
    if (i % 16 === 12 || i % 16 === 13) return false;
    return true;
  }

  function resetRunState(keepScore) {
    if (!keepScore) {
      state.score = 0;
      state.combo = 0;
    }
    state.circles = [];
    state.particles = [];
    state.floaters = [];
    state.nextBeatIndex = 0;
  }

  function ensureNextBeatIndex(nowMs) {
    // Start spawning after LEAD_IN_MS from current song time
    const target = nowMs + LEAD_IN_MS;
    const i = Math.max(0, Math.floor(target / state.beatIntervalMs));
    if (state.nextBeatIndex < i) state.nextBeatIndex = i;
  }

  function pushCircle(hitTimeMs, idNum) {
    const { x, y } = circlePosForId(idNum);
    state.circles.push({
      id: `${state.songId}:${idNum}`,
      hitTimeMs,
      x,
      y,
      hit: false,
      judged: null,
    });
  }

  function scheduleCircles(nowMs) {
    ensureNextBeatIndex(nowMs);
    const horizon = nowMs + LOOKAHEAD_MS;

    while (true) {
      const hitTimeMs = state.nextBeatIndex * state.beatIntervalMs;
      if (hitTimeMs > horizon) break;

      if (patternAllowsBeat(state.nextBeatIndex)) {
        pushCircle(hitTimeMs, state.nextBeatIndex);

        // occasional off-beat
        if (state.nextBeatIndex % 8 === 4) {
          pushCircle(hitTimeMs + state.beatIntervalMs * 0.5, state.nextBeatIndex + 100000);
        }
      }

      state.nextBeatIndex += 1;
    }
  }

  function pruneOld(nowMs) {
    state.circles = state.circles.filter((c) => nowMs - c.hitTimeMs < DESPAWN_MS);
    state.particles = state.particles.filter((p) => p.life < p.ttl);
    state.floaters = state.floaters.filter((f) => f.life < f.ttl);
  }

  function autoMiss(nowMs) {
    for (const c of state.circles) {
      if (c.hit || c.judged) continue;
      if (nowMs - c.hitTimeMs > GOOD_WINDOW_MS) {
        c.judged = "MISS";
        state.combo = 0;
        addFloater("MISS", c.x, c.y - 90, "rgba(255,110,110,1)");
      }
    }
  }

  function getClosestHittableCircle(nowMs, px, py) {
    let best = null;
    let bestDelta = Infinity;
    const r2 = (CIRCLE_R * 1.15) * (CIRCLE_R * 1.15);
    for (const c of state.circles) {
      if (c.hit || c.judged) continue;
      const d2 = dist2(px, py, c.x, c.y);
      if (d2 > r2) continue;
      const dt = Math.abs(nowMs - c.hitTimeMs);
      if (dt < bestDelta) {
        bestDelta = dt;
        best = c;
      }
    }
    return { circle: best, delta: bestDelta };
  }

  function registerHit(circle, label, baseScore) {
    circle.hit = true;
    circle.judged = label;

    state.combo += 1;
    const mult = comboMultiplier();
    state.score += Math.round(baseScore * mult);

    const color = label === "PERFECT" ? "rgba(0,245,255,1)" : "rgba(255,43,214,1)";
    addFloater(label, circle.x, circle.y - 90, color);
    burst(circle.x, circle.y, "rgba(0,245,255,0.95)", "rgba(255,43,214,0.95)");
    updateHud();
  }

  function registerMiss(circle) {
    circle.hit = false;
    circle.judged = "MISS";
    state.combo = 0;
    addFloater("MISS", circle.x, circle.y - 90, "rgba(255,110,110,1)");
    burst(circle.x, circle.y, "rgba(255,110,110,0.9)", "rgba(155,92,255,0.9)");
    updateHud();
  }

  function handleTapAt(px, py) {
    if (state.phase !== "running") return;
    if (!state.audio) return;

    const t = nowSongMs();

    // Calibration taps: capture beat timing from audio clock
    if (state.calibrating) {
      state.calibTaps.push(state.audio.currentTime * 1000);
      const left = Math.max(0, 8 - state.calibTaps.length);
      addFloater(left ? `CAL ${left}` : "CAL ✓", px, py - 70, "rgba(0,245,255,1)");
      if (state.calibTaps.length >= 8) finishCalibration();
      return;
    }

    const { circle, delta } = getClosestHittableCircle(t, px, py);
    if (!circle || delta > TAP_MISS_WINDOW_MS) return;

    if (delta <= PERFECT_WINDOW_MS) {
      registerHit(circle, "PERFECT", SCORE_PERFECT);
    } else if (delta <= GOOD_WINDOW_MS) {
      registerHit(circle, "GOOD", SCORE_GOOD);
    } else {
      registerMiss(circle);
    }
  }

  // -----------------------------
  // Calibration + sync tweaks
  // -----------------------------
  function setSyncAndPersist(bpm, offsetMs) {
    const next = {
      bpm: clamp(bpm, 60, 220),
      offsetMs: clamp(offsetMs, -2000, 2000),
    };
    saveSync(state.songId, next);
    applySyncToState(state.songId);
    updateSongMeta();

    // If playing, re-align the beat grid immediately.
    if (state.phase === "running") {
      resetRunState(true);
      ensureNextBeatIndex(nowSongMs());
    }
  }

  function startCalibration() {
    if (state.phase !== "running") {
      // Start playing and enter calibration mode.
      beginRun(true).catch(() => {});
      return;
    }
    state.calibrating = true;
    state.calibTaps = [];
    addFloater("CALIBRATE", CANVAS_W / 2, 110, "rgba(0,245,255,1)");
  }

  function finishCalibration() {
    const taps = state.calibTaps.slice();
    state.calibrating = false;
    state.calibTaps = [];
    if (taps.length < 4) return;

    // intervals (ms)
    const iv = [];
    for (let i = 1; i < taps.length; i++) {
      const d = taps[i] - taps[i - 1];
      if (d > 200 && d < 1500) iv.push(d);
    }
    if (iv.length < 3) return;
    iv.sort((a, b) => a - b);
    const med = iv[Math.floor(iv.length / 2)];
    const bpm = clamp(60000 / med, 60, 220);
    const interval = 60000 / bpm;

    // Choose offset so current tap aligns to nearest beat gridline.
    const audioMs = taps[taps.length - 1];
    const k = Math.round(audioMs / interval);
    const offsetMs = audioMs - k * interval;

    setSyncAndPersist(bpm, offsetMs);
    addFloater("SYNCED", CANVAS_W / 2, 150, "rgba(255,43,214,1)");
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function drawBackground(nowPerf) {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, "#06061a");
    g.addColorStop(0.45, "#12002f");
    g.addColorStop(1, "#001a2a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

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

    const scan = (nowPerf * 0.05) % CANVAS_H;
    const sg = ctx.createLinearGradient(0, scan - 120, 0, scan + 120);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(0.5, "rgba(255,255,255,0.08)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, scan - 120, CANVAS_W, 240);
  }

  function drawCircle(c, nowMs) {
    if (c.judged === "MISS") return;
    if (c.hit) return;

    const dt = c.hitTimeMs - nowMs;
    const t = clamp(1 - dt / APPROACH_MS, 0, 1); // 0 -> far, 1 -> on-time
    const show = dt < APPROACH_MS + 180 && dt > -GOOD_WINDOW_MS - 120;
    if (!show) return;

    const hot = clamp(1 - Math.abs(dt) / 220, 0, 1);
    const neonA = `rgba(0,245,255,${lerp(0.25, 0.95, hot)})`;
    const neonB = `rgba(255,43,214,${lerp(0.20, 0.80, hot)})`;

    const ringR = lerp(CIRCLE_R * 2.6, CIRCLE_R, t);
    const fillA = lerp(0.10, 0.72, t);

    // approach ring
    ctx.save();
    ctx.lineWidth = lerp(10, 6, t);
    ctx.shadowBlur = 22;
    ctx.shadowColor = neonA;
    ctx.strokeStyle = neonA;
    ctx.beginPath();
    ctx.arc(c.x, c.y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // main circle
    ctx.shadowBlur = 26;
    ctx.shadowColor = neonB;
    const grad = ctx.createRadialGradient(c.x - 10, c.y - 12, 10, c.x, c.y, CIRCLE_R * 1.2);
    grad.addColorStop(0, `rgba(255,255,255,${fillA})`);
    grad.addColorStop(0.35, "rgba(0,245,255,0.35)");
    grad.addColorStop(0.85, "rgba(255,43,214,0.25)");
    grad.addColorStop(1, "rgba(155,92,255,0.18)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, CIRCLE_R, 0, Math.PI * 2);
    ctx.fill();

    // inner core
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(c.x, c.y, lerp(10, 16, hot), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles(dtMs) {
    for (const p of state.particles) {
      p.life += dtMs;
      p.x += p.vx * dtMs;
      p.y += p.vy * dtMs;
      p.vy += 0.0012 * dtMs;

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

  function drawTopHint(nowMs) {
    if (state.phase !== "running") return;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.font = "800 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    const msg = state.calibrating ? "CALIBRATING: tap 8 beats" : "Tap the circles on beat";
    ctx.fillText(msg, CANVAS_W / 2, 42);
    ctx.restore();
  }

  function renderFrame(nowPerf, dtMs) {
    const songMs = state.phase === "running" ? nowSongMs() : 0;
    drawBackground(nowPerf);

    if (state.phase === "running") {
      for (const c of state.circles) drawCircle(c, songMs);
      drawTopHint(songMs);
    }

    drawParticles(dtMs);
    drawFloaters(dtMs);

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.font = "700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "center";
    ctx.fillText("Tap circles • Space on desktop", CANVAS_W / 2, CANVAS_H - 40);
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
      scheduleCircles(t);
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
  async function beginRun(enterCalibration) {
    setOverlayMessage("");
    startBtn.disabled = true;

    const baseSong = SONGS[state.songId];
    resetRunState(false);

    if (!state.audio || state.audioErrored) {
      await prepareAudioForSong(baseSong);
    }
    if (!state.audio || state.audioErrored) {
      startBtn.disabled = false;
      return;
    }

    try {
      state.audio.currentTime = 0;
    } catch (_) {}

    try {
      const p = state.audio.play();
      if (p && typeof p.then === "function") await p;
    } catch (_) {
      startBtn.disabled = false;
      setOverlayMessage("Audio couldn't start. Tap again or verify assets/*.mp3.");
      return;
    }

    state.phase = "running";
    setOverlayVisible(false);
    startBtn.textContent = "Tap to Play";
    startBtn.disabled = false;
    setOverlayMessage("");

    state.calibrating = Boolean(enterCalibration);
    state.calibTaps = [];
  }

  function endRun(reason) {
    state.phase = "gameover";
    state.calibrating = false;
    state.calibTaps = [];
    setOverlayVisible(true);

    if (state.score > state.best) {
      state.best = state.score;
      saveBest(state.songId, state.best);
    }
    updateHud();

    const song = SONGS[state.songId];
    const msg = `${reason || "Game over"} • ${song.displayName} • Score: ${state.score} • Best: ${state.best}`;
    setOverlayMessage(msg);
    startBtn.textContent = "Play Again";
  }

  // -----------------------------
  // Inputs + sync UI
  // -----------------------------
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (state.phase === "running") {
        const { x, y } = pointerToCanvas(e);
        handleTapAt(x, y);
      }
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
        handleTapAt(CANVAS_W / 2, CANVAS_H / 2);
      }
    }
    if (e.code === "Enter") {
      if (state.phase !== "running") beginRun(false).catch(() => {});
    }
    if (e.code === "KeyC") {
      if (state.phase === "running") startCalibration();
    }
  });

  startBtn.addEventListener("click", () => beginRun(false).catch(() => {}));
  calibrateBtn.addEventListener("click", () => startCalibration());

  bpmDownBtn.addEventListener("click", () => setSyncAndPersist(state.bpm - 1, state.offsetMs));
  bpmUpBtn.addEventListener("click", () => setSyncAndPersist(state.bpm + 1, state.offsetMs));
  offsetDownBtn.addEventListener("click", () => setSyncAndPersist(state.bpm, state.offsetMs - 25));
  offsetUpBtn.addEventListener("click", () => setSyncAndPersist(state.bpm, state.offsetMs + 25));

  btnGolden.addEventListener("click", () => setSelectedSong("golden"));
  btnSoda.addEventListener("click", () => setSelectedSong("sodapop"));

  // -----------------------------
  // Init
  // -----------------------------
  updateSongMeta();
  setSelectedSong(state.songId);
  setOverlayVisible(true);
  updateHud();
  startLoopIfNeeded();

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

