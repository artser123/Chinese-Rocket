"use strict";
/* ================= Meteors ================= */
/* ต.ค. 2026 รอบ 2 — สวยขึ้นแต่ยังลื่น: ทุกอย่างที่ละเอียดถูก "อบ" เป็นภาพไว้ครั้งเดียว
   - mSky (ท้องฟ้า เนบิวลา ทางช้างเผือก ดาวนิ่ง ดาวเคราะห์มีวงแหวน แสงขอบฟ้า vignette — สีตามระดับ HSK)
     และ mBase (สันเขา โดม/อาคารมีไฟ หอปล่อยจรวด ฐานยิง พื้นมีหลุม) อบใหม่เฉพาะตอน resize/เริ่มเกม
   - sprite: ดาว/แสงฟุ้ง/ควัน/เปลวไฟ/หางไฟ/ตัวจรวด/เศษหิน สร้างครั้งเดียวต่อความละเอียด (DPR)
   - ก้อนหิน + ป้ายพินอิน อบต่อลูกตอนเกิด (หมุนตอน blit)
   ต่อเฟรมจึงมีแค่ drawImage: เต็มจอ 1 ครั้ง (ท้องฟ้า) + แถบฐานล่าง + sprite เล็ก ๆ
   ห้ามกลับไปใช้ shadowBlur / filter / สร้าง gradient ใหม่ / bloom() ในลูปต่อเฟรม
   และห้ามเพิ่มการวาดเต็มจอเกิน 2 ชั้นต่อเฟรม (GPU มือถือติด fill-rate) */

/* ---- ธีมสีฉากตามระดับ HSK (1 → 7-9: ฟ้าอมเขียว → น้ำเงิน → ม่วง → ชมพู → ส้ม → แดง → ทอง) ---- */
const M_THEMES = [
  { top: "#020c16", bot: "#0b2a3a", neb: ["40,200,190", "60,130,230", "120,90,220"], pl: ["#9ff0e0", "#2f8f8a", "#0c2a30"], ring: "170,255,230", ground: ["#16343c", "#08161c"] },
  { top: "#03051a", bot: "#141b45", neb: ["70,90,235", "40,160,240", "150,80,220"], pl: ["#b4cfff", "#4067c0", "#101c4a"], ring: "180,205,255", ground: ["#1c2450", "#0a1030"] },
  { top: "#06041a", bot: "#24134a", neb: ["130,70,230", "200,80,200", "60,90,220"], pl: ["#dcc4ff", "#7a4ac8", "#231048"], ring: "220,190,255", ground: ["#261a52", "#0f0a2a"] },
  { top: "#0b0418", bot: "#3a0f3c", neb: ["220,60,170", "130,60,220", "255,110,130"], pl: ["#ffc4e4", "#c04a8e", "#3a0e30"], ring: "255,200,230", ground: ["#3a1a46", "#150820"] },
  { top: "#0f0510", bot: "#3d1426", neb: ["255,100,60", "200,40,110", "255,170,70"], pl: ["#ffd29c", "#d0703a", "#3e1608"], ring: "255,215,170", ground: ["#3e1e2a", "#160a10"] },
  { top: "#110409", bot: "#46101c", neb: ["255,50,70", "170,30,120", "255,130,40"], pl: ["#ffa898", "#c0382c", "#3e0a08"], ring: "255,190,170", ground: ["#40141e", "#16060a"] },
  { top: "#0a0806", bot: "#2e2410", neb: ["255,200,80", "210,120,40", "130,100,230"], pl: ["#fff0b0", "#c8a040", "#3a2a08"], ring: "255,235,170", ground: ["#33281a", "#120d06"] },
];
function meteorTheme() {
  const n = parseInt(currentLevel, 10);
  const i = Number.isFinite(n) ? n - 1 : [...String(currentLevel)].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return M_THEMES[((i % M_THEMES.length) + M_THEMES.length) % M_THEMES.length];
}

/* ---- ชนิดอุกกาบาต (หน้าตาเท่านั้น — คะแนน/ความเร็วเหมือนกันทุกชนิด) ---- */
const M_TYPES = [
  { id: "rock", w: 0.6, body: ["#b08458", "#5e3a24", "#26150c"], trail: "255,150,50", halo: "255,140,50", spark: "#ffaa33", debris: ["#7a5034", "#4e3020"] },
  { id: "ice", w: 0.25, body: ["#effaff", "#76b8de", "#1c4466"], trail: "120,210,255", halo: "110,200,255", spark: "#9fe6ff", debris: ["#cdeeff", "#5a9fc8"] },
  { id: "magma", w: 0.15, body: ["#74342a", "#2e120c", "#120403"], crack: "#ffb347", trail: "255,90,30", halo: "255,80,30", spark: "#ff7a2a", debris: ["#4a2018", "#ff8a3a"] },
];
function pickMeteorType() {
  let r = Math.random();
  for (const t of M_TYPES) if ((r -= t.w) < 0) return t;
  return M_TYPES[0];
}

function spawnMeteor() {
  if (meteors.length >= maxOnScreen()) return;
  const w = pick(pool);
  ctx.font = `700 16px sans-serif`;
  const tw = Math.max(ctx.measureText(w[1]).width, 28);
  const r = Math.max(26, tw / 2 + 12);
  const m = {
    word: w,
    type: pickMeteorType(),
    seed: Math.floor(Math.random() * 1e9),
    x: rand(r + 6, W - r - 6),
    y: -r - 20,
    r: r,
    verts: Array.from({ length: 11 }, () => rand(0.74, 1.12)),
    speed: fallSpeed() * rand(0.85, 1.2),
    wobble: rand(0, 6.28),
    rot: rand(0, 6.28),
    ember: rand(0, 0.08),
  };
  // รูปทรงหิน (รวมเงาเบลอ/ผิว/หลุม) และป้ายพินอินไม่เปลี่ยนตลอดชีวิตของลูกนี้
  // → pre-render เป็น sprite ครั้งเดียว แทนการ shadowBlur + strokeText ทุกเฟรม
  m.rock = makeMeteorRockSprite(m);
  m.label = makeMeteorLabelSprite(w[1], Math.max(15, r * 0.52));
  meteors.push(m);
}

