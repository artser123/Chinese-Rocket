"use strict";
/* ================= Meteors ================= */
function spawnMeteor() {
  if (meteors.length >= maxOnScreen()) return;
  const w = pick(pool);
  ctx.font = `700 16px sans-serif`;
  const tw = Math.max(ctx.measureText(w[1]).width, 28);
  const r = Math.max(26, tw / 2 + 12);
  meteors.push({
    word: w,
    x: rand(r + 6, W - r - 6),
    y: -r - 20,
    r: r,
    verts: Array.from({ length: 9 }, () => rand(0.72, 1.15)),
    speed: fallSpeed() * rand(0.85, 1.2),
    wobble: rand(0, 6.28),
    rot: rand(0, 6.28),
  });
}

function hitGround(m, idx) {
  meteors.splice(idx, 1);
  combo = 0;
  lives--;
  music.setIntensity(1 - lives / 3); // เลือดน้อยลง = ดนตรีเข้มข้นขึ้น
  shakeT = 0.45;
  sfx.damage();
  explosion(m.x, groundY() - 6, "#ff5030", 30);
  updateHUD();
  ensurePlayable();
  if (lives <= 0) endGame();
}

/* ================= Options (rocket buttons) ================= */
function refreshOptions() {
  // candidates: words of meteors currently on screen (prefer lowest)
  const onScreen = [...meteors].sort((a, b) => b.y - a.y)
    .map((m) => m.word);
  const chosen = [], usedPinyin = new Set();
  for (const w of onScreen) {
    if (chosen.length >= 4) break;
    if (!usedPinyin.has(w[1])) { chosen.push(w); usedPinyin.add(w[1]); }
  }
  // distractors that do NOT match any active meteor
  const activePinyin = new Set(meteors.map((m) => m.word[1]));
  while (chosen.length < 4) {
    const w = pick(pool);
    if (!activePinyin.has(w[1]) && !usedPinyin.has(w[1])) {
      chosen.push(w); usedPinyin.add(w[1]);
    }
  }
  options = shuffle(chosen);
}

function ensurePlayable() {
  // if no button matches any meteor anymore, regenerate
  const activePinyin = new Set(meteors.map((m) => m.word[1]));
  if (!options.some((w) => activePinyin.has(w[1]))) {
    refreshOptions();
    renderOptions();
  }
}

function renderOptions() {
  optBtns.forEach((btn, i) => {
    const w = options[i];
    btn.textContent = w ? w[0] : "";
    btn.classList.remove("flash-wrong", "flash-right");
  });
}

function fireOption(i) {
  if (!running || paused) return;
  const now = performance.now();
  if (now < stunUntil) return;
  const w = options[i];
  if (!w) return;

  // find lowest meteor with matching pinyin
  let target = -1, ty = -Infinity;
  meteors.forEach((m, idx) => {
    if (m.word[1] === w[1] && m.y > ty) { ty = m.y; target = idx; }
  });

  if (target >= 0) {
    const m = meteors[target];
    meteors.splice(target, 1);
    combo++;
    const heightBonus = Math.round(Math.max(0, (groundY() - m.y) / groundY()) * 10);
    const pts = 10 + heightBonus + Math.min(combo - 1, 5) * 2;
    score += pts;
    sfx.shoot();
    setTimeout(() => sfx.boom(), 160);
    // จุดควบคุมสุ่ม → เส้นทางโค้ง Bézier (ไม่ใช่แนวตรง) แต่ยังพุ่งเข้าเป้าหมายเดิม
    const x1 = baseX(), y1 = baseY() - 40;
    const dx = m.x - x1, dy = m.y - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const off = Math.min(rand(0.3, 0.65) * dist, 220) * (Math.random() < 0.5 ? -1 : 1);
    missiles.push({
      x1, y1, x2: m.x, y2: m.y,
      cx: (x1 + m.x) / 2 + (-dy / dist) * off,
      cy: (y1 + m.y) / 2 + (dx / dist) * off - rand(10, 60),
      t: 0, trail: [], color: "#ffaa33",
    });
    explosion(baseX(), baseY() - 46, "#9fd0ff", 6);   // muzzle flash
    floaters.push({ x: m.x, y: m.y, text: "+" + pts, age: 0, life: 0.9, color: "#ffd76a" });
    showToast(`<span class="toast-zh">${w[0]}</span> <span class="toast-py">${w[1]}</span> = <span class="toast-th">${w[2]}</span>`);
    speakWordHit(w);
    optBtns[i].classList.add("flash-right");
    setTimeout(() => optBtns[i].classList.remove("flash-right"), 250);
    destroyed++;
    metDone.add(m.word[0]);
    updateHUD();
    refreshOptions();
    renderOptions();
  } else {
    combo = 0;
    score = Math.max(0, score - 5);
    stunUntil = now + 450;
    sfx.wrong();
    optBtns[i].classList.add("flash-wrong");
    setTimeout(() => optBtns[i].classList.remove("flash-wrong"), 400);
    const wf = $("wrongFlash");
    wf.classList.remove("hide"); wf.classList.add("show");
    setTimeout(() => { wf.classList.remove("show"); wf.classList.add("hide"); }, 80);
    updateHUD();
  }
}

