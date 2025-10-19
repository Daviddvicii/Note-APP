'use strict';

// Pac-Man HTML5 Canvas
(() => {
  const GRID_W = 28;
  const GRID_H = 31;

  const TILE = {
    EMPTY: 0,
    WALL: 1,
    DOT: 2,
    POWER: 3,
    GATE: 4,
  };

  const DIRS = {
    up:    { x:  0, y: -1, name: 'up' },
    down:  { x:  0, y:  1, name: 'down' },
    left:  { x: -1, y:  0, name: 'left' },
    right: { x:  1, y:  0, name: 'right' },
    none:  { x:  0, y:  0, name: 'none' },
  };
  const DIR_ARRAY = [DIRS.left, DIRS.right, DIRS.up, DIRS.down];

  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; }

  // Deterministic pseudo-random (for frightened wiggle / tie-breakers)
  let seed = 1337;
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function randInt(n) { return (rand() * n) | 0; }

  // --- movement helpers
  function nextTileFromCenter(cx, cy, dir) {
    const tx = Math.floor(cx), ty = Math.floor(cy);
    const nx = tx + (dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0);
    const ny = ty + (dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0);
    return { nx, ny };
  }
  function blockedAhead(maze, cx, cy, dir, allowGate = false) {
    const { nx, ny } = nextTileFromCenter(cx, cy, dir);
    if (!maze.isInside(nx, ny)) return false; // wrap allowed
    const t = maze.tileAt(nx, ny);
    if (t === TILE.WALL) return true;
    if (!allowGate && t === TILE.GATE) return true;
    return false;
  }

  // Classic-ish maze 28x31
  const MAZE_ASCII = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '######.##### ## #####.######',
    '######.##          ##.######',
    '######.## ###--### ##.######',
    '      .   #      #   .      ',
    '######.## # #### # ##.######',
    '######.## # #GG# # ##.######',
    '######.## # #### # ##.######',
    '   ... .  ###--###  . ...   ',
    '######.##          ##.######',
    '######.## ######## ##.######',
    '######.## ######## ##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o..##................##..o#',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################',
    '############################',
    '############################',
  ];

  class Input {
    constructor() {
      this.queued = DIRS.none;
      this.swipeStart = null;
      this.bind();
    }
    bind() {
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'arrowup' || k === 'w') this.queued = DIRS.up;
        else if (k === 'arrowdown' || k === 's') this.queued = DIRS.down;
        else if (k === 'arrowleft' || k === 'a') this.queued = DIRS.left;
        else if (k === 'arrowright' || k === 'd') this.queued = DIRS.right;
      });
      const dpad = document.querySelector('.dpad');
      if (dpad) {
        dpad.addEventListener('pointerdown', (e) => {
          const t = e.target;
          if (t && t.dataset && t.dataset.dir) {
            const s = t.dataset.dir;
            this.queued = DIRS[s] || DIRS.none;
          }
        });
      }
      const canvas = document.getElementById('game');
      if (canvas) {
        canvas.addEventListener('pointerdown', (e) => {
          this.swipeStart = { x: e.clientX, y: e.clientY };
        });
        canvas.addEventListener('pointerup', (e) => {
          if (!this.swipeStart) return;
          const dx = e.clientX - this.swipeStart.x;
          const dy = e.clientY - this.swipeStart.y;
          const adx = Math.abs(dx), ady = Math.abs(dy);
          if (Math.max(adx, ady) > 24) {
            this.queued = adx > ady ? (dx > 0 ? DIRS.right : DIRS.left)
                                    : (dy > 0 ? DIRS.down  : DIRS.up);
          }
          this.swipeStart = null;
        });
      }
    }
    consumeQueued() { return this.queued; } // persistent
  }

  class Sound {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.wakaToggle = false;
      this.initContext = this.initContext.bind(this);
      window.addEventListener('pointerdown', this.initContext, { once: true });
      window.addEventListener('keydown', this.initContext, { once: true });
    }
    initContext() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } }
    setMuted(m) { this.muted = m; }
    beep(freq = 440, dur = 0.08, type = 'square', gain = 0.02) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g).connect(this.ctx.destination);
      o.start(t0); o.stop(t0 + dur);
    }
    waka() { this.beep(this.wakaToggle ? 380 : 320, 0.05, 'square', 0.02); this.wakaToggle = !this.wakaToggle; }
    dot() { this.beep(700, 0.04, 'square', 0.02); }
    power() { this.beep(220, 0.25, 'sawtooth', 0.02); }
    eatGhost() { this.beep(180, 0.2, 'triangle', 0.03); }
    death() { this.beep(100, 0.6, 'sine', 0.05); }
  }

  class Maze {
    constructor() {
      this.w = GRID_W; this.h = GRID_H;
      this.grid = new Array(this.h);
      this.dotCount = 0;
      for (let y = 0; y < this.h; y++) {
        this.grid[y] = new Array(this.w);
        const row = MAZE_ASCII[y] || ''.padEnd(this.w, '#');
        for (let x = 0; x < this.w; x++) {
          const c = row[x] || '#';
          let t = TILE.EMPTY;
          if (c === '#') t = TILE.WALL;
          else if (c === '.') { t = TILE.DOT; this.dotCount++; }
          else if (c === 'o') { t = TILE.POWER; this.dotCount++; }
          else if (c === '-') t = TILE.GATE;
          else t = TILE.EMPTY;
          this.grid[y][x] = t;
        }
      }
      this.house = { x: 13, y: 15 };
    }
    isInside(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; }
    tileAt(tx, ty) { if (!this.isInside(tx, ty)) return TILE.WALL; return this.grid[ty][tx]; }
    isWall(tx, ty) { return this.tileAt(tx, ty) === TILE.WALL; }
    isGate(tx, ty) { return this.tileAt(tx, ty) === TILE.GATE; }
    eatAt(tx, ty) {
      const t = this.tileAt(tx, ty);
      if (t === TILE.DOT)   { this.grid[ty][tx] = TILE.EMPTY; this.dotCount--; return 'dot'; }
      if (t === TILE.POWER) { this.grid[ty][tx] = TILE.EMPTY; this.dotCount--; return 'power'; }
      return null;
    }
    resetDots() {
      this.dotCount = 0;
      for (let y = 0; y < this.h; y++) {
        const row = MAZE_ASCII[y];
        for (let x = 0; x < this.w; x++) {
          const c = row[x];
          if (c === '.') { this.grid[y][x] = TILE.DOT; this.dotCount++; }
          else if (c === 'o') { this.grid[y][x] = TILE.POWER; this.dotCount++; }
          else if (c === '#') this.grid[y][x] = TILE.WALL;
          else if (c === '-') this.grid[y][x] = TILE.GATE;
          else this.grid[y][x] = TILE.EMPTY;
        }
      }
    }
  }

  class Entity {
    constructor(x, y, speedTilesPerSec) {
      this.x = x; this.y = y;               // in tiles (floating)
      this.dir = DIRS.left;
      this.speed = speedTilesPerSec;
    }
    centerOfTile() { return { cx: Math.floor(this.x) + 0.5, cy: Math.floor(this.y) + 0.5 }; }
  }

  class Pacman extends Entity {
    constructor(x, y) {
      super(x, y, 5.6);
      this.radiusFrac = 0.44;
      this.mouth = 0;
    }
    update(dt, maze, input) {
      const desired = input.consumeQueued();
      const { cx, cy } = this.centerOfTile();
      const nearCenter = Math.abs(this.x - cx) < 0.18 && Math.abs(this.y - cy) < 0.18;

      // take queued turn exactly at center (if legal)
      if (desired && desired !== this.dir && nearCenter && !blockedAhead(maze, cx, cy, desired, false)) {
        this.x = cx; this.y = cy;
        this.dir = desired;
      }

      // if next tile in current dir is blocked, snap to center and stop
      if (this.dir !== DIRS.none && blockedAhead(maze, cx, cy, this.dir, false)) {
        const toCx = cx - this.x, toCy = cy - this.y;
        const step = this.speed * dt;
        const len = Math.hypot(toCx, toCy);
        if (len > 0.0001) {
          const ux = toCx / len, uy = toCy / len;
          const move = Math.min(step, len);
          this.x += ux * move; this.y += uy * move;
        }
        if (Math.abs(this.x - cx) <= 0.01 && Math.abs(this.y - cy) <= 0.01) {
          this.x = cx; this.y = cy;
          this.dir = DIRS.none;
        }
      } else {
        this.x += this.dir.x * this.speed * dt;
        this.y += this.dir.y * this.speed * dt;
      }

      // if stopped and desired is open now, take it
      if (this.dir === DIRS.none && desired && !blockedAhead(maze, this.centerOfTile().cx, this.centerOfTile().cy, desired, false)) {
        const c2 = this.centerOfTile(); this.x = c2.cx; this.y = c2.cy;
        this.dir = desired;
      }

      // Wrap tunnels
      if (this.x < -0.5) this.x = maze.w - 0.5;
      if (this.x > maze.w + 0.5) this.x = -0.5;

      this.mouth += dt * 10;
    }
    draw(ctx, tileSize, offX, offY) {
      const px = offX + this.x * tileSize;
      const py = offY + this.y * tileSize;
      const r = tileSize * this.radiusFrac;
      const open = 0.2 + 0.2 * Math.abs(Math.sin(this.mouth));
      let a0 = 0, a1 = Math.PI*2;
      if (this.dir === DIRS.right) { a0 = open; a1 = Math.PI*2 - open; }
      else if (this.dir === DIRS.left) { a0 = Math.PI + open; a1 = Math.PI - open; }
      else if (this.dir === DIRS.up) { a0 = -Math.PI/2 + open; a1 = Math.PI*1.5 - open; }
      else if (this.dir === DIRS.down) { a0 = Math.PI/2 + open; a1 = Math.PI/2 - open; }

      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.arc(px, py, r, a0, a1, false);
      ctx.closePath(); ctx.fill();
    }
  }

  class Ghost extends Entity {
    constructor(x, y, color, name) {
      super(x, y, 5.2);
      this.baseSpeed = 5.2;
      this.color = color;
      this.name = name;
      this.mode = 'scatter';   // 'chase'|'scatter'|'frightened'|'eyes'
      this.frightenedTimer = 0;
      this.scatterTarget = { x: 1, y: 1 };
      this.home = { x, y };
    }
    setScatterCorner(k) {
      const corners = [
        { x: GRID_W - 2, y: 1 },
        { x: 1, y: 1 },
        { x: GRID_W - 2, y: GRID_H - 2 },
        { x: 1, y: GRID_H - 2 },
      ];
      this.scatterTarget = corners[k % corners.length];
    }
    enterFrightened(dur) {
      if (this.mode !== 'eyes') { this.mode = 'frightened'; this.frightenedTimer = dur; }
    }
    update(dt, maze, pacman, blinkyRef) {
      let speed = this.baseSpeed;
      if (this.mode === 'frightened') speed *= 0.66;
      if (this.mode === 'eyes') speed *= 1.3;

      if (this.mode === 'frightened') {
        this.frightenedTimer -= dt;
        if (this.frightenedTimer <= 0) this.mode = 'chase';
      }

      const { cx, cy } = this.centerOfTile();
      const atCenter = Math.abs(this.x - cx) < 0.12 && Math.abs(this.y - cy) < 0.12;

      // if about to hit a wall, snap and re-choose
      const hittingWall = this.dir !== DIRS.none && blockedAhead(maze, cx, cy, this.dir, this.mode === 'eyes');
      if (hittingWall) { this.x = cx; this.y = cy; }

      if (atCenter || hittingWall) {
        this.x = cx; this.y = cy;

        const target = this.computeTarget(pacman, blinkyRef);
        const dirs = [DIRS.up, DIRS.left, DIRS.down, DIRS.right].filter((d) => {
          if (this.mode !== 'frightened' && this.dir && d.x === -this.dir.x && d.y === -this.dir.y) return false;
          return !blockedAhead(maze, cx, cy, d, this.mode === 'eyes');
        });

        if (dirs.length > 0) {
          let next = dirs[0];
          if (this.mode === 'frightened') {
            next = dirs[randInt(dirs.length)];
          } else {
            let best = Infinity;
            const start = (this.name.charCodeAt(0) + Math.floor(seed % 4)) % 4; // de-sync selection
            for (let i = 0; i < dirs.length; i++) {
              const d = dirs[(start + i) % dirs.length];
              const nx = cx + d.x, ny = cy + d.y;
              const dd = dist2(nx, ny, target.x, target.y);
              if (dd < best) { best = dd; next = d; }
            }
          }
          this.dir = next;
        } else {
          this.dir = { x: -this.dir.x, y: -this.dir.y, name: 'rev' };
        }
      }

      this.x += this.dir.x * speed * dt;
      this.y += this.dir.y * speed * dt;

      if (this.x < -0.5) this.x = maze.w - 0.5;
      if (this.x > maze.w + 0.5) this.x = -0.5;

      if (this.mode === 'eyes') {
        const d2v = dist2(this.x, this.y, maze.house.x + 0.5, maze.house.y + 0.5);
        if (d2v < 0.1) { this.mode = 'scatter'; this.dir = DIRS.left; }
      }
    }
    computeTarget(pacman, blinkyRef) {
      if (this.mode === 'scatter') return this.scatterTarget;
      if (this.mode === 'eyes') return { x: blinkyRef ? blinkyRef.home.x : 13, y: 14 };
      const px = pacman.x, py = pacman.y;
      const pd = pacman.dir || DIRS.left;
      switch (this.name) {
        case 'blinky': return { x: px, y: py };
        case 'pinky':  return { x: px + pd.x * 4, y: py + pd.y * 4 };
        case 'inky': {
          const ahead = { x: px + pd.x * 2, y: py + pd.y * 2 };
          const bx = blinkyRef ? blinkyRef.x : px;
          const by = blinkyRef ? blinkyRef.y : py;
          return { x: ahead.x + (ahead.x - bx), y: ahead.y + (ahead.y - by) };
        }
        case 'clyde': {
          const d2v = dist2(this.x, this.y, px, py);
          if (d2v > 64) return { x: px, y: py }; // > 8 tiles
          return this.scatterTarget;
        }
      }
      return { x: px, y: py };
    }
    draw(ctx, tileSize, offX, offY) {
      const px = offX + this.x * tileSize;
      const py = offY + this.y * tileSize;
      const h = tileSize * 0.9, r = h * 0.5;
      const bodyColor = this.mode === 'frightened' ? '#1e90ff' : this.color;

      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(px, py - h * 0.1, r, Math.PI, 0);
      ctx.lineTo(px + r, py + r * 0.8);
      const fr = 4;
      for (let i = fr; i >= 0; i--) {
        const fx = px - r + (i / fr) * (2 * r);
        const fy = py + r * 0.8 + (i % 2 === 0 ? -r * 0.15 : 0);
        ctx.lineTo(fx, fy);
      }
      ctx.closePath(); ctx.fill();

      const eyeOffsetX = (this.dir.x || 0) * r * 0.2;
      const eyeOffsetY = (this.dir.y || 0) * r * 0.2;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(px - r * 0.35 + eyeOffsetX, py - r * 0.2 + eyeOffsetY, r * 0.25, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + r * 0.35 + eyeOffsetX, py - r * 0.2 + eyeOffsetY, r * 0.25, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#001b2e';
      ctx.beginPath(); ctx.arc(px - r * 0.35 + eyeOffsetX, py - r * 0.2 + eyeOffsetY, r * 0.12, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + r * 0.35 + eyeOffsetX, py - r * 0.2 + eyeOffsetY, r * 0.12, 0, Math.PI*2); ctx.fill();
    }
  }

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.ctx = this.canvas.getContext('2d');
      this.input = new Input();
      this.sound = new Sound();
      this.maze = new Maze();
      this.pacman = new Pacman(13.5, 23);
      this.ghosts = [
        new Ghost(13.5, 11, '#ff3b3b', 'blinky'),
        new Ghost(13.5, 14, '#ff9be1', 'pinky'),
        new Ghost(11.5, 14, '#00e1ff', 'inky'),
        new Ghost(15.5, 14, '#ffb24c', 'clyde'),
      ];
      this.ghosts[0].setScatterCorner(0);
      this.ghosts[1].setScatterCorner(1);
      this.ghosts[2].setScatterCorner(2);
      this.ghosts[3].setScatterCorner(3);

      this.level = 1;
      this.score = 0;
      this.best = Number(localStorage.getItem('pacman_best_score') || '0') || 0;
      this.lives = 3;
      this.paused = false;
      this.gameOver = false;

      this.lastTime = 0;
      this.accum = 0;
      this.fixedDt = 1 / 120;
      this.tileSize = 16;
      this.scatterTimer = 0;
      this.inChase = false;

      this.bindUI();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    bindUI() {
      const muteBtn = document.getElementById('mute-btn');
      const pauseBtn = document.getElementById('pause-btn');
      if (muteBtn) {
        muteBtn.addEventListener('click', () => {
          const newState = !(this.sound.muted);
          this.sound.setMuted(newState);
          muteBtn.textContent = newState ? '🔇 Muted' : '🔊 Sound';
          muteBtn.setAttribute('aria-pressed', String(newState));
        });
      }
      if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
      window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'p') this.togglePause();
        if (e.key.toLowerCase() === 'm') {
          const newState = !(this.sound.muted);
          this.sound.setMuted(newState);
          if (muteBtn) {
            muteBtn.textContent = newState ? '🔇 Muted' : '🔊 Sound';
            muteBtn.setAttribute('aria-pressed', String(newState));
          }
        }
      });
    }

    togglePause() {
      this.paused = !this.paused;
      const pauseBtn = document.getElementById('pause-btn');
      if (pauseBtn) pauseBtn.textContent = this.paused ? '▶️ Resume' : '⏸️ Pause';
    }

    resize() {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const cssW = window.innerWidth, cssH = window.innerHeight;
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
      const playableW = this.canvas.width / dpr;
      const playableH = this.canvas.height / dpr;
      this.tileSize = Math.floor(Math.min(playableW / GRID_W, playableH / GRID_H));
      // scale to DPR; draw in CSS pixels
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resetPositions() {
      this.pacman.x = 13.5; this.pacman.y = 23; this.pacman.dir = DIRS.left;
      const positions = [[13.5,11],[13.5,14],[11.5,14],[15.5,14]];
      this.ghosts.forEach((g,i) => {
        g.x = positions[i][0]; g.y = positions[i][1];
        g.dir = DIR_ARRAY[randInt(4)];   // randomize start direction
        g.mode = 'scatter';
      });
      this.scatterTimer = 0; this.inChase = false;
    }

    nextLevel() {
      this.level++;
      this.maze.resetDots();
      this.pacman.speed = Math.min(7, 5.6 + (this.level - 1) * 0.15);
      for (const g of this.ghosts) g.baseSpeed = Math.min(6.5, 5.2 + (this.level - 1) * 0.1);
      this.resetPositions();
    }

    loop(ts) {
      if (!this.lastTime) this.lastTime = ts;
      const delta = Math.min(0.05, (ts - this.lastTime) / 1000);
      this.lastTime = ts;
      if (!this.paused && !this.gameOver) {
        this.accum += delta;
        while (this.accum >= this.fixedDt) {
          this.update(this.fixedDt);
          this.accum -= this.fixedDt;
        }
      }
      this.draw();
      requestAnimationFrame(this.loop);
    }

    update(dt) {
      // scatter/chase cycles
      this.scatterTimer += dt;
      const scatterLen = 7, chaseLen = 20;
      if (!this.inChase && this.scatterTimer > scatterLen) {
        this.inChase = true; this.scatterTimer = 0;
        this.ghosts.forEach(g => { if (g.mode !== 'eyes') g.mode = 'chase'; });
      } else if (this.inChase && this.scatterTimer > chaseLen) {
        this.inChase = false; this.scatterTimer = 0;
        this.ghosts.forEach(g => { if (g.mode !== 'eyes') g.mode = 'scatter'; });
      }

      // Pac-Man
      const prevTile = { x: Math.floor(this.pacman.x), y: Math.floor(this.pacman.y) };
      this.pacman.update(dt, this.maze, this.input);
      const nowTile = { x: Math.floor(this.pacman.x), y: Math.floor(this.pacman.y) };
      if (nowTile.x !== prevTile.x || nowTile.y !== prevTile.y) this.sound.waka();

      // Eat
      const c = this.pacman.centerOfTile();
      if (Math.abs(this.pacman.x - c.cx) < 0.3 && Math.abs(this.pacman.y - c.cy) < 0.3) {
        const eaten = this.maze.eatAt(Math.floor(c.cx), Math.floor(c.cy));
        if (eaten === 'dot') { this.addScore(10); this.sound.dot(); }
        else if (eaten === 'power') {
          this.addScore(50); this.sound.power();
          const frightDur = 6 - Math.min(3, this.level * 0.3);
          this.ghosts.forEach(g => g.enterFrightened(frightDur));
        }
      }

      // Ghosts
      const blinky = this.ghosts.find(g => g.name === 'blinky');
      for (const g of this.ghosts) g.update(dt, this.maze, this.pacman, blinky);

      // Collisions
      for (const g of this.ghosts) {
        if (g.mode === 'eyes') continue;
        const d2v = dist2(g.x, g.y, this.pacman.x, this.pacman.y);
        if (d2v < 0.35) {
          if (g.mode === 'frightened') {
            this.addScore(200); g.mode = 'eyes'; this.sound.eatGhost();
          } else {
            this.loseLife(); break;
          }
        }
      }

      if (this.maze.dotCount <= 0) this.nextLevel();
      this.updateHUD();
    }

    loseLife() {
      this.lives--; this.sound.death();
      if (this.lives <= 0) {
        this.gameOver = true;
        if (this.score > this.best) { this.best = this.score; localStorage.setItem('pacman_best_score', String(this.best)); }
        setTimeout(() => {
          this.level = 1; this.score = 0; this.lives = 3; this.maze.resetDots();
          this.gameOver = false; this.resetPositions();
        }, 1500);
      } else {
        this.resetPositions();
      }
    }

    addScore(n) { this.score += n; if (this.score > this.best) this.best = this.score; }

    updateHUD() {
      const scoreEl = document.getElementById('hud-score');
      const bestEl = document.getElementById('hud-best');
      const livesEl = document.getElementById('hud-lives');
      if (scoreEl) scoreEl.textContent = `Score: ${this.score}`;
      if (bestEl) bestEl.textContent = `Best: ${this.best}`;
      if (livesEl) {
        livesEl.innerHTML = '';
        for (let i = 0; i < this.lives; i++) {
          const d = document.createElement('div'); d.className = 'life-dot'; livesEl.appendChild(d);
        }
      }
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      const tileSize = this.tileSize;
      const ox = Math.floor((window.innerWidth  - tileSize * GRID_W) / 2);
      const oy = Math.floor((window.innerHeight - tileSize * GRID_H) / 2);

      this.drawMaze(ctx, tileSize, ox, oy);
      this.drawDots(ctx, tileSize, ox, oy);
      this.pacman.draw(ctx, tileSize, ox, oy);
      for (const g of this.ghosts) g.draw(ctx, tileSize, ox, oy);

      if (this.paused || this.gameOver) this.drawOverlay(ctx);
    }

    drawOverlay(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = '#7fffd4';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '20px "Press Start 2P", monospace';
      ctx.fillText(this.paused ? 'PAUSED' : 'GAME OVER', window.innerWidth/2, window.innerHeight/2);
      ctx.restore();
    }

    drawMaze(ctx, tileSize, offX, offY) {
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          const t = this.maze.grid[y][x];
          if (t === TILE.WALL) {
            ctx.fillStyle = '#143b5b';
            ctx.fillRect(offX + x*tileSize, offY + y*tileSize, tileSize, tileSize);
            ctx.strokeStyle = '#7fffd4';
            ctx.lineWidth = 2;
            ctx.strokeRect(offX + x*tileSize + 1, offY + y*tileSize + 1, tileSize - 2, tileSize - 2);
          } else if (t === TILE.GATE) {
            ctx.fillStyle = '#7fffd455';
            ctx.fillRect(offX + x*tileSize + tileSize*0.1, offY + y*tileSize + tileSize*0.45, tileSize*0.8, tileSize*0.1);
          }
        }
      }
    }

    drawDots(ctx, tileSize, offX, offY) {
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          const t = this.maze.grid[y][x];
          if (t === TILE.DOT) {
            ctx.fillStyle = '#fff6b3';
            ctx.beginPath();
            ctx.arc(offX + (x + 0.5) * tileSize, offY + (y + 0.5) * tileSize, tileSize * 0.08, 0, Math.PI * 2);
            ctx.fill();
          } else if (t === TILE.POWER) {
            ctx.fillStyle = '#ffd23f';
            ctx.beginPath();
            ctx.arc(offX + (x + 0.5) * tileSize, offY + (y + 0.5) * tileSize, tileSize * 0.18, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  window.addEventListener('DOMContentLoaded', () => new Game());
})();
