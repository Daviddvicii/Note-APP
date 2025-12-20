/* Neon Tap Defense - one-finger survival defense on HTML5 Canvas. */

(() => {
  /** @type {HTMLCanvasElement | null} */
  const canvas = document.getElementById("game");
  if (!canvas) return;
  /** @type {CanvasRenderingContext2D} */
  const ctx = canvas.getContext("2d", { alpha: false });

  // ----- Utilities ---------------------------------------------------------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };
  const norm = (x, y) => {
    const m = Math.hypot(x, y) || 1;
    return { x: x / m, y: y / m, m };
  };
  const fmtTime = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  // ----- Canvas sizing -----------------------------------------------------
  let dpr = 1;
  let w = 1;
  let h = 1;
  let cx = 0;
  let cy = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = cssW;
    h = cssH;
    cx = w * 0.5;
    cy = h * 0.5;
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();

  // ----- Game state --------------------------------------------------------
  const Phase = Object.freeze({
    Intro: "intro",
    Playing: "playing",
    Paused: "paused",
    Over: "over",
  });

  const storageKey = "neon_tap_defense_best_seconds";
  const loadBest = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      const v = raw ? Number(raw) : 0;
      return Number.isFinite(v) ? v : 0;
    } catch (_) {
      return 0;
    }
  };
  const saveBest = (v) => {
    try {
      localStorage.setItem(storageKey, String(v));
    } catch (_) {
      // ignore
    }
  };

  const state = {
    phase: Phase.Intro,
    lastNow: performance.now(),
    timeAlive: 0,
    bestSeconds: loadBest(),

    hp: 100,
    maxHp: 100,

    // dynamics
    spawnTimer: 0,
    nextSpawnIn: 1.2,
    difficulty: 0,

    // feedback
    shakeT: 0,
    flashT: 0,
  };

  const core = {
    r: 18,
    hitR: 22,
  };

  /** @type {{x:number,y:number,vx:number,vy:number,r:number,life:number,color:string,alpha:number}[]} */
  const particles = [];
  /** @type {{x:number,y:number,vx:number,vy:number,r:number,life:number,damage:number,color:string,glow:string,fromTurret:boolean}[]} */
  const bullets = [];
  /** @type {{x:number,y:number,vx:number,vy:number,r:number,hp:number,maxHp:number,color:string,glow:string}[]} */
  const enemies = [];

  const turretConfig = {
    count: 6,
    ringR: 96,
    padR: 16,
    activeDuration: 7.5,
    fireCooldown: 0.38,
    range: 520,
    bulletSpeed: 920,
    bulletDamage: 1,
  };

  /** @type {{angle:number,x:number,y:number,r:number,activeUntil:number,lastShot:number}[]} */
  const turrets = [];

  function rebuildTurrets() {
    turrets.length = 0;
    for (let i = 0; i < turretConfig.count; i++) {
      const angle = (i / turretConfig.count) * TAU - Math.PI / 2;
      const x = cx + Math.cos(angle) * turretConfig.ringR;
      const y = cy + Math.sin(angle) * turretConfig.ringR;
      turrets.push({
        angle,
        x,
        y,
        r: turretConfig.padR,
        activeUntil: 0,
        lastShot: 0,
      });
    }
  }

  rebuildTurrets();
  window.addEventListener("resize", rebuildTurrets, { passive: true });

  // ----- Spawning / damage -------------------------------------------------
  function spawnEnemy() {
    const margin = 60;
    const side = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    if (side === 0) {
      x = rand(-margin, w + margin);
      y = -margin;
    } else if (side === 1) {
      x = w + margin;
      y = rand(-margin, h + margin);
    } else if (side === 2) {
      x = rand(-margin, w + margin);
      y = h + margin;
    } else {
      x = -margin;
      y = rand(-margin, h + margin);
    }

    const t = state.timeAlive;
    const speed = 70 + Math.min(220, t * 3.2) + rand(-10, 18);
    const toughChance = clamp(0.05 + t / 90, 0.05, 0.22);
    const hp = Math.random() < toughChance ? 2 : 1;

    const d = norm(cx - x, cy - y);
    const r = hp === 2 ? 16 : 13;
    const color = hp === 2 ? "#ffd24a" : "#ff2a7f";
    const glow = hp === 2 ? "rgba(255,210,74,0.85)" : "rgba(255,42,127,0.85)";

    enemies.push({
      x,
      y,
      vx: d.x * speed,
      vy: d.y * speed,
      r,
      hp,
      maxHp: hp,
      color,
      glow,
    });
  }

  function burst(x, y, baseColor, count = 14, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = rand(40, 300) * power;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: rand(1.2, 3.4),
        life: rand(0.25, 0.8),
        color: baseColor,
        alpha: rand(0.5, 1.0),
      });
    }
  }

  function hitCore(dmg) {
    state.hp = Math.max(0, state.hp - dmg);
    state.shakeT = Math.min(0.35, state.shakeT + 0.18);
    state.flashT = Math.min(0.22, state.flashT + 0.14);
    burst(cx, cy, "rgba(64,255,178,0.85)", 18, 1.2);
    if (state.hp <= 0) {
      state.phase = Phase.Over;
      const best = Math.max(state.bestSeconds, state.timeAlive);
      if (best !== state.bestSeconds) {
        state.bestSeconds = best;
        saveBest(best);
      }
    }
  }

  // ----- Shooting ----------------------------------------------------------
  const playerWeapon = {
    cooldown: 0.16,
    lastShot: -999,
    bulletSpeed: 1250,
    bulletDamage: 1,
  };

  function fireBullet(fromX, fromY, toX, toY, speed, damage, color, glow, fromTurret) {
    const d = norm(toX - fromX, toY - fromY);
    bullets.push({
      x: fromX + d.x * (core.r + 2),
      y: fromY + d.y * (core.r + 2),
      vx: d.x * speed,
      vy: d.y * speed,
      r: 4,
      life: 1.05,
      damage,
      color,
      glow,
      fromTurret,
    });
    // muzzle sparkle
    burst(fromX + d.x * 16, fromY + d.y * 16, glow, 6, 0.7);
  }

  function tryActivateTurretAt(x, y, now) {
    for (const t of turrets) {
      if (dist2(x, y, t.x, t.y) <= (t.r * 1.35) ** 2) {
        t.activeUntil = Math.max(t.activeUntil, now / 1000 + turretConfig.activeDuration);
        burst(t.x, t.y, "rgba(87,183,255,0.9)", 12, 1.0);
        return true;
      }
    }
    return false;
  }

  function handleTap(x, y) {
    const now = performance.now();

    if (state.phase === Phase.Intro) {
      startGame();
      return;
    }
    if (state.phase === Phase.Over) {
      startGame();
      return;
    }
    if (state.phase === Phase.Paused) {
      state.phase = Phase.Playing;
      state.lastNow = now;
      return;
    }
    if (state.phase !== Phase.Playing) return;

    // First priority: turret pad activation
    if (tryActivateTurretAt(x, y, now)) return;

    // Otherwise: player shot
    const t = now / 1000;
    if (t - playerWeapon.lastShot < playerWeapon.cooldown) return;
    playerWeapon.lastShot = t;

    fireBullet(
      cx,
      cy,
      x,
      y,
      playerWeapon.bulletSpeed,
      playerWeapon.bulletDamage,
      "#ff5fd2",
      "rgba(255,95,210,0.95)",
      false
    );
  }

  // ----- Input -------------------------------------------------------------
  function pointerToCanvas(ev) {
    const r = canvas.getBoundingClientRect();
    const x = clamp(ev.clientX - r.left, 0, r.width);
    const y = clamp(ev.clientY - r.top, 0, r.height);
    return { x, y };
  }

  canvas.addEventListener(
    "pointerdown",
    (ev) => {
      ev.preventDefault();
      canvas.setPointerCapture?.(ev.pointerId);
      const p = pointerToCanvas(ev);
      handleTap(p.x, p.y);
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      handleTap(cx, cy - 120);
    }
  });

  window.addEventListener("blur", () => {
    if (state.phase === Phase.Playing) state.phase = Phase.Paused;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.phase === Phase.Playing) state.phase = Phase.Paused;
  });

  // ----- Game flow ---------------------------------------------------------
  function resetWorld() {
    bullets.length = 0;
    enemies.length = 0;
    particles.length = 0;
    for (const t of turrets) {
      t.activeUntil = 0;
      t.lastShot = 0;
    }
    state.hp = state.maxHp;
    state.timeAlive = 0;
    state.spawnTimer = 0;
    state.nextSpawnIn = 1.1;
    state.difficulty = 0;
    state.shakeT = 0;
    state.flashT = 0;
  }

  function startGame() {
    resetWorld();
    state.phase = Phase.Playing;
    state.lastNow = performance.now();
  }

  // ----- Update ------------------------------------------------------------
  function update(dt, nowS) {
    state.timeAlive += dt;
    state.difficulty = state.timeAlive;

    // spawn pacing: quicker over time, with slight jitter
    state.spawnTimer += dt;
    const targetSpawn = clamp(1.15 - state.timeAlive / 80, 0.28, 1.15);
    if (state.spawnTimer >= state.nextSpawnIn) {
      state.spawnTimer = 0;
      state.nextSpawnIn = targetSpawn * rand(0.78, 1.15);
      spawnEnemy();
      if (state.timeAlive > 25 && Math.random() < 0.12) spawnEnemy();
    }

    // turrets auto-fire
    for (const t of turrets) {
      if (nowS > t.activeUntil) continue;
      if (nowS - t.lastShot < turretConfig.fireCooldown) continue;

      // find nearest enemy
      let best = null;
      let bestD2 = turretConfig.range * turretConfig.range;
      for (const e of enemies) {
        const d2 = dist2(t.x, t.y, e.x, e.y);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = e;
        }
      }
      if (!best) continue;
      t.lastShot = nowS;
      fireBullet(
        t.x,
        t.y,
        best.x,
        best.y,
        turretConfig.bulletSpeed,
        turretConfig.bulletDamage,
        "#57b7ff",
        "rgba(87,183,255,0.95)",
        true
      );
    }

    // bullets
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }

    // enemies
    for (const e of enemies) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }

    // particles
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.18, dt);
      p.vy *= Math.pow(0.18, dt);
      p.life -= dt;
    }

    // collisions: bullets vs enemies
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      if (b.life <= 0) {
        bullets.splice(bi, 1);
        continue;
      }
      if (b.x < -120 || b.x > w + 120 || b.y < -120 || b.y > h + 120) {
        bullets.splice(bi, 1);
        continue;
      }

      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const e = enemies[ei];
        const rr = (b.r + e.r) * (b.r + e.r);
        if (dist2(b.x, b.y, e.x, e.y) <= rr) {
          e.hp -= b.damage;
          burst(b.x, b.y, b.glow, 10, 0.9);
          bullets.splice(bi, 1);
          if (e.hp <= 0) {
            burst(e.x, e.y, e.glow, 18, 1.2);
            enemies.splice(ei, 1);
          }
          break;
        }
      }
    }

    // enemies reaching core
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (dist2(e.x, e.y, cx, cy) <= (e.r + core.hitR) ** 2) {
        enemies.splice(ei, 1);
        hitCore(12 + (e.maxHp - 1) * 8);
      }
    }

    // decay feedback
    state.shakeT = Math.max(0, state.shakeT - dt);
    state.flashT = Math.max(0, state.flashT - dt);

    // clean particles
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
  }

  // ----- Render ------------------------------------------------------------
  function drawGrid() {
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "rgba(57,255,20,0.35)";
    ctx.lineWidth = 1;
    const step = 46;
    const t = performance.now() / 1000;
    const ox = (t * 18) % step;
    const oy = (t * 12) % step;
    for (let x = -step + ox; x < w + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = -step + oy; y < h + step; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    // trails
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);

    // subtle vignette / gradient
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.65);
    g.addColorStop(0, "rgba(9,14,30,0.15)");
    g.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    drawGrid();

    // screen shake
    let sx = 0;
    let sy = 0;
    if (state.shakeT > 0) {
      const k = state.shakeT / 0.35;
      sx = (Math.random() - 0.5) * 10 * k;
      sy = (Math.random() - 0.5) * 10 * k;
    }
    ctx.save();
    ctx.translate(sx, sy);

    // turret pads
    for (const t of turrets) {
      const nowS = performance.now() / 1000;
      const active = nowS < t.activeUntil;
      const frac = active ? (t.activeUntil - nowS) / turretConfig.activeDuration : 0;
      const glowA = active ? 0.75 : 0.22;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(87,183,255,${glowA})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r + (active ? 2 : 0), 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = active ? "rgba(87,183,255,0.9)" : "rgba(87,183,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r + 4, 0, TAU);
      ctx.stroke();

      // tiny timer arc (minimal UI but informative)
      if (active) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        ctx.stroke();
      }
    }

    // enemies
    for (const e of enemies) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = e.glow;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 4, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, TAU);
      ctx.fill();

      if (e.maxHp > 1) {
        // small core dot to hint "armored"
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.beginPath();
        ctx.arc(e.x, e.y, 4, 0, TAU);
        ctx.fill();
      }
    }

    // bullets + particles additive
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of bullets) {
      ctx.strokeStyle = b.glow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }
    for (const p of particles) {
      const a = clamp(p.life / 0.8, 0, 1) * p.alpha;
      ctx.fillStyle = p.color.replace("0.95", String(a)).replace("0.9", String(a));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // core
    const hpFrac = clamp(state.hp / state.maxHp, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(64,255,178,0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, 52, 0, TAU);
    ctx.fill();
    ctx.restore();

    // hp ring
    ctx.strokeStyle = "rgba(64,255,178,0.9)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, -Math.PI / 2, -Math.PI / 2 + TAU * hpFrac);
    ctx.stroke();

    // core body
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(64,255,178,0.95)";
    ctx.beginPath();
    ctx.arc(cx, cy, core.r + 6, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#0b1426";
    ctx.beginPath();
    ctx.arc(cx, cy, core.r, 0, TAU);
    ctx.fill();

    // flash overlay on damage
    if (state.flashT > 0) {
      ctx.fillStyle = `rgba(255,95,210,${0.08 * (state.flashT / 0.22)})`;
      ctx.fillRect(-sx, -sy, w, h);
    }

    ctx.restore();

    // Minimal HUD (top center)
    ctx.save();
    ctx.fillStyle = "rgba(200,255,241,0.9)";
    ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const timeText = fmtTime(state.timeAlive);
    const bestText = fmtTime(state.bestSeconds);
    ctx.fillText(`TIME ${timeText}   BEST ${bestText}`, cx, 12 + (window.visualViewport?.offsetTop || 0));
    ctx.restore();

    // Intro / Over / Paused overlays (on-canvas, minimal)
    if (state.phase !== Phase.Playing) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillStyle = "rgba(87,183,255,0.95)";
      ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      const title =
        state.phase === Phase.Intro
          ? "NEON TAP DEFENSE"
          : state.phase === Phase.Paused
            ? "PAUSED"
            : "SYSTEM DOWN";
      ctx.fillText(title, cx, cy - 34);

      ctx.fillStyle = "rgba(200,255,241,0.9)";
      ctx.font = "500 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      let msg = "";
      if (state.phase === Phase.Intro) {
        msg = "Tap to shoot. Tap glowing nodes to activate turrets.";
      } else if (state.phase === Phase.Paused) {
        msg = "Tap to resume.";
      } else {
        msg = `Survived ${fmtTime(state.timeAlive)}. Tap to restart.`;
      }
      ctx.fillText(msg, cx, cy + 8);

      ctx.fillStyle = "rgba(200,255,241,0.7)";
      ctx.font = "500 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("One finger. Minimal UI. Maximum panic.", cx, cy + 34);
      ctx.restore();
    }
  }

  // ----- Main loop ---------------------------------------------------------
  // Start with a clean frame (avoid seeing default black before trails settle)
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  function frame(now) {
    const dt = Math.min((now - state.lastNow) / 1000, 0.033);
    state.lastNow = now;

    // keep center aligned even if address bar changes viewport height
    // (some mobile browsers report innerHeight changes frequently)
    const newCx = window.innerWidth * 0.5;
    const newCy = window.innerHeight * 0.5;
    if (Math.abs(newCx - cx) > 0.5 || Math.abs(newCy - cy) > 0.5) {
      cx = newCx;
      cy = newCy;
      rebuildTurrets();
    }

    if (state.phase === Phase.Playing) {
      update(dt, now / 1000);
    }
    draw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame((t) => {
    state.lastNow = t;
    requestAnimationFrame(frame);
  });
})();