optBtns.forEach((btn, i) => {
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireOption(i); });
});

/* ================= Effects ================= */
function explosion(x, y, color, n) {
  rings.push({ x, y, r: 10, max: rand(70, 100), age: 0, life: 0.4, color });
  particles.push({ x, y, vx: 0, vy: 0, life: 0.12, age: 0, color: "#ffffff", r: 16 });
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28), sp = rand(40, 240);
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.4, 0.9), age: 0, color, r: rand(1.5, 4),
    });
  }
}

function confettiBurst(container, n = 28) {
  const colors = ["#ffd23c", "#58ff88", "#6a7af0", "#ff6a9d", "#8fd3ff"];
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "confetti";
    const dx = rand(-190, 190);
    p.style.setProperty("--mx", dx * 0.55 + "px");
    p.style.setProperty("--my", rand(-240, -110) + "px");
    p.style.setProperty("--dx", dx + "px");
    p.style.setProperty("--fy", rand(140, 300) + "px");
    p.style.setProperty("--rot", rand(-700, 700) + "deg");
    p.style.setProperty("--dur", rand(0.75, 1.25) + "s");
    p.style.background = pick(colors);
    container.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
}

function showToast(html, id = "toast", duration = 1800) {
  const t = $(id);
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), duration);
}

function updateHUD() {
  $("score").textContent = score;
  $("lives").textContent = "❤️".repeat(Math.max(0, lives)) + "🖤".repeat(Math.max(0, 3 - lives));
  $("metProg").textContent = progPct(metDone.size, pool.length);
}