// path หินแบบมน (quadratic ผ่านจุดกึ่งกลาง) จากรัศมีสุ่มรอบวง
function meteorRockPath(R, verts) {
  const n = verts.length, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28;
    pts.push([Math.cos(a) * R * verts[i], Math.sin(a) * R * verts[i]]);
  }
  const p = new Path2D();
  const mid = (i) => { const a = pts[i % n], b = pts[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const m0 = mid(n - 1);
  p.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) { const m = mid(i); p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
  p.closePath();
  return p;
}

// sprite ของก้อนหิน (เบกที่ rot=0 แล้วค่อยหมุนตอน blit)
function makeMeteorRockSprite(m) {
  const R = m.r, T = m.type, dpr = DPR, rr = seededRng(m.seed);
  const margin = Math.ceil(R * 1.0); // เผื่อเงาเบลอ 0.7R + offset 0.18R
  const size = Math.ceil(R * 1.15 + margin) * 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.ceil(size * dpr);
  const c2 = cv.getContext("2d");
  c2.scale(dpr, dpr);
  c2.translate(size / 2, size / 2);
  const path = meteorRockPath(R, m.verts);
  // ตัวหิน + เงาตกกระทบ
  c2.save();
  const body = c2.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R * 1.1);
  body.addColorStop(0, T.body[0]); body.addColorStop(0.55, T.body[1]); body.addColorStop(1, T.body[2]);
  c2.shadowColor = "rgba(0,0,0,.6)";
  c2.shadowBlur = R * 0.7;
  c2.shadowOffsetY = R * 0.18;
  c2.fillStyle = body;
  c2.fill(path);
  c2.restore();
  c2.save();
  c2.clip(path);
  // ผิวหินเป็นเม็ด
  for (let i = 0, n = Math.round(R * 1.6); i < n; i++) {
    const a = rr() * 6.28, d = rr() * R;
    c2.fillStyle = rr() < 0.5 ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.2)";
    c2.fillRect(Math.cos(a) * d, Math.sin(a) * d, 1 + rr() * 2, 1 + rr() * 2);
  }
  // หลุม: วงมืด + ขอบล่างขวาสว่าง (แสงมาจากซ้ายบน)
  for (let i = 0, n = 3 + Math.floor(rr() * 3); i < n; i++) {
    const a = rr() * 6.28, d = rr() * R * 0.62, cr = R * (0.09 + rr() * 0.14);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    c2.fillStyle = "rgba(0,0,0,.3)";
    c2.beginPath(); c2.arc(x, y, cr, 0, 6.28); c2.fill();
    c2.strokeStyle = "rgba(255,255,255,.18)";
    c2.lineWidth = Math.max(1, cr * 0.28);
    c2.beginPath(); c2.arc(x, y, cr * 0.9, 0.15, 1.95); c2.stroke();
  }
  if (T.id === "ice") {
    // ผลึกน้ำแข็ง: เส้นรอยแยกบาง ๆ + จุดสะท้อนแสง
    c2.strokeStyle = "rgba(255,255,255,.4)"; c2.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      const a = rr() * 6.28;
      c2.beginPath(); c2.moveTo(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15);
      c2.lineTo(Math.cos(a + 0.3) * R * 0.95, Math.sin(a + 0.3) * R * 0.95); c2.stroke();
    }
    c2.fillStyle = "rgba(255,255,255,.55)";
    c2.beginPath(); c2.ellipse(-R * 0.38, -R * 0.42, R * 0.2, R * 0.1, -0.6, 0, 6.28); c2.fill();
  }
  // เงาด้านมืด (ขวาล่าง)
  const sh = c2.createRadialGradient(-R * 0.45, -R * 0.45, R * 0.5, -R * 0.2, -R * 0.2, R * 1.6);
  sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.5)");
  c2.fillStyle = sh;
  c2.fillRect(-R * 1.3, -R * 1.3, R * 2.6, R * 2.6);
  if (T.crack) {
    // แมกมา: รอยแตกเรืองแสง (shadowBlur จ่ายครั้งเดียวตอนอบ)
    c2.globalCompositeOperation = "lighter";
    c2.strokeStyle = T.crack; c2.shadowColor = T.crack; c2.shadowBlur = R * 0.3;
    c2.lineWidth = Math.max(1.4, R * 0.07); c2.lineJoin = "round";
    for (let i = 0; i < 4; i++) {
      let a = rr() * 6.28, d = R * 0.1;
      c2.beginPath(); c2.moveTo(Math.cos(a) * d, Math.sin(a) * d);
      for (let k = 0; k < 3; k++) { a += (rr() - 0.5) * 0.9; d += R * (0.2 + rr() * 0.15); c2.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
      c2.stroke();
    }
  }
  c2.restore();
  // ขอบร้อนจากการเสียดสีบรรยากาศ (ซ้ายบน)
  c2.save();
  c2.globalCompositeOperation = "lighter";
  const rim = c2.createLinearGradient(-R, -R, R * 0.4, R * 0.4);
  rim.addColorStop(0, `rgba(${T.halo},.7)`); rim.addColorStop(1, `rgba(${T.halo},0)`);
  c2.strokeStyle = rim;
  c2.lineWidth = Math.max(1.5, R * 0.08);
  c2.stroke(path);
  c2.restore();
  return { cv, size };
}

// sprite ของป้ายพินอิน (ข้อความ/ขนาดคงที่ต่อลูก — เดิม strokeText+เงาเบลอใหม่ทุกเฟรม)
function makeMeteorLabelSprite(text, fontPx) {
  const dpr = DPR;
  const font = `700 ${fontPx}px sans-serif`;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const tw = probe.measureText(text).width;
  const w = Math.ceil(tw + fontPx * 1.2);
  const h = Math.ceil(fontPx * 2.2);
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * dpr);
  cv.height = Math.ceil(h * dpr);
  const c2 = cv.getContext("2d");
  c2.scale(dpr, dpr);
  c2.font = font;
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.shadowColor = "rgba(0,0,0,.65)";
  c2.shadowBlur = 5;
  c2.shadowOffsetY = 1;
  c2.lineWidth = 4;
  c2.strokeStyle = "rgba(0,0,0,.85)";
  c2.strokeText(text, w / 2, h / 2);
  c2.fillStyle = "#ffe9b0";
  c2.fillText(text, w / 2, h / 2);
  return { cv, w, h };
}

