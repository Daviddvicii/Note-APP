// Neon Rift Split — MVP
// Split-screen survival: control two avatars, dodge hazards, survive your attention budget.

(function () {
  "use strict";

  // ── Constants ──
  const W = 900, H = 600;
  const AW = W / 2;              // arena width
  const DIVIDER = 3;             // center divider thickness
  const PLAYER_R = 14;
  const PLAYER_SPEED = 260;      // px/s
  const FRICTION = 0.88;
  const NEAR_MISS_DIST = 8;
  const RIFT_COOLDOWN = 6;

  const DART_SPEED_BASE = 320;
  const DART_SPEED_MAX = 600;
  const DART_TELE_BASE = 0.6;
  const DART_TELE_MIN = 0.28;
  const DART_RADIUS = 6;

  const LASER_TELE_BASE = 0.9;
  const LASER_TELE_MIN = 0.4;
  const LASER_ACTIVE = 0.3;
  const LASER_WIDTH = 8;

  const SPAWN_INTERVAL_BASE = 1.6;
  const SPAWN_INTERVAL_MIN = 0.32;

  // ── Canvas setup ──
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  let scale = 1;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    scale = Math.min(ww / W, wh / H);
    canvas.style.width = (W * scale) + "px";
    canvas.style.height = (H * scale) + "px";
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ── State ──
  const SCREEN_START = 0, SCREEN_PLAY = 1, SCREEN_OVER = 2;
  let screen = SCREEN_START;
  let score = 0;
  let bestScore = parseInt(localStorage.getItem("neon-rift-best")) || 0;
  let elapsed = 0;
  let difficulty = 0;
  let riftCooldown = 0;
  let nearMissCount = 0;

  // Players
  function makePlayer(arenaIdx) {
    return {
      arena: arenaIdx,
      x: AW / 2,
      y: H * 0.7,
      vx: 0, vy: 0,
      r: PLAYER_R,
      alive: true,
      trail: [],
      invincible: 0,
    };
  }
  let pL, pR;

  // Hazards per arena
  let hazardsL = [], hazardsR = [];
  let spawnTimerL = 0, spawnTimerR = 0;

  // Particles
  let particles = [];

  // ── Input ──
  const keys = {};
  window.addEventListener("keydown", e => { keys[e.code] = true; e.preventDefault(); });
  window.addEventListener("keyup", e => { keys[e.code] = false; });

  // Mobile touch joysticks
  let touchL = null, touchR = null;
  const touchOrigins = {};

  function screenToWorld(tx, ty) {
    const rect = canvas.getBoundingClientRect();
    return { x: (tx - rect.left) / scale, y: (ty - rect.top) / scale };
  }

  canvas.addEventListener("touchstart", e => {
    for (const t of e.changedTouches) {
      const pos = screenToWorld(t.clientX, t.clientY);
      const side = pos.x < W / 2 ? "L" : "R";
      touchOrigins[t.identifier] = { ox: pos.x, oy: pos.y, side };
      if (side === "L") touchL = { dx: 0, dy: 0 };
      else touchR = { dx: 0, dy: 0 };
    }
    if (screen === SCREEN_START) startGame();
    if (screen === SCREEN_OVER) startGame();
  }, { passive: true });

  canvas.addEventListener("touchmove", e => {
    for (const t of e.changedTouches) {
      const origin = touchOrigins[t.identifier];
      if (!origin) continue;
      const pos = screenToWorld(t.clientX, t.clientY);
      const dx = pos.x - origin.ox;
      const dy = pos.y - origin.oy;
      const maxDist = 40;
      const dist = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(dist, maxDist);
      const nx = (dx / dist) * (clamped / maxDist);
      const ny = (dy / dist) * (clamped / maxDist);
      if (origin.side === "L") touchL = { dx: nx, dy: ny };
      else touchR = { dx: nx, dy: ny };
    }
  }, { passive: true });

  canvas.addEventListener("touchend", e => {
    for (const t of e.changedTouches) {
      const origin = touchOrigins[t.identifier];
      if (!origin) continue;
      if (origin.side === "L") touchL = null;
      else touchR = null;
      delete touchOrigins[t.identifier];
    }
  }, { passive: true });

  // ── Game init ──
  function startGame() {
    screen = SCREEN_PLAY;
    score = 0;
    elapsed = 0;
    difficulty = 0;
    riftCooldown = 0;
    nearMissCount = 0;
    pL = makePlayer(0);
    pR = makePlayer(1);
    hazardsL = [];
    hazardsR = [];
    spawnTimerL = 1.0;
    spawnTimerR = 1.2;
    particles = [];
  }

  // ── Difficulty curve ──
  function getDifficulty(t) {
    return Math.min(t / 60, 1);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function spawnInterval() {
    return lerp(SPAWN_INTERVAL_BASE, SPAWN_INTERVAL_MIN, difficulty);
  }

  function dartTelegraph() {
    return lerp(DART_TELE_BASE, DART_TELE_MIN, difficulty);
  }

  function dartSpeed() {
    return lerp(DART_SPEED_BASE, DART_SPEED_MAX, difficulty);
  }

  function laserTelegraph() {
    return lerp(LASER_TELE_BASE, LASER_TELE_MIN, difficulty);
  }

  // ── Hazard factories ──
  function spawnDart(arena, targetX, targetY) {
    const side = Math.floor(Math.random() * 4);
    let sx, sy;
    if (side === 0) { sx = Math.random() * AW; sy = -20; }
    else if (side === 1) { sx = Math.random() * AW; sy = H + 20; }
    else if (side === 2) { sx = -20; sy = Math.random() * H; }
    else { sx = AW + 20; sy = Math.random() * H; }

    const dx = targetX - sx;
    const dy = targetY - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = dartSpeed();
    return {
      type: "dart",
      phase: "telegraph",
      timer: dartTelegraph(),
      sx, sy,
      tx: targetX, ty: targetY,
      x: sx, y: sy,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      r: DART_RADIUS,
      life: 3,
    };
  }

  function spawnLaser(arena) {
    const horizontal = Math.random() < 0.5;
    const pos = horizontal
      ? 40 + Math.random() * (H - 80)
      : 40 + Math.random() * (AW - 80);
    return {
      type: "laser",
      phase: "telegraph",
      timer: laserTelegraph(),
      activeTimer: LASER_ACTIVE,
      horizontal,
      pos,
      width: LASER_WIDTH,
    };
  }

  function spawnHazard(arena, player) {
    if (Math.random() < 0.55) {
      return spawnDart(arena, player.x, player.y);
    }
    return spawnLaser(arena);
  }

  // ── Update ──
  function updatePlayer(p, dt, dxInput, dyInput) {
    if (!p.alive) return;
    p.vx += dxInput * PLAYER_SPEED * dt * 8;
    p.vy += dyInput * PLAYER_SPEED * dt * 8;
    p.vx *= FRICTION;
    p.vy *= FRICTION;

    const speed = Math.hypot(p.vx, p.vy);
    if (speed > PLAYER_SPEED) {
      p.vx = (p.vx / speed) * PLAYER_SPEED;
      p.vy = (p.vy / speed) * PLAYER_SPEED;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    p.x = Math.max(p.r, Math.min(AW - p.r, p.x));
    p.y = Math.max(p.r, Math.min(H - p.r, p.y));

    if (p.invincible > 0) p.invincible -= dt;

    p.trail.push({ x: p.x, y: p.y, a: 1 });
    if (p.trail.length > 12) p.trail.shift();
  }

  function getInputLeft() {
    let dx = 0, dy = 0;
    if (keys["KeyA"] || keys["KeyLeft"]) dx -= 1;
    if (keys["KeyD"]) dx += 1;
    if (keys["KeyW"]) dy -= 1;
    if (keys["KeyS"]) dy += 1;
    if (touchL) { dx = touchL.dx; dy = touchL.dy; }
    return { dx, dy };
  }

  function getInputRight() {
    let dx = 0, dy = 0;
    if (keys["ArrowLeft"]) dx -= 1;
    if (keys["ArrowRight"]) dx += 1;
    if (keys["ArrowUp"]) dy -= 1;
    if (keys["ArrowDown"]) dy += 1;
    if (touchR) { dx = touchR.dx; dy = touchR.dy; }
    return { dx, dy };
  }

  function updateHazards(hazards, player, dt) {
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      if (h.type === "dart") {
        if (h.phase === "telegraph") {
          h.timer -= dt;
          if (h.timer <= 0) h.phase = "active";
        } else {
          h.x += h.vx * dt;
          h.y += h.vy * dt;
          h.life -= dt;
          if (h.life <= 0 || h.x < -50 || h.x > AW + 50 || h.y < -50 || h.y > H + 50) {
            hazards.splice(i, 1);
            continue;
          }
          if (player.alive && player.invincible <= 0) {
            const dist = Math.hypot(h.x - player.x, h.y - player.y);
            if (dist < h.r + player.r) {
              player.alive = false;
              spawnDeathParticles(player);
            } else if (dist < h.r + player.r + NEAR_MISS_DIST) {
              nearMissCount++;
              score += 5;
              spawnNearMissParticles(player);
            }
          }
        }
      } else if (h.type === "laser") {
        if (h.phase === "telegraph") {
          h.timer -= dt;
          if (h.timer <= 0) h.phase = "active";
        } else {
          h.activeTimer -= dt;
          if (h.activeTimer <= 0) {
            hazards.splice(i, 1);
            continue;
          }
          if (player.alive && player.invincible <= 0) {
            let hit = false;
            if (h.horizontal) {
              hit = Math.abs(player.y - h.pos) < h.width / 2 + player.r;
            } else {
              hit = Math.abs(player.x - h.pos) < h.width / 2 + player.r;
            }
            if (hit) {
              player.alive = false;
              spawnDeathParticles(player);
            } else {
              let nearDist;
              if (h.horizontal) nearDist = Math.abs(player.y - h.pos) - h.width / 2;
              else nearDist = Math.abs(player.x - h.pos) - h.width / 2;
              if (nearDist > 0 && nearDist < player.r + NEAR_MISS_DIST) {
                nearMissCount++;
                score += 3;
              }
            }
          }
        }
      }
    }
  }

  function spawnDeathParticles(p) {
    const colors = ["#ff2bd6", "#00e5ff", "#ff4444", "#ffcc33"];
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 200;
      particles.push({
        x: p.x, y: p.y,
        arena: p.arena,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 2 + Math.random() * 4,
        life: 0.5 + Math.random() * 0.8,
        maxLife: 0.5 + Math.random() * 0.8,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  function spawnNearMissParticles(p) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 80;
      particles.push({
        x: p.x, y: p.y,
        arena: p.arena,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 1.5 + Math.random() * 2,
        life: 0.3 + Math.random() * 0.3,
        maxLife: 0.3 + Math.random() * 0.3,
        color: "#ffcc33",
      });
    }
  }

  function spawnRiftParticles() {
    const colors = ["#8b5cff", "#00e5ff", "#ff2bd6"];
    for (const p of [pL, pR]) {
      for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 120;
        particles.push({
          x: p.x, y: p.y,
          arena: p.arena,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 2 + Math.random() * 3,
          life: 0.4 + Math.random() * 0.4,
          maxLife: 0.4 + Math.random() * 0.4,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function riftPulse() {
    if (riftCooldown > 0) return;
    if (!pL.alive || !pR.alive) return;
    const tmpX = pL.x, tmpY = pL.y;
    pL.x = pR.x; pL.y = pR.y;
    pR.x = tmpX; pR.y = tmpY;
    pL.invincible = 0.3;
    pR.invincible = 0.3;
    riftCooldown = RIFT_COOLDOWN;
    spawnRiftParticles();
  }

  function update(dt) {
    if (screen !== SCREEN_PLAY) return;

    elapsed += dt;
    difficulty = getDifficulty(elapsed);

    // Score
    score += dt;

    // Rift cooldown
    if (riftCooldown > 0) riftCooldown = Math.max(0, riftCooldown - dt);

    // Rift input
    if (keys["Space"]) {
      keys["Space"] = false;
      riftPulse();
    }

    // Players
    const iL = getInputLeft();
    const iR = getInputRight();
    updatePlayer(pL, dt, iL.dx, iL.dy);
    updatePlayer(pR, dt, iR.dx, iR.dy);

    // Spawn hazards
    spawnTimerL -= dt;
    spawnTimerR -= dt;
    if (spawnTimerL <= 0) {
      hazardsL.push(spawnHazard(0, pL));
      spawnTimerL = spawnInterval() * (0.8 + Math.random() * 0.4);
    }
    if (spawnTimerR <= 0) {
      hazardsR.push(spawnHazard(1, pR));
      spawnTimerR = spawnInterval() * (0.8 + Math.random() * 0.4);
    }

    // Update hazards
    updateHazards(hazardsL, pL, dt);
    updateHazards(hazardsR, pR, dt);

    // Particles
    updateParticles(dt);

    // Death check
    if (!pL.alive || !pR.alive) {
      const finalScore = Math.floor(score);
      if (finalScore > bestScore) {
        bestScore = finalScore;
        localStorage.setItem("neon-rift-best", bestScore);
      }
      screen = SCREEN_OVER;
    }
  }

  // ── Drawing helpers ──
  function drawGrid(xOff) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(xOff, 0, AW, H);
    ctx.clip();

    const gridSize = 40;
    const scrollY = (elapsed * 15) % gridSize;
    ctx.strokeStyle = "rgba(0,255,200,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= AW; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(xOff + x, 0);
      ctx.lineTo(xOff + x, H);
      ctx.stroke();
    }
    for (let y = -gridSize + scrollY; y <= H; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(xOff, y);
      ctx.lineTo(xOff + AW, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(p, xOff, color, glowColor) {
    if (!p.alive) return;

    // Trail
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      const a = (i / p.trail.length) * 0.3;
      ctx.beginPath();
      ctx.arc(xOff + t.x, t.y, p.r * (i / p.trail.length) * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = glowColor.replace("1)", a + ")");
      ctx.fill();
    }

    // Invincibility flash
    if (p.invincible > 0 && Math.floor(p.invincible * 20) % 2 === 0) return;

    // Glow
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(xOff + p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Inner bright
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(xOff + p.x, p.y, p.r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }

  function drawDart(h, xOff) {
    if (h.phase === "telegraph") {
      const alpha = 0.3 + 0.4 * Math.abs(Math.sin(elapsed * 12));
      ctx.save();
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = `rgba(255,43,214,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xOff + h.sx, h.sy);
      ctx.lineTo(xOff + h.tx, h.ty);
      ctx.stroke();
      ctx.setLineDash([]);

      // Spawn point indicator
      ctx.beginPath();
      ctx.arc(xOff + h.sx, h.sy, 4 + 3 * Math.sin(elapsed * 10), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,43,214,${alpha})`;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.shadowColor = "#ff2bd6";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(xOff + h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fillStyle = "#ff2bd6";
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(xOff + h.x, h.y, h.r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  }

  function drawLaser(h, xOff) {
    if (h.phase === "telegraph") {
      const alpha = 0.15 + 0.35 * Math.abs(Math.sin(elapsed * 8));
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = `rgba(0,229,255,${alpha})`;
      ctx.lineWidth = h.width;
      ctx.beginPath();
      if (h.horizontal) {
        ctx.moveTo(xOff, h.pos);
        ctx.lineTo(xOff + AW, h.pos);
      } else {
        ctx.moveTo(xOff + h.pos, 0);
        ctx.lineTo(xOff + h.pos, H);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else {
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 18;
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = h.width;
      ctx.beginPath();
      if (h.horizontal) {
        ctx.moveTo(xOff, h.pos);
        ctx.lineTo(xOff + AW, h.pos);
      } else {
        ctx.moveTo(xOff + h.pos, 0);
        ctx.lineTo(xOff + h.pos, H);
      }
      ctx.stroke();

      // Bright center
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (h.horizontal) {
        ctx.moveTo(xOff, h.pos);
        ctx.lineTo(xOff + AW, h.pos);
      } else {
        ctx.moveTo(xOff + h.pos, 0);
        ctx.lineTo(xOff + h.pos, H);
      }
      ctx.stroke();
    }
  }

  function drawHazards(hazards, xOff) {
    for (const h of hazards) {
      if (h.type === "dart") drawDart(h, xOff);
      else drawLaser(h, xOff);
    }
  }

  function drawParticlesForArena(arenaIdx, xOff) {
    for (const p of particles) {
      if (p.arena !== arenaIdx) continue;
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(xOff + p.x, p.y, p.r * a, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawDivider() {
    const grad = ctx.createLinearGradient(W / 2, 0, W / 2, H);
    grad.addColorStop(0, "rgba(139,92,255,0.0)");
    grad.addColorStop(0.3, "rgba(139,92,255,0.6)");
    grad.addColorStop(0.5, "rgba(139,92,255,0.9)");
    grad.addColorStop(0.7, "rgba(139,92,255,0.6)");
    grad.addColorStop(1, "rgba(139,92,255,0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(W / 2 - DIVIDER / 2, 0, DIVIDER, H);

    ctx.shadowColor = "#8b5cff";
    ctx.shadowBlur = 12;
    ctx.fillRect(W / 2 - 1, 0, 2, H);
    ctx.shadowBlur = 0;
  }

  function drawHUD() {
    const barH = 36;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, barH);
    ctx.strokeStyle = "rgba(139,92,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, barH);
    ctx.lineTo(W, barH);
    ctx.stroke();

    ctx.font = "bold 14px monospace";
    ctx.textBaseline = "middle";
    const cy = barH / 2;

    // Score
    ctx.fillStyle = "#00ff66";
    ctx.textAlign = "left";
    ctx.fillText("SCORE " + Math.floor(score), 12, cy);

    // Best
    ctx.fillStyle = "#ffcc33";
    ctx.textAlign = "center";
    ctx.fillText("BEST " + bestScore, W / 2, cy);

    // Time
    ctx.fillStyle = "#00e5ff";
    ctx.textAlign = "right";
    const mins = Math.floor(elapsed / 60);
    const secs = Math.floor(elapsed % 60);
    ctx.fillText(
      mins.toString().padStart(2, "0") + ":" + secs.toString().padStart(2, "0"),
      W - 120, cy
    );

    // Rift cooldown
    if (riftCooldown > 0) {
      ctx.fillStyle = "rgba(139,92,255,0.6)";
      ctx.fillText("RIFT " + riftCooldown.toFixed(1) + "s", W - 55, cy);
    } else {
      ctx.fillStyle = "#8b5cff";
      ctx.fillText("RIFT ✦", W - 55, cy);
    }

    // Arena labels
    ctx.font = "11px monospace";
    ctx.fillStyle = "rgba(0,255,200,0.35)";
    ctx.textAlign = "center";
    ctx.fillText("◄ WASD", AW / 2, barH + 14);
    ctx.fillText("ARROWS ►", AW + AW / 2, barH + 14);
  }

  function drawVirtualJoysticks() {
    const isMobile = "ontouchstart" in window;
    if (!isMobile) return;

    const joyR = 36;
    const positions = [
      { x: 70, y: H - 70 },
      { x: W - 70, y: H - 70 },
    ];
    for (let i = 0; i < 2; i++) {
      const jp = positions[i];
      ctx.beginPath();
      ctx.arc(jp.x, jp.y, joyR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,255,200,0.2)";
      ctx.lineWidth = 2;
      ctx.stroke();

      const input = i === 0 ? touchL : touchR;
      if (input) {
        ctx.beginPath();
        ctx.arc(jp.x + input.dx * 20, jp.y + input.dy * 20, joyR * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,255,200,0.25)";
        ctx.fill();
      }
    }
  }

  // ── Screen drawing ──
  function drawStart() {
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, W, H);

    // Animated grid
    drawGrid(0);
    drawGrid(AW);
    drawDivider();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Title
    ctx.shadowColor = "#8b5cff";
    ctx.shadowBlur = 30;
    ctx.font = "bold 38px monospace";
    ctx.fillStyle = "#8b5cff";
    ctx.fillText("NEON RIFT SPLIT", W / 2, H * 0.22);
    ctx.shadowBlur = 0;

    // Subtitle
    ctx.font = "14px monospace";
    ctx.fillStyle = "rgba(0,229,255,0.8)";
    ctx.fillText("Split-Screen Survival · Dodge or Die", W / 2, H * 0.30);

    // Controls
    ctx.font = "13px monospace";
    ctx.fillStyle = "rgba(0,255,200,0.6)";
    const lines = [
      "Left Avatar:  W A S D",
      "Right Avatar: ↑ ← ↓ →",
      "Rift Pulse:   SPACE (swap positions)",
      "",
      "If either avatar dies, the run ends.",
      "Survive. Switch focus. Stay alive.",
    ];
    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2, H * 0.42 + i * 22);
    });

    // Mobile hint
    const isMobile = "ontouchstart" in window;
    if (isMobile) {
      ctx.fillStyle = "rgba(255,204,51,0.6)";
      ctx.fillText("Touch left/right half to control each avatar", W / 2, H * 0.75);
    }

    // Start prompt
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
    ctx.font = "bold 18px monospace";
    ctx.fillStyle = `rgba(0,255,102,${0.5 + pulse * 0.5})`;
    ctx.fillText(isMobile ? "TAP TO START" : "PRESS ENTER TO START", W / 2, H * 0.85);

    // Best
    if (bestScore > 0) {
      ctx.font = "12px monospace";
      ctx.fillStyle = "#ffcc33";
      ctx.fillText("BEST: " + bestScore, W / 2, H * 0.92);
    }
  }

  function drawGame() {
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, W, H);

    // Grids
    drawGrid(0);
    drawGrid(AW);

    // Hazards
    drawHazards(hazardsL, 0);
    drawHazards(hazardsR, AW);

    // Particles
    drawParticlesForArena(0, 0);
    drawParticlesForArena(1, AW);

    // Players
    drawPlayer(pL, 0, "#00ff66", "rgba(0,255,102,1)");
    drawPlayer(pR, AW, "#00e5ff", "rgba(0,229,255,1)");

    // Divider
    drawDivider();

    // HUD
    drawHUD();

    // Virtual joysticks
    drawVirtualJoysticks();
  }

  function drawGameOver() {
    // Draw the frozen game state underneath
    drawGame();

    // Dark overlay
    ctx.fillStyle = "rgba(5,5,16,0.75)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "#ff2bd6";
    ctx.shadowBlur = 25;
    ctx.font = "bold 36px monospace";
    ctx.fillStyle = "#ff2bd6";
    ctx.fillText("RIFT COLLAPSED", W / 2, H * 0.25);
    ctx.shadowBlur = 0;

    ctx.font = "16px monospace";
    ctx.fillStyle = "#00e5ff";
    ctx.fillText("TIME: " + formatTime(elapsed), W / 2, H * 0.38);

    ctx.fillStyle = "#00ff66";
    ctx.fillText("SCORE: " + Math.floor(score), W / 2, H * 0.46);

    ctx.fillStyle = "#ffcc33";
    ctx.fillText("BEST: " + bestScore, W / 2, H * 0.54);

    ctx.font = "13px monospace";
    ctx.fillStyle = "rgba(0,255,200,0.5)";
    ctx.fillText("Near Misses: " + nearMissCount, W / 2, H * 0.62);

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
    ctx.font = "bold 16px monospace";
    const isMobile = "ontouchstart" in window;
    ctx.fillStyle = `rgba(139,92,255,${0.5 + pulse * 0.5})`;
    ctx.fillText(isMobile ? "TAP TO RETRY" : "PRESS ENTER TO RETRY", W / 2, H * 0.78);
  }

  function formatTime(t) {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return mins.toString().padStart(2, "0") + ":" +
           secs.toString().padStart(2, "0") + "." +
           ms.toString().padStart(2, "0");
  }

  // ── Main loop ──
  let lastTime = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;

    if (screen === SCREEN_START) {
      elapsed += dt; // for grid animation
      if (keys["Enter"] || keys["Space"]) {
        keys["Enter"] = false;
        keys["Space"] = false;
        startGame();
      }
      drawStart();
    } else if (screen === SCREEN_PLAY) {
      update(dt);
      drawGame();
    } else if (screen === SCREEN_OVER) {
      updateParticles(dt);
      if (keys["Enter"] || keys["Space"]) {
        keys["Enter"] = false;
        keys["Space"] = false;
        startGame();
      }
      drawGameOver();
    }
  }

  requestAnimationFrame(frame);
})();
