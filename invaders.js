'use strict';

/* Space Invaders – single-file build (non-module)
   Works with invaders.html (canvas #game + btn-left/right/mute)
*/

/* ===== Tuning ===== */
const diffSetting = localStorage.getItem('retro_difficulty') || 'normal';

let PLAYER_SPEED = 260;
let BULLET_SPEED = 520;
let ENEMY_SPEED  = 30;
let ENEMY_FIRE_RATE = 0.9;

if (diffSetting === 'easy') {
  PLAYER_SPEED = 300; // Faster player
  ENEMY_SPEED = 20;   // Slower enemies
  ENEMY_FIRE_RATE = 0.6; // Less frequent fire (higher number might be slower? No, usage is rate or interval?)
  // Checking usage: sampleEnemyInterval uses ENEMY_FIRE_RATE as 'r' in -Math.log(1-u)/r. 
  // If r is rate (events per sec), higher is faster.
  // Wait, let's check sampleEnemyInterval: return Math.max(0.08, -Math.log(1-u)/r);
  // If r is small, 1/r is large -> interval is large -> slower fire.
  // So ENEMY_FIRE_RATE should be LOWER for easy?
  // Original is 0.9.
  ENEMY_FIRE_RATE = 0.5; 
} else if (diffSetting === 'hard') {
  PLAYER_SPEED = 240;
  ENEMY_SPEED = 45;
  ENEMY_FIRE_RATE = 1.4;
}

const DESCENT_STEP = 8;
const SHOOT_COOLDOWN = 0.25;
const INVADER_COLS = 10, INVADER_ROWS = 5;
const INVADER_SIZE = 18, INVADER_H_SPACING = 16, INVADER_V_SPACING = 14;
const PLAYER_WIDTH = 32, PLAYER_HEIGHT = 16;
const BULLET_WIDTH = 2, BULLET_HEIGHT = 8;
const PLAYER_INVULN_TIME = 1.0;

/* ===== Utils ===== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const aabb = (ax, ay, aw, ah, bx, by, bw, bh) =>
  ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

/* ===== Sound (tiny WebAudio beeps) ===== */
class Sound {
  constructor(){ this.enabled = true; this.ctx = null; }
  ensure(){ if (!this.ctx) { try{ this.ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch{ this.enabled=false; } } }
  toggle(){ this.enabled = !this.enabled; return this.enabled; }
  resume(){ this.ensure(); if (this.ctx && this.ctx.state==='suspended') this.ctx.resume(); }
  _beep(freqFrom, freqTo, dur, type='square', gain=0.08){
    if(!this.enabled) return; this.ensure(); if(!this.ctx) return;
    const t = this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freqFrom, t);
    if (freqTo!==null) o.frequency.exponentialRampToValueAtTime(freqTo, t+dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g).connect(this.ctx.destination); o.start(); o.stop(t+dur+0.01);
  }
  shoot(){ this._beep(880, null, 0.09, 'square', 0.08); }
  pop(){ this._beep(440, 110, 0.16, 'triangle', 0.10); }
}

/* ===== Bullets ===== */
class Bullet { constructor(){ this.active=false; this.x=0; this.y=0; this.vy=0; this.width=BULLET_WIDTH; this.height=BULLET_HEIGHT; this.fromEnemy=false; } }
class BulletPool {
  constructor(n){ this.pool=Array.from({length:n},()=>new Bullet()); this.active=[]; }
  spawn(x,y,vy,fromEnemy){
    const b=this.pool.find(b=>!b.active); if(!b) return null;
    b.active=true; b.x=x; b.y=y; b.vy=vy; b.fromEnemy=!!fromEnemy; this.active.push(b); return b;
  }
  update(dt,h){
    let w=0;
    for(let i=0;i<this.active.length;i++){ const b=this.active[i]; b.y+=b.vy*dt;
      if(b.y+b.height<0 || b.y>h) b.active=false; else this.active[w++]=b;
    }
    this.active.length=w;
  }
  draw(ctx){ ctx.fillStyle='#fff'; for(const b of this.active) ctx.fillRect(b.x,b.y,b.width,b.height); }
}