function hitGround(m, idx) {
  meteors.splice(idx, 1);
  combo = 0;
  lives--;
  music.setIntensity(1 - lives / 3); // เลือดน้อยลง = ดนตรีเข้มข้นขึ้น
  shakeT = 0.45;
  sfx.damage();
  explosion(m.x, groundY() - 6, "#ff5030", 30);
  meteorDebris(m.x, groundY() - 10, m.type, 5, true);
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
      t: 0, trail: [], type: m.type,
    });
    explosion(baseX(), baseY() - 46, "#9fd0ff", 6);   // muzzle flash
    mRecoil = 1;
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

// คำจีนของอุกกาบาตอยู่ใน canvas: แตะบริเวณป้ายคำเพื่อเปิดบับเบิ้ลคำแปล/ดูเส้นขีด
canvas.addEventListener("click", (e) => {
  if (!running || paused || !meteors.length) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * W / Math.max(1, r.width);
  const y = (e.clientY - r.top) * H / Math.max(1, r.height);
  const target = [...meteors].reverse().find((m) => Math.hypot(x - m.x, y - m.y) <= Math.max(28, m.r * 2.2));
  if (target) crOpenCanvasTextBubble(target.word[0], e.clientX, e.clientY);
});


/* ================= Effects ================= */
// อนุภาค: จำกัดจำนวน + ใช้ object ซ้ำ (free list) ไม่สร้างใหม่ทุกครั้ง → GC ไม่สะดุดกลางเกม
const M_MAX_PARTICLES = 240;
const mPartFree = [];
let mDebris = [], mFlashes = [], mRecoil = 0;
function mAddParticle(x, y, vx, vy, life, color, r, g = 200) {
  if (particles.length >= M_MAX_PARTICLES) return;
  const p = mPartFree.pop() || {};
  p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.age = 0;
  p.r = r; p.g = g; p.spr = mSparkSprite(color);
  particles.push(p);
}
function mAddFlash(x, y, size, life = 0.22) {
  mFlashes.push({ x, y, size, age: 0, life });
}
function meteorResetFx() {
  mDebris = []; mFlashes = []; mRecoil = 0;
}

function explosion(x, y, color, n) {
  rings.push({ x, y, r: 10, max: rand(70, 100), age: 0, life: 0.4, color });
  mAddFlash(x, y, 46, 0.14);
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28), sp = rand(40, 240);
    mAddParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 0.9), color, rand(1.5, 4));
  }
}
// เศษหินแตกกระจาย (sprite ชิ้นเล็กหมุนตกตามแรงโน้มถ่วง)
function meteorDebris(x, y, type, n, up = false) {
  for (let i = 0; i < n; i++) {
    const a = up ? rand(-2.8, -0.35) : rand(0, 6.28), sp = rand(90, 260);
    mDebris.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      rot: rand(0, 6.28), vr: rand(-9, 9), size: rand(7, 14),
      spr: pick(type.debrisSpr), age: 0, life: rand(0.7, 1.1),
    });
  }
}
// จรวดชนอุกกาบาต: แสงวาบ + วงคลื่น + สะเก็ดไฟสีตามชนิด + เศษหิน
function meteorBurst(x, y, type) {
  explosion(x, y, type.spark, 36);
  mAddFlash(x, y, 120, 0.26);
  meteorDebris(x, y, type, 6);
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

/* ================= ภาพที่อบไว้ (สร้างใหม่เมื่อ meteorStaticsDirty) ================= */
let mSky = null, mBase = null, mSpr = null, mSprScale = 0;
const mSparkCache = new Map();
const mCanvas = (w, h) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; return cv; };

function meteorBuildStatics() {
  meteorStaticsDirty = false;
  if (mSprScale !== DPR) { mSpr = mBuildSprites(); mSprScale = DPR; }
  const gy = groundY(), th = meteorTheme();
  mSky = mBuildSky(gy, th);
  mBase = mBuildBase(gy, th);
}

// สะเก็ดไฟ: แกนขาว → สี → โปร่ง (แคชตามสี; สีที่ใช้มีไม่กี่สี)
// color ต้องเป็น hex 6 หลัก (#rrggbb) เพราะต่อท้ายค่า alpha เป็น #rrggbbaa
function mSparkSprite(color) {
  let cv = mSparkCache.get(color);
  if (cv) return cv;
  cv = mCanvas(32, 32);
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,.95)");
  g.addColorStop(0.22, color);
  g.addColorStop(0.5, color + "55");
  g.addColorStop(1, color + "00");
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  mSparkCache.set(color, cv);
  return cv;
}

function mBuildSprites() {
  const S = {
    glowW: softSprite("255,255,255", 64),
    glowWarm: softSprite("255,180,90", 64),
    glowRed: softSprite("255,45,35", 64),
    smoke: softSprite("190,200,225", 64),
    star: mStarSprite(),
    flame: mFlameSprite(),
    rocket: mRocketSprite(),
  };
  for (const t of M_TYPES) {
    t.trailSpr = mTrailSprite(t.trail);
    t.haloSpr = softSprite(t.halo, 64);
    t.debrisSpr = [0, 1, 2, 3].map((i) => mDebrisSprite(t, i));
  }
  return S;
}

function mStarSprite() {
  const cv = mCanvas(32, 32), c = cv.getContext("2d");
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.16, "rgba(235,242,255,.9)");
  g.addColorStop(0.42, "rgba(160,190,255,.16)");
  g.addColorStop(1, "rgba(160,190,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  c.fillStyle = "rgba(220,235,255,.35)";   // ประกายแฉกบาง ๆ
  c.fillRect(15.5, 3, 1, 26); c.fillRect(3, 15.5, 26, 1);
  return cv;
}