/* ================= Draw ================= */
function drawBackground(dt) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#05081e");
  g.addColorStop(1, "#141b45");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  for (const s of stars) {
    s.tw += dt * 2;
    s.y += (s.spd * dt) / Math.max(H, 1);
    if (s.y > 1.02) { s.y = -0.02; s.x = Math.random(); }
    ctx.globalAlpha = 0.4 + 0.35 * Math.sin(s.tw);
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, s.r, 0, 6.28);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBase() {
  const x = baseX(), y = baseY();
  // ground
  ctx.fillStyle = "#1c2450";
  ctx.fillRect(0, groundY(), W, H - groundY());
  ctx.fillStyle = "#2a346b";
  ctx.fillRect(0, groundY(), W, 4);
  // launch pad
  ctx.fillStyle = "#39478f";
  ctx.beginPath();
  ctx.moveTo(x - 34, groundY()); ctx.lineTo(x + 34, groundY());
  ctx.lineTo(x + 20, y - 14); ctx.lineTo(x - 20, y - 14);
  ctx.closePath(); ctx.fill();
  // engine flame flicker — โหมดแสงบวก ให้เปลวไฟ "สว่างจริง" และทับกันแล้วสว่างขึ้น
  const fl = 8 + Math.random() * 10;
  glowOn(ctx);
  const fg = ctx.createLinearGradient(0, y - 14, 0, y + fl);
  fg.addColorStop(0, "rgba(255,235,150,.95)");
  fg.addColorStop(0.5, "rgba(255,140,40,.7)");
  fg.addColorStop(1, "rgba(255,60,10,0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 14); ctx.lineTo(x, y + fl); ctx.lineTo(x + 5, y - 14);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,220,140,.5)";
  ctx.beginPath(); ctx.arc(x, y + fl * 0.35, fl * 0.7, 0, 6.28); ctx.fill();
  glowOff(ctx);

  // fins
  ctx.fillStyle = "#d84343";
  ctx.beginPath(); ctx.moveTo(x - 9, y - 32); ctx.lineTo(x - 17, y - 16); ctx.lineTo(x - 9, y - 16); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 9, y - 32); ctx.lineTo(x + 17, y - 16); ctx.lineTo(x + 9, y - 16); ctx.closePath(); ctx.fill();

  // body
  const bg = ctx.createLinearGradient(x - 9, 0, x + 9, 0);
  bg.addColorStop(0, "#eef2ff"); bg.addColorStop(1, "#b9c4e0");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x, y - 66);
  ctx.quadraticCurveTo(x + 10, y - 52, x + 9, y - 30);
  ctx.lineTo(x + 9, y - 16); ctx.lineTo(x - 9, y - 16);
  ctx.lineTo(x - 9, y - 30);
  ctx.quadraticCurveTo(x - 10, y - 52, x, y - 66);
  ctx.fill();

  // nose cone
  ctx.fillStyle = "#e04b3a";
  ctx.beginPath();
  ctx.moveTo(x, y - 66);
  ctx.quadraticCurveTo(x + 9, y - 55, x + 9, y - 46);
  ctx.lineTo(x - 9, y - 46);
  ctx.quadraticCurveTo(x - 9, y - 55, x, y - 66);
  ctx.fill();

  // window
  ctx.fillStyle = "#1a2246";
  ctx.beginPath(); ctx.arc(x, y - 36, 6, 0, 6.28); ctx.fill();
  ctx.fillStyle = "#8fd3ff";
  ctx.beginPath(); ctx.arc(x, y - 36, 4, 0, 6.28); ctx.fill();

  // stunned?
  if (performance.now() < stunUntil) {
    ctx.fillStyle = "rgba(255,60,60,.9)";
    ctx.font = "700 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚠", x, y - 78);
  }
}