/* ===== Player ===== */
class Player {
  constructor(game){ this.game=game; this.width=PLAYER_WIDTH; this.height=PLAYER_HEIGHT;
    this.x=0; this.y=0; this.moveLeft=false; this.moveRight=false; this.cooldown=0; this.invuln=0; }
  reset(){ this.x=(this.game.width-this.width)/2; this.y=this.game.height-this.height-18; this.cooldown=0; this.invuln=0; }
  update(dt){
    let dx=(this.moveRight?1:0)-(this.moveLeft?1:0);
    this.x=clamp(this.x+dx*PLAYER_SPEED*dt, 0, this.game.width-this.width);
    if(this.cooldown>0) this.cooldown-=dt; if(this.invuln>0) this.invuln-=dt;
  }
  tryShoot(){
    if(this.cooldown>0) return;
    const bx=this.x+this.width/2-BULLET_WIDTH/2, by=this.y-BULLET_HEIGHT;
    if(this.game.playerBullets.spawn(bx,by,-BULLET_SPEED,false)) {
      this.cooldown=SHOOT_COOLDOWN; this.game.sound.shoot();
    }
  }
  hit(){ if(this.invuln>0) return false; this.invuln=PLAYER_INVULN_TIME; return true; }
  draw(ctx){ if(this.invuln>0 && Math.floor(this.invuln*10)%2===0) return;
    ctx.fillStyle='#41c7ff'; ctx.fillRect(this.x,this.y,this.width,this.height);
    ctx.fillRect(this.x+this.width/2-2,this.y-4,4,4);
  }
}

/* ===== Invader Grid ===== */
class InvaderGrid {
  constructor(game){
    this.game=game; this.cols=INVADER_COLS; this.rows=INVADER_ROWS; this.size=INVADER_SIZE;
    this.h=INVADER_H_SPACING; this.v=INVADER_V_SPACING; this.alive=Array(this.cols*this.rows).fill(true);
    this.total=this.alive.length; this.remaining=this.total; this.dir=1; this.x=40; this.y=50;
    this.base=ENEMY_SPEED; this.descendPending=false;
  }
  idx(c,r){ return r*this.cols+c; }
  isAlive(c,r){ return this.alive[this.idx(c,r)]; }
  kill(c,r){ const i=this.idx(c,r); if(this.alive[i]){ this.alive[i]=false; this.remaining--; return true; } return false; }
  forEachAlive(cb){ for(let r=0;r<this.rows;r++) for(let c=0;c<this.cols;c++) if(this.isAlive(c,r)) cb(c,r); }
  bounds(){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity, s=this.size;
    this.forEachAlive((c,r)=>{ const x=this.x+c*(s+this.h), y=this.y+r*(s+this.v);
      minX=Math.min(minX,x); maxX=Math.max(maxX,x+s); minY=Math.min(minY,y); maxY=Math.max(maxY,y+s); });
    if(minX===Infinity) return {minX:0,maxX:0,minY:0,maxY:0};
    return {minX,maxX,minY,maxY};
  }
  update(dt){
    if(this.remaining===0) return;
    const speed=this.base*(1+(1-this.remaining/this.total)*1.8);
    const b=this.bounds();
    this.x+=this.dir*speed*dt;
    if(b.minX<=0 && this.dir<0) this.descendPending=true;
    if(b.maxX>=this.game.width && this.dir>0) this.descendPending=true;
    if(this.descendPending){ this.descendPending=false; this.dir*=-1; this.y+=DESCENT_STEP; }
  }
  draw(ctx){
    if(this.remaining===0) return;
    const s=this.size; ctx.fillStyle='#39ff14';
    this.forEachAlive((c,r)=>{ const x=this.x+c*(s+this.h), y=this.y+r*(s+this.v);
      ctx.fillRect(x,y,s,s); ctx.fillStyle='#000'; ctx.fillRect(x+4,y+6,3,3); ctx.fillRect(x+s-7,y+6,3,3); ctx.fillStyle='#39ff14';
    });
  }
  pickShooter(){
    const cols=[]; for(let c=0;c<this.cols;c++){ let bottom=-1;
      for(let r=0;r<this.rows;r++) if(this.isAlive(c,r)) bottom=r;
      if(bottom>=0) cols.push({c,bottom}); }
    if(cols.length===0) return null;
    const p=cols[Math.floor(Math.random()*cols.length)], s=this.size;
    return { x:this.x+p.c*(s+this.h)+s/2-BULLET_WIDTH/2, y:this.y+p.bottom*(s+this.v)+s };
  }
}

/* ===== Game ===== */
const GameState = { READY:'READY', RUNNING:'RUNNING', GAME_OVER:'GAME_OVER', YOU_WIN:'YOU_WIN' };

class Game {
  constructor(canvas){
    this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.width=0; this.height=0; this.dpr=1;
    this.sound=new Sound();
    this.player=new Player(this);
    this.grid=new InvaderGrid(this);
    this.playerBullets=new BulletPool(24);
    this.enemyBullets=new BulletPool(24);
    this.lives=3; this.score=0; this.best=Number(localStorage.getItem('invaders_best_score')||'0')||0;
    this.state=GameState.READY; this.timeToEnemyFire=0;
    this.lastTime=0; this.accum=0; this.fixedDt=1/60;
    this.installEvents(); this.onResize(); this.resetRound(); requestAnimationFrame(t=>this.frame(t));
  }

