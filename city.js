(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const scoreEl = document.getElementById("score");
  const speedEl = document.getElementById("speed");

  // Resize canvas to match device width (portrait)
  function resize() {
    const maxW = Math.min(window.innerWidth * 0.95, 420);
    const h = maxW * (16 / 9); // tall vertical
    canvas.width = maxW;
    canvas.height = h;
  }
  resize();
  window.addEventListener("resize", resize);

  // Game state
  let running = false;
  let speed = 0;
  let score = 0;

  const car = {
    x: 160,
    y: 500,
    w: 40,
    h: 60,
  };

  const lanes = [80, 160, 240];
  let laneIndex = 1;

  const traffic = [];

  function spawnCar() {
    traffic.push({
      x: lanes[Math.floor(Math.random() * 3)],
      y: -80,
      w: 40,
      h: 60,
    });
  }

  setInterval(() => {
    if (running) spawnCar();
  }, 1200);

  // Draw loop
  function draw() {
    ctx.fillStyle = "#001403";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Road lines
    ctx.strokeStyle = "rgba(0,255,102,0.3)";
    ctx.setLineDash([20, 20]);
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.moveTo(canvas.width / 3, 0);
    ctx.lineTo(canvas.width / 3, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo((canvas.width / 3) * 2, 0);
    ctx.lineTo((canvas.width / 3) * 2, canvas.height);
    ctx.stroke();

    // Player car
    ctx.fillStyle = "#00ffaa";
    ctx.fillRect(car.x - car.w / 2, car.y - car.h / 2, car.w, car.h);

    // Traffic
    ctx.fillStyle = "#ff0055";
    for (let t of traffic) {
      ctx.fillRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h);
    }
  }

  // Update loop
  function update(dt) {
    if (!running) return;

    speed += dt * 18;
    if (speed > 180) speed = 180;

    // Move traffic
    for (let t of traffic) {
      t.y += dt * speed * 1.6;

      // Collision
      if (
        Math.abs(t.x - car.x) < 40 &&
        Math.abs(t.y - car.y) < 60
      ) {
        running = false;
        overlay.classList.remove("hidden");
        overlay.querySelector("#overlay-title").textContent = "Crashed!";
      }
    }

    // Remove old cars
    for (let i = traffic.length - 1; i >= 0; i--) {
      if (traffic[i].y > canvas.height + 100) {
        traffic.splice(i, 1);
        score += 10;
      }
    }

    scoreEl.textContent = score;
    speedEl.textContent = Math.floor(speed);
  }

  let last = performance.now();
  function loop(now) {
    const dt = (now - last) / 1000;
    last = now;

    update(dt);
    draw();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Start game
  function startGame() {
    running = true;
    overlay.classList.add("hidden");
    speed = 60;
    score = 0;
    traffic.length = 0;
  }

  overlay.addEventListener("click", startGame);

  // Keyboard controls
  document.addEventListener("keydown", (e) => {
    if (!running) startGame();

    if (e.key === "ArrowLeft" || e.key === "a") {
      laneIndex = Math.max(0, laneIndex - 1);
      car.x = lanes[laneIndex];
    }

    if (e.key === "ArrowRight" || e.key === "d") {
      laneIndex = Math.min(2, laneIndex + 1);
      car.x = lanes[laneIndex];
    }

    if (e.key === "ArrowUp" || e.key === "w") {
      speed += 4;
    }
  });

  // Touch controls
  document.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!running) startGame();
      const act = btn.dataset.act;

      if (act === "left") {
        laneIndex = Math.max(0, laneIndex - 1);
        car.x = lanes[laneIndex];
      }
      if (act === "right") {
        laneIndex = Math.min(2, laneIndex + 1);
        car.x = lanes[laneIndex];
      }
      if (act === "up") {
        speed += 6;
      }
    });
  });

})();