function drawMeteor(m) {
  // flame trail — แสงบวก ทำให้นุ่งลุกซ้อนทับกันแล้วสว่างขึ้น
  glowOn(ctx);
  const trail = ctx.createLinearGradient(m.x, m.y - m.r * 2.6, m.x, m.y);
  trail.addColorStop(0, "rgba(255,120,30,0)");
  trail.addColorStop(1, "rgba(255,160,40,.75)");
  ctx.fillStyle = trail;
  ctx.beginPath();
  ctx.moveTo(m.x - m.r * 0.7, m.y);
  ctx.quadraticCurveTo(m.x, m.y - m.r * 3, m.x + m.r * 0.7, m.y);
  ctx.closePath(); ctx.fill();
  // เงาแสงร้อนจางๆ รอบลูกหิน ให้ดูมีบรรยากาศร้อน
  const halo = ctx.createRadialGradient(m.x, m.y, m.r * 0.3, m.x, m.y, m.r * 2.1);
  halo.addColorStop(0, "rgba(255,150,50,.35)");
  halo.addColorStop(1, "rgba(255,90,20,0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 2.1, 0, 6.28); ctx.fill();
  glowOff(ctx);

  // rock — เงาหลักด้านล่างทำให้ก้อนหินหลุดจากพื้นหลัง (ตัดกับแสงด้านบน)
  const rock = ctx.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.2, m.x, m.y, m.r);
  rock.addColorStop(0, "#8a5a3a");
  rock.addColorStop(1, "#4a2c1c");
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = m.r * 0.7;
  ctx.shadowOffsetY = m.r * 0.18;
  ctx.fillStyle = rock;
  ctx.beginPath();
  const n = m.verts.length;
  for (let i = 0; i < n; i++) {
    const a = m.rot + (i / n) * 6.28;
    const rr = m.r * m.verts[i];
    const px = m.x + Math.cos(a) * rr, py = m.y + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // craters
  ctx.fillStyle = "rgba(0,0,0,.25)";
  for (let i = 0; i < 3; i++) {
    const a = m.rot + i * 2.1;
    ctx.beginPath();
    ctx.arc(m.x + Math.cos(a) * m.r * 0.5, m.y + Math.sin(a) * m.r * 0.5, m.r * 0.16, 0, 6.28);
    ctx.fill();
  }
  ctx.restore(); // ปิดเงาของก้อนหิน ก่อนวาดตัวอักษร
  // pinyin label — ตัวอักษรมีเงามืด+เส้นขอบดำ อ่านชัดบนพื้นหลังที่วุ่นวาย
  ctx.font = `700 ${Math.max(15, m.r * 0.52)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  textShadowOn(ctx, 5);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  ctx.strokeText(m.word[1], m.x, m.y);
  ctx.fillStyle = "#ffe9b0";
  ctx.fillText(m.word[1], m.x, m.y);
  textShadowOff(ctx);
}

function drawMissileBody() {
  // engine flame — แสงบวก
  const fl = 6 + Math.random() * 5;
  glowOn(ctx);
  const fg = ctx.createLinearGradient(0, 6, 0, 6 + fl + 4);
  fg.addColorStop(0, "rgba(255,220,120,.95)");
  fg.addColorStop(1, "rgba(255,90,20,0)");
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.moveTo(-2.5, 6); ctx.lineTo(0, 6 + fl); ctx.lineTo(2.5, 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,210,140,.45)";
  ctx.beginPath(); ctx.arc(0, 6 + fl * 0.3, fl * 0.55, 0, 6.28); ctx.fill();
  glowOff(ctx);
  // body
  ctx.fillStyle = "#e8ecf5";
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.quadraticCurveTo(4, -4, 3, 6); ctx.lineTo(-3, 6);
  ctx.quadraticCurveTo(-4, -4, 0, -9);
  ctx.fill();
  // nose
  ctx.fillStyle = "#ff5040";
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.quadraticCurveTo(3.2, -5, 3.1, -2); ctx.lineTo(-3.1, -2);
  ctx.quadraticCurveTo(-3.2, -5, 0, -9);
  ctx.fill();
  // fins
  ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(-6, 7); ctx.lineTo(-3, 6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(6, 7); ctx.lineTo(3, 6); ctx.closePath(); ctx.fill();
}

function drawMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const ms = missiles[i];
    ms.t += dt * 4.2;
    const t = Math.min(ms.t, 1);
    const e = 1 - Math.pow(1 - t, 1.6);
    const it = 1 - e;
    const x = it * it * ms.x1 + 2 * it * e * ms.cx + e * e * ms.x2;
    const y = it * it * ms.y1 + 2 * it * e * ms.cy + e * e * ms.y2;

    ms.trail.push({ x, y, age: 0 });
    for (const p of ms.trail) p.age += dt;
    ms.trail = ms.trail.filter((p) => p.age < 0.4);

    // smoke trail (การส่วย)
    for (const p of ms.trail) {
      const a = (0.4 - p.age) / 0.4;
      ctx.fillStyle = `rgba(190,200,225,${a * 0.35})`;
      ctx.beginPath(); ctx.arc(p.x + Math.sin(p.age * 30 + x) * 2, p.y, 2.5 + p.age * 22, 0, 6.28); ctx.fill();
    }
    // hot glow near head
    for (const p of ms.trail.slice(-7)) {
      const a = (0.4 - p.age) / 0.4;
      ctx.fillStyle = `rgba(255,170,60,${a * 0.5})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2 + p.age * 6, 0, 6.28); ctx.fill();
    }

    if (ms.t >= 1) {
      explosion(ms.x2, ms.y2, ms.color || "#ffaa33", 42);
      shakeT = Math.max(shakeT, 0.18);
      missiles.splice(i, 1);
      continue;
    }

    // หันหัวจรวดตามทิศเส้นโค้ง (derivative ของ Bézier)
    const vx = 2 * it * (ms.cx - ms.x1) + 2 * e * (ms.x2 - ms.cx);
    const vy = 2 * it * (ms.cy - ms.y1) + 2 * e * (ms.y2 - ms.cy);
    const ang = Math.atan2(vy, vx) + Math.PI / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    drawMissileBody();
    ctx.restore();
  }
}

function drawRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    g.age += dt;
    const t = g.age / g.life;
    if (t >= 1) { rings.splice(i, 1); continue; }
    glowOn(ctx, 1 - t);
    ctx.strokeStyle = g.color;
    ctx.lineWidth = Math.max(1, 6 * (1 - t));
    // วงแหวน 2 ชั้น: วงหลัก + วงจางด้านนอก ให้ดูเป็นคลื่นแสง
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r + (g.max - g.r) * t, 0, 6.28); ctx.stroke();
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.lineWidth = Math.max(1, 2 * (1 - t));
    ctx.beginPath(); ctx.arc(g.x, g.y, (g.r + (g.max - g.r) * t) * 0.72, 0, 6.28); ctx.stroke();
  }
  glowOff(ctx);
}

function drawFloaters(dt) {
  ctx.font = "800 22px 'Noto Sans Thai', sans-serif";
  ctx.textAlign = "center";
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.age += dt;
    const t = f.age / f.life;
    if (t >= 1) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - t;
    textShadowOn(ctx, 6);           // คะแนนที่ลอยขึ้นมีเงา อ่านชัดทุกพื้นหลัง
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - t * 50);
    textShadowOff(ctx);
  }
  ctx.globalAlpha = 1;
}

function drawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 200 * dt;
    const a = 1 - p.age / p.life;
    // ประกายไฟ: วาดด้วยแสงบวก ให้ซ้อนทับกันแล้วสว่างวาบเหมือนประกายจริง
    glowOn(ctx, a);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
    // แกนสว่างจางตรงกลาง
    ctx.globalAlpha = a * 0.6;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.6, p.r * 0.45), 0, 6.28); ctx.fill();
    glowOff(ctx);
  }
}

/* ================= Loop ================= */
function loop(t) {
  if (!running) return;
  const dt = Math.min((t - lastTime) / 1000, 0.05);
  lastTime = t;

  if (!paused) {
    spawnTimer += dt;
    const interval = spawnInterval();
    if (spawnTimer >= interval) {
      spawnTimer = 0;
      spawnMeteor();
      ensurePlayable();
    }

    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.y += m.speed * dt;
      m.x += Math.sin((m.wobble += dt * 2)) * 12 * dt;
      m.rot += dt * 0.6;
      if (m.y + m.r * 0.4 >= groundY()) hitGround(m, i);
    }
  }

  drawBackground(dt);
  shakeT = Math.max(0, shakeT - dt);
  const shx = shakeT ? (Math.random() * 2 - 1) * 10 * (shakeT / 0.45) : 0;
  const shy = shakeT ? (Math.random() * 2 - 1) * 8 * (shakeT / 0.45) : 0;
  ctx.save();
  ctx.translate(shx, shy);
  drawBase();
  for (const m of meteors) drawMeteor(m);
  drawMissiles(paused ? 0 : dt);
  drawParticles(paused ? 0 : dt);
  drawRings(paused ? 0 : dt);
  bloom(canvas, ctx, W, H);   // Bloom ปลอม: ย่อ→เบลอ→ทับแบบบวก (สะสมทุก "lighter" ให้เป็นแสงฟุ้ง)
  drawFloaters(paused ? 0 : dt);
  ctx.restore();

  requestAnimationFrame(loop);
}

