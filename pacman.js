'use strict';

// Pac-Man – OPEN house (dots), doorways + working side tunnel, roaming ghosts
(() => {
  const GRID_W = 28, GRID_H = 31;

  const TILE = { EMPTY:0, WALL:1, DOT:2, POWER:3 };

  const DIRS = {
    up:    { x:  0, y: -1, name: 'up' },
    down:  { x:  0, y:  1, name: 'down' },
    left:  { x: -1, y:  0, name: 'left' },
    right: { x:  1, y:  0, name: 'right' },
    none:  { x:  0, y:  0, name: 'none' },
  };
  const DIR_ARRAY = [DIRS.left, DIRS.right, DIRS.up, DIRS.down];

  const dist2 = (ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;};
  let seed = 1337; function rand(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;} function randInt(n){return (rand()*n)|0;}

  // baseline maze (unchanged); we’ll carve openings programmatically
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
    '######.## ###  ### ##.######',
    '      .   #      #   .      ',
    '######.## # #### # ##.######',
    '######.## # #### # ##.######',
    '######.## # #### # ##.######',
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

  class Input {
    constructor(){ this.queued=DIRS.none; this.swipeStart=null; this.bind(); }
    bind(){
      window.addEventListener('keydown', e=>{
        const k = e.key.toLowerCase();
        if (k==='arrowup'||k==='w') this.queued=DIRS.up;
        else if (k==='arrowdown'||k==='s') this.queued=DIRS.down;
        else if (k==='arrowleft'||k==='a') this.queued=DIRS.left;
        else if (k==='arrowright'||k==='d') this.queued=DIRS.right;
      });
      const dpad=document.querySelector('.dpad');
      if(dpad){
        dpad.addEventListener('pointerdown',e=>{
          const t=e.target; if(t&&t.dataset&&t.dataset.dir) this.queued=DIRS[t.dataset.dir]||DIRS.none;
        });
      }
      const canvas=document.getElementById('game');
      if(canvas){
        canvas.addEventListener('pointerdown',e=>{this.swipeStart={x:e.clientX,y:e.clientY};});
        canvas.addEventListener('pointerup',e=>{
          if(!this.swipeStart) return;
          const dx=e.clientX-this.swipeStart.x, dy=e.clientY-this.swipeStart.y;
          if(Math.max(Math.abs(dx),Math.abs(dy))>24){
            this.queued = Math.abs(dx)>Math.abs(dy) ? (dx>0?DIRS.right:DIRS.left) : (dy>0?DIRS.down:DIRS.up);
          }
          this.swipeStart=null;
        });
      }
    }
    consumeQueued(){ return this.queued; }
  }

  class Sound {
    constructor(){ this.ctx=null; this.muted=false; this.wakaToggle=false;
      this.initContext=this.initContext.bind(this);
      window.addEventListener('pointerdown',this.initContext,{once:true});
      window.addEventListener('keydown',this.initContext,{once:true});
    }
    initContext(){ if(!this.ctx){ try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(_){} } }
    setMuted(m){ this.muted=m; }
    beep(f=440,d=0.08,t='square',g=0.02){ if(this.muted||!this.ctx) return; const T=this.ctx.currentTime,o=this.ctx.createOscillator(),G=this.ctx.createGain(); o.type=t;o.frequency.value=f;G.gain.value=g;o.connect(G).connect(this.ctx.destination);o.start(T);o.stop(T+d); }
    waka(){ this.beep(this.wakaToggle?380:320,0.05,'square',0.02); this.wakaToggle=!this.wakaToggle; }
    dot(){ this.beep(700,0.04,'square',0.02); }
    power(){ this.beep(220,0.25,'sawtooth',0.02); }
    eatGhost(){ this.beep(180,0.2,'triangle',0.03); }
    death(){ this.beep(100,0.6,'sine',0.05); }
  }

  class Maze {
    constructor(){
      this.w=GRID_W; this.h=GRID_H; this.grid=new Array(this.h); this.dotCount=0;

      // 1) build from ASCII
      for(let y=0;y<this.h;y++){
        this.grid[y]=new Array(this.w);
        const row=MAZE_ASCII[y]||''.padEnd(this.w,'#');
        for(let x=0;x<this.w;x++){
          const c=row[x]||'#';
          let t=TILE.EMPTY;
          if(c==='#') t=TILE.WALL;
          else if(c==='.') t=TILE.DOT;
          else if(c==='o') t=TILE.POWER;
          else t=TILE.EMPTY;
          this.grid[y][x]=t;
        }
      }

      // 2) OPEN the ghost house area completely to DOTS and cut doorways
      // house rectangle (center-ish)
      const hx0=10, hx1=17, hy0=13, hy1=17;
      for(let y=hy0;y<=hy1;y++){
        for(let x=hx0;x<=hx1;x++) this.grid[y][x]=TILE.DOT;
      }
      // doorways to connect with maze
      const openings = [
        {x:13,y:12}, {x:14,y:12}, // top
        {x:13,y:18}, {x:14,y:18}, // bottom
        {x:9 ,y:15}, {x:9 ,y:16}, // left
        {x:18,y:15}, {x:18,y:16}, // right
      ];
      openings.forEach(p=>{
        if(p.x>=0&&p.x<this.w&&p.y>=0&&p.y<this.h) this.grid[p.y][p.x]=TILE.DOT;
      });

      // 3) OPEN side warp tunnel (row 17)
      const ty = 17;
      if(ty>=0 && ty<this.h){
        this.grid[ty][0]  = TILE.EMPTY;
        this.grid[ty][27] = TILE.EMPTY;
        // make sure you can step into tunnel
        this.grid[ty][1]  = (this.grid[ty][1]===TILE.WALL)?TILE.DOT:this.grid[ty][1];
        this.grid[ty][26] = (this.grid[ty][26]===TILE.WALL)?TILE.DOT:this.grid[ty][26];
      }

      // count dots
      this.dotCount=0;
      for(let y=0;y<this.h;y++) for(let x=0;x<this.w;x++){
        const t=this.grid[y][x]; if(t===TILE.DOT||t===TILE.POWER) this.dotCount++;
      }

      this.house={x:13,y:15};
    }
    isInside(x,y){ return x>=0&&x<this.w&&y>=0&&y<this.h; }
    tileAt(tx,ty){ if(!this.isInside(tx,ty)) return TILE.WALL; return this.grid[ty][tx]; }
    isWall(tx,ty){ return this.tileAt(tx,ty)===TILE.WALL; }
    eatAt(tx,ty){
      const t=this.tileAt(tx,ty);
      if(t===TILE.DOT){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'dot'; }
      if(t===TILE.POWER){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'power'; }
      return null;
    }
    resetDots(){
      // rebuild then re-open areas
      for(let y=0;y<this.h;y++){
        const row=MAZE_ASCII[y];
        for(let x=0;x<this.w;x++){
          const c=row[x];
          if(c==='#') this.grid[y][x]=TILE.WALL;
          else if(c==='.') this.grid[y][x]=TILE.DOT;
          else if(c==='o') this.grid[y][x]=TILE.POWER;
          else this.grid[y][x]=TILE.EMPTY;
        }
      }
      const hx0=10, hx1=17, hy0=13, hy1=17;
      for(let y=hy0;y<=hy1;y++) for(let x=hx0;x<=hx1;x++) this.grid[y][x]=TILE.DOT;
      [{x:13,y:12},{x:14,y:12},{x:13,y:18},{x:14,y:18},{x:9,y:15},{x:9,y:16},{x:18,y:15},{x:18,y:16}].forEach(p=>{ this.grid[p.y][p.x]=TILE.DOT; });
      const ty=17; this.grid[ty][0]=TILE.EMPTY; this.grid[ty][27]=TILE.EMPTY; if(this.grid[ty][1]===TILE.WALL) this.grid[ty][1]=TILE.DOT; if(this.grid[ty][26]===TILE.WALL) this.grid[ty][26]=TILE.DOT;

      this.dotCount=0;
      for(let y=0;y<this.h;y++) for(let x=0;x<this.w;x++){
        const t=this.grid[y][x]; if(t===TILE.DOT||t===TILE.POWER) this.dotCount++;
      }
    }
  }

  function nearestOpenTileCenter(maze, fx, fy){
    const sx=Math.round(fx), sy=Math.round(fy);
    const q=[[sx,sy]], seen=new Set(); const key=(x,y)=>x+'|'+y;
    while(q.length){
      const [x,y]=q.shift(); if(!maze.isInside(x,y)) continue;
      if(seen.has(key(x,y))) continue; seen.add(key(x,y));
      const t=maze.tileAt(x,y);
      if(t!==TILE.WALL) return {x:x+0.5,y:y+0.5};
      q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    return {x:maze.w/2,y:maze.h/2};
  }

  class Entity {
    constructor(x,y,s){ this.x=x; this.y=y; this.dir=DIRS.left; this.speed=s; }
    centerOfTile(){ return {cx:Math.floor(this.x)+0.5, cy:Math.floor(this.y)+0.5}; }
    canMove(maze,dir){
      const nx=this.x+dir.x*0.51, ny=this.y+dir.y*0.51;
      const tx=Math.floor(nx+(dir.x>0?0.5:dir.x<0?-0.5:0));
      const ty=Math.floor(ny+(dir.y>0?0.5:dir.y<0?-0.5:0));
      if(!maze.isInside(tx,ty)) return true; // allow wrap
      return !maze.isWall(tx,ty);
    }
  }

  class Pacman extends Entity {
    constructor(x,y){ super(x,y,5.6); this.mouth=0; this.radiusFrac=0.44; }
    update(dt,maze,input){
      const desired=input.consumeQueued();
      const {cx,cy}=this.centerOfTile();
      const nearC=Math.abs(this.x-cx)<0.22 && Math.abs(this.y-cy)<0.22;

      if(desired!==this.dir && nearC && this.canMove(maze,desired)){ this.x=cx; this.y=cy; this.dir=desired; }

      if(this.dir!==DIRS.none && !this.canMove(maze,this.dir)){
        const dx=cx-this.x, dy=cy-this.y, step=this.speed*dt, len=Math.hypot(dx,dy);
        if(len>0.0001){ const ux=dx/len, uy=dy/len, mv=Math.min(step,len); this.x+=ux*mv; this.y+=uy*mv; }
        if(Math.abs(this.x-cx)<=0.01 && Math.abs(this.y-cy)<=0.01){ this.x=cx; this.y=cy; this.dir=DIRS.none; }
      } else {
        this.x+=this.dir.x*this.speed*dt; this.y+=this.dir.y*this.speed*dt;
      }

      if(this.dir===DIRS.none && desired && this.canMove(maze,desired)){ const c2=this.centerOfTile(); this.x=c2.cx; this.y=c2.cy; this.dir=desired; }

      // wrap tunnel
      if(this.x<-0.5){ this.x=maze.w-0.5; }
      if(this.x>maze.w+0.5){ this.x=-0.5; }

      this.mouth+=dt*10;
    }
    draw(ctx,t,ox,oy){
      const px=ox+this.x*t, py=oy+this.y*t, r=t*this.radiusFrac;
      const open=0.2+0.2*Math.abs(Math.sin(this.mouth));
      let a0=0,a1=Math.PI*2;
      if(this.dir===DIRS.right){a0=open;a1=Math.PI*2-open;}
      else if(this.dir===DIRS.left){a0=Math.PI+open;a1=Math.PI-open;}
      else if(this.dir===DIRS.up){a0=-Math.PI/2+open;a1=Math.PI*1.5-open;}
      else if(this.dir===DIRS.down){a0=Math.PI/2+open;a1=Math.PI/2-open;}
      ctx.fillStyle='#ffd23f'; ctx.beginPath(); ctx.moveTo(px,py); ctx.arc(px,py,r,a0,a1,false); ctx.closePath(); ctx.fill();
    }
  }

  class Ghost extends Entity {
    constructor(x,y,color,name){ super(x,y,5.0); this.color=color; this.name=name; }
    update(dt,maze){
      const {cx,cy}=this.centerOfTile();
      const nearC=Math.abs(this.x-cx)<0.22 && Math.abs(this.y-cy)<0.22;
      if(nearC){ this.x=cx; this.y=cy; }

      const forwardBlocked=this.dir!==DIRS.none && !this.canMove(maze,this.dir);

      if(this.dir===DIRS.none || nearC || forwardBlocked){
        const legal=[DIRS.up,DIRS.left,DIRS.down,DIRS.right].filter(d=>{
          const rev=this.dir && d.x===-this.dir.x && d.y===-this.dir.y;
          if(rev && !forwardBlocked) return false; // prefer not to reverse unless stuck
          return this.canMove(maze,d);
        });
        this.dir = legal.length ? legal[randInt(legal.length)] : DIRS.none;
      }

      if(this.dir!==DIRS.none && this.canMove(maze,this.dir)){
        this.x+=this.dir.x*5.0*dt; this.y+=this.dir.y*5.0*dt;
      }

      if(this.x<-0.5) this.x=maze.w-0.5;
      if(this.x>maze.w+0.5) this.x=-0.5;
    }
    draw(ctx,t,ox,oy){
      const px=ox+this.x*t, py=oy+this.y*t, h=t*0.9, r=h*0.5;
      ctx.fillStyle=this.color;
      ctx.beginPath(); ctx.arc(px,py-h*0.1,r,Math.PI,0); ctx.lineTo(px+r,py+r*0.8);
      for(let i=4;i>=0;i--){ const fx=px-r+(i/4)*(2*r); const fy=py+r*0.8+(i%2===0?-r*0.15:0); ctx.lineTo(fx,fy); }
      ctx.closePath(); ctx.fill();
      const ex=(this.dir.x||0)*r*0.2, ey=(this.dir.y||0)*r*0.2;
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(px-r*0.35+ex,py-r*0.2+ey,r*0.25,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+r*0.35+ex,py-r*0.2+ey,r*0.25,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#001b2e'; ctx.beginPath(); ctx.arc(px-r*0.35+ex,py-r*0.2+ey,r*0.12,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+r*0.35+ex,py-r*0.2+ey,r*0.12,0,Math.PI*2); ctx.fill();
    }
  }

  class Game {
    constructor(){
      this.canvas=document.getElementById('game'); this.ctx=this.canvas.getContext('2d');
      this.input=new Input(); this.sound=new Sound(); this.maze=new Maze();

      const pSpawn=nearestOpenTileCenter(this.maze,13.5,23);
      this.pacman=new Pacman(pSpawn.x,pSpawn.y);

      // 2×2 block, different initial directions so they start moving
      const homes=[
        {x:13.5,y:15.5,color:'#ff3b3b',name:'blinky',dir:DIRS.left},
        {x:14.5,y:15.5,color:'#ff9be1',name:'pinky', dir:DIRS.right},
        {x:13.5,y:14.5,color:'#00e1ff',name:'inky',  dir:DIRS.up},
        {x:14.5,y:14.5,color:'#ffb24c',name:'clyde', dir:DIRS.down},
      ];
      this.ghosts=homes.map(h=>{ const c=nearestOpenTileCenter(this.maze,h.x,h.y); const g=new Ghost(c.x,c.y,h.color,h.name); g.dir=h.dir; return g; });

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
      window.addEventListener('keydown',(e)=>{ if(e.key.toLowerCase()==='p') this.togglePause(); if(e.key.toLowerCase()==='m'&&muteBtn){ const m=!this.sound.muted; this.sound.setMuted(m); muteBtn.textContent=m?'🔇 Muted':'🔊 Sound'; muteBtn.setAttribute('aria-pressed',String(m)); }});
    }
    togglePause(){ this.paused=!this.paused; const b=document.getElementById('pause-btn'); if(b) b.textContent=this.paused?'▶️ Resume':'⏸️ Pause'; }

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

      const homes=[[13.5,15.5,DIRS.left],[14.5,15.5,DIRS.right],[13.5,14.5,DIRS.up],[14.5,14.5,DIRS.down]];
      this.ghosts.forEach((g,i)=>{ const c=nearestOpenTileCenter(this.maze,homes[i][0],homes[i][1]); g.x=c.x; g.y=c.y; g.dir=homes[i][2]; });
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
      const prevTile={x:Math.floor(this.pacman.x),y:Math.floor(this.pacman.y)};
      this.pacman.update(dt,this.maze,this.input);
      const nowTile={x:Math.floor(this.pacman.x),y:Math.floor(this.pacman.y)};
      if(nowTile.x!==prevTile.x || nowTile.y!==prevTile.y) this.sound.waka();

      const c=this.pacman.centerOfTile();
      if(Math.abs(this.pacman.x-c.cx)<0.3 && Math.abs(this.pacman.y-c.cy)<0.3){
        const eaten=this.maze.eatAt(Math.floor(c.cx),Math.floor(c.cy));
        if(eaten==='dot'){ this.addScore(10); this.sound.dot(); }
        else if(eaten==='power'){ this.addScore(50); this.sound.power(); }
      }

      for(const g of this.ghosts) g.update(dt,this.maze);

      for(const g of this.ghosts){
        if(dist2(g.x,g.y,this.pacman.x,this.pacman.y)<0.35){ this.loseLife(); break; }
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
      const s=document.getElementById('hud-score'), b=document.getElementById('hud-best'), l=document.getElementById('hud-lives');
      if(s) s.textContent=`Score: ${this.score}`;
      if(b) b.textContent=`Best: ${this.best}`;
      if(l){ l.innerHTML=''; for(let i=0;i<this.lives;i++){ const d=document.createElement('div'); d.className='life-dot'; l.appendChild(d); } }
    }

    draw(){
      const ctx=this.ctx; ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
      const t=this.tileSize, ox=Math.floor((window.innerWidth - t*GRID_W)/2), oy=Math.floor((window.innerHeight- t*GRID_H)/2);
      this.drawMaze(ctx,t,ox,oy); this.drawDots(ctx,t,ox,oy);
      this.pacman.draw(ctx,t,ox,oy); for(const g of this.ghosts) g.draw(ctx,t,ox,oy);
      if(this.paused || this.gameOver) this.drawOverlay(ctx);
    }
    drawOverlay(ctx){ ctx.save(); ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight); ctx.fillStyle='#7fffd4'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='20px "Press Start 2P", monospace'; ctx.fillText(this.paused?'PAUSED':'GAME OVER', window.innerWidth/2, window.innerHeight/2); ctx.restore(); }
    drawMaze(ctx,t,ox,oy){
      for(let y=0;y<this.maze.h;y++) for(let x=0;x<this.maze.w;x++){
        if(this.maze.grid[y][x]===TILE.WALL){
          ctx.fillStyle='#143b5b'; ctx.fillRect(ox+x*t,oy+y*t,t,t);
          ctx.strokeStyle='#7fffd4'; ctx.lineWidth=2; ctx.strokeRect(ox+x*t+1,oy+y*t+1,t-2,t-2);
        }
      }
    }
    drawDots(ctx,t,ox,oy){
      for(let y=0;y<this.maze.h;y++) for(let x=0;x<this.maze.w;x++){
        const A=this.maze.grid[y][x];
        if(A===TILE.DOT){ ctx.fillStyle='#fff6b3'; ctx.beginPath(); ctx.arc(ox+(x+0.5)*t,oy+(y+0.5)*t,t*0.08,0,Math.PI*2); ctx.fill(); }
        else if(A===TILE.POWER){ ctx.fillStyle='#ffd23f'; ctx.beginPath(); ctx.arc(ox+(x+0.5)*t,oy+(y+0.5)*t,t*0.18,0,Math.PI*2); ctx.fill(); }
      }
    }
  }

  window.addEventListener('DOMContentLoaded',()=>new Game());
})();