  installEvents(){
    window.addEventListener('resize', ()=>this.onResize());
    // prevent pull-to-refresh
    this.canvas.addEventListener('touchstart', e=>{ e.preventDefault(); this.onAction(); }, {passive:false});
    this.canvas.addEventListener('touchmove',  e=>e.preventDefault(), {passive:false});
    this.canvas.addEventListener('touchend',   e=>e.preventDefault(), {passive:false});

    window.addEventListener('keydown', e=>{
      if (['ArrowLeft','ArrowRight',' ','Space','a','A','d','D','m','M'].includes(e.key)) e.preventDefault();
      if (e.key==='m'||e.key==='M'){ updateMuteButton(this.sound.toggle()); return; }
      if (e.key===' '||e.code==='Space'){ this.onAction(); return; }
      if (e.key==='ArrowLeft'||e.key==='a'||e.key==='A')  this.player.moveLeft=true;
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') this.player.moveRight=true;
    }, {passive:false});
    window.addEventListener('keyup', e=>{
      if (e.key==='ArrowLeft'||e.key==='a'||e.key==='A')  this.player.moveLeft=false;
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') this.player.moveRight=false;
    });

    const L=document.getElementById('btn-left'), R=document.getElementById('btn-right'), M=document.getElementById('btn-mute');
    const pl=e=>{ e.preventDefault(); this.sound.resume(); this.player.moveLeft=true;  };
    const rl=e=>{ e.preventDefault(); this.player.moveLeft=false; };
    const pr=e=>{ e.preventDefault(); this.sound.resume(); this.player.moveRight=true; };
    const rr=e=>{ e.preventDefault(); this.player.moveRight=false; };
    if(L){ L.addEventListener('touchstart',pl,{passive:false}); L.addEventListener('touchend',rl,{passive:false});
           L.addEventListener('touchcancel',rl,{passive:false}); L.addEventListener('mousedown',pl);
           L.addEventListener('mouseup',rl); L.addEventListener('mouseleave',rl); }
    if(R){ R.addEventListener('touchstart',pr,{passive:false}); R.addEventListener('touchend',rr,{passive:false});
           R.addEventListener('touchcancel',rr,{passive:false}); R.addEventListener('mousedown',pr);
           R.addEventListener('mouseup',rr); R.addEventListener('mouseleave',rr); }
    if(M){ M.addEventListener('click', ()=>updateMuteButton(this.sound.toggle())); }
  }

  onAction(){
    this.sound.resume();
    if (this.state===GameState.READY){ this.state=GameState.RUNNING; return; }
    if (this.state===GameState.GAME_OVER || this.state===GameState.YOU_WIN){ this.resetRound(); this.state=GameState.RUNNING; return; }
    if (this.state===GameState.RUNNING){ this.player.tryShoot(); return; }
  }

