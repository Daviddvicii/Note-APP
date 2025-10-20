'use strict';

// Pac-Man — open house doorway + 2×2 ghosts + no-jitter movement
(() => {
  const GRID_W = 28, GRID_H = 31;

  const TILE = { EMPTY:0, WALL:1, DOT:2, POWER:3, GATE:4 };

  const DIRS = {
    up:    { x:  0, y: -1, name:'up' },
    down:  { x:  0, y:  1, name:'down' },
    left:  { x: -1, y:  0, name:'left' },
    right: { x:  1, y:  0, name:'right' },
    none:  { x:  0, y:  0, name:'none' },
  };
  const DIR_LIST = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];

  const dist2 = (ax,ay,bx,by)=>{ const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy; };
  let seed = 1337; const rand = () => (seed=(seed*1103515245+12345)&0x7fffffff, seed/0x7fffffff);
  const randi = n => (rand()*n)|0;

  // ── Maze (OPEN corridor above the house; house is 2×2 GG) ───────────────────
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
    // ⬇️ This row used to be ###  ### which sealed the house. Open it:
    '######.## #        # ##.######',
    '      .   #      #   .      ',
    '######.## #      # ##.######',
    '######.## #  GG  # ##.######',
    '######.## #  GG  # ##.######',
    '######.## #      # ##.######',
    '   ... .  ###  ###  . ...   ',
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

  // ── Input ───────────────────────────────────────────────────────────────────
  class Input {
    constructor(){ this.queued=DIRS.none; this.swipe=null; this.bind(); }
    bind(){
      addEventListener('keydown', e=>{
        const k=e.key.toLowerCase();
        if(k==='arrowup'||k==='w') this.queued=DIRS.up;
        else if(k==='arrowdown'||k==='s') this.queued=DIRS.down;
        else if(k==='arrowleft'||k==='a') this.queued=DIRS.left;
        else if(k==='arrowright'||k==='d') this.queued=DIRS.right;
      });
      const dpad=document.querySelector('.dpad');
      dpad?.addEventListener('pointerdown', e=>{
        const d=e.target?.dataset?.dir; if(d) this.queued = DIRS[d]||DIRS.none;
      });
      const c=document.getElementById('game');
      c?.addEventListener('pointerdown', e=>{ this.swipe={x:e.clientX,y:e.clientY}; });
      c?.addEventListener('pointerup', e=>{
        if(!this.swipe) return;
        const dx=e.clientX-this.swipe.x, dy=e.clientY-this.swipe.y;
        if(Math.max(Math.abs(dx),Math.abs(dy))>24){
          this.queued = Math.abs(dx)>Math.abs(dy) ? (dx>0?DIRS.right:DIRS.left)
                                                  : (dy>0?DIRS.down:DIRS.up);
        }
        this.swipe=null;
      });
    }
    consumeQueued(){ return this.queued; }
  }

  // ── Sound ────────────────────────────────────────────────────────────────────
  class Sound {
    constructor(){ this.ctx=null; this.muted=false; this.toggle=false;
      const init=()=>{ if(!this.ctx){ try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch{} } };
      addEventListener('pointerdown', init, {once:true}); addEventListener('keydown', init, {once:true});
    }
    setMuted(m){ this.muted=m; }
    beep(f=440,d=0.08,t='square',g=0.02){ if(this.muted||!this.ctx) return; const ct=this.ctx.currentTime;
      const o=this.ctx.createOscillator(), a=this.ctx.createGain(); o.type=t; o.frequency.value=f; a.gain.value=g;
      o.connect(a).connect(this.ctx.destination); o.start(ct); o.stop(ct+d); }
    waka(){ this.beep(this.toggle?380:320,0.05,'square',0.02); this.toggle=!this.toggle; }
    dot(){ this.beep(700,0.04); } power(){ this.beep(220,0.25,'sawtooth',0.02); }
    eatGhost(){ this.beep(180,0.2,'triangle',0.03); } death(){ this.beep(100,0.6,'sine',0.05); }
  }

  // ── Maze ─────────────────────────────────────────────────────────────────────
  class Maze {
    constructor(){
      this.w=GRID_W; this.h=GRID_H;
      this.grid=Array.from({length:this.h},()=>Array(this.w).fill(TILE.WALL));
      this.dotCount=0;
      for(let y=0;y<this.h;y++){
        const row=MAZE_ASCII[y]||''.padEnd(this.w,'#');
        for(let x=0;x<this.w;x++){
          const c=row[x]||'#';
          let t=TILE.EMPTY;
          if(c==='#') t=TILE.WALL;
          else if(c==='.') { t=TILE.DOT; this.dotCount++; }
          else if(c==='o') { t=TILE.POWER; this.dotCount++; }
          else if(c==='-') t=TILE.GATE;
          else t=TILE.EMPTY;
          this.grid[y][x]=t;
        }
      }
      this.house={x:13,y:15};
    }
    isInside(x,y){ return x>=0&&x<this.w&&y>=0&&y<this.h; }
    tileAt(tx,ty){ return this.isInside(tx,ty)?this.grid[ty][tx]:TILE.WALL; }
    eatAt(tx,ty){
      const t=this.tileAt(tx,ty);
      if(t===TILE.DOT){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'dot'; }
      if(t===TILE.POWER){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'power'; }
      return null;
    }
    resetDots(){
      this.dotCount=0;
      for(let y=0;y<this.h;y++){
        const row=MAZE_ASCII[y];
        for(let x=0;x<this.w;x++){
          const c=row[x];
          if(c==='#') this.grid[y][x]=TILE.WALL;
          else if(c==='.') { this.grid[y][x]=TILE.DOT; this.dotCount++; }
          else if(c==='o') { this.grid[y][x]=TILE.POWER; this.dotCount++; }
          else if(c==='-') this.grid[y][x]=TILE.GATE;
          else this.grid[y][x]=TILE.EMPTY;
        }
      }
    }
  }

  const isFloor = t => t===TILE.EMPTY||t===TILE.DOT||t===TILE.POWER;
  function nearestOpenTileCenter(maze, fx,fy){
    const sx=Math.round(fx), sy=Math.round(fy);
    const q=[[sx,sy]]; const seen=new Set(); const key=(x,y)=>x+'|'+y;
    while(q.length){
      const [x,y]=q.shift(); if(!maze.isInside(x,y)) continue; const k=key(x,y); if(seen.has(k)) continue; seen.add(k);
      if(isFloor(maze.tileAt(x,y))) return {x:x+0.5,y:y+0.5};
      q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    return {x:13.5,y:23.5};
  }

  // ── Entities ─────────────────────────────────────────────────────────────────
  class Entity{ constructor(x,y,speed){ this.x=x; this.y=y; this.dir=DIRS.left; this.speed=speed; }
    center(){ return {cx:Math.floor(this.x)+0.5, cy:Math.floor(this.y)+0.5}; } }

  class Pacman extends Entity {
  constructor(x,y){ super(x,y,5.6); this.mouth=0; this.radiusFrac=0.44; }

  // helper: can we move into the next tile in dir?
  canGo(maze, dir){
    const { cx, cy } = this.center();
    const nx = cx + dir.x, ny = cy + dir.y;
    const tx = Math.floor(nx), ty = Math.floor(ny);
    if (!maze.isInside(tx,ty)) return true;              // allow wrap
    const t = maze.tileAt(tx,ty);
    return t !== TILE.WALL && t !== TILE.GATE;           // treat gate as closed for Pac-Man
  }

  update(dt, maze, input){
    const want = input.consumeQueued();
    const { cx, cy } = this.center();
    const near = Math.abs(this.x - cx) < 0.12 && Math.abs(this.y - cy) < 0.12;

    // 1) Take the queued turn exactly at center (if legal)
    if (want && want !== this.dir && near && this.canGo(maze, want)) {
      this.x = cx; this.y = cy;
      this.dir = want;
    }

    // 2) If current direction is blocked, glide to center and stop there
    if (this.dir !== DIRS.none && !this.canGo(maze, this.dir)) {
      const dx = cx - this.x, dy = cy - this.y;
      const step = this.speed * dt;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        const move = Math.min(step, len);
        this.x += dx / len * move;
        this.y += dy / len * move;
      }
      if (Math.abs(this.x - cx) <= 0.01 && Math.abs(this.y - cy) <= 0.01) {
        this.x = cx; this.y = cy;
        this.dir = DIRS.none;
      }
    } else {
      // 3) Otherwise, move
      this.x += this.dir.x * this.speed * dt;
      this.y += this.dir.y * this.speed * dt;
    }

    // 4) If we’re stopped and the wanted dir is open now, go
    if (this.dir === DIRS.none && want && this.canGo(maze, want)) {
      this.dir = want;
    }

    // 5) Wrap tunnels
    if (this.x < -0.5) this.x = maze.w - 0.5;
    if (this.x > maze.w + 0.5) this.x = -0.5;

    this.mouth += dt * 10;
  }

  draw(ctx, tileSize, offX, offY) {
    const px = offX + this.x * tileSize;
    const py = offY + this.y * tileSize;
    const r = tileSize * this.radiusFrac;
    const open = 0.2 + 0.2 * Math.abs(Math.sin(this.mouth));
    let a0 = 0, a1 = Math.PI * 2;
    if (this.dir === DIRS.right) { a0 = open; a1 = Math.PI * 2 - open; }
    else if (this.dir === DIRS.left) { a0 = Math.PI + open; a1 = Math.PI - open; }
    else if (this.dir === DIRS.up) { a0 = -Math.PI/2 + open; a1 = Math.PI*1.5 - open; }
    else if (this.dir === DIRS.down) { a0 = Math.PI/2 + open; a1 = Math.PI/2 - open; }

    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.arc(px, py, r, a0, a1, false);
    ctx.closePath(); ctx.fill();
  }
  }

  class Ghost extends Entity{
    constructor(x,y,color,name){ super(x,y,5.0); this.color=color; this.name=name; this.mode='scatter'; this.fright=0; }
    inHouse(){ const {cx,cy}=this.center(); return cx>=12.5&&cx<=14.5&&cy>=14.5&&cy<=16.5; }
    canGo(maze,dir){
      const {cx,cy}=this.center(); const nx=cx+dir.x, ny=cy+dir.y;
      const tx=Math.floor(nx), ty=Math.floor(ny);
      if(!maze.isInside(tx,ty)) return true;
      return maze.tileAt(tx,ty)!==TILE.WALL; // doorway is open; treat GATE as floor
    }
    pickDir(maze){
      const options = DIR_LIST.filter(d => this.canGo(maze,d) && !(d.x===-this.dir.x && d.y===-this.dir.y));
      if(options.length===0){ // dead-end: reverse
        const rev = DIR_LIST.find(d=>d.x===-this.dir.x && d.y===-this.dir.y);
        return rev || DIRS.none;
      }
      return options[randi(options.length)];
    }
    update(dt,maze){
      const speed = this.mode==='eyes' ? 6.2 : this.mode==='frightened' ? 3.6 : 5.0;

      const {cx,cy}=this.center();
      const near=Math.abs(this.x-cx)<0.18 && Math.abs(this.y-cy)<0.18;
      if(near){
        this.x=cx; this.y=cy;

        // prefer straight if possible; otherwise pick a legal non-reverse
        if(!this.canGo(maze,this.dir)) this.dir=this.pickDir(maze);

        // if still in house and can go up, go up to exit
        if(this.inHouse() && this.canGo(maze,DIRS.up)) this.dir=DIRS.up;
      }

      // safety: if a wall appears ahead (layout edits), re-pick
      if(!this.canGo(maze,this.dir)) this.dir=this.pickDir(maze);

      // move
      if(this.dir!==DIRS.none){ this.x+=this.dir.x*speed*dt; this.y+=this.dir.y*speed*dt; }

      // wrap
      if(this.x<-0.5) this.x=maze.w-0.5;
      if(this.x>maze.w+0.5) this.x=-0.5;
    }
    draw(ctx,tile,ox,oy){
      const px=ox+this.x*tile, py=oy+this.y*tile;
      const h=tile*0.9, r=h*0.5, col=this.mode==='frightened'?'#1e90ff':this.color;
      ctx.fillStyle=col; ctx.beginPath(); ctx.arc(px,py-h*0.1,r,Math.PI,0); ctx.lineTo(px+r,py+r*0.8);
      for(let i=4;i>=0;i--){ const fx=px-r+(i/4)*(2*r), fy=py+r*0.8+(i%2===0?-r*0.15:0); ctx.lineTo(fx,fy); }
      ctx.closePath(); ctx.fill();
      const ex=(this.dir.x||0)*r*0.2, ey=(this.dir.y||0)*r*0.2;
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(px-r*0.35+ex, py-r*0.2+ey, r*0.25, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+r*0.35+ex, py-r*0.2+ey, r*0.25, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='#001b2e';
      ctx.beginPath(); ctx.arc(px-r*0.35+ex, py-r*0.2+ey, r*0.12, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+r*0.35+ex, py-r*0.2+ey, r*0.12, 0, Math.PI*2); ctx.fill();
    }
  }

  // ── Game ─────────────────────────────────────────────────────────────────────
  class Game{
    constructor(){
      this.canvas=document.getElementById('game'); this.ctx=this.canvas.getContext('2d');
      this.input=new Input(); this.sound=new Sound(); this.maze=new Maze();

      const p=nearestOpenTileCenter(this.maze,13.5,23.5);
      this.pacman=new Pacman(p.x,p.y); this.pacman.dir=DIRS.left;

      // explicit 2×2 ghosts inside house
      const homes=[ {x:13,y:15,color:'#ff3b3b',name:'blinky'},
                    {x:14,y:15,color:'#ff9be1',name:'pinky'},
                    {x:13,y:16,color:'#00e1ff',name:'inky'},
                    {x:14,y:16,color:'#ffb24c',name:'clyde'} ];
      this.ghosts=homes.map(h=>{ const c=nearestOpenTileCenter(this.maze,h.x,h.y); const g=new Ghost(c.x,c.y,h.color,h.name); g.dir=DIRS.up; return g; });

      this.level=1; this.score=0; this.best=Number(localStorage.getItem('pacman_best_score')||'0')||0;
      this.lives=3; this.paused=false; this.gameOver=false;
      this.last=0; this.accum=0; this.fixed=1/120; this.tile=16;

      this.bindUI(); this.resize(); addEventListener('resize',()=>this.resize());
      requestAnimationFrame(t=>this.frame(t));
    }

    bindUI(){
      const mute=document.getElementById('mute-btn');
      const pause=document.getElementById('pause-btn');
      mute?.addEventListener('click',()=>{ const m=!this.sound.muted; this.sound.setMuted(m); mute.textContent=m?'🔇 Muted':'🔊 Sound'; mute.setAttribute('aria-pressed',String(m)); });
      pause?.addEventListener('click',()=>this.togglePause());
      addEventListener('keydown',e=>{
        if(e.key.toLowerCase()==='p') this.togglePause();
        if(e.key.toLowerCase()==='m' && mute){ const m=!this.sound.muted; this.sound.setMuted(m); mute.textContent=m?'🔇 Muted':'🔊 Sound'; mute.setAttribute('aria-pressed',String(m)); }
      });
    }
    togglePause(){ this.paused=!this.paused; const p=document.getElementById('pause-btn'); if(p) p.textContent=this.paused?'▶️ Resume':'⏸️ Pause'; }

    resize(){
      const dpr=Math.max(1,Math.min(3,devicePixelRatio||1));
      const cssW=innerWidth, cssH=innerHeight;
      this.canvas.style.width=cssW+'px'; this.canvas.style.height=cssH+'px';
      this.canvas.width=Math.floor(cssW*dpr); this.canvas.height=Math.floor(cssH*dpr);
      const playW=this.canvas.width/dpr, playH=this.canvas.height/dpr;
      this.tile=Math.floor(Math.min(playW/GRID_W, playH/GRID_H));
      this.ctx.setTransform(dpr,0,0,dpr,0,0);
    }

    frame(t){
      if(!this.last) this.last=t;
      let dt=Math.min(0.05,(t-this.last)/1000); this.last=t;
      if(!this.paused && !this.gameOver){
        this.accum=Math.min(this.accum+dt,0.25);
        while(this.accum>=this.fixed){ this.update(this.fixed); this.accum-=this.fixed; }
      }
      this.draw(); requestAnimationFrame(tt=>this.frame(tt));
    }

    update(dt){
      const before={x:Math.floor(this.pacman.x),y:Math.floor(this.pacman.y)};
      this.pacman.update(dt,this.maze,this.input);
      const after={x:Math.floor(this.pacman.x),y:Math.floor(this.pacman.y)};
      if(before.x!==after.x || before.y!==after.y) this.sound.waka();

      const c=this.pacman.center();
      if(Math.abs(this.pacman.x-c.cx)<0.3 && Math.abs(this.pacman.y-c.cy)<0.3){
        const eaten=this.maze.eatAt(Math.floor(c.cx),Math.floor(c.cy));
        if(eaten==='dot'){ this.addScore(10); this.sound.dot(); }
        else if(eaten==='power'){ this.addScore(50); this.sound.power(); this.ghosts.forEach(g=>g.fright=5); }
      }

      for(const g of this.ghosts) g.update(dt,this.maze);

      for(const g of this.ghosts){
        if(dist2(g.x,g.y,this.pacman.x,this.pacman.y)<0.35){
          if(g.fright>0){ this.addScore(200); g.mode='eyes'; this.sound.eatGhost(); }
          else { this.loseLife(); break; }
        }
      }

      if(this.maze.dotCount<=0){ this.level++; this.maze.resetDots(); this.resetPositions(); }
      this.updateHUD();
    }

    resetPositions(){
      const p=nearestOpenTileCenter(this.maze,13.5,23.5);
      this.pacman.x=p.x; this.pacman.y=p.y; this.pacman.dir=DIRS.left;
      const homes=[[13,15],[14,15],[13,16],[14,16]];
      this.ghosts.forEach((g,i)=>{ const c=nearestOpenTileCenter(this.maze,homes[i][0],homes[i][1]); g.x=c.x; g.y=c.y; g.dir=DIRS.up; g.mode='scatter'; g.fright=0; });
    }

    loseLife(){
      this.lives--; this.sound.death();
      if(this.lives<=0){
        this.gameOver=true;
        if(this.score>this.best){ this.best=this.score; localStorage.setItem('pacman_best_score',String(this.best)); }
        setTimeout(()=>{ this.level=1; this.score=0; this.lives=3; this.maze.resetDots(); this.gameOver=false; this.resetPositions(); },1200);
      }else{ this.resetPositions(); }
    }

    addScore(n){ this.score+=n; if(this.score>this.best) this.best=this.score; }
    updateHUD(){
      const s=document.getElementById('hud-score'), b=document.getElementById('hud-best'), l=document.getElementById('hud-lives');
      if(s) s.textContent=`Score: ${this.score}`;
      if(b) b.textContent=`Best: ${this.best}`;
      if(l){ l.innerHTML=''; for(let i=0;i<this.lives;i++){ const d=document.createElement('div'); d.className='life-dot'; l.appendChild(d); } }
    }

    draw(){
      const ctx=this.ctx, tile=this.tile;
      const ox=Math.floor((innerWidth - tile*GRID_W)/2);
      const oy=Math.floor((innerHeight- tile*GRID_H)/2);
      ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
      // walls
      for(let y=0;y<this.maze.h;y++){
        for(let x=0;x<this.maze.w;x++){
          if(this.maze.grid[y][x]===TILE.WALL){
            ctx.fillStyle='#143b5b';
            ctx.fillRect(ox+x*tile, oy+y*tile, tile, tile);
            ctx.strokeStyle='#7fffd4'; ctx.lineWidth=2;
            ctx.strokeRect(ox+x*tile+1, oy+y*tile+1, tile-2, tile-2);
          }
        }
      }
      // dots
      for(let y=0;y<this.maze.h;y++){
        for(let x=0;x<this.maze.w;x++){
          const t=this.maze.grid[y][x];
          if(t===TILE.DOT){
            ctx.fillStyle='#fff6b3'; ctx.beginPath();
            ctx.arc(ox+(x+0.5)*tile, oy+(y+0.5)*tile, tile*0.08, 0, Math.PI*2); ctx.fill();
          } else if(t===TILE.POWER){
            ctx.fillStyle='#ffd23f'; ctx.beginPath();
            ctx.arc(ox+(x+0.5)*tile, oy+(y+0.5)*tile, tile*0.18, 0, Math.PI*2); ctx.fill();
          }
        }
      }
      this.pacman.draw(ctx,tile,ox,oy);
      for(const g of this.ghosts) g.draw(ctx,tile,ox,oy);

      if(this.paused || this.gameOver){
        ctx.save();
        ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(0,0,innerWidth,innerHeight);
        ctx.fillStyle='#7fffd4'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font='20px "Press Start 2P", monospace';
        ctx.fillText(this.paused?'PAUSED':'GAME OVER', innerWidth/2, innerHeight/2);
        ctx.restore();
      }
    }
  }

  addEventListener('DOMContentLoaded', ()=> new Game());
})();