// หางไฟอุกกาบาต: หยดน้ำกลับหัว กว้างที่หัว (ล่าง) เรียวขึ้นบน + แกนร้อนสีอ่อน
// จุดศูนย์กลางลูกอยู่ที่ y = 0.9 ของความสูง sprite
function mTrailSprite(rgb) {
  const w = 64, h = 192, cv = mCanvas(w, h), c = cv.getContext("2d");
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.55, `rgba(${rgb},.3)`); g.addColorStop(1, `rgba(${rgb},.85)`);
  c.fillStyle = g;
  c.beginPath(); c.moveTo(4, h * 0.9); c.quadraticCurveTo(w / 2, -h * 0.2, w - 4, h * 0.9);
  c.quadraticCurveTo(w / 2, h + 8, 4, h * 0.9); c.fill();
  const g2 = c.createLinearGradient(0, h * 0.35, 0, h);
  g2.addColorStop(0, "rgba(255,240,210,0)"); g2.addColorStop(1, "rgba(255,248,225,.75)");
  c.fillStyle = g2;
  c.beginPath(); c.moveTo(w * 0.3, h * 0.9); c.quadraticCurveTo(w / 2, h * 0.25, w * 0.7, h * 0.9);
  c.quadraticCurveTo(w / 2, h - 2, w * 0.3, h * 0.9); c.fill();
  return cv;
}

// เปลวไฟเครื่องยนต์ (ชี้ลง): กว้างที่หัวฉีด (บน) → แหลมด้านล่าง
function mFlameSprite() {
  const w = 32, h = 96, cv = mCanvas(w, h), c = cv.getContext("2d");
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255,240,170,.98)"); g.addColorStop(0.45, "rgba(255,140,40,.75)"); g.addColorStop(1, "rgba(255,60,10,0)");
  c.fillStyle = g;
  c.beginPath(); c.moveTo(2, 0); c.quadraticCurveTo(w * 0.2, h * 0.5, w / 2, h); c.quadraticCurveTo(w * 0.8, h * 0.5, w - 2, 0); c.fill();
  c.fillStyle = "rgba(255,255,240,.85)";
  c.beginPath(); c.moveTo(w * 0.3, 0); c.quadraticCurveTo(w / 2, h * 0.5, w * 0.7, 0); c.fill();
  return cv;
}

// ตัวจรวดบนฐาน — origin (24, 72) ของ sprite = จุด (baseX, baseY) เดิม
function mRocketSprite() {
  const L = makeLayer(48, 64, DPR), c = L.c;
  c.translate(24, 72);
  // ครีบ (ด้านมืดขวา)
  const fin = c.createLinearGradient(-18, 0, 18, 0);
  fin.addColorStop(0, "#ff6a55"); fin.addColorStop(0.5, "#d63a2c"); fin.addColorStop(1, "#8a1c14");
  c.fillStyle = fin;
  c.beginPath(); c.moveTo(-9, -34); c.lineTo(-19, -14); c.lineTo(-17, -12); c.lineTo(-9, -16); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(9, -34); c.lineTo(19, -14); c.lineTo(17, -12); c.lineTo(9, -16); c.closePath(); c.fill();
  // หัวฉีด
  c.fillStyle = "#3a4058";
  c.beginPath(); c.moveTo(-6, -16); c.lineTo(6, -16); c.lineTo(7, -11); c.lineTo(-7, -11); c.closePath(); c.fill();
  // ลำตัวทรงกระบอก
  const body = c.createLinearGradient(-10, 0, 10, 0);
  body.addColorStop(0, "#d7deef"); body.addColorStop(0.3, "#ffffff"); body.addColorStop(0.75, "#b9c4e0"); body.addColorStop(1, "#7f8bb0");
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(0, -66);
  c.quadraticCurveTo(10, -52, 9, -30); c.lineTo(9, -16); c.lineTo(-9, -16); c.lineTo(-9, -30);
  c.quadraticCurveTo(-10, -52, 0, -66);
  c.fill();
  // เส้นแผ่นโลหะ + หมุด
  c.strokeStyle = "rgba(60,70,110,.45)"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(-9, -24); c.lineTo(9, -24); c.moveTo(-9.5, -44); c.lineTo(9.5, -44); c.stroke();
  c.fillStyle = "rgba(60,70,110,.5)";
  for (const x of [-6, -2, 2, 6]) { c.beginPath(); c.arc(x, -20, 0.8, 0, 6.28); c.fill(); }
  // หัวจรวด
  const nose = c.createLinearGradient(-9, 0, 9, 0);
  nose.addColorStop(0, "#ff7a62"); nose.addColorStop(0.35, "#ff5a44"); nose.addColorStop(1, "#a8241a");
  c.fillStyle = nose;
  c.beginPath();
  c.moveTo(0, -66); c.quadraticCurveTo(9, -55, 9, -46); c.lineTo(-9, -46); c.quadraticCurveTo(-9, -55, 0, -66);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(-3, -60); c.quadraticCurveTo(-6, -54, -6, -48); c.stroke();
  // หน้าต่าง
  c.fillStyle = "#28304f"; c.beginPath(); c.arc(0, -35, 6.2, 0, 6.28); c.fill();
  const glass = c.createRadialGradient(-1.5, -37, 0.5, 0, -35, 4.5);
  glass.addColorStop(0, "#d8f2ff"); glass.addColorStop(0.5, "#6fc4ff"); glass.addColorStop(1, "#2a5f9e");
  c.fillStyle = glass; c.beginPath(); c.arc(0, -35, 4.3, 0, 6.28); c.fill();
  c.fillStyle = "rgba(255,255,255,.9)"; c.beginPath(); c.arc(-1.6, -36.8, 1.1, 0, 6.28); c.fill();
  return L;
}

function mDebrisSprite(T, i) {
  const s = 24, cv = mCanvas(s, s), c = cv.getContext("2d"), r = seededRng(977 + i * 131 + T.id.charCodeAt(0));
  c.translate(s / 2, s / 2);
  c.fillStyle = T.debris[i % 2];
  c.beginPath();
  const n = 5 + (i % 2);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.28, d = 5 + r() * 6;
    k ? c.lineTo(Math.cos(a) * d, Math.sin(a) * d) : c.moveTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  c.closePath(); c.fill();
  c.strokeStyle = T.crack ? "rgba(255,180,80,.8)" : "rgba(255,255,255,.28)";
  c.lineWidth = 1.2; c.stroke();
  return cv;
}

