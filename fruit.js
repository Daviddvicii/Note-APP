(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score-value');
  const livesEl = document.getElementById('lives-value');
  const megaEl = document.getElementById('mega-value');
  const overlay = document.getElementById('overlay');
  const overlayMessage = document.getElementById('overlay-message');
  const overlayTitle = document.getElementById('overlay-title');
  const restartBtn = document.getElementById('restart-btn');
  const hint = document.getElementById('hint');

  const GRAVITY = 1800;
  const MEGA_INTERVAL = 6;
  const BOMB_CHANCE = 0.28;
  const SLICE_GRACE = 8;
  const TRAIL_MAX_POINTS = 12;
  const TRAIL_LIFETIME = 160; // ms

  const FRUIT_TYPES = [
    { name: 'Lazer Lime', colors: ['#00ffb3', '#03705a'], juice: '#00ffd5', value: 60, radius: 26 },
    { name: 'Cosmic Citrus', colors: ['#ffd319', '#ff901f'], juice: '#ffcb40', value: 70, radius: 25 },
    { name: 'Ultraviolet Berry', colors: ['#ff3cac', '#8d00ff'], juice: '#ff74e6', value: 80, radius: 24 },
    { name: 'Electric Kiwi', colors: ['#a8ff00', '#417505'], juice: '#d4ff72', value: 65, radius: 23 },
    { name: 'Neptune Grape', colors: ['#6c63ff', '#240046'], juice: '#a685ff', value: 75, radius: 27 },
  ];

  const MEGA_FRUIT = {
    name: 'Mega Meteor Melon',
    colors: ['#ff6b6b', '#ff8e53'],
    juice: '#ffb376',
    value: 200,
    radius: 40,
    health: 3,
  };

  const BOMB_TYPE = {
    name: 'Plasma Bomb',
    colors: ['#ff0054', '#1b0015'],
    glow: '#ff77b7',
    radius: 24,
  };

  const state = {
    score: 0,
    lives: 3,
    normalCounter: 0,
    fruits: [],
    particles: [],
    trail: [],
    spawnTimer: 0,
    spawnDelay: 1,
    pointerDown: false,
    gameOver: false,
    lastTime: performance.now(),
  };

  let width = window.innerWidth;
  let height = window.innerHeight;
  let dpr = window.devicePixelRatio || 1;
  let hintTimeout = null;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);

  restartBtn.addEventListener('click', resetGame);
  canvas.addEventListener('pointerdown', startSlice);
  canvas.addEventListener('pointermove', moveSlice);
  window.addEventListener('pointerup', endSlice);
  window.addEventListener('pointercancel', endSlice);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  resetGame();
  requestAnimationFrame(loop);

  function resetGame() {
    state.score = 0;
    state.lives = 3;
    state.normalCounter = 0;
    state.fruits.length = 0;
    state.particles.length = 0;
    state.trail.length = 0;
    state.spawnTimer = 0;
    state.spawnDelay = randomRange(0.7, 1.2);
    state.pointerDown = false;
    state.gameOver = false;
    state.lastTime = performance.now();
    overlay.hidden = true;
    updateHud();
    showHint();
  }

  function showHint() {
    if (!hint) return;
    hint.classList.remove('hidden');
    clearTimeout(hintTimeout);
    hintTimeout = window.setTimeout(() => hint.classList.add('hidden'), 6000);
  }

  function hideHint() {
    if (!hint) return;
    hint.classList.add('hidden');
    clearTimeout(hintTimeout);
  }

  function loop(now) {
    const delta = Math.min(0.033, (now - state.lastTime) / 1000 || 0);
    state.lastTime = now;

    if (!state.gameOver) {
      runGame(delta, now);
    } else {
      updateParticles(delta);
      fadeTrail(now);
    }

    draw(now);
    requestAnimationFrame(loop);
  }

  function runGame(delta, now) {
    state.spawnTimer += delta;
    if (state.spawnTimer >= state.spawnDelay) {
      spawnWave();
      state.spawnTimer = 0;
      state.spawnDelay = randomRange(0.65, 1.05);
    }

    updateFruits(delta);
    updateParticles(delta);
    fadeTrail(now);
    checkSlices();
  }

  function spawnWave() {
    if (state.normalCounter >= MEGA_INTERVAL - 1) {
      spawnFruit('mega');
      state.normalCounter = 0;
    } else {
      spawnFruit('fruit');
      state.normalCounter += 1;
    }

    if (Math.random() < BOMB_CHANCE) {
      spawnFruit('bomb');
    }

    updateHud();
  }

  function spawnFruit(kind) {
    if (kind === 'mega') {
      state.fruits.push(createFruit(MEGA_FRUIT, { mega: true }));
      return;
    }

    if (kind === 'bomb') {
      state.fruits.push(createBomb());
      return;
    }

    const config = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
    state.fruits.push(createFruit(config));
  }

  function createFruit(config, options = {}) {
    const spawnX = randomRange(width * 0.15, width * 0.85);
    const spawnY = height + 60;
    const tossAngle = randomRange(-Math.PI / 3, Math.PI / 3);
    const launch = randomRange(840, 1120);
    const vx = Math.sin(tossAngle) * randomRange(120, 280);
    const vy = -launch;

    const maxHealth = options.mega ? config.health : 1;
    const radius = (options.mega ? config.radius : config.radius * randomRange(0.9, 1.1));

    return {
      kind: options.mega ? 'mega' : 'fruit',
      x: spawnX,
      y: spawnY,
      vx,
      vy,
      radius,
      rotation: Math.random() * Math.PI * 2,
      spin: randomRange(-2.5, 2.5),
      colors: config.colors,
      juice: config.juice,
      value: config.value,
      health: maxHealth,
      maxHealth,
      sliceCooldown: 0,
      flash: 0,
      remove: false,
      isBomb: false,
    };
  }

  function createBomb() {
    const spawnX = randomRange(width * 0.25, width * 0.75);
    const spawnY = height + 60;
    const vy = -randomRange(900, 1150);
    const vx = randomRange(-220, 220);

    return {
      kind: 'bomb',
      x: spawnX,
      y: spawnY,
      vx,
      vy,
      radius: BOMB_TYPE.radius,
      rotation: Math.random() * Math.PI * 2,
      spin: randomRange(-5, 5),
      sliceCooldown: 0,
      glow: BOMB_TYPE.glow,
      colors: BOMB_TYPE.colors,
      remove: false,
      isBomb: true,
    };
  }

  function updateFruits(delta) {
    const offscreenBottom = height + 80;
    const offscreenTop = -160;

    state.fruits = state.fruits.filter((fruit) => {
      fruit.vy += GRAVITY * delta;
      fruit.x += fruit.vx * delta;
      fruit.y += fruit.vy * delta;
      fruit.rotation += fruit.spin * delta;
      fruit.sliceCooldown = Math.max(0, fruit.sliceCooldown - delta);
      fruit.flash = Math.max(0, fruit.flash - delta);

      if (!fruit.isBomb && fruit.y - fruit.radius > offscreenBottom) {
        if (!state.gameOver) {
          loseLife();
        }
        return false;
      }

      if (fruit.isBomb && fruit.y - fruit.radius > offscreenBottom) {
        return false;
      }

      return fruit.y + fruit.radius > offscreenTop && !fruit.remove;
    });
  }

  function updateParticles(delta) {
    state.particles = state.particles.filter((particle) => {
      particle.life -= delta;
      if (particle.life <= 0) {
        return false;
      }

      const vx = particle.vx ?? 0;
      const vy = particle.vy ?? 0;
      particle.x += vx * delta;
      particle.y += vy * delta;

      if (particle.gravity) {
        particle.vy += particle.gravity * delta;
      }

      return true;
    });
  }

  function fadeTrail(now) {
    for (let i = state.trail.length - 1; i >= 0; i -= 1) {
      if (now - state.trail[i].time > TRAIL_LIFETIME) {
        state.trail.splice(i, 1);
      }
    }
  }

  function checkSlices() {
    if (state.trail.length < 2) return;

    const segments = state.trail.length - 1;

    for (const fruit of state.fruits) {
      if (fruit.sliceCooldown > 0 || fruit.remove) continue;

      for (let i = 0; i < segments; i += 1) {
        const from = state.trail[i];
        const to = state.trail[i + 1];
        const distance = distanceToSegment(fruit.x, fruit.y, from, to);

        if (distance <= fruit.radius + SLICE_GRACE) {
          handleFruitHit(fruit, from, to);
          break;
        }
      }
    }

    state.fruits = state.fruits.filter((fruit) => !fruit.remove);
  }

  function handleFruitHit(fruit, from, to) {
    fruit.sliceCooldown = 0.12;

    const direction = { x: to.x - from.x, y: to.y - from.y };

    if (fruit.isBomb) {
      spawnBombExplosion(fruit);
      gameOver('That was a bomb! Slice carefully.', 'Boom!');
      return;
    }

    fruit.health -= 1;
    fruit.flash = 0.2;

    const reward = Math.round(fruit.value / fruit.maxHealth);
    spawnJuiceBurst(fruit, direction);

    if (fruit.health <= 0) {
      fruit.remove = true;
    }

    addScore(reward, fruit);
  }

  function spawnJuiceBurst(fruit, direction) {
    const magnitude = Math.hypot(direction.x, direction.y) || 1;
    const norm = { x: direction.x / magnitude, y: direction.y / magnitude };
    const sprayCount = fruit.kind === 'mega' ? 24 : 14;

    for (let i = 0; i < sprayCount; i += 1) {
      const angle = Math.atan2(norm.y, norm.x) + randomRange(-0.6, 0.6);
      const speed = randomRange(220, 420);

      state.particles.push({
        kind: 'juice',
        x: fruit.x,
        y: fruit.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        gravity: 2400,
        color: fruit.juice,
        size: randomRange(2, 4.5),
        life: randomRange(0.4, 0.7),
        duration: 0.7,
      });
    }

  }

  function spawnBombExplosion(fruit) {
    const blast = fruit.radius * 1.4;

    for (let i = 0; i < 36; i += 1) {
      const angle = (Math.PI * 2 * i) / 36;
      const speed = randomRange(180, 420);
      state.particles.push({
        kind: 'juice',
        x: fruit.x,
        y: fruit.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 1200,
        color: '#ff003c',
        size: randomRange(2.5, 5),
        life: randomRange(0.4, 0.8),
        duration: 0.8,
      });
    }

    state.particles.push({
      kind: 'ring',
      x: fruit.x,
      y: fruit.y,
      radius: blast,
      life: 0.4,
      duration: 0.4,
      vx: 0,
      vy: 0,
    });
  }

  function draw(time) {
    drawBackground(time);
    drawParticles();
    drawFruits();
    drawTrail();
  }

  function drawBackground(time) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#08001f');
    gradient.addColorStop(0.5, '#150033');
    gradient.addColorStop(1, '#020008');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = 'rgba(0, 255, 213, 0.35)';
    ctx.lineWidth = 1;
    const spacing = 80;
    const offsetY = (time * 0.05) % spacing;
    const offsetX = (time * 0.03) % spacing;

    ctx.beginPath();
    for (let y = -spacing + offsetY; y < height + spacing; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    for (let x = -spacing + offsetX; x < width + spacing; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFruits() {
    for (const fruit of state.fruits) {
      ctx.save();
      ctx.translate(fruit.x, fruit.y);
      ctx.rotate(fruit.rotation);

      if (fruit.isBomb) {
        drawBomb(fruit);
      } else {
        drawFruit(fruit);
      }

      ctx.restore();
    }
  }

  function drawFruit(fruit) {
    const gradient = ctx.createRadialGradient(-fruit.radius * 0.3, -fruit.radius * 0.3, fruit.radius * 0.2, 0, 0, fruit.radius);
    gradient.addColorStop(0, fruit.colors[0]);
    gradient.addColorStop(1, fruit.colors[1]);

    ctx.shadowColor = fruit.flash > 0 ? '#ffffff' : fruit.colors[0];
    ctx.shadowBlur = fruit.kind === 'mega' ? 25 : 12;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, fruit.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = fruit.kind === 'mega' ? 4 : 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.moveTo(-fruit.radius * 0.6, 0);
    ctx.lineTo(fruit.radius * 0.6, 0);
    ctx.stroke();

    if (fruit.maxHealth > 1) {
      ctx.save();
      ctx.rotate(-Math.PI / 2);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0, 255, 213, 0.65)';
      const portion = Math.max(fruit.health, 0) / fruit.maxHealth;
      ctx.beginPath();
      ctx.arc(0, 0, fruit.radius + 6, 0, Math.PI * 2 * portion);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBomb(fruit) {
    const gradient = ctx.createRadialGradient(-fruit.radius * 0.1, -fruit.radius * 0.1, fruit.radius * 0.2, 0, 0, fruit.radius);
    gradient.addColorStop(0, '#ff4d8a');
    gradient.addColorStop(0.6, '#3e001f');
    gradient.addColorStop(1, '#16000b');

    ctx.shadowColor = fruit.glow;
    ctx.shadowBlur = 20;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, fruit.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(-fruit.radius * 0.6, 0);
    ctx.lineTo(fruit.radius * 0.6, 0);
    ctx.moveTo(0, -fruit.radius * 0.6);
    ctx.lineTo(0, fruit.radius * 0.6);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -fruit.radius);
    ctx.lineTo(0, -fruit.radius - 16);
    ctx.stroke();
  }

  function drawParticles() {
    for (const particle of state.particles) {
      if (particle.kind === 'juice') {
        const alpha = Math.max(particle.life / particle.duration, 0);
        ctx.fillStyle = applyAlpha(particle.color, alpha);
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (particle.kind === 'text') {
        const alpha = Math.max(particle.life / particle.duration, 0);
        ctx.save();
        ctx.font = '12px "Press Start 2P"';
        ctx.fillStyle = `rgba(223, 255, 249, ${alpha})`;
        ctx.textAlign = 'center';
        ctx.fillText(particle.text, particle.x, particle.y);
        ctx.restore();
      } else if (particle.kind === 'ring') {
        const alpha = Math.max(particle.life / particle.duration, 0);
        const progress = 1 - alpha;
        ctx.save();
        ctx.lineWidth = 6;
        ctx.strokeStyle = `rgba(255, 0, 84, ${alpha})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius * (1 + progress * 1.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawTrail() {
    if (state.trail.length < 2) return;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.shadowColor = '#00fff0';
    ctx.shadowBlur = 22;
    ctx.strokeStyle = 'rgba(0,255,213,0.8)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(state.trail[0].x, state.trail[0].y);
    for (let i = 1; i < state.trail.length; i += 1) {
      ctx.lineTo(state.trail[i].x, state.trail[i].y);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = 'rgba(255,0,255,0.4)';
    ctx.lineWidth = 14;
    ctx.stroke();

    ctx.restore();
  }

  function startSlice(event) {
    if (state.gameOver) return;
    state.pointerDown = true;
    hideHint();
    recordPointer(event);
  }

  function moveSlice(event) {
    if (!state.pointerDown || state.gameOver) return;
    recordPointer(event);
  }

  function endSlice() {
    state.pointerDown = false;
    state.trail.length = 0;
  }

  function recordPointer(event) {
    const point = getCanvasPoint(event);
    state.trail.push({ ...point, time: performance.now() });
    if (state.trail.length > TRAIL_MAX_POINTS) {
      state.trail.shift();
    }
  }

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function loseLife() {
    state.lives = Math.max(0, state.lives - 1);
    updateHud();
    if (state.lives <= 0) {
      gameOver('Too many fruit splattered! Keep slicing faster.');
    }
  }

  function addScore(amount, fruit) {
    state.score = Math.max(0, state.score + amount);
    updateHud();
    if (fruit) {
      state.particles.push({
        kind: 'text',
        text: `+${amount}`,
        x: fruit.x,
        y: fruit.y - fruit.radius - 10,
        vx: 0,
        vy: -30,
        life: 1.1,
        duration: 1.1,
      });
    }
  }

  function updateHud() {
    scoreEl.textContent = state.score.toString().padStart(4, '0');
    livesEl.textContent = state.lives.toString();
    const remaining = Math.max(1, MEGA_INTERVAL - state.normalCounter);
    megaEl.textContent = remaining <= 1 ? 'NEXT!' : remaining.toString();
  }

  function gameOver(message, title = 'Game Over') {
    if (state.gameOver) return;
    state.gameOver = true;
    overlay.hidden = false;
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    state.pointerDown = false;
    state.trail.length = 0;
  }

  function applyAlpha(color, alpha) {
    const ctxAlpha = Math.max(0, Math.min(1, alpha));
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const bigint = parseInt(hex.length === 3
        ? hex.split('').map((char) => char + char).join('')
        : hex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r}, ${g}, ${b}, ${ctxAlpha})`;
    }
    return color;
  }

  function distanceToSegment(px, py, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / lenSq));
    const cx = a.x + t * vx;
    const cy = a.y + t * vy;
    const dx = px - cx;
    const dy = py - cy;
    return Math.hypot(dx, dy);
  }

  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }
})();
