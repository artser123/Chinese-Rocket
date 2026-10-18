"use strict";
/* ================= Zombie shooter mode (เกมยิงซอมบี้) ================= */
const zcanvas = $("zcanvas");
const zctx = zcanvas.getContext("2d");
const zoptBtns = Array.from(document.querySelectorAll(".zopt"));
// base/ramp/cap = ความเร็วซอมบี้ (px/s) เพิ่มขึ้นตามเวลาที่ผ่านไป, spawn ลดลงตามจำนวนที่ยิงได้
const ZDIFF = {
  easy:   { base: 24, ramp: 0.3,  cap: 110, spawn0: 3.5, spawnDecay: 0.03,  spawnMin: 1.8 },
  medium: { base: 35, ramp: 0.6,  cap: 160, spawn0: 2.9, spawnDecay: 0.04,  spawnMin: 1.3 },
  hard:   { base: 50, ramp: 1.1,  cap: 230, spawn0: 2.4, spawnDecay: 0.055, spawnMin: 0.9 },
};
// weapon tiers — auto-upgrade based on kills
const ZWEAPONS = [
  { id: "bow",     name: "🏹 ธนู",            min: 0,  fire: () => sfx.bowShot(), miss: () => sfx.bowMiss(), burst: 1, bulletColor: "#d4a86a", bulletStyle: "arrow",  explosion: false, shake: 0.10, flash: 0.05 },
  { id: "pistol",  name: "🔫 ปืนสั้น",         min: 11, fire: () => sfx.pistol(),  miss: () => sfx.click1(),  burst: 1, bulletColor: "#ffe66b", bulletStyle: "tracer", explosion: false, shake: 0.18, flash: 0.07 },
  { id: "smg",     name: "🔫 ปืนกลมือ",       min: 21, fire: () => sfx.smg(),     miss: () => sfx.click3(),  burst: 3, bulletColor: "#ffd76a", bulletStyle: "tracer", explosion: false, shake: 0.22, flash: 0.06 },
  { id: "hmg",     name: "🔫 ปืนกลหนัก",      min: 31, fire: () => sfx.hmg(),     miss: () => sfx.click3(),  burst: 3, bulletColor: "#ffaa3a", bulletStyle: "tracer", explosion: false, shake: 0.30, flash: 0.08 },
  { id: "sniper",  name: "🎯 สไนเปอร์ไรเฟิล", min: 41, fire: () => sfx.sniper(),  miss: () => sfx.click1(),  burst: 1, bulletColor: "#ff6a3a", bulletStyle: "tracer", explosion: false, shake: 0.40, flash: 0.10 },
  { id: "grenade", name: "💣 ระเบิดมือ",      min: 51, fire: () => sfx.grenade(), miss: () => sfx.bowMiss(), burst: 1, bulletColor: "#3a3a3a", bulletStyle: "lob",    explosion: true,  shake: 0.45, flash: 0.12 },
  { id: "bazooka", name: "🚀 บาซูก้า",        min: 61, fire: () => sfx.bazooka(), miss: () => sfx.click1(),  burst: 1, bulletColor: "#ff4a2a", bulletStyle: "rocket",  explosion: true,  shake: 0.55, flash: 0.15 },
];
const zWeapon = () => {
  if (!zb) return ZWEAPONS[0];
  let w = ZWEAPONS[0];
  for (const wp of ZWEAPONS) if (zb.kills >= wp.min) w = wp;
  return w;
};
let ZW = 0, ZH = 0;
const zGroundY = () => ($("zombieBar").offsetTop || ZH - 90) - 28;
const zPoliceX = () => Math.max(70, ZW * 0.14);
const zGunTip = () => ({ x: zPoliceX() + 56 - zb.recoil, y: zGroundY() - 75 });
// pre-generate twinkling stars + drifting fog puffs (regenerated on resize)
let zStars = [], zFog = [];
function zRegenAtmosphere() {
  const gy = zGroundY();
  zStars = Array.from({ length: 60 }, () => ({
    x: Math.random() * ZW, y: Math.random() * gy * 0.7,
    r: rand(0.4, 1.6), tw: rand(0, 6.28), sp: rand(1.5, 4),
  }));
  zFog = Array.from({ length: 6 }, () => ({
    x: Math.random() * ZW, y: gy * (0.45 + Math.random() * 0.4),
    r: rand(80, 180), sp: rand(6, 16), a: rand(0.04, 0.1),
  }));
}
function zresize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ZW = window.innerWidth; ZH = window.innerHeight;
  zcanvas.width = Math.floor(ZW * dpr);
  zcanvas.height = Math.floor(ZH * dpr);
  zcanvas.style.width = ZW + "px";
  zcanvas.style.height = ZH + "px";
  zctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  zRegenAtmosphere();
}
window.addEventListener("resize", zresize);
window.addEventListener("orientationchange", () => setTimeout(zresize, 200));
window.addEventListener("resize", () => { if (matching) applyMatchLayout(); });
window.addEventListener("orientationchange", () => { if (matching) setTimeout(applyMatchLayout, 200); });
zresize();

const zombieBestKey = () => `cr_best_${catPrefix()}${currentLevel}_zombie_${difficulty}_${zDuration}`;
function zSpeed() {
  const d = ZDIFF[difficulty];
  return Math.min(d.base + zb.elapsed * d.ramp, d.cap) * Math.max(0.7, ZW / 800);
}
function zSpawnInterval() {
  const d = ZDIFF[difficulty];
  return Math.max(d.spawnMin, d.spawn0 - zb.kills * d.spawnDecay);
}
const zAlive = () => zb.zombies.filter((z) => !z.dead && !z.hit);
const zFirst = (s) => s.split(/[｜|]/)[0].trim();