/* ---- ท้องฟ้า (W × groundY) ---- */
function mBuildSky(gy, th) {
  const L = makeLayer(W, gy, DPR), c = L.c, r = seededRng(4242), big = Math.max(W, gy);
  const sky = c.createLinearGradient(0, 0, 0, gy);
  sky.addColorStop(0, th.top); sky.addColorStop(1, th.bot);
  c.fillStyle = sky; c.fillRect(0, 0, W, gy);
  // เนบิวลา: ก้อนแสงนุ่มหลายสีซ้อนแบบบวก
  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const rad = big * (0.22 + r() * 0.34), x = r() * W, y = r() * gy * 0.85;
    c.globalAlpha = 0.08 + r() * 0.12;
    c.drawImage(softSprite(th.neb[i % 3], 128), x - rad, y - rad * 0.7, rad * 2, rad * 1.4);
  }
  // ทางช้างเผือก: แถบเรืองเฉียง + ดาวหนาแน่นตามแถบ
  const cx = W * 0.45, cy = gy * 0.42, ang = -0.55, len = big * 1.3;
  c.save();
  c.translate(cx, cy); c.rotate(ang); c.scale(1, 0.16);
  c.globalAlpha = 0.22;
  c.drawImage(softSprite(th.neb[1], 128), -len / 2, -len / 2, len, len);
  c.restore();
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let i = 0; i < 520; i++) {
    const u = (r() - 0.5) * len, v = (r() + r() + r() - 1.5) * big * 0.07;
    const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
    if (y < 0 || y > gy) continue;
    c.globalAlpha = 0.15 + r() * 0.45;
    c.fillStyle = r() < 0.25 ? "#ffe4d0" : "#e6ecff";
    c.fillRect(x, y, 0.6 + r() * 0.9, 0.6 + r() * 0.9);
  }
  // ดาวนิ่งทั่วฟ้า (ดวงที่กะพริบ/เลื่อนวาดสดใน drawBackground)
  for (let i = 0; i < 240; i++) {
    c.globalAlpha = 0.2 + r() * 0.6;
    c.fillStyle = r() < 0.18 ? "#ffd9c8" : r() < 0.3 ? "#c8dcff" : "#f2f4ff";
    const s = 0.5 + r() * 1.1;
    c.fillRect(r() * W, r() * gy, s, s);
  }
  c.globalAlpha = 1;
  mDrawPlanet(c, W * 0.8, gy * 0.28, Math.max(38, Math.min(120, Math.min(W, gy) * 0.13)), th);
  // แสงบรรยากาศที่ขอบฟ้า เหนือฐาน
  c.globalCompositeOperation = "lighter";
  const hz = c.createLinearGradient(0, gy - 180, 0, gy);
  hz.addColorStop(0, `rgba(${th.neb[0]},0)`); hz.addColorStop(1, `rgba(${th.neb[0]},.32)`);
  c.fillStyle = hz; c.fillRect(0, gy - 180, W, 180);
  c.globalCompositeOperation = "source-over";
  // vignette (อบรวมไว้ในท้องฟ้า ไม่ต้องวาดเต็มจอเพิ่มอีกชั้น)
  const vig = c.createRadialGradient(W / 2, gy * 0.55, Math.min(W, gy) * 0.35, W / 2, gy * 0.55, big * 0.8);
  vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,.5)");
  c.fillStyle = vig; c.fillRect(0, 0, W, gy);
  return L;
}

function mDrawPlanet(c, px, py, R, th) {
  // แสงบรรยากาศรอบดาว
  c.save();
  c.globalCompositeOperation = "lighter"; c.globalAlpha = 0.45;
  c.drawImage(softSprite(th.ring, 128), px - R * 1.7, py - R * 1.7, R * 3.4, R * 3.4);
  c.restore();
  const ring = (from, to) => {
    c.save();
    c.translate(px, py); c.rotate(-0.38); c.scale(1, 0.26);
    c.strokeStyle = `rgba(${th.ring},.28)`; c.lineWidth = R * 0.34;
    c.beginPath(); c.arc(0, 0, R * 1.75, from, to); c.stroke();
    c.strokeStyle = `rgba(${th.ring},.6)`; c.lineWidth = R * 0.07;
    c.beginPath(); c.arc(0, 0, R * 1.58, from, to); c.stroke();
    c.beginPath(); c.arc(0, 0, R * 1.95, from, to); c.stroke();
    c.restore();
  };
  ring(Math.PI, Math.PI * 2);   // ครึ่งหลัง (อยู่หลังดาว)
  c.save();
  c.beginPath(); c.arc(px, py, R, 0, 6.28); c.clip();
  const disc = c.createRadialGradient(px - R * 0.4, py - R * 0.45, R * 0.1, px, py, R * 1.05);
  disc.addColorStop(0, th.pl[0]); disc.addColorStop(0.55, th.pl[1]); disc.addColorStop(1, th.pl[2]);
  c.fillStyle = disc; c.fillRect(px - R, py - R, R * 2, R * 2);
  // แถบเมฆบนดาว
  c.save();
  c.translate(px, py); c.rotate(-0.38);
  for (let i = -4; i <= 4; i++) {
    c.fillStyle = i % 2 ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.08)";
    c.fillRect(-R * 1.2, i * R * 0.22, R * 2.4, R * (0.08 + (i & 1) * 0.06));
  }
  c.restore();
  // ด้านกลางคืนของดาว
  const night = c.createRadialGradient(px - R * 0.55, py - R * 0.55, R * 0.7, px - R * 0.3, py - R * 0.3, R * 1.9);
  night.addColorStop(0, "rgba(0,0,0,0)"); night.addColorStop(1, "rgba(0,0,0,.75)");
  c.fillStyle = night; c.fillRect(px - R, py - R, R * 2, R * 2);
  c.restore();
  ring(0, Math.PI);             // ครึ่งหน้า (ทับดาว)
  // ดวงจันทร์บริวาร
  const mx = px - R * 1.95, my = py + R * 0.95, mr = Math.max(5, R * 0.15);
  const mg = c.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, mr * 0.1, mx, my, mr);
  mg.addColorStop(0, "#f2efe6"); mg.addColorStop(1, "#5d5a66");
  c.fillStyle = mg; c.beginPath(); c.arc(mx, my, mr, 0, 6.28); c.fill();
}

