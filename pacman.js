'use strict';

// Pac-Man HTML5 Canvas – roam-only ghosts, fixed spawns
(() => {
  const GRID_W = 28, GRID_H = 31;

  const TILE = { EMPTY:0, WALL:1, DOT:2, POWER:3, GATE:4 };

  const DIRS = {
    up:    { x:  0, y: -1, name: 'up' },
    down:  { x:  0, y:  1, name: 'down' },
    left:  { x: -1, y:  0, name: 'left' },
    right: { x:  1, y:  0, name: 'right' },
    none:  { x:  0, y:  0, name: 'none' },
  };
  const DIR_ARRAY = [DIRS.left, DIRS.right, DIRS.up, DIRS.down];

  const dist2 = (ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;};

  // tiny deterministic PRNG to de-sync choices a bit
  let seed = 1337;
  function rand(){ seed = (seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
  function randInt(n){ return (rand()*n)|0; }

  // movement helpers
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

  // Classic-ish maze 28x31 (keep the '--' gates!)
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
    '######.## #  GG  # ##.######',
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

  // ---------- Input ----------
  class Input {
    constructor() { this.queued = DIRS.none; this.swipeStart = null; this.bind(); }
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
          const t = e.target; if (t && t.dataset && t.dataset.dir) this.queued = DIRS[t.dataset.dir] || DIRS.none;
        });
      }
      const canvas = document.getElementById('game');
      if (canvas) {
        canvas.addEventListener('pointerdown', (e) => { this.swipeStart = { x: e.clientX, y: e.clientY }; });
        canvas.addEventListener('pointerup', (e) => {
          if (!this.swipeStart) return;
          const dx = e.clientX - this.swipeStart.x, dy = e.clientY - this.swipeStart.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) {
            this.queued = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left)
                                                      : (dy > 0 ? DIRS.down  : DIRS.up);
          }
          this.swipeStart = null;
        });
      }
    }
    consumeQueued() { return this.queued; } // persistent queue
  }

  // ---------- Sound ----------
  class Sound {
    constructor() {
      this.ctx = null; this.muted = false; this.wakaToggle = false;
      this.initContext = this.initContext.bind(this);
      window.addEventListener('pointerdown', this.initContext, { once: true });
      window.addEventListener('keydown', this.initContext, { once: true });
    }
    initContext() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_){} } }
    setMuted(m){ this.muted = m; }
    beep(freq=440, dur=0.08, type='square', gain=0.02){
      if (this.muted || !this.ctx) return;
      const t0=this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type=type; o.frequency.value=freq; g.gain.value=gain; o.connect(g).connect(this.ctx.destination);
      o.start(t0); o.stop(t0+dur);
    }
    waka(){ this.beep(this.wakaToggle?380:320,0.05,'square',0.02); this.wakaToggle=!this.wakaToggle; }
    dot(){ this.beep(700,0.04,'square',0.02); }
    power(){ this.beep(220,0.25,'sawtooth',0.02); }
    eatGhost(){ this.beep(180,0.2,'triangle',0.03); }
    death(){ this.beep(100,0.6,'sine',0.05); }
  }

  // ---------- Maze ----------
  class Maze {
    constructor(){
      this.w=GRID_W; this.h=GRID_H; this.grid=new Array(this.h); this.dotCount=0;
      for (let y=0;y<this.h;y++){
        this.grid[y]=new Array(this.w);
        const row=MAZE_ASCII[y]||''.padEnd(this.w,'#');
        for (let x=0;x<this.w;x++){
          const c=row[x]||'#'; let t=TILE.EMPTY;
          if (c==='#') t=TILE.WALL;
          else if (c==='.') { t=TILE.DOT; this.dotCount++; }
          else if (c==='o') { t=TILE.POWER; this.dotCount++; }
          else if (c==='-') t=TILE.GATE;
          this.grid[y][x]=t;
        }
      }
      this.house={ x:13, y:15 };
    }
    isInside(x,y){ return x>=0 && x<this.w && y>=0 && y<this.h; }
    tileAt(tx,ty){ if(!this.isInside(tx,ty)) return TILE.WALL; return this.grid[ty][tx]; }
    isWall(tx,ty){ return this.tileAt(tx,ty)===TILE.WALL; }
    isGate(tx,ty){ return this.tileAt(tx,ty)===TILE.GATE; }
    eatAt(tx,ty){
      const t=this.tileAt(tx,ty);
      if (t===TILE.DOT){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'dot'; }
      if (t===TILE.POWER){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'power'; }
      return null;
    }
    resetDots(){
      this.dotCount=0;
      for(let y=0;y<this.h;y++){
        const row=MAZE_ASCII[y];
        for(let x=0;x<this.w;x++){
          const c=row[x];
          if (c==='.') { this.grid[y][x]=TILE.DOT; this.dotCount++; }
          else if (c==='o') { this.grid[y][x]=TILE.POWER; this.dotCount++; }
          else if (c==='#') this.grid[y][x]=TILE.WALL;
          else if (c==='-') this.grid[y][x]=TILE.GATE;
          else this.grid[y][x]=TILE.EMPTY;
        }
      }
    }
  }

  // ---------- spawn helper ----------
  const isFloor = t => (t===TILE.EMPTY || t===TILE.DOT || t===TILE.POWER);
  function nearestOpenTileCenter(maze, fx, fy){
    const sx=Math.round(fx), sy=Math.round(fy);
    const q=[[sx,sy]], seen=new Set(); const key=(x,y)=>x+'|'+y;
    while(q.length){
      const [x,y]=q.shift(); if(!maze.isInside(x,y)) continue;
      if(seen.has(key(x,y))) continue; seen.add(key(x,y));
      if (isFloor(maze.tileAt(x,y))) return { x:x+0.5, y:y+0.5 };
      q.push([x+1,y]); q.push([x-1,y]); q.push([x,y+1]); q.push([x,y-1]);
    }
    return { x: Math.floor(maze.w/2)+0.5, y: Math.floor(maze.h/2)+0.5 };
  }

  // ---------- Entities ----------
  class Entity {
    constructor(x,y,speed){ this.x=x; this.y=y; this.dir=DIRS.left; this.speed=speed; }
    centerOfTile(){ return { cx:Math.floor(this.x)+0.5, cy:Math.floor(this.y)+0.5 }; }
  }

  class Pacman extends Entity {
    constructor(x,y){ super(x,y,5.6); this.mouth=0; this.radiusFrac=0.44; }
    update(dt, maze, input){
      const desired=input.consumeQueued();
      const {cx,cy}=this.centerOfTile();
      const nearCenter = Math.abs(this.x-cx)<0.18 && Math.abs(this.y-cy)<0.18;

      // take a queued turn exactly at center
      if (desired!==this.dir && nearCenter && !blockedAhead(maze,cx,cy,desired,false)) {
        this.x=cx; this.y=cy; this.dir=desired;
      }

      // if blocked, slide to center and stop
      if (this.dir!==DIRS.none && blockedAhead(maze,cx,cy,this.dir,false)) {
        const dx=cx-this.x, dy=cy-this.y, step=this.speed*dt, len=Math.hypot(dx,dy);
        if (len>0.0001){ const ux=dx/len, uy=dy/len; const mv=Math.min(step,len); this.x+=ux*mv; this.y+=uy*mv; }
        if (Math.abs(this.x-cx)<=0.01 && Math.abs(this.y-cy)<=0.01){ this.x=cx; this.y=cy; this.dir=DIRS.none; }
      } else {
        this.x+=this.dir.x*this.speed*dt; this.y+=this.dir.y*this.speed*dt;
      }

      // if stopped and desired is open now, take it
      if (this.dir===DIRS.none && desired && !blockedAhead(maze,this.centerOfTile().cx,this.centerOfTile().cy,desired,false)){
        const c2=this.centerOfTile(); this.x=c2.cx; this.y=c2.cy; this.dir=desired;
      }

      // wrap
      if (this.x < -0.5) this.x = maze.w - 0.5;
      if (this.x > maze.w + 0.5) this.x = -0.5;

      this.mouth += dt*10;
    }
    draw(ctx, tile, ox, oy){
      const px=ox+this.x*tile, py=oy+this.y*tile, r=tile*this.radiusFrac;
      const open=0.2+0.2*Math.abs(Math.sin(this.mouth));
      let a0=0,a1=Math.PI*2;
      if(this.dir===DIRS.right){ a0=open; a1=Math.PI*2-open; }
      else if(this.dir===DIRS.left){ a0=Math.PI+open; a1=Math.PI-open; }
      else if(this.dir===DIRS.up){ a0=-Math.PI/2+open; a1=Math.PI*1.5-open; }
      else if(this.dir===DIRS.down){ a0=Math.PI/2+open; a1=Math.PI/2-open; }
      ctx.fillStyle='#ffd23f';
      ctx.beginPath(); ctx.moveTo(px,py); ctx.arc(px,py,r,a0,a1,false); ctx.closePath(); ctx.fill();
    }
  }

  class Ghost extends Entity {
    constructor(x,y,color,name){
      super(x,y,5.2); this.baseSpeed=5.2; this.color=color; this.name=name;
      this.mode='scatter'; this.frightenedTimer=0; this.scatterTarget={x:1,y:1}; this.home={x,y};
    }
    setScatterCorner(k){
      const c=[ {x:GRID_W-2,y:1}, {x:1,y:1}, {x:GRID_W-2,y:GRID_H-2}, {x:1,y:GRID_H-2} ];
      this.scatterTarget = c[k%4];
    }
    inHouse(){
      const {cx,cy}=this.centerOfTile();
      return cx>=11 && cx<=16 && cy>=13 && cy<=17;
    }
    canMove(maze, dir, allowGate){
      const nx=this.x + dir.x*0.51, ny=this.y + dir.y*0.51;
      const tx=Math.floor(nx + (dir.x>0?0.5:dir.x<0?-0.5:0));
      const ty=Math.floor(ny + (dir.y>0?0.5:dir.y<0?-0.5:0));
      if(!maze.isInside(tx,ty)) return true;
      const t=maze.tileAt(tx,ty);
      if(t===TILE.WALL) return false;
      if(t===TILE.GATE && !allowGate) return false;
      return true;
    }
    update(dt, maze){
      // roam-only behavior
      let speed=this.baseSpeed;
      if(this.mode==='frightened') speed*=0.66;
      if(this.mode==='eyes') speed*=1.3;

      if(this.mode==='frightened'){ this.frightenedTimer-=dt; if(this.frightenedTimer<=0) this.mode='scatter'; }

      const allowGate=(this.mode==='eyes') || this.inHouse();

      const {cx,cy}=this.centerOfTile();
      const nearCenter = Math.abs(this.x-cx)<0.22 && Math.abs(this.y-cy)<0.22;
      if(nearCenter){ this.x=cx; this.y=cy; }

      const forwardBlocked = this.dir!==DIRS.none && !this.canMove(maze,this.dir,allowGate);
      if(this.dir===DIRS.none || nearCenter || forwardBlocked){
        const legal=[DIRS.up,DIRS.left,DIRS.down,DIRS.right].filter(d=>{
          const reversing = this.dir && d.x===-this.dir.x && d.y===-this.dir.y;
          if(reversing && this.mode!=='frightened') return false;
          return this.canMove(maze,d,allowGate);
        });

        if(legal.length===0){
          const any=[DIRS.up,DIRS.left,DIRS.down,DIRS.right].filter(d=>this.canMove(maze,d,allowGate));
          this.dir = any.length ? any[randInt(any.length)] : DIRS.none;
        }else{
          this.dir = legal[randInt(legal.length)]; // random roam
        }
      }

      if(this.dir!==DIRS.none && this.canMove(maze,this.dir,allowGate)){
        this.x += this.dir.x*speed*dt; this.y += this.dir.y*speed*dt;
      }

      if (this.x < -0.5) this.x = maze.w - 0.5;
      if (this.x > maze.w + 0.5) this.x = -0.5;

      if(this.mode==='eyes'){
        const d2h=dist2(this.x,this.y,maze.house.x+0.5,maze.house.y+0.5);
        if(d2h<0.2){ this.mode='scatter'; this.dir=DIRS.left; }
      }
    }
    draw(ctx, tile, ox, oy){
      const px=ox+this.x*tile, py=oy+this.y*tile;
      const h=tile*0.9, r=h*0.5;
      const bodyColor = this.mode==='frightened' ? '#1e90ff' : this.color;

      ctx.fillStyle=bodyColor;
      ctx.beginPath();
      ctx.arc(px, py - h*0.1, r, Math.PI, 0);
      ctx.lineTo(px + r, py + r*0.8);
      for(let i=4;i>=0;i--){
        const fx=px - r + (i/4)*(2*r);
        const fy=py + r*0.8 + (i%2===0 ? -r*0.15 : 0);
        ctx.lineTo(fx, fy);
      }
      ctx.closePath(); ctx.fill();

      const ex=(this.dir.x||0)*r*0.2, ey=(this.dir.y||0)*r*0.2;
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(px - r*0.35 + ex, py - r*0.2 + ey, r*0.25, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + r*0.35 + ex, py - r*0.2 + ey, r*0.25, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='#001b2e';
      ctx.beginPath(); ctx.arc(px - r*0.35 + ex, py - r*0.2 + ey, r*0.12, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + r*0.35 + ex, py - r*0.2 + ey, r*0.12, 0, Math.PI*2); ctx.fill();
    }
    enterFrightened(d){ if(this.mode!=='eyes'){ this.mode='frightened'; this.frightenedTimer=d; } }
  }

  // ---------- Game ----------
  class Game {
    constructor(){
      this.canvas=document.getElementById('game'); this.ctx=this.canvas.getContext('2d');
      this.input=new Input(); this.sound=new Sound(); this.maze=new Maze();

      // Pac-Man spawn (snapped to floor)
      const pSpawn = nearestOpenTileCenter(this.maze, 13.5, 23);
      this.pacman = new Pacman(pSpawn.x, pSpawn.y);

      // Ghosts spawn INSIDE the house (snapped to floor)
      const homes = [
        { x:13.5, y:15.5, color:'#ff3b3b', name:'blinky' },
        { x:13.5, y:14.5, color:'#ff9be1', name:'pinky'  },
        { x:12.5, y:15.5, color:'#00e1ff', name:'inky'   },
        { x:14.5, y:15.5, color:'#ffb24c', name:'clyde'  },
      ];
      this.ghosts = homes.map(h=>{
        const c=nearestOpenTileCenter(this.maze,h.x,h.y);
        const g=new Ghost(c.x,c.y,h.color,h.name);
        g.dir=DIRS.left; g.mode='scatter'; return g;
      });
      this.ghosts[0].setScatterCorner(0);
      this.ghosts[1].setScatterCorner(1);
      this.ghosts[2].setScatterCorner(2);
      this.ghosts[3].setScatterCorner(3);

      this.level=1; this.score=0; this.best=Number(localStorage.getItem('pacman_best_score')||'0')||0;
      this.lives=3; this.paused=false; this.gameOver=false;
      this.lastTime=0; this.accum=0; this.fixedDt=1/120; this.tileSize=16;

      this.bindUI(); this.resize(); window.addEventListener('resize',()=>this.resize());
      this.loop=this.loop.bind(this); requestAnimationFrame(this.loop);
    }

    bindUI(){
      const muteBtn=document.getElementById('mute-btn');
      const pauseBtn=document.getElementById('pause-btn');
      if(muteBtn){ muteBtn.addEventListener('click',()=>{ const m=!this.sound.muted; this.sound.setMuted(m); muteBtn.textContent=m?'🔇 Muted':'🔊 Sound'; muteBtn.setAttribute('aria-pressed',String(m)); }); }
      if(pauseBtn){ pauseBtn.addEventListener('click',()=>this.togglePause()); }
      window.addEventListener('keydown',(e)=>{
        if(e.key.toLowerCase()==='p') this.togglePause();
        if(e.key.toLowerCase()==='m' && muteBtn){ const m=!this.sound.muted; this.sound.setMuted(m); muteBtn.textContent=m?'🔇 Muted':'🔊 Sound'; muteBtn.setAttribute('aria-pressed',String(m)); }
      });
    }
    togglePause(){ this.paused=!this.paused; const btn=document.getElementById('pause-btn'); if(btn) btn.textContent=this.paused?'▶️ Resume':'⏸️ Pause'; }

    resize(){
      const dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));
      const cssW=window.innerWidth, cssH=window.innerHeight;
      this.canvas.style.width=cssW+'px'; this.canvas.style.height=cssH+'px';
      this.canvas.width=Math.floor(cssW*dpr); this.canvas.height=Math.floor(cssH*dpr);
      const playableW=this.canvas.width/dpr, playableH=this.canvas.height/dpr;
      this.tileSize=Math.floor(Math.min(playableW/GRID_W, playableH/GRID_H));
      this.ctx.setTransform(dpr,0,0,dpr,0,0);
    }

    resetPositions(){
      const p=nearestOpenTileCenter(this.maze,13.5,23);
      this.pacman.x=p.x; this.pacman.y=p.y; this.pacman.dir=DIRS.left;

      const homes = [{x:13.5,y:15.5},{x:13.5,y:14.5},{x:12.5,y:15.5},{x:14.5,y:15.5}];
      this.ghosts.forEach((g,i)=>{
        const c=nearestOpenTileCenter(this.maze,homes[i].x,homes[i].y);
        g.x=c.x; g.y=c.y; g.dir=DIR_ARRAY[randInt(4)]; g.mode='scatter';
      });
    }

    loop(ts){
      if(!this.lastTime) this.lastTime=ts;
      const delta=Math.min(0.05,(ts-this.lastTime)/1000); this.lastTime=ts;
      if(!this.paused && !this.gameOver){
        this.accum+=delta;
        while(this.accum>=this.fixedDt){ this.update(this.fixedDt); this.accum-=this.fixedDt; }
      }
      this.draw(); requestAnimationFrame(this.loop);
    }

    update(dt){
      // Pac-Man movement + waka on tile change
      const prevTile={ x:Math.floor(this.pacman.x), y:Math.floor(this.pacman.y) };
      this.pacman.update(dt,this.maze,this.input);
      const nowTile={ x:Math.floor(this.pacman.x), y:Math.floor(this.pacman.y) };
      if(nowTile.x!==prevTile.x || nowTile.y!==prevTile.y) this.sound.waka();

      // Eat dots/power when centered
      const c=this.pacman.centerOfTile();
      if(Math.abs(this.pacman.x-c.cx)<0.3 && Math.abs(this.pacman.y-c.cy)<0.3){
        const eaten=this.maze.eatAt(Math.floor(c.cx),Math.floor(c.cy));
        if(eaten==='dot'){ this.addScore(10); this.sound.dot(); }
        else if(eaten==='power'){ this.addScore(50); this.sound.power();
          this.ghosts.forEach(g=>g.enterFrightened(5));
        }
      }

      // Ghosts
      for(const g of this.ghosts) g.update(dt,this.maze);

      // Collisions
      for(const g of this.ghosts){
        if(g.mode==='eyes') continue;
        if(dist2(g.x,g.y,this.pacman.x,this.pacman.y)<0.35){
          if(g.mode==='frightened'){ this.addScore(200); g.mode='eyes'; this.sound.eatGhost(); }
          else { this.loseLife(); break; }
        }
      }

      if(this.maze.dotCount<=0){ this.level++; this.maze.resetDots(); this.resetPositions(); }
      this.updateHUD();
    }

    loseLife(){
      this.lives--; this.sound.death();
      if(this.lives<=0){
        this.gameOver=true;
        if(this.score>this.best){ this.best=this.score; localStorage.setItem('pacman_best_score',String(this.best)); }
        setTimeout(()=>{ this.level=1; this.score=0; this.lives=3; this.maze.resetDots(); this.gameOver=false; this.resetPositions(); },1500);
      } else { this.resetPositions(); }
    }

    addScore(n){ this.score+=n; if(this.score>this.best) this.best=this.score; }

    updateHUD(){
      const scoreEl=document.getElementById('hud-score');
      const bestEl=document.getElementById('hud-best');
      const livesEl=document.getElementById('hud-lives');
      if(scoreEl) scoreEl.textContent=`Score: ${this.score}`;
      if(bestEl) bestEl.textContent=`Best: ${this.best}`;
      if(livesEl){ livesEl.innerHTML=''; for(let i=0;i<this.lives;i++){ const d=document.createElement('div'); d.className='life-dot'; livesEl.appendChild(d); } }
    }

    draw(){
      const ctx=this.ctx; ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
      const tile=this.tileSize;
      const ox=Math.floor((window.innerWidth - tile*GRID_W)/2);
      const oy=Math.floor((window.innerHeight- tile*GRID_H)/2);
      this.drawMaze(ctx,tile,ox,oy);
      this.drawDots(ctx,tile,ox,oy);
      this.pacman.draw(ctx,tile,ox,oy);
      for(const g of this.ghosts) g.draw(ctx,tile,ox,oy);
      if(this.paused || this.gameOver) this.drawOverlay(ctx);
    }

    drawOverlay(ctx){
      ctx.save();
      ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
      ctx.fillStyle='#7fffd4'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font='20px "Press Start 2P", monospace';
      ctx.fillText(this.paused?'PAUSED':'GAME OVER', window.innerWidth/2, window.innerHeight/2);
      ctx.restore();
    }

    drawMaze(ctx,tile,ox,oy){
      for(let y=0;y<this.maze.h;y++){
        for(let x=0;x<this.maze.w;x++){
          const t=this.maze.grid[y][x];
          if(t===TILE.WALL){
            ctx.fillStyle='#143b5b';
            ctx.fillRect(ox+x*tile, oy+y*tile, tile, tile);
            ctx.strokeStyle='#7fffd4'; ctx.lineWidth=2;
            ctx.strokeRect(ox+x*tile+1, oy+y*tile+1, tile-2, tile-2);
          } else if (t===TILE.GATE){
            ctx.fillStyle='#7fffd455';
            ctx.fillRect(ox+x*tile+tile*0.1, oy+y*tile+tile*0.45, tile*0.8, tile*0.1);
          }
        }
      }
    }

    drawDots(ctx,tile,ox,oy){
      for(let y=0;y<this.maze.h;y++){
        for(let x=0;x<this.maze.w;x++){
          const t=this.maze.grid[y][x];
          if(t===TILE.DOT){
            ctx.fillStyle='#fff6b3'; ctx.beginPath();
            ctx.arc(ox+(x+0.5)*tile, oy+(y+0.5)*tile, tile*0.08, 0, Math.PI*2); ctx.fill();
          } else if (t===TILE.POWER){
            ctx.fillStyle='#ffd23f'; ctx.beginPath();
            ctx.arc(ox+(x+0.5)*tile, oy+(y+0.5)*tile, tile*0.18, 0, Math.PI*2); ctx.fill();
          }
        }
      }
    }
  }

  window.addEventListener('DOMContentLoaded', ()=> new Game());
})();
