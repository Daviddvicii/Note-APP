// Neon Tap Defense - Strategic survival game
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const waveEl = document.getElementById('wave');
const scoreEl = document.getElementById('score');
const hpEl = document.getElementById('hp');

// Resize canvas to fit window
function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Game state
let gameState = 'start'; // 'start', 'playing', 'paused', 'gameOver'
let wave = 1;
let score = 0;
let playerHp = 100;
let enemies = [];
let bullets = [];
let turrets = [];
let particles = [];
let enemiesInWave = 0;
let enemiesSpawned = 0;
let spawnTimer = 0;
let waveDelay = 0;

// Player (center of screen)
const player = {
  x: 0,
  y: 0,
  radius: 20,
  color: '#00ffff',
  shootCooldown: 0,
  shootDelay: 15 // frames between shots
};

// Colors
const colors = {
  cyan: '#00ffff',
  pink: '#ff00ff',
  yellow: '#ffff00',
  green: '#00ff00',
  red: '#ff0055',
  orange: '#ff8800',
  purple: '#aa00ff'
};

// Enemy types
const enemyTypes = {
  basic: { color: colors.pink, radius: 12, speed: 1, hp: 1, score: 10 },
  fast: { color: colors.yellow, radius: 10, speed: 2, hp: 1, score: 15 },
  tank: { color: colors.red, radius: 16, speed: 0.6, hp: 3, score: 25 },
  splitter: { color: colors.purple, radius: 14, speed: 1.2, hp: 2, score: 20 }
};

// Initialize game
function init() {
  player.x = canvas.width / 2;
  player.y = canvas.height / 2;
  
  // Place initial turrets in a circle around player
  const turretCount = 4;
  const radius = 120;
  for (let i = 0; i < turretCount; i++) {
    const angle = (Math.PI * 2 * i) / turretCount;
    turrets.push({
      x: player.x + Math.cos(angle) * radius,
      y: player.y + Math.sin(angle) * radius,
      radius: 15,
      color: colors.green,
      shootCooldown: 0,
      shootDelay: 30,
      range: 150
    });
  }
  
  startWave();
}

// Start a new wave
function startWave() {
  enemiesInWave = 5 + wave * 3;
  enemiesSpawned = 0;
  spawnTimer = 0;
  waveDelay = 0;
}

// Spawn enemy from random edge
function spawnEnemy() {
  const side = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
  let x, y, angle;
  
  const margin = 50;
  
  switch(side) {
    case 0: // top
      x = Math.random() * canvas.width;
      y = -margin;
      break;
    case 1: // right
      x = canvas.width + margin;
      y = Math.random() * canvas.height;
      break;
    case 2: // bottom
      x = Math.random() * canvas.width;
      y = canvas.height + margin;
      break;
    case 3: // left
      x = -margin;
      y = Math.random() * canvas.height;
      break;
  }
  
  // Choose enemy type based on wave
  let type = 'basic';
  const rand = Math.random();
  
  if (wave >= 3 && rand < 0.2) {
    type = 'tank';
  } else if (wave >= 2 && rand < 0.4) {
    type = 'fast';
  } else if (wave >= 4 && rand < 0.3) {
    type = 'splitter';
  }
  
  const template = enemyTypes[type];
  
  enemies.push({
    x, y,
    radius: template.radius,
    color: template.color,
    speed: template.speed,
    hp: template.hp,
    maxHp: template.hp,
    score: template.score,
    type
  });
  
  enemiesSpawned++;
}

// Shoot bullet from source toward target
function shoot(from, targetX, targetY, color = colors.cyan) {
  const angle = Math.atan2(targetY - from.y, targetX - from.x);
  const speed = 8;
  
  bullets.push({
    x: from.x,
    y: from.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: 4,
    color: color,
    damage: 1
  });
}

// Create particle effect
function createParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 2 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 2 + Math.random() * 2,
      color,
      life: 30,
      maxLife: 30
    });
  }
}