/* ---- ฐานด้านล่าง (สันเขา + อาคาร + หอปล่อย + ฐานยิง + พื้น) จาก groundY-150 ถึงล่างจอ ---- */
function mBuildBase(gy, th) {
  const top = Math.max(0, gy - 150), L = makeLayer(W, H - top, DPR), c = L.c, r = seededRng(777);
  c.translate(0, -top);
  L.top = top;
  L.lights = [];
  const cx = W / 2;
  // สันเขาไกล (สีจางตามธีม) + ขอบรับแสง
  const ridge = (baseY, amp, step, fill, rim) => {
    c.beginPath(); c.moveTo(-10, gy + 2);
    let y = baseY;
    for (let x = -10; x <= W + step; x += step) { y = baseY - r() * amp; c.lineTo(x, y); }
    c.lineTo(W + 10, gy + 2); c.closePath();
    c.fillStyle = fill; c.fill();
    c.strokeStyle = rim; c.lineWidth = 1.2; c.stroke();
  };
  ridge(gy - 38, 42, 34, "rgba(14,16,40,.92)", `rgba(${th.neb[0]},.35)`);
  ridge(gy - 14, 22, 22, "rgba(8,10,26,.96)", `rgba(${th.neb[1]},.25)`);
  // อาคาร: วางห่างจากฐานยิงกลางจอ ทั้งสองฝั่ง
  const structure = (x, kind) => {
    if (kind === 0) {           // โดมกระจก
      const R = 18 + r() * 14;
      const g = c.createRadialGradient(x - R * 0.3, gy - R * 0.7, 2, x, gy, R);
      g.addColorStop(0, "rgba(190,220,255,.55)"); g.addColorStop(1, "rgba(60,80,140,.55)");
      c.fillStyle = "#151a36"; c.fillRect(x - R - 3, gy - 5, R * 2 + 6, 5);
      c.fillStyle = g; c.beginPath(); c.arc(x, gy - 5, R, Math.PI, 0); c.fill();
      c.strokeStyle = "rgba(200,225,255,.35)"; c.lineWidth = 1;
      c.beginPath(); c.arc(x, gy - 5, R, Math.PI, 0); c.moveTo(x, gy - 5 - R); c.lineTo(x, gy - 5); c.stroke();
      c.fillStyle = "#ffd77a";
      for (let k = 0; k < 3; k++) c.fillRect(x - R * 0.5 + k * R * 0.4, gy - 10, 3, 3);
    } else if (kind === 1) {    // อาคารที่พักมีหน้าต่าง
      const w = 40 + r() * 30, h = 22 + r() * 22;
      c.fillStyle = "#12162e"; c.fillRect(x - w / 2, gy - h, w, h);
      c.fillStyle = `rgba(${th.neb[0]},.35)`; c.fillRect(x - w / 2, gy - h, w, 2);
      for (let wy = gy - h + 6; wy < gy - 5; wy += 8)
        for (let wx = x - w / 2 + 5; wx < x + w / 2 - 5; wx += 8) {
          const k = r();
          c.fillStyle = k < 0.35 ? "#ffd77a" : k < 0.45 ? "#8fd3ff" : "rgba(255,255,255,.05)";
          c.fillRect(wx, wy, 4, 4);
        }
    } else if (kind === 2) {    // เสาอากาศ + จาน
      const h = 50 + r() * 30;
      c.strokeStyle = "#2a3050"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, gy); c.lineTo(x, gy - h); c.stroke();
      c.fillStyle = "#3a4268";
      c.beginPath(); c.ellipse(x + 8, gy - h * 0.6, 12, 5, -0.6, 0, 6.28); c.fill();
      L.lights.push({ x, y: gy - h, color: "red", ph: r() * 6.28, sp: 3 });
    } else {                    // ถังเชื้อเพลิง
      const R = 9 + r() * 5;
      for (let k = 0; k < 2; k++) {
        const tx = x + k * (R * 2 + 3);
        const g = c.createLinearGradient(tx - R, 0, tx + R, 0);
        g.addColorStop(0, "#cfd6ea"); g.addColorStop(1, "#5a6488");
        c.fillStyle = g; c.fillRect(tx - R, gy - R * 3, R * 2, R * 3);
        c.beginPath(); c.arc(tx, gy - R * 3, R, Math.PI, 0); c.fill();
        c.fillStyle = "#d84343"; c.fillRect(tx - R, gy - R * 1.8, R * 2, 3);
      }
    }
  };
  for (const side of [-1, 1]) {
    let x = cx + side * (side < 0 ? 95 : 120);
    while (x > -40 && x < W + 40) {
      structure(x, Math.floor(r() * 4));
      x += side * (80 + r() * 90);
    }
  }
  // หอปล่อยจรวด (โครงถัก) ข้างฐานยิง
  const tx = cx + 34, tTop = gy - 118;
  c.strokeStyle = "#3a4670"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(tx, gy - 14); c.lineTo(tx, tTop); c.moveTo(tx + 12, gy - 14); c.lineTo(tx + 12, tTop); c.stroke();
  c.lineWidth = 1;
  c.beginPath();
  for (let y = gy - 14; y > tTop; y -= 12) { c.moveTo(tx, y); c.lineTo(tx + 12, y - 12); c.moveTo(tx + 12, y); c.lineTo(tx, y - 12); }
  c.moveTo(tx, gy - 70); c.lineTo(tx - 22, gy - 70);   // แขนยึดจรวด
  c.stroke();
  L.lights.push({ x: tx + 6, y: tTop - 3, color: "red", ph: 0, sp: 2.4 });
  // พื้น
  const ground = c.createLinearGradient(0, gy, 0, H);
  ground.addColorStop(0, th.ground[0]); ground.addColorStop(1, th.ground[1]);
  c.fillStyle = ground; c.fillRect(0, gy, W, H - gy);
  c.fillStyle = `rgba(${th.neb[0]},.45)`; c.fillRect(0, gy, W, 2);
  for (let i = 0; i < Math.ceil(W / 90); i++) {      // หลุมบนพื้น
    const x = r() * W, y = gy + 10 + r() * 40, rw = 10 + r() * 24;
    c.fillStyle = "rgba(0,0,0,.28)"; c.beginPath(); c.ellipse(x, y, rw, rw * 0.28, 0, 0, 6.28); c.fill();
    c.strokeStyle = "rgba(255,255,255,.08)"; c.lineWidth = 1;
    c.beginPath(); c.ellipse(x, y + 1, rw, rw * 0.28, 0, 0.2, 2.9); c.stroke();
  }
  // ฐานยิง: คางหมู + แถบเตือนเหลืองดำ + ไฟขอบ
  const py = gy - 38;   // = baseY() - 14
  const pad = c.createLinearGradient(0, py, 0, gy);
  pad.addColorStop(0, "#4a5aa8"); pad.addColorStop(1, "#262f66");
  c.fillStyle = pad;
  c.beginPath(); c.moveTo(cx - 36, gy); c.lineTo(cx + 36, gy); c.lineTo(cx + 22, py); c.lineTo(cx - 22, py); c.closePath(); c.fill();
  c.save();
  c.beginPath(); c.rect(cx - 22, py, 44, 4); c.clip();
  for (let x = cx - 30; x < cx + 26; x += 8) {
    c.fillStyle = "#ffcc33"; c.beginPath(); c.moveTo(x, py + 4); c.lineTo(x + 4, py); c.lineTo(x + 8, py); c.lineTo(x + 4, py + 4); c.fill();
  }
  c.restore();
  c.fillStyle = "#151a36"; c.fillRect(cx - 22, py + 4, 44, 2);
  L.lights.push({ x: cx - 30, y: gy - 3, color: "warm", ph: 0, sp: 4 }, { x: cx + 30, y: gy - 3, color: "warm", ph: 3.14, sp: 4 });
  return L;
}

