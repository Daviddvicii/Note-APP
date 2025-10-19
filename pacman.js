'use strict';

// Pac-Man HTML5 Canvas implementation
// Organized into small classes: Game, Maze, Pacman, Ghost, Input, Sound

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
    up: { x: 0, y: -1, name: 'up' },
    down: { x: 0, y: 1, name: 'down' },
    left: { x: -1, y: 0, name: 'left' },
    right: { x: 1, y: 0, name: 'right' },
    none: { x: 0, y: 0, name: 'none' },
  };
  const DIR_ARRAY = [DIRS.left, DIRS.right, DIRS.up, DIRS.down];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; }

  // Simple deterministic pseudo-random for frightened wiggle
  let seed = 1337;
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function randInt(n) { return (rand() * n) | 0; }

  // Classic-ish maze 28x31 (using # walls, . dots, o power, - gate, spaces empty)
  // Layout is adapted to fit 28x31 and play well; not pixel-perfect arcade map but close.
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
  // Ensure 31 rows; above includes 31 lines (index 0..30)

  // ==== Grid helpers (must be right after MAZE_ASCII) ====
  const TILE_SIZE = 16;

  function nearCenter(x, y, tol = 0.2) {
    const cx = Math.floor(x) + 0.5;
    const cy = Math.floor(y) + 0.5;
    return Math.abs(x - cx) < tol && Math.abs(y - cy) < tol;
  }
  function snapToCenterXY(obj) {
    const cx = Math.floor(obj.x) + 0.5;
    const cy = Math.floor(obj.y) + 0.5;
    obj.x = cx; obj.y = cy;
  }
  function tunnelRow(y) {
    if (y < 0 || y >= GRID_H) return false;
    return MAZE_ASCII[y].includes(' ');
  }

  class Input {
    constructor() {
      this.queued = DIRS.none;
      this.keysDown = new Set();
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

      // D-pad buttons
      const dpad = document.querySelector('.dpad');
      if (dpad) {
        dpad.addEventListener('pointerdown', (e) => {
          const target = e.target;
          if (target && target.dataset && target.dataset.dir) {
            this.setDirFromString(target.dataset.dir);
          }
        });
      }

      // Swipe gestures
      const canvas = document.getElementById('game');
      if (canvas) {
        canvas.addEventListener('pointerdown', (e) => {
          this.swipeStart = { x: e.clientX, y: e.clientY, t: performance.now() };
        });
        canvas.addEventListener('pointerup', (e) => {
          if (!this.swipeStart) return;
          const dx = e.clientX - this.swipeStart.x;
          const dy = e.clientY - this.swipeStart.y;
          const adx = Math.abs(dx), ady = Math.abs(dy);
          if (Math.max(adx, ady) > 24) {
            if (adx > ady) this.queued = dx > 0 ? DIRS.right : DIRS.left;
            else this.queued = dy > 0 ? DIRS.down : DIRS.up;
          }
          this.swipeStart = null;
        });
      }
    }
    setDirFromString(s) {
      if (s === 'up') this.queued = DIRS.up;
      else if (s === 'down') this.queued = DIRS.down;
      else if (s === 'left') this.queued = DIRS.left;
      else if (s === 'right') this.queued = DIRS.right;
    }
    consumeQueued() {
      const d = this.queued; this.queued = d; // non-consuming; Pac-Man uses queued persistently
      return d;
    }
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
    initContext() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { /* no audio */ }
      }
    }
    setMuted(m) { this.muted = m; }
    now() { return this.ctx ? this.ctx.currentTime : 0; }
    beep(freq = 440, dur = 0.08, type = 'square', gain = 0.02) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    }
    waka() {
      // Alternating two short bleeps to simulate waka
      this.beep(this.wakaToggle ? 380 : 320, 0.05, 'square', 0.02);
      this.wakaToggle = !this.wakaToggle;
    }
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
      // Ghost house location
      this.house = { x: 13, y: 15 }; // center tiles near 'GG' markers
    }
    isInside(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; }
    tileAt(tx, ty) {
      if (!this.isInside(tx, ty)) return TILE.WALL;
      return this.grid[ty][tx];
    }
    isWall(tx, ty) { return this.tileAt(tx, ty) === TILE.WALL; }
    isGate(tx, ty) { return this.tileAt(tx, ty) === TILE.GATE; }
    eatAt(tx, ty) {
      const t = this.tileAt(tx, ty);
      if (t === TILE.DOT) { this.grid[ty][tx] = TILE.EMPTY; this.dotCount--; return 'dot'; }
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
      this.x = x; // in tiles
      this.y = y; // in tiles
      this.dir = DIRS.left;
      this.desiredDir = DIRS.left;
      this.speed = speedTilesPerSec; // tiles per second
    }
    setDir(d) { this.desiredDir = d; }
    centerOfTile() { return { cx: Math.floor(this.x) + 0.5, cy: Math.floor(this.y) + 0.5 }; }
  }

  class Pacman extends Entity {
    constructor(x, y) {
      super(x, y, 5.6); // ~5.6 tiles/s → ~90 px/s if tile 16
      this.radiusFrac = 0.44;
      this.alive = true;
      this.mouth = 0; // animate mouth
    }
    canMove(maze, dir) {
      const nx = this.x + dir.x * 0.51;
      const ny = this.y + dir.y * 0.51;
      const tx = Math.floor(nx + (dir.x > 0 ? 0.5 : dir.x < 0 ? -0.5 : 0));
      const ty = Math.floor(ny + (dir.y > 0 ? 0.5 : dir.y < 0 ? -0.5 : 0));
      if (!maze.isInside(tx, ty)) return true; // allow wrap; handled outside
      const wall = maze.isWall(tx, ty) || maze.isGate(tx, ty);
      return !wall;
    }
    update(dt, maze, input) {
      const desired = input.consumeQueued();

      // Turn only at cell centers and only if the turn is legal
      if (desired && desired !== this.dir && nearCenter(this.x, this.y)) {
        const tx = Math.floor(this.x), ty = Math.floor(this.y);
        const nx = tx + desired.x, ny = ty + desired.y;
        const blocked = (maze.isInside(nx, ny) && (maze.isWall(nx, ny) || maze.isGate(nx, ny)));
        if (!blocked) {
          snapToCenterXY(this);
          this.dir = desired;
        }
      }

      // If the next cell in current dir is blocked, stop on center and wait
      {
        const tx = Math.floor(this.x), ty = Math.floor(this.y);
        const nx = tx + this.dir.x, ny = ty + this.dir.y;
        const blocked = (maze.isInside(nx, ny) && (maze.isWall(nx, ny) || maze.isGate(nx, ny)));
        if (blocked) {
          snapToCenterXY(this);
          if (desired && desired !== this.dir) {
            const n2x = tx + desired.x, n2y = ty + desired.y;
            const blocked2 = (maze.isInside(n2x, n2y) && (maze.isWall(n2x, n2y) || maze.isGate(n2x, n2y)));
            if (!blocked2) this.dir = desired;
          }
          // Still blocked → no movement this frame
          if (this.dir === DIRS.none ||
              (maze.isInside(tx + this.dir.x, ty + this.dir.y) && (maze.isWall(tx + this.dir.x, ty + this.dir.y) || maze.isGate(tx + this.dir.x, ty + this.dir.y)))) {
            return;
          }
        }
      }

      // Move within corridor
      this.x += this.dir.x * this.speed * dt;
      this.y += this.dir.y * this.speed * dt;

      // Keep on rails (snap the perpendicular axis)
      if (this.dir === DIRS.left || this.dir === DIRS.right) {
        this.y = Math.floor(this.y) + 0.5;
      } else if (this.dir === DIRS.up || this.dir === DIRS.down) {
        this.x = Math.floor(this.x) + 0.5;
      }

      // Horizontal tunnel wrap only on tunnel rows
      const gy = Math.floor(this.y);
      if (tunnelRow(gy)) {
        if (this.x < -0.5) this.x = GRID_W - 0.5;
        if (this.x > GRID_W + 0.5) this.x = -0.5;
      }

      this.mouth += dt * 10;
    }
    draw(ctx, tileSize, offX, offY) {
      const px = offX + this.x * tileSize;
      const py = offY + this.y * tileSize;
      const r = tileSize * this.radiusFrac;
      const open = 0.2 + 0.2 * Math.abs(Math.sin(this.mouth));
      let angStart = 0, angEnd = Math.PI * 2;
      if (this.dir === DIRS.right) { angStart = open; angEnd = Math.PI * 2 - open; }
      else if (this.dir === DIRS.left) { angStart = Math.PI + open; angEnd = Math.PI - open; }
      else if (this.dir === DIRS.up) { angStart = -Math.PI/2 + open; angEnd = Math.PI*1.5 - open; }
      else if (this.dir === DIRS.down) { angStart = Math.PI/2 + open; angEnd = Math.PI/2 - open; }

      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, r, angStart, angEnd, false);
      ctx.closePath();
      ctx.fill();
    }
  }

  class Ghost extends Entity {
    constructor(x, y, color, name) {
      super(x, y, 5.2);
      this.baseSpeed = 5.2;
      this.color = color;
      this.name = name;
      this.mode = 'scatter'; // 'chase' | 'scatter' | 'frightened' | 'eyes'
      this.frightenedTimer = 0;
      this.scatterTarget = { x: 1, y: 1 };
      this.home = { x, y };
    }
    setScatterCorner(cornerIndex) {
      // 0: top-right, 1: top-left, 2: bottom-right, 3: bottom-left
      const corners = [
        { x: GRID_W - 2, y: 1 },
        { x: 1, y: 1 },
        { x: GRID_W - 2, y: GRID_H - 2 },
        { x: 1, y: GRID_H - 2 },
      ];
      this.scatterTarget = corners[cornerIndex % corners.length];
    }
    enterFrightened(duration) {
      if (this.mode !== 'eyes') { // eyes mode ignores frightened
        this.mode = 'frightened';
        this.frightenedTimer = duration;
      }
    }
    update(dt, maze, pacman, blinkyRef) {
      let speed = this.baseSpeed;
      if (this.mode === 'frightened') speed *= 0.66;
      if (this.mode === 'eyes') speed *= 1.3;

      if (this.mode === 'frightened') {
        this.frightenedTimer -= dt;
        if (this.frightenedTimer <= 0) this.mode = 'chase';
      }

      const atCenter = nearCenter(this.x, this.y, 0.15);
      if (atCenter) {
        snapToCenterXY(this);
        const target = this.computeTarget(pacman, blinkyRef);
        const tx = Math.floor(this.x), ty = Math.floor(this.y);

        const opposite = (this.dir === DIRS.left) ? DIRS.right :
                         (this.dir === DIRS.right) ? DIRS.left :
                         (this.dir === DIRS.up) ? DIRS.down :
                         (this.dir === DIRS.down) ? DIRS.up : DIRS.none;

        const options = [DIRS.up, DIRS.left, DIRS.down, DIRS.right].filter(d => {
          if (this.mode !== 'frightened' && d === opposite) return false;
          const nx = tx + d.x, ny = ty + d.y;
          if (!maze.isInside(nx, ny)) return true; // allow wrap; walls checked next
          if (maze.isWall(nx, ny)) return false;
          if (maze.isGate(nx, ny) && this.mode !== 'eyes') return false;
          return true;
        });

        if (options.length) {
          if (this.mode === 'frightened') {
            this.dir = options[Math.floor(Math.random() * options.length)];
          } else {
            let best = options[0], bestD = Infinity;
            for (const d of options) {
              const nx = tx + d.x, ny = ty + d.y;
              const dd = (nx - target.x) * (nx - target.x) + (ny - target.y) * (ny - target.y);
              if (dd < bestD) { bestD = dd; best = d; }
            }
            this.dir = best;
          }
        }
      }

      const tx = Math.floor(this.x), ty = Math.floor(this.y);
      const nx = tx + this.dir.x, ny = ty + this.dir.y;
      const blocked = (maze.isInside(nx, ny) && (maze.isWall(nx, ny) || (maze.isGate(nx, ny) && this.mode !== 'eyes')));
      if (blocked) {
        snapToCenterXY(this);
        return;
      }

      this.x += this.dir.x * speed * dt;
      this.y += this.dir.y * speed * dt;

      if (this.dir === DIRS.left || this.dir === DIRS.right) this.y = Math.floor(this.y) + 0.5;
      else if (this.dir === DIRS.up || this.dir === DIRS.down) this.x = Math.floor(this.x) + 0.5;

      if (tunnelRow(Math.floor(this.y))) {
        if (this.x < -0.5) this.x = GRID_W - 0.5;
        if (this.x > GRID_W + 0.5) this.x = -0.5;
      }

      if (this.mode === 'eyes') {
        const d2h = (this.x - (this.home.x + 0.5)) ** 2 + (this.y - (this.home.y + 0.5)) ** 2;
        if (d2h < 0.1) { this.mode = 'scatter'; this.dir = DIRS.left; }
      }
    }
    computeTarget(pacman, blinkyRef) {
      if (this.mode === 'scatter') return this.scatterTarget;
      if (this.mode === 'eyes') return { x: blinkyRef ? blinkyRef.home.x : 13, y: 14 };
      // chase rules per ghost
      const px = pacman.x, py = pacman.y;
      const pd = pacman.dir || DIRS.left;
      switch (this.name) {
        case 'blinky': // target Pac-Man
          return { x: px, y: py };
        case 'pinky': { // 4 tiles ahead
          return { x: px + pd.x * 4, y: py + pd.y * 4 };
        }
        case 'inky': { // vector from blinky to a point two tiles ahead of pacman
          const ahead = { x: px + pd.x * 2, y: py + pd.y * 2 };
          const bx = blinkyRef ? blinkyRef.x : px;
          const by = blinkyRef ? blinkyRef.y : py;
          return { x: ahead.x + (ahead.x - bx), y: ahead.y + (ahead.y - by) };
        }
        case 'clyde': { // if far chase pacman, if close scatter
          const d2 = dist2(this.x, this.y, px, py);
          if (d2 > 64) return { x: px, y: py }; // >8 tiles away
          return this.scatterTarget;
        }
      }
      return { x: px, y: py };
    }
    draw(ctx, tileSize, offX, offY) {
      const px = offX + this.x * tileSize;
      const py = offY + this.y * tileSize;
      const w = tileSize * 0.9, h = tileSize * 0.9;
      const r = h * 0.5;
      const bodyColor = this.mode === 'frightened' ? '#1e90ff' : this.color;

      // Body
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(px, py - h * 0.1, r, Math.PI, 0);
      ctx.lineTo(px + r, py + r * 0.8);
      // bottom frills
      const frills = 4;
      for (let i = frills; i >= 0; i--) {
        const fx = px - r + (i / frills) * (2 * r);
        const fy = py + r * 0.8 + (i % 2 === 0 ? -r * 0.15 : 0);
        ctx.lineTo(fx, fy);
      }
      ctx.closePath();
      ctx.fill();

      // Eyes
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
      this.pacman = new Pacman(13.5, 23); // near bottom center
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
      this.fixedDt = 1 / 120; // physics tick
      this.tileSize = 16; // computed on resize
      this.offX = 0; this.offY = 0;
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
      if (pauseBtn) {
        pauseBtn.addEventListener('click', () => this.togglePause());
      }
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
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
      const playableW = this.canvas.width / dpr;
      const playableH = this.canvas.height / dpr;
      this.tileSize = Math.floor(Math.min(playableW / GRID_W, playableH / GRID_H));
      this.offX = Math.floor((playableW - this.tileSize * GRID_W) / 2) * dpr;
      this.offY = Math.floor((playableH - this.tileSize * GRID_H) / 2) * dpr;
      // Scale context to DPR; we'll draw in CSS pixels then multiply positions by dpr
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resetPositions(afterDeath) {
      this.pacman.x = 13.5; this.pacman.y = 23; this.pacman.dir = DIRS.left;
      const positions = [
        [13.5, 11], [13.5, 14], [11.5, 14], [15.5, 14],
      ];
      this.ghosts.forEach((g, i) => {
        g.x = positions[i][0]; g.y = positions[i][1]; g.dir = DIRS.left; g.mode = afterDeath ? 'scatter' : 'scatter';
      });
      this.scatterTimer = 0; this.inChase = false;
    }

    nextLevel() {
      this.level++;
      this.maze.resetDots();
      // Slight speedup
      this.pacman.speed = Math.min(7, 5.6 + (this.level - 1) * 0.15);
      for (const g of this.ghosts) g.baseSpeed = Math.min(6.5, 5.2 + (this.level - 1) * 0.1);
      this.resetPositions(false);
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
      // Timers: scatter/chase cycles
      this.scatterTimer += dt;
      const scatterLen = 7, chaseLen = 20;
      if (!this.inChase && this.scatterTimer > scatterLen) {
        this.inChase = true; this.scatterTimer = 0; this.ghosts.forEach(g => { if (g.mode !== 'eyes') g.mode = 'chase'; });
      } else if (this.inChase && this.scatterTimer > chaseLen) {
        this.inChase = false; this.scatterTimer = 0; this.ghosts.forEach(g => { if (g.mode !== 'eyes') g.mode = 'scatter'; });
      }

      // Pac-Man movement and eating
      const prevTile = { x: Math.floor(this.pacman.x), y: Math.floor(this.pacman.y) };
      this.pacman.update(dt, this.maze, this.input);
      const nowTile = { x: Math.floor(this.pacman.x), y: Math.floor(this.pacman.y) };
      if (nowTile.x !== prevTile.x || nowTile.y !== prevTile.y) {
        this.sound.waka();
      }

      // Eat dots/power when centered
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

      // Update ghosts
      const blinky = this.ghosts.find(g => g.name === 'blinky');
      for (const g of this.ghosts) g.update(dt, this.maze, this.pacman, blinky);

      // Collisions with ghosts
      for (const g of this.ghosts) {
        if (g.mode === 'eyes') continue;
        const d2 = dist2(g.x, g.y, this.pacman.x, this.pacman.y);
        if (d2 < 0.35) {
          if (g.mode === 'frightened') {
            // eat ghost
            this.addScore(200);
            g.mode = 'eyes';
            this.sound.eatGhost();
          } else {
            // lose a life
            this.loseLife();
            break;
          }
        }
      }

      // Level cleared
      if (this.maze.dotCount <= 0) this.nextLevel();

      this.updateHUD();
    }

    loseLife() {
      this.lives--;
      this.sound.death();
      if (this.lives <= 0) {
        this.gameOver = true;
        // Update best
        if (this.score > this.best) {
          this.best = this.score;
          localStorage.setItem('pacman_best_score', String(this.best));
        }
        setTimeout(() => {
          // Reset for a new run
          this.level = 1; this.score = 0; this.lives = 3; this.maze.resetDots();
          this.gameOver = false; this.resetPositions(false);
        }, 1500);
      } else {
        // Reset positions after short pause
        this.resetPositions(true);
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
      // Clear background as transparent; page CSS shows background
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // Convert offsets from device to CSS pixels since ctx is scaled
      const offX = this.offX / (this.canvas.width / (this.canvas.style.width.replace('px','')|0 || window.innerWidth));
      const offY = this.offY / (this.canvas.height / (this.canvas.style.height.replace('px','')|0 || window.innerHeight));

      // Actually, we set transform to DPR already; use stored CSS offsets directly
      const ox = Math.floor((window.innerWidth - this.tileSize * GRID_W) / 2);
      const oy = Math.floor((window.innerHeight - this.tileSize * GRID_H) / 2);

      this.drawMaze(ctx, this.tileSize, ox, oy);
      // Draw dots and power pellets
      this.drawDots(ctx, this.tileSize, ox, oy);

      // Draw entities
      this.pacman.draw(ctx, this.tileSize, ox, oy);
      for (const g of this.ghosts) g.draw(ctx, this.tileSize, ox, oy);

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
      // Walls
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

  // Initialize the game when DOM is ready
  window.addEventListener('DOMContentLoaded', () => {
    new Game();
  });
})();
