'use strict';

(() => {
  const GRID_W = 28, GRID_H = 31;
  const TILE = { EMPTY:0, WALL:1, DOT:2, POWER:3 };

  const DIRS = {
    up:{x:0,y:-1,name:'up'}, down:{x:0,y:1,name:'down'},
    left:{x:-1,y:0,name:'left'}, right:{x:1,y:0,name:'right'},
    none:{x:0,y:0,name:'none'}
  };
  const DIRS_ARR = [DIRS.left, DIRS.right, DIRS.up, DIRS.down];
  const d2=(ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;};
  let seed=1337; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff)|0;

  // ------- MAZE (fixed corridors + open house top) -------
  const MAZE_ASCII = [
    "############################",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#............##............#",
    "#.####.##.########.##.####.#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.##### ## #####.######",
    "######.##### ## #####.######",
    "######.##          ##.######",
    "######.##   ###### ##.######",
    "      .     #    #     .    ",
    "######.##   #    # ##.######",
    "######.##   # GG # ##.######",
    "######.##   # GG # ##.######",
    "######.##   #    # ##.######",
    "######.##   ##  ## ##.######",
    "######.##          ##.######",
    "######.## ######## ##.######",
    "######.## ######## ##.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o..##................##..o#",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#............##............#",
    "############################",
    "############################"
  ];

  // ---------- input ----------
  class Input{
    constructor(){ this.want=DIRS.none; this.start=null;
      addEventListener('keydown',e=>{
        const k=e.key.toLowerCase();
        if(k==='arrowup'||k==='w') this.want=DIRS.up;
        else if(k==='arrowdown'||k==='s') this.want=DIRS.down;
        else if(k==='arrowleft'||k==='a') this.want=DIRS.left;
        else if(k==='arrowright'||k==='d') this.want=DIRS.right;
      });
      const dpad=document.querySelector('.dpad');
      if(dpad){ dpad.addEventListener('pointerdown',e=>{ const d=e.target.dataset.dir; if(d) this.want=DIRS[d]||DIRS.none; }); }
      const cvs=document.getElementById('game');
      if(cvs){
        cvs.addEventListener('pointerdown',e=>{ this.start={x:e.clientX,y:e.clientY}; });
        cvs.addEventListener('pointerup',e=>{
          if(!this.start) return;
          const dx=e.clientX-this.start.x, dy=e.clientY-this.start.y;
          if(Math.max(Math.abs(dx),Math.abs(dy))>24){
            this.want = Math.abs(dx)>Math.abs(dy) ? (dx>0?DIRS.right:DIRS.left) : (dy>0?DIRS.down:DIRS.up);
          }
          this.start=null;
        });
      }
    }
  }

  // ---------- audio ----------
  class Sound{
    constructor(){ this.ctx=null; this.muted=false; this.alt=false;
      const boot=()=>{ if(!this.ctx){ try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch{} } };
      addEventListener('pointerdown',boot,{once:true});
      addEventListener('keydown',boot,{once:true});
    }
    setMuted(m){ this.muted=m; }
    beep(f=440,d=0.06,t='square',g=0.02){ if(this.muted||!this.ctx) return;
      const t0=this.ctx.currentTime, o=this.ctx.createOscillator(), a=this.ctx.createGain();
      o.type=t; o.frequency.value=f; a.gain.value=g; o.connect(a).connect(this.ctx.destination);
      o.start(t0); o.stop(t0+d);
    }
    waka(){ this.beep(this.alt?380:320,0.05); this.alt=!this.alt; }
    dot(){ this.beep(700,0.04); }
    power(){ this.beep(220,0.25,'sawtooth',0.03); }
    death(){ this.beep(110,0.6,'sine',0.06); }
  }

  // ---------- maze ----------
  class Maze{
    constructor(){
      this.w=GRID_W; this.h=GRID_H; this.grid=new Array(this.h); this.dotCount=0;
      for(let y=0;y<this.h;y++){
        this.grid[y]=new Array(this.w);
        const row=MAZE_ASCII[y]||"".padEnd(this.w,'#');
        for(let x=0;x<this.w;x++){
          const c=row[x]||'#'; let t=TILE.EMPTY;
          if(c==='#') t=TILE.WALL;
          else if(c==='.'){ t=TILE.DOT; this.dotCount++; }
          else if(c==='o'){ t=TILE.POWER; this.dotCount++; }
          this.grid[y][x]=t;
        }
      }
      this.house={x:13,y:15};
    }
    inside(x,y){ return x>=0&&x<this.w&&y>=0&&y<this.h; }
    tile(tx,ty){ if(!this.inside(tx,ty)) return TILE.WALL; return this.grid[ty][tx]; }
    isWall(tx,ty){ return this.tile(tx,ty)===TILE.WALL; }
    eatAt(tx,ty){
      const t=this.tile(tx,ty);
      if(t===TILE.DOT){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'dot'; }
      if(t===TILE.POWER){ this.grid[ty][tx]=TILE.EMPTY; this.dotCount--; return 'power'; }
      return null;
    }
  }

  // unify probe for everyone (prevents jams)
  function nextFromCenter(cx,cy,dir){
    const tx=Math.floor(cx), ty=Math.floor(cy);
    const nx=tx+(dir.x>0?1:dir.x<0?-1:0);
    const ny=ty+(dir.y>0?1:dir.y<0?-1:0);
    return {nx,ny};
  }
  function blockedAhead(maze,cx,cy,dir){
    const {nx,ny}=nextFromCenter(cx,cy,dir);
    if(!maze.inside(nx,ny)) return false; // wrap allowed
    return maze.isWall(nx,ny);
  }

  // ---------- entities ----------
  class Entity{
    constructor(x,y,s){ this.x=x; this.y=y; this.dir=DIRS.left; this.speed=s; }
    center(){ return {cx:Math.floor(this.x)+0.5, cy:Math.floor(this.y)+0.5}; }
  }

  class Pacman extends Entity{
    constructor(x,y){ super(x,y,5.6); this.mouth=0; }
    update(dt,maze,input){
      const want=input.want;
      const {cx,cy}=this.center();
      const near=Math.abs(this.x-cx)<0.18 && Math.abs(this.y-cy)<0.18;

      if(want!==this.dir && near && !blockedAhead(maze,cx,cy,want)){ this.x=cx; this.y=cy; this.dir=want; }

      if(this.dir!==DIRS.none && blockedAhead(maze,cx,cy,this.dir)){
        const dx=cx-this.x, dy=cy-this.y, step=this.speed*dt, len=Math.hypot(dx,dy);
        if(len>0.0001){ const mv=Math.min(step,len); this.x+=dx/len*mv; this.y+=dy/len*mv; }
        if(Math.abs(this.x-cx)<=0.01 && Math.abs(this.y-cy)<=0.01){ this.x=cx; this.y=cy; this.dir=DIRS.none; }
      }else{
        this.x+=this.dir.x*this.speed*dt; this.y+=this.dir.y*this.speed*dt;
      }

      if(this.dir===DIRS.none && want && !blockedAhead(maze,this.center().cx,this.center().cy,want)){
        const c2=this.center(); this.x=c2.cx; this.y=c2.cy; this.dir=want;
      }

      if(this.x<-0.5) this.x=maze.w-0.5;
      if(this.x>maze.w+0.5) this.x=-0.5;
      this.mouth+=dt*10;
    }
    draw(ctx,t,ox,oy){
      const px=ox+this.x*t, py=oy+this.y*t, r=t*0.44;
      const open=0.2+0.2*Math.abs(Math.sin(this.mouth));
      let a0=0,a1=Math.PI*2;
      if(this.dir===DIRS.right){ a0=open; a1=Math.PI*2-open; }
      else if(this.dir===DIRS.left){ a0=Math.PI+open; a1=Math.PI-open; }
      else if(this.dir===DIRS.up){ a0=-Math.PI/2+open; a1=Math.PI*1.5-open; }
      else if(this.dir===DIRS.down){ a0=Math.PI/2+open; a1=Math.PI/2-open; }
      ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.moveTo(px,py); ctx.arc(px,py,r,a0,a1,false); ctx.closePath(); ctx.fill();
    }
  }

  class Ghost extends Entity{
    constructor(x,y,color,name){ super(x,y,5.1); this.color=color; this.name=name; }
    update(dt,maze,pm){
      const {cx,cy}=this.center();
      const near=Math.abs(this.x-cx)<0.2 && Math.abs(this.y-cy)<0.2;
      if(near){ this.x=cx; this.y=cy; }

      const hitWall = this.dir!==DIRS.none && blockedAhead(maze,cx,cy,this.dir);
      if(near || hitWall || this.dir===DIRS.none){
        // simple chase: pick legal dir that minimizes distance to Pac-Man, no instant reverse
        const dirs=[DIRS.up,DIRS.left,DIRS.down,DIRS.right].filter(d=>!blockedAhead(maze,cx,cy,d));
        const pool=dirs.filter(d=>!(d.x===-this.dir.x && d.y===-this.dir.y));
        const options=pool.length?pool:dirs;
        if(options.length){
          let best=options[0], bestD=Infinity;
          const tx=pm.x, ty=pm.y;
          for(const d of options){
            const nx=cx+d.x, ny=cy+d.y;
            const dd=d2(nx,ny,tx,ty);
            if(dd<bestD){ bestD=dd; best=d; }
          }
          this.dir=best;
        }else{
          this.dir=DIRS.none;
        }
      }

      if(this.dir!==DIRS.none && !blockedAhead(maze,this.center().cx,this.center().cy,this.dir)){
        this.x+=this.dir.x*this.speed*dt; this.y+=this.dir.y*this.speed*dt;
      }

      if(this.x<-0.5) this.x=maze.w-0.5;
      if(this.x>maze.w+0.5) this.x=-0.5;
    }
    draw(ctx,t,ox,oy){
      const px=ox+this.x*t, py=oy+this.y*t, h=t*0.9, r=h*0.5;
      ctx.fillStyle=this.color;
      ctx.beginPath(); ctx.arc(px,py-h*0.1,r,Math.PI,0); ctx.lineTo(px+r,py+r*0.8);
      for(let i=4;i>=0;i--){ const fx=px-r+(i/4)*(2*r), fy=py+r*0.8+(i%2===0?-r*0.15:0); ctx.lineTo(fx,fy); }
      ctx.closePath(); ctx.fill();
      const ex=(this.dir.x||0)*r*0.2, ey=(this.dir.y||0)*r*0.2;
      ctx.fillStyle="#fff";
      ctx.beginPath(); ctx.arc(px-r*0.35+ex,py-r*0.2+ey,r*0.25,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+r*0.35+ex,py-r*0.2+ey,r*0.25,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#001b2e";
      ctx.beginPath(); ctx.arc(px-r*0.35+ex,py-r*0.2+ey,r*0.12,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+r*0.35+ex,py-r*0.2+ey,r*0.12,0,Math.PI*2); ctx.fill();
    }
  }

  // ---------- game ----------
  class Game{
    constructor(){
      this.canvas=document.getElementById('game'); this.ctx=this.canvas.getContext('2d');
      this.input=new Input(); this.sound=new Sound(); this.maze=new Maze();
      this.pac=new Pacman(13.5,23);
      this.ghosts=[
        new Ghost(13.5,15.5,'#ff3b3b','blinky'),
        new Ghost(14.5,15.5,'#ffb24c','clyde'),
        new Ghost(13.5,14.5,'#ff9be1','pinky'),
        new Ghost(12.5,14.5,'#00e1ff','inky'),
      ];
      for(const g of this.ghosts){ g.dir = DIRS_ARR[(rnd()%4)]; }

      this.tile=16; this.last=0; this.acc=0; this.fixed=1/120;
      this.score=0; this.best=Number(localStorage.getItem('pm_best')||'0'); this.lives=3;
      this.paused=false; this.gameOver=false;
      this.bindUI(); this.resize(); addEventListener('resize',()=>this.resize());
      this.loop=this.loop.bind(this); requestAnimationFrame(this.loop);
    }

    bindUI(){
      const m=document.getElementById('mute-btn'), p=document.getElementById('pause-btn');
      if(m) m.addEventListener('click',()=>{ const v=!this.sound.muted; this.sound.setMuted(v); m.textContent=v?'🔇 Muted':'🔊 Sound'; });
      if(p) p.addEventListener('click',()=>this.toggle());
      addEventListener('keydown',e=>{
        if(e.key.toLowerCase()==='p') this.toggle();
        if(e.key.toLowerCase()==='m'&&m){ const v=!this.sound.muted; this.sound.setMuted(v); m.textContent=v?'🔇 Muted':'🔊 Sound'; }
      });
    }
    toggle(){ this.paused=!this.paused; const p=document.getElementById('pause-btn'); if(p) p.textContent=this.paused?'▶️ Resume':'⏸️ Pause'; }

    resize(){
      const dpr=Math.max(1,Math.min(3,devicePixelRatio||1));
      const w=innerWidth,h=innerHeight;
      this.canvas.style.width=w+'px'; this.canvas.style.height=h+'px';
      this.canvas.width=Math.floor(w*dpr); this.canvas.height=Math.floor(h*dpr);
      const pw=this.canvas.width/dpr, ph=this.canvas.height/dpr;
      this.tile=Math.floor(Math.min(pw/GRID_W,ph/GRID_H));
      this.ctx.setTransform(dpr,0,0,dpr,0,0);
    }

    loop(ts){
      if(!this.last) this.last=ts;
      const dt=Math.min(0.05,(ts-this.last)/1000); this.last=ts;
      if(!this.paused && !this.gameOver){
        this.acc+=dt; while(this.acc>=this.fixed){ this.update(this.fixed); this.acc-=this.fixed; }
      }
      this.draw(); requestAnimationFrame(this.loop);
    }

    update(dt){
      const before={x:Math.floor(this.pac.x),y:Math.floor(this.pac.y)};
      this.pac.update(dt,this.maze,this.input);
      const after={x:Math.floor(this.pac.x),y:Math.floor(this.pac.y)};
      if(before.x!==after.x||before.y!==after.y) this.sound.waka();

      const c=this.pac.center();
      if(Math.abs(this.pac.x-c.cx)<0.3 && Math.abs(this.pac.y-c.cy)<0.3){
        const r=this.maze.eatAt(Math.floor(c.cx),Math.floor(c.cy));
        if(r==='dot'){ this.score+=10; this.sound.dot(); }
        else if(r==='power'){ this.score+=50; this.sound.power(); }
      }

      for(const g of this.ghosts) g.update(dt,this.maze,this.pac);

      for(const g of this.ghosts){
        if(d2(g.x,g.y,this.pac.x,this.pac.y)<0.35){ this.loseLife(); break; }
      }

      if(this.maze.dotCount<=0){ this.maze=new Maze(); this.resetPositions(); }
      this.updateHUD();
    }

    resetPositions(){
      this.pac.x=13.5; this.pac.y=23; this.pac.dir=DIRS.left;
      const homes=[[13.5,15.5],[14.5,15.5],[13.5,14.5],[12.5,14.5]];
      this.ghosts.forEach((g,i)=>{ g.x=homes[i][0]; g.y=homes[i][1]; g.dir=DIRS_ARR[(rnd()%4)]; });
    }

    loseLife(){
      this.lives--; this.sound.death();
      if(this.lives<=0){
        this.gameOver=true;
        if(this.score>this.best){ this.best=this.score; localStorage.setItem('pm_best',String(this.best)); }
        setTimeout(()=>{ this.score=0; this.lives=3; this.gameOver=false; this.maze=new Maze(); this.resetPositions(); },1200);
      }else{ this.resetPositions(); }
    }

    updateHUD(){
      const s=document.getElementById('hud-score');
      const b=document.getElementById('hud-best');
      const l=document.getElementById('hud-lives');
      if(s) s.textContent=`Score: ${this.score}`;
      if(b) b.textContent=`Best: ${this.best=Math.max(this.best,this.score)}`;
      if(l){ l.innerHTML=''; for(let i=0;i<this.lives;i++){ const d=document.createElement('div'); d.className='life-dot'; l.appendChild(d); } }
    }

    draw(){
      const ctx=this.ctx, t=this.tile;
      const ox=Math.floor((innerWidth -t*GRID_W)/2);
      const oy=Math.floor((innerHeight-t*GRID_H)/2);
      ctx.clearRect(0,0,this.canvas.width,this.canvas.height);

      for(let y=0;y<this.maze.h;y++){
        for(let x=0;x<this.maze.w;x++){
          if(this.maze.grid[y][x]===TILE.WALL){
            ctx.fillStyle="#143b5b"; ctx.fillRect(ox+x*t,oy+y*t,t,t);
            ctx.strokeStyle="#7fffd4"; ctx.lineWidth=2; ctx.strokeRect(ox+x*t+1,oy+y*t+1,t-2,t-2);
          }
        }
      }
      for(let y=0;y<this.maze.h;y++){
        for(let x=0;x<this.maze.w;x++){
          const v=this.maze.grid[y][x];
          if(v===TILE.DOT){ ctx.fillStyle="#fff6b3"; ctx.beginPath(); ctx.arc(ox+(x+0.5)*t,oy+(y+0.5)*t,t*0.08,0,Math.PI*2); ctx.fill(); }
          else if(v===TILE.POWER){ ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.arc(ox+(x+0.5)*t,oy+(y+0.5)*t,t*0.18,0,Math.PI*2); ctx.fill(); }
        }
      }

      this.pac.draw(ctx,t,ox,oy);
      for(const g of this.ghosts) g.draw(ctx,t,ox,oy);

      if(this.paused||this.gameOver){
        ctx.save(); ctx.fillStyle="rgba(0,0,0,.35)"; ctx.fillRect(0,0,innerWidth,innerHeight);
        ctx.fillStyle="#7fffd4"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.font='20px "Press Start 2P"';
        ctx.fillText(this.paused?'PAUSED':'GAME OVER', innerWidth/2, innerHeight/2); ctx.restore();
      }
    }
  }

  addEventListener('DOMContentLoaded',()=>new Game());
})();