/* ================= Draw (ต่อเฟรม: drawImage เป็นหลัก) ================= */
function drawBackground(dt) {
  ctx.drawImage(mSky.cv, 0, 0, mSky.w, mSky.h);
  // ดาวที่เลื่อน/กะพริบ (parallax 3 ชั้นตามความเร็ว) — sprite แทน arc() ต่อดวง
  for (const s of stars) {
    s.tw += dt * 2;
    s.y += (s.spd * dt) / Math.max(H, 1);
    if (s.y > 1.02) { s.y = -0.02; s.x = Math.random(); }
    ctx.globalAlpha = 0.45 + 0.4 * Math.sin(s.tw);
    const d = s.r * 4.2;
    ctx.drawImage(mSpr.star, s.x * W - d / 2, s.y * H - d / 2, d, d);
  }
  ctx.globalAlpha = 1;
}

function drawBase(t) {
  ctx.drawImage(mBase.cv, 0, mBase.top, mBase.w, mBase.h);
  // ไฟกะพริบบนอาคาร/หอ/ฐานยิง
  glowOn(ctx);
  for (const l of mBase.lights) {
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.001 * l.sp + l.ph));
    ctx.globalAlpha = a;
    ctx.drawImage(l.color === "red" ? mSpr.glowRed : mSpr.glowWarm, l.x - 7, l.y - 7, 14, 14);
  }
  glowOff(ctx);
  const x = baseX(), y = baseY() + mRecoil * 3;
  // เปลวไฟเครื่องยนต์ (ยิงแล้วพุ่งแรงขึ้นชั่วครู่)
  const fl = 10 + Math.random() * 10 + mRecoil * 14;
  glowOn(ctx);
  ctx.drawImage(mSpr.flame, x - 6, y - 12, 12, fl + 6);
  ctx.globalAlpha = 0.55;
  ctx.drawImage(mSpr.glowWarm, x - fl * 0.8, y - 12 + fl * 0.2 - fl * 0.8, fl * 1.6, fl * 1.6);
  glowOff(ctx);
  ctx.drawImage(mSpr.rocket.cv, x - 24, y - 72, 48, 64);
  if (performance.now() < stunUntil) {
    ctx.fillStyle = "rgba(255,60,60,.9)";
    ctx.font = "700 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚠", x, y - 78);
  }
}

// พื้นเรืองแดงใต้ลูกที่ใกล้ตก (เตือนก่อนเสียเลือด)
function drawGroundWarnings(t) {
  const gy = groundY(), from = gy * 0.45;
  glowOn(ctx);
  for (const m of meteors) {
    const k = (m.y - from) / Math.max(1, gy - m.r - from);
    if (k <= 0) continue;
    const kk = Math.min(1, k);
    ctx.globalAlpha = kk * (0.55 + 0.45 * Math.sin(t * 0.012 + m.seed));
    const w = m.r * (2.6 + kk * 1.8), h = 14 + kk * 10;
    ctx.drawImage(mSpr.glowRed, m.x - w / 2, gy - h / 2, w, h);
  }
  glowOff(ctx);
}

function drawMeteor(m) {
  const T = m.type;
  // หางไฟ + ไอร้อนรอบลูก — sprite ต่อชนิด วาดแบบแสงบวก (แทน gradient ใหม่ 2 อันต่อลูกต่อเฟรม)
  glowOn(ctx);
  const tw = m.r * 1.9, th = m.r * (4.1 + Math.sin(m.wobble * 5) * 0.25);
  ctx.drawImage(T.trailSpr, m.x - tw / 2, m.y - th * 0.9, tw, th);
  const hr = m.r * 2.2;
  ctx.globalAlpha = 0.4;
  ctx.drawImage(T.haloSpr, m.x - hr, m.y - hr, hr * 2, hr * 2);
  glowOff(ctx);
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(m.rot);
  ctx.drawImage(m.rock.cv, -m.rock.size / 2, -m.rock.size / 2, m.rock.size, m.rock.size);
  ctx.restore();
  ctx.drawImage(m.label.cv, m.x - m.label.w / 2, m.y - m.label.h / 2, m.label.w, m.label.h);
}