function startZombieGame(level) {
  currentLevel = level;
  pool = getVocabPool(level);
  if (!pool.length) pool = getVocabPool("1");
  lastStarter = () => startZombieGame(level);
  zresize();
  zb = {
    score: 0, kills: 0, combo: 0, elapsed: 0, timeLeft: zDuration,
    spawnTimer: 0, nextSpawn: 1.0, stunUntil: 0,
    zombies: [], bullets: [], particles: [], floaters: [], options: [],
    walk: 0, scroll: 0, recoil: 0, flash: 0, shake: 0,
    paused: false, ending: false, endTimer: 0, lastTime: performance.now(),
    weaponId: "bow", upgradeFlash: 0, done: new Set(),
  };
  switchScreen($("zombie"));
  $("zPauseOverlay").classList.remove("show");
  updateZombieHUD();
  refreshZOptions();
  renderZOptions();
  stopSpeech();
  music.start("zombie");
  requestAnimationFrame(zloop);
}

function updateZombieHUD() {
  $("zScore").textContent = zb.score;
  $("zKills").textContent = "🧟 " + zb.kills;
  // show current weapon
  const wp = zWeapon();
  if ($("zWeapon")) $("zWeapon").textContent = wp.name;
  // ไม่จำกัดเวลา → แสดงเวลาที่เล่นไปแล้วแทนการนับถอยหลัง
  const t = zDuration ? Math.max(0, Math.ceil(zb.timeLeft)) : Math.floor(zb.elapsed);
  const el = $("zTimer");
  el.textContent = `${zDuration ? "⏱" : "♾️"} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  el.classList.toggle("urgent", !!zDuration && t <= 10);
  $("zProg").textContent = progPct(zb.done.size, pool.length);
}

function spawnZombie() {
  const alive = zAlive();
  if (alive.length >= 4) return;
  // เว้นระยะไม่ให้ซอมบี้ตัวใหม่ซ้อนกับตัวที่เพิ่งออกมา
  if (alive.some((z) => z.x > ZW - 90)) return;
  const usedPinyin = new Set(alive.map((z) => z.word[1]));
  let w = pick(pool), guard = 0;
  while (usedPinyin.has(w[1]) && guard++ < 200) w = pick(pool);
  zb.zombies.push({
    word: w, x: ZW + 40, speed: zSpeed() * rand(0.9, 1.1),
    phase: rand(0, 6.28), hit: false, dead: false, fall: 0,
    scale: rand(0.85, 1.2),
    skin: pick(["#7fc45a", "#6aa84a", "#8fd96b", "#9ec47a"]),
    skinDark: pick(["#4e8f2e", "#3a6a22", "#5a8033"]),
    shirtLight: pick(["#7a5a9a", "#5a3a7a", "#6a4a8a", "#8a6aaa", "#4a5a8a"]),
    shirtDark: pick(["#5a3a7a", "#3a2a5a", "#4a3a6a", "#6a4a8a", "#2a3a6a"]),
  });
}

function refreshZOptions() {
  // ปุ่มพินอิน: ใส่คำของซอมบี้ที่อยู่บนจอก่อน (ตัวที่ใกล้ตำรวจสุดมาก่อน) แล้วเติมตัวหลอก
  const onScreen = zAlive().sort((a, b) => a.x - b.x).map((z) => z.word);
  const chosen = [], used = new Set();
  for (const w of onScreen) {
    if (chosen.length >= 4) break;
    if (!used.has(w[1])) { chosen.push(w); used.add(w[1]); }
  }
  let guard = 0;
  while (chosen.length < 4 && guard++ < 800) {
    const w = pick(pool);
    if (!used.has(w[1])) { chosen.push(w); used.add(w[1]); }
  }
  zb.options = shuffle(chosen);
}

function ensureZPlayable() {
  const active = new Set(zAlive().map((z) => z.word[1]));
  if (active.size && !zb.options.some((w) => active.has(w[1]))) {
    refreshZOptions();
    renderZOptions();
  }
}

function renderZOptions() {
  zoptBtns.forEach((btn, i) => {
    const w = zb.options[i];
    btn.textContent = w ? zFirst(w[1]) : "";
    btn.classList.remove("flash-wrong", "flash-right");
  });
}

function fireZOption(i) {
  if (!zb || zb.paused || zb.ending) return;
  const now = performance.now();
  if (now < zb.stunUntil) return;
  const w = zb.options[i];
  if (!w) return;
  let target = null;
  for (const z of zAlive()) if (z.word[1] === w[1] && (!target || z.x < target.x)) target = z;

  if (target) {
    target.hit = true;
    zb.combo++;
    const distBonus = Math.round(Math.max(0, (target.x - zPoliceX()) / Math.max(ZW, 1)) * 10);
    const pts = 10 + distBonus + Math.min(zb.combo - 1, 5) * 2;
    zb.score += pts;
    zb.kills++;
    zb.done.add(target.word[0]);
    // weapon upgrade check — compare against current equipped weapon
    const newWp = zWeapon();
    if (newWp.id !== zb.weaponId) {
      zb.weaponId = newWp.id;
      zb.upgradeFlash = 1.5;
      sfx.upgrade();
      showToast(`<span class="toast-zh">⬆️ อัปเกรดอาวุธ!</span> <span class="toast-py">${newWp.name}</span>`, "ztoast", 2500);
    }
    const wp = newWp;
    zb.recoil = wp.shake * 50; zb.flash = wp.flash; zb.shake = wp.shake;
    const tip = zGunTip();
    // burst fire for SMG/HMG
    for (let s = 0; s < wp.burst; s++) {
      const delay = s * 70;
      setTimeout(() => {
        if (!zb || zb.ending) return;
        zb.bullets.push({ x: tip.x, y: tip.y + rand(-4, 4), target, color: wp.bulletColor, style: wp.bulletStyle, explosion: wp.explosion });
      }, delay);
    }
    wp.fire();
    // muzzle smoke puffs
    for (let i = 0; i < 5; i++) {
      zb.particles.push({ x: tip.x + rand(-4, 4), y: tip.y + rand(-4, 4), vx: rand(40, 120), vy: rand(-30, -5),
                          life: rand(0.5, 1.0), age: 0, r: rand(6, 12), color: "rgba(180,180,180,0.5)", smoke: true, gravity: false });
    }
    // foot dust under zombie
    const gy = zGroundY();
    for (let i = 0; i < 4; i++) {
      zb.particles.push({ x: target.x + rand(-8, 8), y: gy + rand(-2, 2), vx: rand(-30, 30), vy: rand(-30, -10),
                          life: rand(0.3, 0.6), age: 0, r: rand(2, 4), color: "rgba(120,100,80,0.6)", gravity: true });
    }
    zb.floaters.push({ x: target.x, y: zGroundY() - 135, text: "+" + pts, age: 0, life: 0.9 });
    if (!zb.upgradeFlash) showToast(`<span class="toast-zh">${w[0]}</span> <span class="toast-py">${w[1]}</span> = <span class="toast-th">${w[2]}</span>`, "ztoast", 3000);
    speakWordHit(w);
    zoptBtns[i].classList.add("flash-right");
    setTimeout(() => zoptBtns[i].classList.remove("flash-right"), 250);
    updateZombieHUD();
    refreshZOptions();
    renderZOptions();
  } else {
    // ทายผิด → อาวุธยิงไม่ออก
    const wp = zWeapon();
    zb.combo = 0;
    zb.score = Math.max(0, zb.score - 5);
    zb.stunUntil = now + 500;
    wp.miss();
    zoptBtns[i].classList.add("flash-wrong");
    setTimeout(() => zoptBtns[i].classList.remove("flash-wrong"), 400);
    const wf = $("zWrongFlash");
    wf.classList.remove("hide"); wf.classList.add("show");
    setTimeout(() => { wf.classList.remove("show"); wf.classList.add("hide"); }, 80);
    updateZombieHUD();
  }
}
zoptBtns.forEach((btn, i) => btn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireZOption(i); }));

function killZombie(z) {
  z.dead = true; z.fall = 0;
  sfx.groan();
  const gy = zGroundY();
  // green blood splatter (more, varied)
  for (let i = 0; i < 26; i++) {
    const a = rand(-2.6, 0.4), sp = rand(80, 280);
    zb.particles.push({ x: z.x, y: gy - 85, vx: Math.cos(a) * sp + 40, vy: Math.sin(a) * sp,
                        life: rand(0.4, 0.9), age: 0, r: rand(2, 5.5), color: pick(["#7fc45a", "#4e8f2e", "#a5ff6b", "#3a6a22"]), gravity: true });
  }
  // red blood splatter
  for (let i = 0; i < 10; i++) {
    const a = rand(-2.6, 0.4), sp = rand(60, 200);
    zb.particles.push({ x: z.x, y: gy - 85, vx: Math.cos(a) * sp + 40, vy: Math.sin(a) * sp,
                        life: rand(0.3, 0.7), age: 0, r: rand(1.5, 3.5), color: pick(["#a01010", "#c01818", "#7a0a0a"]), gravity: true });
  }
  // smoke puff at impact
  for (let i = 0; i < 6; i++) {
    zb.particles.push({ x: z.x + rand(-10, 10), y: gy - 85 + rand(-10, 10), vx: rand(-20, 20), vy: rand(-40, -10),
                        life: rand(0.6, 1.2), age: 0, r: rand(8, 16), color: "rgba(120,120,120,0.5)", smoke: true, gravity: false });
  }
}

function zUpdate(dt) {
  zb.recoil = Math.max(0, zb.recoil - dt * 70);
  zb.flash = Math.max(0, zb.flash - dt);
  zb.shake = Math.max(0, zb.shake - dt);
  zb.upgradeFlash = Math.max(0, zb.upgradeFlash - dt);
  if (zb.ending) {
    zb.endTimer -= dt;
    if (zb.endTimer <= 0) zombieGameOver(false);
    return;
  }
  zb.elapsed += dt;
  zb.timeLeft -= dt;
  zb.walk += dt * 7;
  zb.scroll += dt * 70;
  if (zDuration && zb.timeLeft <= 0) { zb.timeLeft = 0; updateZombieHUD(); zombieGameOver(true); return; }

  zb.spawnTimer += dt;
  if (zb.spawnTimer >= zb.nextSpawn) {
    zb.spawnTimer = 0;
    zb.nextSpawn = zSpawnInterval();
    spawnZombie();
    ensureZPlayable();
  }

  const px = zPoliceX();
  const moving = zAlive().sort((a, b) => a.x - b.x);
  moving.forEach((z, i) => {
    z.x -= z.speed * dt;
    z.phase += dt * 6;
    // ซอมบี้ตัวหลังวิ่งเร็วกว่า → ไม่ให้แซงซ้อนตัวหน้า
    if (i > 0) z.x = Math.max(z.x, moving[i - 1].x + 64);
    if (z.x - 30 <= px + 22) {
      zb.ending = true; zb.endTimer = 0.8; zb.shake = 0.5;
      sfx.damage();
      const wf = $("zWrongFlash");
      wf.classList.remove("hide"); wf.classList.add("show");
    }
  });
  for (let i = zb.zombies.length - 1; i >= 0; i--) {
    const z = zb.zombies[i];
    if (z.dead && (z.fall += dt) > 0.7) zb.zombies.splice(i, 1);
  }
  for (let i = zb.bullets.length - 1; i >= 0; i--) {
    const b = zb.bullets[i];
    b.x += 2400 * dt;
    if (b.x >= b.target.x - 10) {
      if (b.explosion) {
        // big explosion at impact
        const gy = zGroundY();
        for (let j = 0; j < 40; j++) {
          const a = rand(-3.14, 3.14), sp = rand(100, 400);
          zb.particles.push({ x: b.target.x, y: gy - 85, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                              life: rand(0.5, 1.2), age: 0, r: rand(3, 8), color: pick(["#ff6a3a", "#ffaa3a", "#ff4a2a", "#ffd76a"]), gravity: true });
        }
        for (let j = 0; j < 12; j++) {
          zb.particles.push({ x: b.target.x + rand(-20, 20), y: gy - 85 + rand(-20, 20), vx: rand(-40, 40), vy: rand(-60, -10),
                              life: rand(0.8, 1.5), age: 0, r: rand(12, 24), color: "rgba(120,120,120,0.6)", smoke: true, gravity: false });
        }
        zb.shake = Math.max(zb.shake, 0.5);
      }
      killZombie(b.target); zb.bullets.splice(i, 1);
    }
  }
  for (let i = zb.particles.length - 1; i >= 0; i--) {
    const p = zb.particles[i];
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.gravity) p.vy += 500 * dt;
    if (p.smoke) { p.vx *= 0.96; p.vy *= 0.96; p.r += 8 * dt; }
    if (p.age >= p.life) zb.particles.splice(i, 1);
  }
  for (let i = zb.floaters.length - 1; i >= 0; i--) {
    const f = zb.floaters[i];
    f.age += dt; f.y -= 45 * dt;
    if (f.age >= f.life) zb.floaters.splice(i, 1);
  }
  updateZombieHUD();
}

function zRoundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
  c.fill();
}

function zDrawBackground(c) {
  const gy = zGroundY();
  // sky gradient (deeper, duskier)
  const g = c.createLinearGradient(0, 0, 0, gy);
  g.addColorStop(0, "#05070f"); g.addColorStop(0.55, "#1a1130"); g.addColorStop(1, "#3a1626");
  c.fillStyle = g; c.fillRect(0, 0, ZW, ZH);

  // stars (twinkle)
  for (const s of zStars) {
    s.tw += 0.05;
    c.globalAlpha = 0.5 + Math.sin(s.tw) * 0.4;
    c.fillStyle = "#e8e6ff";
    c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.28); c.fill();
  }
  c.globalAlpha = 1;

  // moon with glow halo
  const mx = ZW * 0.8, my = gy * 0.22;
  const halo = c.createRadialGradient(mx, my, 8, mx, my, 70);
  halo.addColorStop(0, "rgba(243,233,184,0.45)"); halo.addColorStop(1, "rgba(243,233,184,0)");
  c.fillStyle = halo; c.beginPath(); c.arc(mx, my, 70, 0, 6.28); c.fill();
  c.fillStyle = "#f3e9b8"; c.beginPath(); c.arc(mx, my, 26, 0, 6.28); c.fill();
  c.fillStyle = "#e0d6a5"; c.beginPath(); c.arc(mx - 8, my - 6, 5, 0, 6.28); c.arc(mx + 9, my + 8, 4, 0, 6.28); c.fill();

  // far buildings (parallax) — two layers for depth
  const par = zb.scroll * 0.25, off = par % 160;
  for (let x = -off - 160; x < ZW + 160; x += 160) {
    const k = Math.round((x + par) / 160);
    const h = 50 + ((k * 37) % 7) * 16, bw = 110 + ((k * 11) % 3) * 12;
    c.fillStyle = "#11142a"; c.fillRect(x, gy - h, bw, h);
    c.fillStyle = "#c9b458";
    let wi = 0;
    for (let wy = gy - h + 10; wy < gy - 14; wy += 16)
      for (let wx = 0; wx < bw - 20; wx += 18) {
        if (((k * 13 + wi++) % 5) === 0) c.fillRect(x + 10 + wx, wy, 7, 8);
      }
  }
  // near buildings (faster parallax, darker)
  const par2 = zb.scroll * 0.5, off2 = par2 % 220;
  for (let x = -off2 - 220; x < ZW + 220; x += 220) {
    const k = Math.round((x + par2) / 220);
    const h = 80 + ((k * 53) % 5) * 22, bw = 150 + ((k * 17) % 3) * 18;
    c.fillStyle = "#0a0c1a"; c.fillRect(x, gy - h, bw, h);
    c.fillStyle = "#ffd76a";
    let wi = 0;
    for (let wy = gy - h + 14; wy < gy - 18; wy += 20)
      for (let wx = 0; wx < bw - 28; wx += 24) {
        if (((k * 23 + wi++) % 4) === 0) c.fillRect(x + 14 + wx, wy, 8, 10);
      }
  }

  // drifting fog
  for (const f of zFog) {
    f.x -= f.sp * 0.016;
    if (f.x < -f.r) f.x = ZW + f.r;
    const fg = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    fg.addColorStop(0, `rgba(180,180,210,${f.a})`); fg.addColorStop(1, "rgba(180,180,210,0)");
    c.fillStyle = fg; c.beginPath(); c.arc(f.x, f.y, f.r, 0, 6.28); c.fill();
  }

  // fence / grass edge
  c.fillStyle = "#2f4a24"; c.fillRect(0, gy - 6, ZW, 8);
  // road with subtle gradient
  const rg = c.createLinearGradient(0, gy, 0, ZH);
  rg.addColorStop(0, "#1b1f2c"); rg.addColorStop(1, "#0d0f18");
  c.fillStyle = rg; c.fillRect(0, gy, ZW, ZH - gy);
  const off3 = zb.scroll % 90;
  c.fillStyle = "#5a5a40";
  for (let x = -off3; x < ZW; x += 90) c.fillRect(x, gy + 18, 44, 4);

  // vignette (dark edges)
  const vg = c.createRadialGradient(ZW / 2, ZH / 2, Math.min(ZW, ZH) * 0.35, ZW / 2, ZH / 2, Math.max(ZW, ZH) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
  c.fillStyle = vg; c.fillRect(0, 0, ZW, ZH);
}

function zDrawPolice(c) {
  const x = zPoliceX(), y = zGroundY();
  const swing = zb.ending ? 0 : Math.sin(zb.walk);
  // ground shadow
  c.save();
  c.fillStyle = "rgba(0,0,0,0.45)";
  c.beginPath(); c.ellipse(x, y + 2, 26, 6, 0, 0, 6.28); c.fill();
  c.translate(x, y);
  // rim light ด้านหลังตัว ให้ silhouette ตำรวจหลุดจากฉากหลัง
  c.save();
  c.globalCompositeOperation = "lighter";
  c.fillStyle = "rgba(120,170,255,.16)";
  zRoundRect(c, -16, -86, 32, 44, 8);
  c.beginPath(); c.arc(0, -98, 13.6, 0, 6.28); c.fill();
  c.restore();
  c.lineCap = "round";
  // legs (with shading) — เงาใต้ขาให้ตัวอิงพื้น ไม่ลอย
  c.save();
  c.shadowColor = "rgba(0,0,0,.55)";
  c.shadowBlur = 10;
  c.shadowOffsetY = 2;
  const lg = c.createLinearGradient(-8, -46, -8, -5);
  lg.addColorStop(0, "#2a3a8b"); lg.addColorStop(1, "#141d52");
  c.strokeStyle = lg; c.lineWidth = 9;
  c.beginPath(); c.moveTo(-4, -46); c.lineTo(-4 + swing * 12, -5); c.moveTo(4, -46); c.lineTo(4 - swing * 12, -5); c.stroke();
  c.fillStyle = "#0a0a0a"; c.fillRect(-4 + swing * 12 - 7, -6, 16, 6); c.fillRect(4 - swing * 12 - 7, -6, 16, 6);
  c.restore();
  // back arm
  c.strokeStyle = "#2a45b8"; c.lineWidth = 8;
  c.beginPath(); c.moveTo(-8, -76); c.lineTo(-16, -52); c.stroke();
  // torso with vertical gradient + belt
  const tg = c.createLinearGradient(-14, -84, 14, -44);
  tg.addColorStop(0, "#3a55c8"); tg.addColorStop(1, "#1e2f88");
  c.fillStyle = tg; zRoundRect(c, -14, -84, 28, 40, 6);
  // belt
  c.fillStyle = "#1a1a1a"; c.fillRect(-14, -50, 28, 5);
  c.fillStyle = "#ffd23c"; c.fillRect(-3, -50, 6, 5); // buckle
  // badge
  c.fillStyle = "#ffd23c"; c.beginPath(); c.arc(-6, -74, 3, 0, 6.28); c.fill();
  c.fillStyle = "#b8860b"; c.beginPath(); c.arc(-6, -74, 1.4, 0, 6.28); c.fill();
  // head (skin gradient) + face
  const hg = c.createRadialGradient(-2, -100, 2, 0, -98, 13);
  hg.addColorStop(0, "#f7d2a8"); hg.addColorStop(1, "#e0b07a");
  c.fillStyle = hg; c.beginPath(); c.arc(0, -98, 12, 0, 6.28); c.fill();
  // eyes
  c.fillStyle = "#222"; c.beginPath(); c.arc(-4, -99, 1.6, 0, 6.28); c.arc(4, -99, 1.6, 0, 6.28); c.fill();
  // mouth (determined)
  c.strokeStyle = "#7a4a2a"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-4, -93); c.lineTo(4, -93); c.stroke();
  // cap with badge
  c.fillStyle = "#1e2a6b"; c.fillRect(-13, -112, 26, 9); c.fillRect(-2, -106, 20, 4);
  c.fillStyle = "#ffd23c"; c.fillRect(-3, -111, 6, 6);
  c.fillStyle = "#b8860b"; c.beginPath(); c.arc(0, -108, 1.5, 0, 6.28); c.fill();
  // front arm holding weapon (with recoil) — weapon-specific drawing
  const r = zb.recoil;
  const wp = zWeapon();
  c.strokeStyle = "#2a45b8"; c.lineWidth = 8;
  c.beginPath(); c.moveTo(6, -76); c.lineTo(30 - r, -73); c.stroke();
  // hand
  c.fillStyle = "#f1c48f"; c.beginPath(); c.arc(31 - r, -73, 5, 0, 6.28); c.fill();
  // weapon body — different per tier
  c.fillStyle = "#1a1a1a";
  if (wp.id === "bow") {
    // bow — arc + string
    c.strokeStyle = "#8b6a3a"; c.lineWidth = 3;
    c.beginPath(); c.arc(40 - r, -73, 18, -1.2, 1.2); c.stroke();
    c.strokeStyle = "#ddd"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(40 - r + 18 * Math.cos(-1.2), -73 + 18 * Math.sin(-1.2)); c.lineTo(40 - r + 18 * Math.cos(1.2), -73 + 18 * Math.sin(1.2)); c.stroke();
    // arrow nocked
    c.strokeStyle = "#d4a86a"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(30 - r, -73); c.lineTo(58 - r, -73); c.stroke();
  } else if (wp.id === "pistol") {
    c.fillRect(30 - r, -79, 28, 7); c.fillRect(32 - r, -73, 7, 11);
    c.strokeStyle = "#2a2a2a"; c.lineWidth = 2; c.beginPath(); c.arc(36 - r, -70, 4, 0, 3.14); c.stroke();
  } else if (wp.id === "smg") {
    c.fillRect(30 - r, -80, 34, 8); c.fillRect(34 - r, -72, 8, 14);
    c.fillStyle = "#333"; c.fillRect(30 - r, -84, 18, 4); // magazine
  } else if (wp.id === "hmg") {
    c.fillRect(30 - r, -82, 44, 10); c.fillRect(36 - r, -72, 10, 16);
    c.fillStyle = "#444"; c.fillRect(30 - r, -86, 22, 6);
    c.fillStyle = "#222"; c.fillRect(46 - r, -88, 30, 4); // barrel
  } else if (wp.id === "sniper") {
    c.fillRect(30 - r, -78, 50, 6); c.fillRect(34 - r, -72, 8, 14);
    c.fillStyle = "#333"; c.fillRect(40 - r, -84, 24, 4); // scope
    c.fillStyle = "#222"; c.fillRect(70 - r, -79, 20, 3); // long barrel
  } else if (wp.id === "grenade") {
    // throwing arm — no weapon drawn, just hand
    c.fillStyle = "#3a3a3a"; c.beginPath(); c.arc(34 - r, -74, 5, 0, 6.28); c.fill();
    c.fillStyle = "#5a5a5a"; c.beginPath(); c.arc(34 - r, -74, 3, 0, 6.28); c.fill();
  } else if (wp.id === "bazooka") {
    c.fillStyle = "#3a3a3a"; c.fillRect(30 - r, -80, 50, 12);
    c.fillStyle = "#5a5a5a"; c.fillRect(34 - r, -76, 12, 8); // grip
    c.fillStyle = "#222"; c.fillRect(70 - r, -78, 16, 8); // muzzle
  }
  // muzzle flash + light cone
  if (zb.flash > 0) {
    const fa = zb.flash / 0.07;
    // light cone toward zombies
    c.globalAlpha = fa * 0.35;
    const cone = c.createRadialGradient(60 - r, -75, 4, 60 - r, -75, 120);
    cone.addColorStop(0, "rgba(255,230,107,0.9)"); cone.addColorStop(1, "rgba(255,230,107,0)");
    c.fillStyle = cone;
    c.beginPath(); c.moveTo(60 - r, -75); c.lineTo(60 - r + 120, -95); c.lineTo(60 - r + 120, -55); c.closePath(); c.fill();
    c.globalAlpha = fa;
    c.fillStyle = "#ffe66b";
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28, rad = i % 2 ? 6 : 15;
      c.lineTo(60 - r + Math.cos(a) * rad, -75 + Math.sin(a) * rad);
    }
    c.closePath(); c.fill();
    c.globalAlpha = 1;
  }
  c.restore();
}

function zDrawZombie(c, z) {
  const gy = zGroundY();
  // ground shadow
  c.save();
  c.fillStyle = "rgba(0,0,0,0.4)";
  c.beginPath(); c.ellipse(z.x, gy + 2, 22 * z.scale, 5, 0, 0, 6.28); c.fill();
  c.translate(z.x, gy);
  if (z.dead) {
    const k = Math.min(1, z.fall / 0.5);
    c.globalAlpha = 1 - Math.max(0, (z.fall - 0.3) / 0.4);
    c.rotate(k * 1.5);   // ล้มหงายไปทางขวา
  }
  c.scale(z.scale, z.scale);
  const bob = Math.sin(z.phase) * 3, swing = Math.sin(z.phase);
  c.lineCap = "round";
  // เงาหลักด้านหลังตัว (fallback ให้ silhouette หลุดจากพื้นหลังถ้าพื้นหลังสว่าง)
  c.save();
  c.shadowColor = "rgba(0,0,0,.55)"; c.shadowBlur = 14;
  c.fillStyle = "rgba(0,0,0,.01)";
  zRoundRect(c, -15, -82 + bob, 30, 40, 6);
  c.restore();
  // legs (shaded)
  const lg = c.createLinearGradient(0, -44, 0, -5);
  lg.addColorStop(0, "#4a6a36"); lg.addColorStop(1, "#2a401c");
  c.strokeStyle = lg; c.lineWidth = 9;
  c.beginPath(); c.moveTo(-4, -44); c.lineTo(-4 - swing * 10, -5); c.moveTo(4, -44); c.lineTo(4 + swing * 10, -5); c.stroke();
  c.fillStyle = "#1a1a1a"; c.fillRect(-4 - swing * 10 - 6, -6, 14, 5); c.fillRect(4 + swing * 10 - 6, -6, 14, 5);
  // torso (torn shirt) with gradient
  const tg = c.createLinearGradient(-15, -82 + bob, 15, -42 + bob);
  tg.addColorStop(0, z.shirtLight); tg.addColorStop(1, z.shirtDark);
  c.fillStyle = tg; zRoundRect(c, -15, -82 + bob, 30, 40, 6);
  // exposed flesh patches
  c.fillStyle = "#7fc45a"; c.fillRect(-15, -50 + bob, 8, 8); c.fillRect(4, -56 + bob, 9, 6);
  // arms reaching left toward the police (shaded)
  c.strokeStyle = z.skin; c.lineWidth = 7;
  c.beginPath();
  c.moveTo(-8, -74 + bob); c.lineTo(-34, -70 + bob + swing * 3);
  c.moveTo(-8, -64 + bob); c.lineTo(-32, -57 + bob - swing * 3);
  c.stroke();
  // clawed fingers
  c.strokeStyle = z.skinDark; c.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    c.beginPath(); c.moveTo(-34, -70 + bob + swing * 3 + i * 2); c.lineTo(-40, -72 + bob + swing * 3 + i * 2); c.stroke();
    c.beginPath(); c.moveTo(-32, -57 + bob - swing * 3 + i * 2); c.lineTo(-38, -59 + bob - swing * 3 + i * 2); c.stroke();
  }
  // head (skin gradient)
  const hg = c.createRadialGradient(-3, -98 + bob, 2, 0, -96 + bob, 15);
  hg.addColorStop(0, z.skin); hg.addColorStop(1, z.skinDark);
  c.fillStyle = hg; c.beginPath(); c.arc(0, -96 + bob, 14, 0, 6.28); c.fill();
  // rim light: ขอบเรืองแสงด้านซ้าย (เหมือนแสงจันทร์ส่องข้างหลัง) ให้หัวหลุดจากฉากหลัง
  c.save();
  c.globalCompositeOperation = "lighter";
  c.strokeStyle = "rgba(150,235,150,.5)";
  c.lineWidth = 2;
  c.beginPath(); c.arc(0, -96 + bob, 13.2, Math.PI * 0.6, Math.PI * 1.75); c.stroke();
  c.restore();
  // messy hair
  c.fillStyle = "#2d4a1c"; c.fillRect(-12, -111 + bob, 20, 6);
  c.strokeStyle = "#2d4a1c"; c.lineWidth = 2;
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-10 + i * 5, -111 + bob); c.lineTo(-12 + i * 5, -116 + bob); c.stroke(); }
  // glowing red eyes
  c.shadowColor = "#ff2020"; c.shadowBlur = 8;
  c.fillStyle = "#ff3b3b"; c.beginPath(); c.arc(-6, -98 + bob, 2.6, 0, 6.28); c.arc(2, -99 + bob, 2.6, 0, 6.28); c.fill();
  c.shadowBlur = 0;
  // fangs + bloody mouth
  c.fillStyle = "#3a0a0a"; c.fillRect(-10, -90 + bob, 11, 3);
  c.fillStyle = "#fff";
  c.beginPath(); c.moveTo(-8, -88 + bob); c.lineTo(-7, -84 + bob); c.lineTo(-6, -88 + bob); c.fill();
  c.beginPath(); c.moveTo(-2, -88 + bob); c.lineTo(-1, -84 + bob); c.lineTo(0, -88 + bob); c.fill();
  // blood drip
  c.fillStyle = "#a01010"; c.fillRect(-7, -84 + bob, 1.5, 4);
  // Chinese word above the head
  if (!z.dead) {
    const text = zFirst(z.word[0]);
    const fs = text.length > 3 ? 22 : text.length > 2 ? 27 : 34;
    c.font = `800 ${fs}px "Noto Sans SC", sans-serif`;
    const tw = c.measureText(text).width, bw = tw + 24, bh = fs + 16, by = -120 + bob - bh;
    // speech bubble with shadow
    c.shadowColor = "rgba(0,0,0,0.4)"; c.shadowBlur = 6; c.shadowOffsetY = 2;
    c.fillStyle = "rgba(255,255,255,.96)";
    zRoundRect(c, -bw / 2, by, bw, bh, 10);
    c.beginPath(); c.moveTo(-6, by + bh - 1); c.lineTo(6, by + bh - 1); c.lineTo(0, by + bh + 7); c.fill();
    c.shadowBlur = 0; c.shadowOffsetY = 0;
    textShadowOn(c, 0, "transparent");
    c.fillStyle = "#1a1a1a"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(text, 0, by + bh / 2 + 1);
    // ขอบตัวอักษรเรืองแสง (rim light) จากด้านบน ให้ตัวอักษรดูมีมิติ ไม่แบนติดบับเบิล
    c.save();
    c.globalCompositeOperation = "lighter";
    c.strokeStyle = "rgba(140,200,255,.35)";
    c.lineWidth = 1.2;
    c.strokeText(text, 0, by + bh / 2);
    c.restore();
    textShadowOff(c);
  }
  c.restore();
}

function zDraw() {
  const c = zctx;
  zDrawBackground(c);
  const shx = zb.shake ? (Math.random() * 2 - 1) * 14 * (zb.shake / 0.5) : 0;
  const shy = zb.shake ? (Math.random() * 2 - 1) * 10 * (zb.shake / 0.5) : 0;
  c.save(); c.translate(shx, shy);
  // ตัวที่ล้มวาดก่อนเพื่อให้อยู่หลังตัวที่ยังเดินอยู่
  [...zb.zombies].sort((a, b) => (a.dead ? -1 : 1) - (b.dead ? -1 : 1)).forEach((z) => zDrawZombie(c, z));
  zDrawPolice(c);
  const tip = zGunTip();
  // bullet tracers (weapon-specific styles)
  c.lineCap = "round";
  for (const b of zb.bullets) {
    const col = b.color || "#ffe66b";
    const style = b.style || "tracer";
    c.globalAlpha = 0.9;
    glowOn(c);   // หัวกระสุน/แสง trail เป็นแสงบวก ให้ดูเป็นกระสุนเรืองแสง
    if (style === "arrow") {
      c.strokeStyle = col; c.lineWidth = 2;
      c.beginPath(); c.moveTo(Math.max(tip.x, b.x - 80), b.y); c.lineTo(b.x, b.y); c.stroke();
      c.fillStyle = col;
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - 8, b.y - 4); c.lineTo(b.x - 8, b.y + 4); c.closePath(); c.fill();
    } else if (style === "lob") {
      const dist = b.target.x - tip.x;
      const progress = Math.min(1, (b.x - tip.x) / Math.max(dist, 1));
      const arcY = b.y - Math.sin(progress * 3.14) * 80;
      c.fillStyle = col; c.beginPath(); c.arc(b.x, arcY, 6, 0, 6.28); c.fill();
      c.strokeStyle = "rgba(120,120,120,0.4)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(tip.x, b.y); c.quadraticCurveTo(tip.x + dist / 2, b.y - 80, b.x, arcY); c.stroke();
    } else if (style === "rocket") {
      c.strokeStyle = "rgba(255,170,80,0.6)"; c.lineWidth = 5;
      c.beginPath(); c.moveTo(Math.max(tip.x, b.x - 100), b.y); c.lineTo(b.x, b.y); c.stroke();
      c.fillStyle = col; c.fillRect(b.x - 12, b.y - 4, 16, 8);
      c.fillStyle = "#ffd76a"; c.beginPath(); c.arc(b.x - 12, b.y, 3, 0, 6.28); c.fill();
      for (let j = 0; j < 3; j++) {
        zb.particles.push({ x: b.x - 12 + rand(-4, 4), y: b.y + rand(-3, 3), vx: rand(-80, -40), vy: rand(-10, 10),
                            life: rand(0.2, 0.4), age: 0, r: rand(3, 6), color: pick(["#ff6a3a", "#ffaa3a", "#ffd76a"]), gravity: false });
      }
    } else {
      c.strokeStyle = col; c.lineWidth = 3;
      c.beginPath(); c.moveTo(Math.max(tip.x, b.x - 60), b.y); c.lineTo(b.x, b.y); c.stroke();
      c.globalAlpha = 0.4; c.lineWidth = 7;
      c.beginPath(); c.moveTo(Math.max(tip.x, b.x - 60), b.y); c.lineTo(b.x, b.y); c.stroke();
      c.globalAlpha = 0.9;
    }
    glowOff(c);
  }
  c.globalAlpha = 1;
  // particles (smoke uses radial gradient, others solid)
  for (const p of zb.particles) {
    const a = 1 - p.age / p.life;
    c.globalAlpha = a;
    if (p.smoke) {
      const sg = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      sg.addColorStop(0, `rgba(180,180,180,${a * 0.5})`); sg.addColorStop(1, "rgba(180,180,180,0)");
      c.fillStyle = sg; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.28); c.fill();
    } else {
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.28); c.fill();
    }
  }
  c.globalAlpha = 1;
  bloom(canvas, c, ZW, ZH);   // Bloom ปลอม: ปากกระบอก/ระเบิด/rocket trail จะฟุ้งเป็นแสง
  c.font = "800 22px 'Noto Sans Thai', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
  for (const f of zb.floaters) {
    c.globalAlpha = 1 - f.age / f.life;
    textShadowOn(c, 6);
    c.fillStyle = "#ffd76a";
    c.fillText(f.text, f.x, f.y);
    textShadowOff(c);
  }
  c.globalAlpha = 1;
  c.restore();

  // red danger flash when a zombie is close to the police
  const closest = zAlive().reduce((m, z) => Math.min(m, z.x - zPoliceX()), Infinity);
  if (closest < 180) {
    const intensity = Math.max(0, 1 - closest / 180);
    c.fillStyle = `rgba(180,20,20,${0.35 * intensity})`;
    c.fillRect(0, 0, ZW, ZH);
  }
  // red flash on ending (zombie reached player)
  if (zb.ending) {
    c.fillStyle = "rgba(200,0,0,0.5)";
    c.fillRect(0, 0, ZW, ZH);
  }

  // color grading (cool dusk tint)
  const grade = c.createLinearGradient(0, 0, 0, ZH);
  grade.addColorStop(0, "rgba(40,20,80,0.12)"); grade.addColorStop(1, "rgba(80,20,40,0.12)");
  c.fillStyle = grade; c.fillRect(0, 0, ZW, ZH);

  // CRT scanlines (subtle)
  c.globalAlpha = 0.06; c.fillStyle = "#000";
  for (let y = 0; y < ZH; y += 3) c.fillRect(0, y, ZW, 1);
  c.globalAlpha = 1;

  // weapon upgrade flash (golden glow)
  if (zb.upgradeFlash > 0) {
    const ua = zb.upgradeFlash / 1.5;
    c.globalAlpha = ua * 0.3;
    const ug = c.createRadialGradient(ZW / 2, ZH / 2, 0, ZW / 2, ZH / 2, Math.max(ZW, ZH) * 0.6);
    ug.addColorStop(0, "rgba(255,215,106,0.8)"); ug.addColorStop(1, "rgba(255,215,106,0)");
    c.fillStyle = ug; c.fillRect(0, 0, ZW, ZH);
    c.globalAlpha = 1;
  }
}

function zloop(t) {
  if (!zb) return;
  const dt = Math.min((t - zb.lastTime) / 1000, 0.05);
  zb.lastTime = t;
  if (!zb.paused) zUpdate(dt);
  if (!zb) return;
  zDraw();
  requestAnimationFrame(zloop);
}

function zombieGameOver(win) {
  const s = zb;
  zb = null;
  music.stop();
  stopSpeech();
  $("zWrongFlash").classList.remove("show");
  if (win) sfx.hit(); else sfx.over();
  showGameOver(win ? "🏆 รอดแล้ว! หมดเวลา" : "🧟 ซอมบี้ถึงตัวแล้ว!", s.score,
    `ยิงซอมบี้ ${s.kills} ตัว • ${levelDisplayName(currentLevel)} • ${DIFF[difficulty].label} • ${zDurLabel()}`,
    zombieBestKey());
}

$("zPauseBtn").addEventListener("click", () => {
  if (!zb || zb.paused) return;
  zb.paused = true;
  sfx.click();
  $("zPauseOverlay").classList.add("show");
});
$("zResumeBtn").addEventListener("click", () => {
  if (!zb) return;
  zb.paused = false;
  zb.lastTime = performance.now();
  sfx.click();
  $("zPauseOverlay").classList.remove("show");
});
$("zQuitBtn").addEventListener("click", () => {
  sfx.click();
  if (zb) saveBest(zombieBestKey(), zb.score);
  zb = null;
  music.stop();
  stopSpeech();
  $("zPauseOverlay").classList.remove("show");
  $("zWrongFlash").classList.remove("show");
  switchScreen(menuEl);
  updateBestLine();
});
$("zMuteBtn").addEventListener("click", () => toggleMute());