  onResize(){
    const dpr=Math.max(1, Math.floor(window.devicePixelRatio||1));
    this.dpr=dpr; const w=window.innerWidth, h=window.innerHeight;
    this.canvas.style.width=w+'px'; this.canvas.style.height=h+'px';
    this.canvas.width=Math.floor(w*dpr); this.canvas.height=Math.floor(h*dpr);
    const ctx=this.ctx; ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr); ctx.imageSmoothingEnabled=false;
    this.width=w; this.height=h; this.player.y=this.height-this.player.height-18;
  }

  resetRound(){
    this.lives=3; this.score=0; this.player.reset();
    this.grid=new InvaderGrid(this);
    this.playerBullets.active.length=0; this.enemyBullets.active.length=0;
    for (const b of this.playerBullets.pool) b.active=false;
    for (const b of this.enemyBullets.pool) b.active=false;
    this.timeToEnemyFire=this.sampleEnemyInterval();
  }

  frame(ms){ requestAnimationFrame(t=>this.frame(t));
    const now=ms*0.001; if(!this.lastTime) this.lastTime=now; let dt=Math.min(now-this.lastTime,0.1);
    this.lastTime=now; this.accum=Math.min(this.accum+dt,0.25);
    while(this.accum>=this.fixedDt){ this.update(this.fixedDt); this.accum-=this.fixedDt; }
    this.render();
  }

  update(dt){
    if(this.state!==GameState.RUNNING) return;
    this.player.update(dt); this.grid.update(dt);
    this.timeToEnemyFire-=dt;
    if(this.timeToEnemyFire<=0){ do{ this.enemyShoot(); this.timeToEnemyFire+=this.sampleEnemyInterval(); } while(this.timeToEnemyFire<=0); }
    this.playerBullets.update(dt,this.height); this.enemyBullets.update(dt,this.height);
    this.handlePlayerHits(); this.handleEnemyHits();
    const b=this.grid.bounds(); if (b.maxY>=this.player.y) return this.gameOver();
    if (this.grid.remaining===0) this.win();
  }

  enemyShoot(){ if(this.grid.remaining===0) return;
    const s=this.grid.pickShooter(); if(!s) return; this.enemyBullets.spawn(s.x,s.y,BULLET_SPEED*0.7,true); }

  sampleEnemyInterval(){ const r=Math.max(ENEMY_FIRE_RATE,0.0001), u=Math.random(); return Math.max(0.08, -Math.log(1-u)/r); }

  handlePlayerHits(){
    if(this.playerBullets.active.length===0 || this.grid.remaining===0) return;
    const s=this.grid.size, hs=this.grid.h, vs=this.grid.v, gx=this.grid.x, gy=this.grid.y;
    const bounds=this.grid.bounds();
    for (const b of this.playerBullets.active){
      if (b.x+b.width<bounds.minX || b.x>bounds.maxX || b.y+b.height<bounds.minY || b.y>bounds.maxY) continue;
      for(let r=0;r<this.grid.rows;r++)for(let c=0;c<this.grid.cols;c++){
        if(!this.grid.isAlive(c,r)) continue;
        const ix=gx+c*(s+hs), iy=gy+r*(s+vs);
        if(aabb(b.x,b.y,b.width,b.height, ix,iy,s,s)){
          this.grid.kill(c,r); b.active=false; this.sound.pop(); this.score+=10;
          if(this.score>this.best){ this.best=this.score; localStorage.setItem('invaders_best_score', String(this.best)); }
          return;
        }
      }
    }
    // compact bullets
    this.playerBullets.active = this.playerBullets.active.filter(bb=>bb.active);
  }

  handleEnemyHits(){
    const p=this.player; let hit=false;
    for (const b of this.enemyBullets.active){
      if(aabb(b.x,b.y,b.width,b.height, p.x,p.y,p.width,p.height)){ b.active=false; if(p.hit()) hit=true; }
    }
    this.enemyBullets.active = this.enemyBullets.active.filter(bb=>bb.active);
    if(hit){ this.lives--; if(this.lives<=0) this.gameOver(); }
  }

  render(){
    const ctx=this.ctx; ctx.clearRect(0,0,this.width,this.height);
    // subtle scanlines
    ctx.fillStyle='#020202'; for(let y=0;y<this.height;y+=4) ctx.fillRect(0,y,this.width,1);
    this.grid.draw(ctx); this.player.draw(ctx); this.playerBullets.draw(ctx); this.enemyBullets.draw(ctx);
    // HUD
    ctx.fillStyle='#32ff7e'; ctx.font='16px monospace'; ctx.textBaseline='top';
    ctx.fillText(`Score: ${this.score}`, 12, 10);
    const lt=`Lives: ${this.lives}`; const w=ctx.measureText(lt).width; ctx.fillText(lt, this.width-w-12, 10);
    ctx.fillStyle='#888'; ctx.font='12px monospace'; ctx.fillText(`Best: ${this.best}`, 12, 28);
    if(this.state!==GameState.RUNNING){
      const text = this.state===GameState.READY ? 'Tap / Space to start'
                  : this.state===GameState.GAME_OVER ? `Game Over\nScore: ${this.score}\nTap / Space to restart`
                  : `You Win!\nScore: ${this.score}\nTap / Space to restart`;
      this.centerText(text);
      if(this.state===GameState.READY) this.bottomHint();
    }
  }
  centerText(t){ const ctx=this.ctx; ctx.save(); ctx.fillStyle='#fff'; ctx.font='bold 22px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    const lines=t.split('\n'), cx=this.width/2, cy=this.height/2;
    lines.forEach((L,i)=>ctx.fillText(L, cx, cy + i*28 - ((lines.length-1)*14))); ctx.restore(); }
  bottomHint(){ const ctx=this.ctx; ctx.save(); ctx.fillStyle='#999'; ctx.font='12px monospace';
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillText('Desktop: ← → move, Space shoot, M mute | Mobile: buttons + tap', this.width/2, this.height-8); ctx.restore(); }
  gameOver(){ this.state=GameState.GAME_OVER; }
  win(){ this.state=GameState.YOU_WIN; }
}

/* ===== Boot ===== */
function updateMuteButton(enabled){ const b=document.getElementById('btn-mute'); if(b) b.textContent = enabled ? '🔊' : '🔇'; }

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  new Game(canvas);
  updateMuteButton(true);
});