// Handle clicks/taps
function handleTap(event) {
  event.preventDefault();
  
  if (gameState === 'start' || gameState === 'gameOver') {
    // Start/restart game
    gameState = 'playing';
    overlay.classList.remove('visible');
    
    if (gameState === 'gameOver' || enemies.length === 0) {
      // Reset game
      wave = 1;
      score = 0;
      playerHp = 100;
      enemies = [];
      bullets = [];
      particles = [];
      turrets = [];
      init();
    }
    return;
  }
  
  if (gameState !== 'playing') return;
  
  // Get click position
  const rect = canvas.getBoundingClientRect();
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);
  
  // Shoot toward click position
  if (player.shootCooldown <= 0) {
    shoot(player, x, y);
    player.shootCooldown = player.shootDelay;
  }
}

canvas.addEventListener('click', handleTap);
canvas.addEventListener('touchstart', handleTap);

// Update game state
function update() {
  if (gameState !== 'playing') return;
  
  // Update player position (always center)
  player.x = canvas.width / 2;
  player.y = canvas.height / 2;
  
  // Update turret positions (orbit around player)
  turrets.forEach((turret, i) => {
    const angle = (Math.PI * 2 * i) / turrets.length + Date.now() * 0.0003;
    const radius = 120;
    turret.x = player.x + Math.cos(angle) * radius;
    turret.y = player.y + Math.sin(angle) * radius;
    
    // Turret auto-shoot at nearest enemy in range
    if (turret.shootCooldown <= 0) {
      let nearest = null;
      let nearestDist = turret.range;
      
      enemies.forEach(enemy => {
        const dist = Math.hypot(enemy.x - turret.x, enemy.y - turret.y);
        if (dist < nearestDist) {
          nearest = enemy;
          nearestDist = dist;
        }
      });
      
      if (nearest) {
        shoot(turret, nearest.x, nearest.y, colors.green);
        turret.shootCooldown = turret.shootDelay;
      }
    } else {
      turret.shootCooldown--;
    }
  });
  
  // Update player cooldown
  if (player.shootCooldown > 0) {
    player.shootCooldown--;
  }
  
  // Spawn enemies
  if (waveDelay > 0) {
    waveDelay--;
    if (waveDelay === 0) {
      wave++;
      startWave();
      
      // Add new turret every 3 waves
      if (wave % 3 === 0 && turrets.length < 8) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 120;
        turrets.push({
          x: player.x + Math.cos(angle) * radius,
          y: player.y + Math.sin(angle) * radius,
          radius: 15,
          color: colors.green,
          shootCooldown: 0,
          shootDelay: 30,
          range: 150
        });
      }
    }
  } else if (enemiesSpawned < enemiesInWave) {
    spawnTimer++;
    const spawnRate = Math.max(30 - wave * 2, 10);
    if (spawnTimer >= spawnRate) {
      spawnEnemy();
      spawnTimer = 0;
    }
  } else if (enemies.length === 0) {
    // Wave complete
    waveDelay = 120;
  }
  
  // Update enemies
  enemies.forEach(enemy => {
    // Move toward player
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy);
    
    if (dist > player.radius + enemy.radius) {
      enemy.x += (dx / dist) * enemy.speed;
      enemy.y += (dy / dist) * enemy.speed;
    } else {
      // Enemy reached player
      playerHp -= 5;
      createParticles(enemy.x, enemy.y, enemy.color);
      enemy.hp = 0;
      
      if (playerHp <= 0) {
        gameOver();
      }
    }
  });
  
  // Update bullets
  bullets.forEach(bullet => {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
  });
  
  // Update particles
  particles.forEach(particle => {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.life--;
  });
  
  // Collision detection: bullets vs enemies
  bullets.forEach(bullet => {
    enemies.forEach(enemy => {
      const dist = Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y);
      if (dist < bullet.radius + enemy.radius) {
        enemy.hp -= bullet.damage;
        bullet.radius = 0; // Mark for removal
        createParticles(bullet.x, bullet.y, enemy.color, 4);
      }
    });
  });
  
  // Remove dead enemies and create effects
  enemies = enemies.filter(enemy => {
    if (enemy.hp <= 0) {
      score += enemy.score;
      createParticles(enemy.x, enemy.y, enemy.color, 12);
      
      // Splitter enemies spawn 2 smaller enemies
      if (enemy.type === 'splitter' && enemy.hp <= 0) {
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          const offset = 20;
          enemies.push({
            x: enemy.x + Math.cos(angle) * offset,
            y: enemy.y + Math.sin(angle) * offset,
            radius: 8,
            color: colors.purple,
            speed: 1.5,
            hp: 1,
            maxHp: 1,
            score: 5,
            type: 'basic'
          });
        }
      }
      
      return false;
    }
    return true;
  });
  
  // Remove off-screen bullets
  bullets = bullets.filter(bullet => {
    return bullet.radius > 0 &&
           bullet.x > -50 && bullet.x < canvas.width + 50 &&
           bullet.y > -50 && bullet.y < canvas.height + 50;
  });
  
  // Remove dead particles
  particles = particles.filter(particle => particle.life > 0);
  
  // Update HUD
  waveEl.textContent = wave;
  scoreEl.textContent = score;
  hpEl.textContent = Math.max(0, playerHp);
  
  // Update HP color
  if (playerHp > 60) {
    hpEl.style.color = colors.green;
  } else if (playerHp > 30) {
    hpEl.style.color = colors.yellow;
  } else {
    hpEl.style.color = colors.red;
  }
}