function drawMissileBody() {
  const fl = 6 + Math.random() * 5;
  glowOn(ctx);
  ctx.drawImage(mSpr.flame, -2.8, 5, 5.6, fl + 4);
  ctx.globalAlpha = 0.5;
  ctx.drawImage(mSpr.glowWarm, -fl * 0.6, 6 + fl * 0.3 - fl * 0.6, fl * 1.2, fl * 1.2);
  glowOff(ctx);
  // body
  ctx.fillStyle = "#e8ecf5";
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.quadraticCurveTo(4, -4, 3, 6); ctx.lineTo(-3, 6);
  ctx.quadraticCurveTo(-4, -4, 0, -9);
  ctx.fill();
  // nose + fins
  ctx.fillStyle = "#ff5040";
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.quadraticCurveTo(3.2, -5, 3.1, -2); ctx.lineTo(-3.1, -2);
  ctx.quadraticCurveTo(-3.2, -5, 0, -9);
  ctx.fill();
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

    if (dt) ms.trail.push({ x, y, age: 0 });
    for (const p of ms.trail) p.age += dt;
    while (ms.trail.length && ms.trail[0].age >= 0.4) ms.trail.shift();   // จุดเก่าสุดอยู่หน้าเสมอ

    // ควันตามหลัง (sprite นุ่ม) แล้วแสงร้อนใกล้หัว (แสงบวก)
    for (const p of ms.trail) {
      const a = (0.4 - p.age) / 0.4, rad = 2.5 + p.age * 22;
      ctx.globalAlpha = a * 0.4;
      ctx.drawImage(mSpr.smoke, p.x + Math.sin(p.age * 30 + x) * 2 - rad, p.y - rad, rad * 2, rad * 2);
    }
    glowOn(ctx);
    for (let k = Math.max(0, ms.trail.length - 7); k < ms.trail.length; k++) {
      const p = ms.trail[k], a = (0.4 - p.age) / 0.4, rad = (2 + p.age * 6) * 2;
      ctx.globalAlpha = a * 0.8;
      ctx.drawImage(mSpr.glowWarm, p.x - rad, p.y - rad, rad * 2, rad * 2);
    }
    glowOff(ctx);
    ctx.globalAlpha = 1;

    if (ms.t >= 1) {
      meteorBurst(ms.x2, ms.y2, ms.type || M_TYPES[0]);
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
    glowOff(ctx);
  }
}

// แสงวาบตรงจุดระเบิด: โตเร็วแล้วจางแบบ ease-out
function drawFlashes(dt) {
  glowOn(ctx);
  for (let i = mFlashes.length - 1; i >= 0; i--) {
    const f = mFlashes[i];
    f.age += dt;
    const k = f.age / f.life;
    if (k >= 1) { mFlashes.splice(i, 1); continue; }
    const s = f.size * (0.55 + k * 0.8);
    ctx.globalAlpha = (1 - k) * (1 - k);
    ctx.drawImage(mSpr.glowW, f.x - s / 2, f.y - s / 2, s, s);
  }
  glowOff(ctx);
}

function drawDebris(dt) {
  for (let i = mDebris.length - 1; i >= 0; i--) {
    const d = mDebris[i];
    d.age += dt;
    if (d.age >= d.life) { mDebris.splice(i, 1); continue; }
    d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 320 * dt; d.rot += d.vr * dt;
    ctx.globalAlpha = Math.min(1, (1 - d.age / d.life) * 1.6);
    ctx.save();
    ctx.translate(d.x, d.y); ctx.rotate(d.rot);
    ctx.drawImage(d.spr, -d.size / 2, -d.size / 2, d.size, d.size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(dt) {
  ctx.font = "800 22px 'Noto Sans Thai', sans-serif";
  ctx.textAlign = "center";
  // ขอบเข้มด้วย strokeText แทน shadowBlur (ถูกกว่ามากบน WebView)
  ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineJoin = "round";
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.age += dt;
    const t = f.age / f.life;
    if (t >= 1) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - t;
    ctx.strokeText(f.text, f.x, f.y - t * 50);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - t * 50);
  }
  ctx.globalAlpha = 1;
}

function drawParticles(dt) {
  // ประกายไฟ: sprite แสงบวก (แกนขาว+สี) — glowOn ครั้งเดียวทั้งชุด ไม่ save/restore ต่อเม็ด
  glowOn(ctx);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      // ลบแบบสลับกับตัวท้าย (O(1)) — ตัวท้ายถูกวาดไปแล้วในรอบนี้เพราะวนจากท้าย
      particles[i] = particles[particles.length - 1];
      particles.pop();
      mPartFree.push(p);
      continue;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += p.g * dt;
    ctx.globalAlpha = 1 - p.age / p.life;
    const d = p.r * 4;
    ctx.drawImage(p.spr, p.x - d / 2, p.y - d / 2, d, d);
  }
  glowOff(ctx);
}

/* ================= Loop ================= */
function loop(t) {
  if (!running) return;
  const dtMs = t - lastTime;
  const dt = Math.min(dtMs / 1000, 0.05);
  lastTime = t;
  meteorRQ.frame(dtMs, paused);           // อาจลดความละเอียด → resize() → อบภาพใหม่ด้านล่าง
  if (meteorStaticsDirty) meteorBuildStatics();

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
      // สะเก็ดไฟหลุดจากหาง (ตกช้ากว่าลูก → ลอยค้างเป็นทางด้านหลัง)
      if ((m.ember -= dt) <= 0) {
        m.ember = rand(0.045, 0.09);
        mAddParticle(m.x + rand(-0.45, 0.45) * m.r, m.y - m.r * 0.35, rand(-14, 14), m.speed * rand(0.1, 0.35),
                     rand(0.35, 0.7), m.type.spark, rand(1, 2.3), 0);
      }
      if (m.y + m.r * 0.4 >= groundY()) hitGround(m, i);
    }
    mRecoil = Math.max(0, mRecoil - dt * 6);
  }

  drawBackground(paused ? 0 : dt);
  shakeT = Math.max(0, shakeT - dt);
  const shx = shakeT ? (Math.random() * 2 - 1) * 10 * (shakeT / 0.45) : 0;
  const shy = shakeT ? (Math.random() * 2 - 1) * 8 * (shakeT / 0.45) : 0;
  ctx.save();
  ctx.translate(shx, shy);
  drawBase(t);
  drawGroundWarnings(t);
  for (const m of meteors) drawMeteor(m);
  drawMissiles(paused ? 0 : dt);
  drawDebris(paused ? 0 : dt);
  drawParticles(paused ? 0 : dt);
  drawFlashes(paused ? 0 : dt);
  drawRings(paused ? 0 : dt);
  drawFloaters(paused ? 0 : dt);
  ctx.restore();

  requestAnimationFrame(loop);
}