// Render game
function render() {
  // Clear with fade effect
  ctx.fillStyle = 'rgba(10, 10, 10, 0.2)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw particles
  particles.forEach(particle => {
    const alpha = particle.life / particle.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  
  // Draw player (center)
  ctx.fillStyle = player.color;
  ctx.shadowBlur = 20;
  ctx.shadowColor = player.color;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw player shield rings
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.3;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + i * 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  
  // Draw turrets
  turrets.forEach(turret => {
    ctx.fillStyle = turret.color;
    ctx.shadowBlur = 15;
    ctx.shadowColor = turret.color;
    ctx.beginPath();
    ctx.arc(turret.x, turret.y, turret.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw range indicator (subtle)
    ctx.strokeStyle = turret.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(turret.x, turret.y, turret.range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    
    // Draw connection line to player
    ctx.strokeStyle = turret.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(turret.x, turret.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  
  // Draw enemies
  enemies.forEach(enemy => {
    ctx.fillStyle = enemy.color;
    ctx.shadowBlur = 15;
    ctx.shadowColor = enemy.color;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw HP bar for damaged enemies
    if (enemy.hp < enemy.maxHp) {
      const barWidth = enemy.radius * 2;
      const barHeight = 3;
      const hpPercent = enemy.hp / enemy.maxHp;
      
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(enemy.x - barWidth/2, enemy.y - enemy.radius - 8, barWidth, barHeight);
      
      ctx.fillStyle = colors.green;
      ctx.fillRect(enemy.x - barWidth/2, enemy.y - enemy.radius - 8, barWidth * hpPercent, barHeight);
    }
  });
  
  // Draw bullets
  bullets.forEach(bullet => {
    ctx.fillStyle = bullet.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = bullet.color;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // Reset shadow
  ctx.shadowBlur = 0;
  
  // Draw wave complete message
  if (waveDelay > 60) {
    ctx.fillStyle = colors.green;
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 20;
    ctx.shadowColor = colors.green;
    const alpha = Math.sin(Date.now() * 0.005) * 0.3 + 0.7;
    ctx.globalAlpha = alpha;
    ctx.fillText(`WAVE ${wave} COMPLETE!`, canvas.width / 2, canvas.height / 2);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

// Game over
function gameOver() {
  gameState = 'gameOver';
  overlay.innerHTML = `
    <div>GAME OVER</div>
    <div class="subtitle">Wave: ${wave} · Score: ${score}</div>
    <div class="subtitle">Tap to restart</div>
  `;
  overlay.classList.add('visible');
}

// Game loop
function gameLoop() {
  update();
  render();
  requestAnimationFrame(gameLoop);
}

// Start
init();
gameLoop();
