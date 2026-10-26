"use strict";
/* ================= Zombie shooter mode (เกมยิงซอมบี้) ================= */
const zcanvas = $("zcanvas");
const zctx = zcanvas.getContext("2d");
const zoptBtns = Array.from(document.querySelectorAll(".zopt"));
// base/ramp/cap = ความเร็วซอมบี้ (px/s) เพิ่มขึ้นตามเวลาที่ผ่านไป, spawn ลดลงตามจำนวนที่ยิงได้
// ต.ค. 2026: ลดความเร็ววิ่ง ~30% ทุกระดับ (base/ramp/cap ปรับตามสัดส่วน) ให้เล่นได้นานขึ้น
const ZDIFF = {
  easy:   { base: 17, ramp: 0.2,  cap: 78,  spawn0: 3.5, spawnDecay: 0.03,  spawnMin: 1.8 },
  medium: { base: 25, ramp: 0.4,  cap: 112, spawn0: 2.9, spawnDecay: 0.04,  spawnMin: 1.3 },
  hard:   { base: 35, ramp: 0.75, cap: 160, spawn0: 2.4, spawnDecay: 0.055, spawnMin: 0.9 },
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
// แคช offsetTop ไว้ (ล้างตอน zresize) — เดิมอ่านสดหลายครั้งต่อเฟรม หลัง HUD เขียน DOM
// ทุกเฟรม จึงบังคับ layout ทั้งหน้าแบบ synchronous ทุกเฟรม (เกมอุกกาบาตไม่มีปัญหานี้
// เพราะ updateHUD ไม่ได้ถูกเรียกทุกเฟรม) ถ้าจอยังซ่อนอยู่ offsetTop = 0 → ใช้ค่าสำรอง ไม่แคช
let zGyCache = 0;
const zGroundY = () => {
  if (zGyCache) return zGyCache;
  const top = $("zombieBar").offsetTop;
  if (!top) return ZH - 90 - 28;
  return (zGyCache = top - 28);
};
const zPoliceX = () => Math.max(70, ZW * 0.14);
const zGunTip = () => ({ x: zPoliceX() + 56 - zb.recoil, y: zGroundY() - 75 });
// pre-generate twinkling stars + drifting fog puffs (regenerated on resize)
// ดาวส่วนใหญ่ถูกอบไว้ในภาพท้องฟ้า (zSkyLayer) แล้ว — ที่นี่เหลือแค่ดวงที่กะพริบสด
let zStars = [], zFog = [];
function zRegenAtmosphere() {
  const gy = zGroundY();
  zStars = Array.from({ length: 16 }, () => ({
    x: Math.random() * ZW, y: Math.random() * gy * 0.7,
    r: rand(0.4, 1.6), tw: rand(0, 6.28), sp: rand(1.5, 4),
  }));
  zFog = Array.from({ length: 6 }, () => ({
    x: Math.random() * ZW, y: gy * (0.45 + Math.random() * 0.4),
    r: rand(80, 180), sp: rand(6, 16), a: rand(0.04, 0.1),
  }));
}
/* ---- ความละเอียดที่ใช้วาด (ต.ค. 2026 รอบ 4: APK ยังกระตุกทั้งมือถือและแท็บเล็ต) ----
   เกมนี้ติดที่ fill-rate ของ GPU มือถือ: ทุกเฟรมมีการวาดเต็มจอหลายชั้น ต้นทุนจึงสเกลตามจำนวนพิกเซล
   ของ canvas — เดิม DPR สูงสุด 2 → แท็บเล็ต 1280×800 = 4.1 ล้าน px ต่อชั้น. ตอนนี้ใช้
   makeRenderQuality() ที่ใช้ร่วมกับเกมอุกกาบาต (03-helpers.js: DPR ≤ 1.5 + งบพิกเซลรวม
   + ลดคุณภาพเองถ้าเครื่องวาดไม่ทัน จำไว้ใน cr_zombie_quality) */
const zRQ = makeRenderQuality("cr_zombie_quality", () => zresize());
let zScale = 1;
function zresize() {
  ZW = window.innerWidth; ZH = window.innerHeight;
  zScale = zRQ.scale(ZW, ZH);
  zcanvas.width = Math.floor(ZW * zScale);
  zcanvas.height = Math.floor(ZH * zScale);
  zcanvas.style.width = ZW + "px";
  zcanvas.style.height = ZH + "px";
  zctx.setTransform(zScale, 0, 0, zScale, 0, 0);
  zGyCache = 0;
  zRegenAtmosphere();
  zBuildStatics();
}
window.addEventListener("resize", zresize);
window.addEventListener("orientationchange", () => setTimeout(zresize, 200));
window.addEventListener("resize", () => { if (matching) applyMatchLayout(); });
window.addEventListener("orientationchange", () => { if (matching) setTimeout(applyMatchLayout, 200); });

/* ---- ทรัพยากรที่คงที่ตามขนาดจอ (สร้างใหม่เฉพาะตอน zresize) ----
   เดิมวาดพื้นหลังสร้าง gradient ทั้งหมดใหม่ "ทุกเฟรม" และเส้น scanline CRT
   เป็น fillRect ~ZH/3 ครั้งต่อเฟรม — จอใหญ่ (แท็บเล็ต ~4.9 ล้าน px) จึงกระตุก
   ฝั่งโทรศัพท์จอเล็กไม่รู้สึก เพราะต้นทุนทั้งหมดสเกลตามพื้นที่จอ */
/* ต.ค. 2026 รอบ 3: ฉากหลังทั้งหมดอบเป็นภาพ (layer) ครั้งเดียวตอน resize
   - zSkyLayer: ท้องฟ้า + แสงเมืองที่ขอบฟ้า + ดาว + ดวงจันทร์มีหลุม + เมฆบางพาดจันทร์
   - zFarStrip / zNearStrip: แถบตึกที่ต่อกันได้ไม่มีรอยต่อ (หน้าต่างหลายสี เสาอากาศ แท็งก์น้ำ
     ป้ายนีออนตัวจีน เสาไฟพร้อมลำแสง) — ต่อเฟรมแค่ drawImage 2–3 ครั้งต่อเลเยอร์
   - zGroundStrip: ขอบหญ้า ขอบทาง ถนนมีเม็ดกรวด/รอยแตก/แอ่งน้ำสะท้อนจันทร์ + เส้นถนน (เลื่อนทั้งแถบ)
   - zGradeLayer: vignette + color grade รวมเป็นภาพครึ่งความละเอียด (gradient นุ่ม ขยายได้ไม่แตก)
   เดิมต่อเฟรม = gradient 3 ชั้นเต็มจอ + ดาว 60 ดวง + path หน้าต่างตึก — ตอนนี้รายละเอียดมากขึ้นแต่ถูกกว่า
   ห้ามย้ายการวาดรายละเอียดเหล่านี้กลับไปไว้ในลูปต่อเฟรม */
let zSkyLayer = null, zFarStrip = null, zNearStrip = null, zGroundStrip = null, zGradeLayer = null;
let zFogSprite = null, zSmokeSprite = null, zGlowSprite = null;
// เลเยอร์อบไว้ใช้ความละเอียดเดียวกับ canvas (zScale) → blit 1:1 ไม่ต้องย่อ/ขยายทุกเฟรม
const zMakeLayer = (w, h, scale = zScale) => makeLayer(w, h, scale);
// สุ่มแบบกำหนด seed — ตึก/ป้ายหน้าตาเดิมทุกครั้งที่ resize ไม่กระโดดเปลี่ยน
const zRng = seededRng;
// ของตัวละคร (พิกัด local คงที่ → สร้างครั้งเดียว ไม่ต้องสร้างใหม่ตอน resize)
// แทน shadowBlur/gradient ที่เดิมสร้างใหม่ทุกเฟรมต่อซอมบี้แต่ละตัวและตำรวจ
let zZombieLegGrad = null, zPoliceLegGrad = null, zPoliceTorsoGrad = null, zPoliceHeadGrad = null;
let zBodyShadowSprite = null, zEyeGlowSprite = null;
function zBuildCharacterStatics() {
  zZombieLegGrad = zctx.createLinearGradient(0, -44, 0, -5);
  zZombieLegGrad.addColorStop(0, "#4a6a36"); zZombieLegGrad.addColorStop(1, "#2a401c");
  zPoliceLegGrad = zctx.createLinearGradient(-8, -46, -8, -5);
  zPoliceLegGrad.addColorStop(0, "#2a3a8b"); zPoliceLegGrad.addColorStop(1, "#141d52");
  zPoliceTorsoGrad = zctx.createLinearGradient(-14, -84, 14, -44);
  zPoliceTorsoGrad.addColorStop(0, "#3a55c8"); zPoliceTorsoGrad.addColorStop(1, "#1e2f88");
  zPoliceHeadGrad = zctx.createRadialGradient(-2, -100, 2, 0, -98, 13);
  zPoliceHeadGrad.addColorStop(0, "#f7d2a8"); zPoliceHeadGrad.addColorStop(1, "#e0b07a");
  zBodyShadowSprite = zSoftSprite("0,0,0", 64);
  zEyeGlowSprite = zSoftSprite("255,32,32", 32);
}

const zSoftSprite = softSprite;

function zBuildSky(gy) {
  const L = zMakeLayer(ZW, gy), c = L.c, r = zRng(11);
  const sky = c.createLinearGradient(0, 0, 0, gy);
  sky.addColorStop(0, "#05070f"); sky.addColorStop(0.55, "#1a1130"); sky.addColorStop(1, "#3a1626");
  c.fillStyle = sky; c.fillRect(0, 0, ZW, gy);
  // แสงเมืองไฟไหม้ที่ขอบฟ้า (ส้มแดงจาง ๆ)
  const glow = c.createRadialGradient(ZW * 0.45, gy, 0, ZW * 0.45, gy, Math.max(ZW, gy) * 0.75);
  glow.addColorStop(0, "rgba(255,90,50,0.28)"); glow.addColorStop(0.5, "rgba(170,40,70,0.1)"); glow.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = glow; c.fillRect(0, 0, ZW, gy);
  // ดาวนิ่ง (ดวงที่กะพริบวาดสดใน zDrawBackground)
  for (let i = 0; i < 90; i++) {
    c.globalAlpha = 0.25 + r() * 0.6;
    c.fillStyle = r() < 0.2 ? "#ffd9c8" : "#e8e6ff";
    c.beginPath(); c.arc(r() * ZW, r() * gy * 0.72, 0.3 + r() * 1.1, 0, 6.28); c.fill();
  }
  c.globalAlpha = 1;
  // ดวงจันทร์: halo + เงาโค้ง + หลุม
  const mx = ZW * 0.8, my = gy * 0.22;
  const halo = c.createRadialGradient(mx, my, 10, mx, my, 95);
  halo.addColorStop(0, "rgba(243,233,184,0.5)"); halo.addColorStop(0.4, "rgba(243,200,170,0.12)"); halo.addColorStop(1, "rgba(243,233,184,0)");
  c.fillStyle = halo; c.beginPath(); c.arc(mx, my, 95, 0, 6.28); c.fill();
  const disc = c.createRadialGradient(mx - 9, my - 9, 4, mx, my, 28);
  disc.addColorStop(0, "#fffbe0"); disc.addColorStop(0.7, "#f0e2a8"); disc.addColorStop(1, "#cdb980");
  c.fillStyle = disc; c.beginPath(); c.arc(mx, my, 27, 0, 6.28); c.fill();
  c.fillStyle = "rgba(170,150,100,0.45)";
  for (const [dx, dy, rr] of [[-9, -6, 5], [9, 8, 4], [4, -12, 2.5], [-3, 12, 3], [13, -3, 2]]) {
    c.beginPath(); c.arc(mx + dx, my + dy, rr, 0, 6.28); c.fill();
  }
  // เมฆบางพาดหน้าจันทร์
  c.globalAlpha = 0.5;
  c.drawImage(zFogSprite, mx - 90, my + 2, 180, 26);
  c.drawImage(zFogSprite, mx - 40, my - 14, 130, 18);
  c.globalAlpha = 1;
  zDrawDistantSkyline(c, gy, r);
  return L;
}

// เส้นขอบฟ้าเมืองไกลลิบ (ตึกสูง + หอคอยทีวี + เจดีย์) เลือนในหมอก — นิ่ง ไม่ทำ parallax
// ช่วยให้จอมือถือแนวตั้งที่ท้องฟ้าสูงมากไม่โล่ง
function zDrawDistantSkyline(c, gy, r) {
  const maxH = Math.min(320, gy * 0.42);
  const haze = c.createLinearGradient(0, gy - maxH, 0, gy);
  haze.addColorStop(0, "#2a1a3e"); haze.addColorStop(1, "#4a1f3a");
  c.fillStyle = haze;
  c.beginPath();
  for (let x = -10; x < ZW + 10;) {
    const w = 18 + r() * 46, h = maxH * (0.25 + r() * 0.5);
    c.rect(x, gy - h, w, h);
    if (r() < 0.3) c.rect(x + w * 0.4, gy - h - 14, 3, 14); // เสาบนยอด
    x += w + r() * 8;
  }
  c.fill();
  // หอคอยทีวี (ทรงไข่มุกตะวันออก)
  const tx = ZW * 0.28, base = gy, th = maxH * 1.05;
  c.fillRect(tx - 3, base - th, 6, th);
  c.beginPath(); c.arc(tx, base - th * 0.42, 13, 0, 6.28); c.arc(tx, base - th * 0.78, 9, 0, 6.28); c.fill();
  c.fillRect(tx - 1, base - th - 30, 2, 30);
  // เจดีย์ 5 ชั้น
  const px = ZW * 0.62;
  for (let i = 0; i < 5; i++) {
    const w = 46 - i * 7, y = base - maxH * 0.35 - i * 22;
    c.fillRect(px - w / 2 + 6, y, w - 12, 22);
    c.beginPath(); c.moveTo(px - w / 2 - 6, y + 4); c.quadraticCurveTo(px, y - 10, px + w / 2 + 6, y + 4); c.lineTo(px + w / 2 - 4, y + 2); c.lineTo(px - w / 2 + 4, y + 2); c.fill();
  }
  c.fillRect(px - 1, base - maxH * 0.35 - 5 * 22 - 18, 2, 20);
  c.fillRect(px - 16, base - maxH * 0.35, 32, maxH * 0.35);
  // ไฟสัญญาณแดง + หน้าต่างจาง ๆ
  c.fillStyle = "rgba(255,70,70,0.8)";
  c.beginPath(); c.arc(tx, base - th - 30, 2, 0, 6.28); c.fill();
  c.fillStyle = "rgba(255,200,140,0.18)";
  for (let i = 0; i < 70; i++) c.fillRect(r() * ZW, gy - r() * maxH * 0.6, 2, 2);
  // หมอกพื้นกลืนฐานตึก
  const fog = c.createLinearGradient(0, gy - maxH * 0.5, 0, gy);
  fog.addColorStop(0, "rgba(90,30,60,0)"); fog.addColorStop(1, "rgba(120,40,70,0.55)");
  c.fillStyle = fog; c.fillRect(0, gy - maxH * 0.5, ZW, maxH * 0.5);
}

const ZNEON = [["酒店", "#ff4fd8"], ["药房", "#3cf0ff"], ["面馆", "#ffb13c"], ["网吧", "#7dff6a"], ["旅馆", "#ff5a5a"], ["超市", "#3cf0ff"]];
function zNeonSign(c, x, y, text, color) {
  // ป้ายนีออนแนวตั้งแบบร้านจีน — shadowBlur จ่ายครั้งเดียวตอนอบภาพ
  const w = 24, h = text.length * 20 + 10;
  c.save();
  c.fillStyle = "rgba(10,6,20,0.85)";
  c.fillRect(x, y, w, h);
  c.shadowColor = color; c.shadowBlur = 12;
  c.strokeStyle = color; c.lineWidth = 2;
  c.strokeRect(x + 1, y + 1, w - 2, h - 2);
  c.fillStyle = color;
  c.font = `700 16px "Noto Sans SC", sans-serif`;
  c.textAlign = "center"; c.textBaseline = "middle";
  [...text].forEach((ch, i) => c.fillText(ch, x + w / 2, y + 15 + i * 20));
  c.restore();
}

function zBuildFarStrip() {
  const S = 160, N = 8, H = 175, L = zMakeLayer(S * N, H), c = L.c, r = zRng(7);
  for (let i = 0; i < N; i++) {
    const bw = 100 + Math.floor(r() * 3) * 16, h = 56 + Math.floor(r() * 7) * 15;
    const x = i * S + 8, top = H - h;
    c.fillStyle = "#121530"; c.fillRect(x, top, bw, h);
    c.fillStyle = "rgba(130,140,220,0.2)"; c.fillRect(x, top, bw, 2);       // แสงจันทร์ที่ขอบหลังคา
    c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x + bw - 10, top, 10, h);  // ด้านเงาของตึก
    const roof = r();
    c.strokeStyle = "#1c2044"; c.fillStyle = "#1c2044"; c.lineWidth = 2;
    if (roof < 0.4) {
      const ax = x + bw * (0.3 + r() * 0.4);
      c.beginPath(); c.moveTo(ax, top); c.lineTo(ax, top - 26); c.moveTo(ax - 6, top - 16); c.lineTo(ax + 6, top - 16); c.stroke();
      c.fillStyle = "#ff3b3b"; c.beginPath(); c.arc(ax, top - 27, 1.8, 0, 6.28); c.fill();
    } else if (roof < 0.7) {
      const tx = x + 12 + r() * (bw - 40);
      c.fillRect(tx, top - 14, 18, 10); c.fillRect(tx + 2, top - 4, 2, 4); c.fillRect(tx + 14, top - 4, 2, 4);
    }
    for (let wy = top + 10; wy < H - 14; wy += 16)
      for (let wx = x + 10; wx < x + bw - 16; wx += 18) {
        const k = r();
        c.fillStyle = k < 0.16 ? "#c9b458" : k < 0.22 ? "#e8d48a" : k < 0.25 ? "#8fb8dc" : "rgba(255,255,255,0.035)";
        c.fillRect(wx, wy, 7, 8);
      }
  }
  return L;
}

function zBuildNearStrip() {
  const S = 220, N = 6, H = 215, L = zMakeLayer(S * N, H), c = L.c, r = zRng(23);
  for (let i = 0; i < N; i++) {
    const bw = 150 + Math.floor(r() * 3) * 18, h = 80 + Math.floor(r() * 5) * 22;
    const x = i * S + 10, top = H - h;
    c.fillStyle = "#0b0d1c"; c.fillRect(x, top, bw, h);
    c.fillStyle = "rgba(150,160,230,0.14)"; c.fillRect(x, top, bw, 2);
    c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(x + bw - 14, top, 14, h);
    for (let wy = top + 14; wy < H - 18; wy += 20)
      for (let wx = x + 14; wx < x + bw - 22; wx += 24) {
        const k = r();
        if (k < 0.2) {
          c.fillStyle = k < 0.15 ? "#ffd76a" : "#ffad5a";
          c.fillRect(wx, wy, 8, 10);
          c.fillStyle = "rgba(255,215,106,0.12)"; c.fillRect(wx - 3, wy - 3, 14, 16); // แสงฟุ้งรอบหน้าต่าง
        } else {
          c.fillStyle = k < 0.24 ? "#5fd0e0" : "rgba(255,255,255,0.03)";
          c.fillRect(wx, wy, 8, 10);
        }
      }
    // บันไดหนีไฟ
    if (r() < 0.5 && h > 110) {
      c.strokeStyle = "rgba(60,64,96,0.9)"; c.lineWidth = 1.5;
      const fx = x + 8;
      c.beginPath();
      for (let fy = top + 22; fy < H - 20; fy += 26) { c.moveTo(fx, fy); c.lineTo(fx + 30, fy); c.moveTo(fx, fy); c.lineTo(fx + 30, fy + 26); }
      c.stroke();
    }
    // ป้ายนีออน
    if (r() < 0.65) {
      const [text, color] = ZNEON[Math.floor(r() * ZNEON.length)];
      zNeonSign(c, x + bw - 40, top + 16, text, color);
    }
  }
  // เสาไฟถนน + ลำแสง (อยู่ในแถบตึกใกล้ ฐานเสาตรงกับพื้น)
  for (let i = 0; i < N; i += 2) {
    const px = i * S + 120, base = H;
    c.save();
    c.globalCompositeOperation = "lighter";
    const cone = c.createRadialGradient(px + 16, base - 108, 2, px + 16, base - 40, 90);
    cone.addColorStop(0, "rgba(255,210,140,0.35)"); cone.addColorStop(1, "rgba(255,210,140,0)");
    c.fillStyle = cone;
    c.beginPath(); c.moveTo(px + 10, base - 108); c.lineTo(px - 40, base); c.lineTo(px + 72, base); c.lineTo(px + 22, base - 108); c.closePath(); c.fill();
    c.restore();
    c.fillStyle = "#1a1d30";
    c.fillRect(px - 2, base - 112, 4, 112);
    c.fillRect(px - 2, base - 112, 20, 3);
    c.fillStyle = "#ffe6a8"; c.shadowColor = "#ffc860"; c.shadowBlur = 14;
    c.fillRect(px + 10, base - 110, 12, 4);
    c.shadowBlur = 0;
  }
  return L;
}

function zBuildGroundStrip(gy) {
  const P = 720, H = Math.max(40, ZH - gy + 6), L = zMakeLayer(P, H), c = L.c, r = zRng(31);
  // ขอบหญ้า + กอหญ้า
  c.fillStyle = "#2f4a24"; c.fillRect(0, 0, P, 8);
  c.fillStyle = "#3f6630";
  for (let x = 0; x < P; x += 6 + r() * 10) {
    const h = 3 + r() * 5;
    c.beginPath(); c.moveTo(x, 2); c.lineTo(x + 2, 2 - h); c.lineTo(x + 4, 2); c.fill();
  }
  // ขอบทางเท้า (แบ่งเป็นก้อน)
  c.fillStyle = "#3d4254"; c.fillRect(0, 6, P, 6);
  c.fillStyle = "#23263a";
  for (let x = 0; x < P; x += 60) c.fillRect(x, 6, 2, 6);
  // ถนน
  const road = c.createLinearGradient(0, 12, 0, H);
  road.addColorStop(0, "#1d2130"); road.addColorStop(1, "#0b0d16");
  c.fillStyle = road; c.fillRect(0, 12, P, H - 12);
  // เม็ดกรวด
  for (let i = 0; i < 420; i++) {
    c.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.3)";
    c.fillRect(r() * P, 12 + r() * (H - 12), 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // รอยแตก
  c.strokeStyle = "rgba(0,0,0,0.45)"; c.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = r() * (P - 80) + 20, y = 30 + r() * Math.max(10, H - 50);
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += 6 + r() * 12; y += (r() - 0.5) * 10; c.lineTo(x, y); }
    c.stroke();
  }
  // แอ่งน้ำสะท้อนแสงจันทร์
  for (const px of [140, 500]) {
    const py = 34 + r() * Math.max(4, Math.min(30, H - 50));
    const g = c.createRadialGradient(px, py, 2, px, py, 40);
    g.addColorStop(0, "rgba(180,190,255,0.22)"); g.addColorStop(1, "rgba(120,130,200,0)");
    c.fillStyle = g; c.beginPath(); c.ellipse(px, py, 44, 7, 0, 0, 6.28); c.fill();
  }
  // เส้นถนน (ตำแหน่งเดิม gy+18 → y 24 ในแถบนี้ที่เริ่มที่ gy-6)
  c.fillStyle = "#77744c";
  for (let x = 0; x < P; x += 90) c.fillRect(x, 24, 44, 4);
  return L;
}

function zBuildGradeLayer() {
  // color grade + vignette + scanline CRT รวมเป็นภาพเดียว → วาดเต็มจอ 1 ครั้งต่อเฟรม
  // (เดิม grade กับ scanline แยกกัน = เต็มจอ 2 ครั้ง; scanline ต้องคมจึงอบที่ zScale ไม่ใช่ครึ่งความละเอียด)
  const L = zMakeLayer(ZW, ZH), c = L.c;
  const grade = c.createLinearGradient(0, 0, 0, ZH);
  grade.addColorStop(0, "rgba(40,20,80,0.12)"); grade.addColorStop(1, "rgba(80,20,40,0.12)");
  c.fillStyle = grade; c.fillRect(0, 0, ZW, ZH);
  const vig = c.createRadialGradient(ZW / 2, ZH / 2, Math.min(ZW, ZH) * 0.35, ZW / 2, ZH / 2, Math.max(ZW, ZH) * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,0.55)");
  c.fillStyle = vig; c.fillRect(0, 0, ZW, ZH);
  // scanline CRT: pattern 1×3 px (แถวมืด 1 px ทุก 3 px) ความเข้ม 6 %
  const pat = document.createElement("canvas");
  pat.width = 1; pat.height = 3;
  const pc = pat.getContext("2d");
  pc.fillStyle = "#000"; pc.fillRect(0, 0, 1, 1);
  c.globalAlpha = 0.06; c.fillStyle = c.createPattern(pat, "repeat");
  c.fillRect(0, 0, ZW, ZH);
  c.globalAlpha = 1;
  return L;
}

function zBuildStatics() {
  const gy = zGroundY();
  // หมอก/ควัน: blob นุ่ม pre-render ครั้งเดียว แล้ว drawImage แทนการสร้าง radial gradient ทุกเฟรม
  // (สร้างก่อน zBuildSky เพราะเมฆหน้าจันทร์ใช้ sprite นี้)
  if (!zFogSprite) {
    zFogSprite = zSoftSprite("180,180,210", 256);
    zSmokeSprite = zSoftSprite("180,180,180", 96);
    zGlowSprite = zSoftSprite("255,215,106", 128);   // แสงฟุ้งปากกระบอก/ไฟอัปเกรดอาวุธ
  }
  zSkyLayer = zBuildSky(gy);
  // แถบตึกไม่ขึ้นกับขนาดจอ — สร้างใหม่เฉพาะเมื่อความละเอียดที่วาด (zScale) เปลี่ยน
  if (!zFarStrip || zFarStrip.scale !== zScale) zFarStrip = zBuildFarStrip();
  if (!zNearStrip || zNearStrip.scale !== zScale) zNearStrip = zBuildNearStrip();
  zGroundStrip = zBuildGroundStrip(gy);
  zGradeLayer = zBuildGradeLayer();
}
zresize();
zBuildCharacterStatics();

// sprite บับเบิลคำจีนเหนือหัวซอมบี้ (ข้อความคงที่ตลอดชีวิตของตัวนี้) — pre-render ตอน spawn
// แทน shadowBlur + fillText + strokeText ทุกเฟรม (แนวเดียวกับ makeMeteorLabelSprite)
function makeZombieBubbleSprite(text) {
  const dpr = zScale;
  const fs = text.length > 3 ? 22 : text.length > 2 ? 27 : 34;
  const font = `800 ${fs}px "Noto Sans SC", sans-serif`;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const tw = probe.measureText(text).width, bw = tw + 24, bh = fs + 16;
  const pad = 10; // เผื่อเงาเบลอ + หางบับเบิล
  const w = Math.ceil(bw + pad * 2), h = Math.ceil(bh + 7 + pad * 2);
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * dpr);
  cv.height = Math.ceil(h * dpr);
  const c2 = cv.getContext("2d");
  c2.scale(dpr, dpr);
  c2.translate(w / 2, pad);
  c2.shadowColor = "rgba(0,0,0,0.4)"; c2.shadowBlur = 6; c2.shadowOffsetY = 2;
  c2.fillStyle = "rgba(255,255,255,.96)";
  zRoundRect(c2, -bw / 2, 0, bw, bh, 10);
  c2.beginPath(); c2.moveTo(-6, bh - 1); c2.lineTo(6, bh - 1); c2.lineTo(0, bh + 7); c2.fill();
  c2.shadowColor = "transparent"; c2.shadowBlur = 0; c2.shadowOffsetY = 0;
  c2.font = font;
  c2.fillStyle = "#1a1a1a"; c2.textAlign = "center"; c2.textBaseline = "middle";
  c2.fillText(text, 0, bh / 2 + 1);
  c2.globalCompositeOperation = "lighter";
  c2.strokeStyle = "rgba(140,200,255,.35)";
  c2.lineWidth = 1.2;
  c2.strokeText(text, 0, bh / 2);
  // anchor = ขอบล่างของบับเบิลหลัก (ไม่รวมหาง) อยู่ที่ y = pad + bh ในสไปรต์
  return { cv, w, h, ay: pad + bh };
}

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
  zb = {
    score: 0, kills: 0, combo: 0, elapsed: 0, timeLeft: zDuration,
    spawnTimer: 0, nextSpawn: 1.0, stunUntil: 0,
    zombies: [], bullets: [], particles: [], floaters: [], options: [],
    walk: 0, scroll: 0, recoil: 0, flash: 0, shake: 0,
    paused: false, ending: false, endTimer: 0, lastTime: performance.now(),
    weaponId: "bow", upgradeFlash: 0, done: new Set(),
  };
  switchScreen($("zombie"));
  // resize หลังจอแสดงแล้ว เพื่อให้ zGroundY อ่าน offsetTop จริงของ #zombieBar (ไม่ใช่ค่าสำรอง)
  // และ gradient พื้นหลังที่แคชไว้ตรงกับเส้นพื้นจริง
  zresize();
  zRQ.reset();
  $("zPauseOverlay").classList.remove("show");
  zHudCache = {};
  updateZombieHUD();
  refreshZOptions();
  renderZOptions();
  stopSpeech();
  music.start("zombie");
  requestAnimationFrame(zloop);
}

// HUD ถูกเรียกทุกเฟรมจาก zUpdate — เขียน DOM เฉพาะเมื่อค่าเปลี่ยนจริง
// (เดิมเขียน textContent 5 จุดทุกเฟรม → style/layout/repaint ของ HUD ที่มี backdrop-filter ทุกเฟรม)
let zHudCache = {};
function zSetText(id, text) {
  if (zHudCache[id] === text) return;
  zHudCache[id] = text;
  const el = $(id);
  if (el) el.textContent = text;
}
function updateZombieHUD() {
  zSetText("zScore", String(zb.score));
  zSetText("zKills", "🧟 " + zb.kills);
  // show current weapon
  zSetText("zWeapon", zWeapon().name);
  // ไม่จำกัดเวลา → แสดงเวลาที่เล่นไปแล้วแทนการนับถอยหลัง
  const t = zDuration ? Math.max(0, Math.ceil(zb.timeLeft)) : Math.floor(zb.elapsed);
  zSetText("zTimer", `${zDuration ? "⏱" : "♾️"} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`);
  const urgent = !!zDuration && t <= 10;
  if (zHudCache.urgent !== urgent) { zHudCache.urgent = urgent; $("zTimer").classList.toggle("urgent", urgent); }
  zSetText("zProg", progPct(zb.done.size, pool.length));
}

function spawnZombie() {
  const alive = zAlive();
  if (alive.length >= 4) return;
  // เว้นระยะไม่ให้ซอมบี้ตัวใหม่ซ้อนกับตัวที่เพิ่งออกมา
  if (alive.some((z) => z.x > ZW - 90)) return;
  const usedPinyin = new Set(alive.map((z) => z.word[1]));
  let w = pick(pool), guard = 0;
  while (usedPinyin.has(w[1]) && guard++ < 200) w = pick(pool);
  const z = {
    word: w, x: ZW + 40, speed: zSpeed() * rand(0.9, 1.1),
    phase: rand(0, 6.28), hit: false, dead: false, fall: 0,
    scale: rand(0.85, 1.2),
    skin: pick(["#7fc45a", "#6aa84a", "#8fd96b", "#9ec47a"]),
    skinDark: pick(["#4e8f2e", "#3a6a22", "#5a8033"]),
    shirtLight: pick(["#7a5a9a", "#5a3a7a", "#6a4a8a", "#8a6aaa", "#4a5a8a"]),
    shirtDark: pick(["#5a3a7a", "#3a2a5a", "#4a3a6a", "#6a4a8a", "#2a3a6a"]),
  };
  // gradient เสื้อ/หัว (สีคงที่ต่อตัว) สร้างที่ bob=0 ครั้งเดียว แล้วตอนวาดค่อย translate ตาม bob
  z.torsoGrad = zctx.createLinearGradient(-15, -82, 15, -42);
  z.torsoGrad.addColorStop(0, z.shirtLight); z.torsoGrad.addColorStop(1, z.shirtDark);
  z.headGrad = zctx.createRadialGradient(-3, -98, 2, 0, -96, 15);
  z.headGrad.addColorStop(0, z.skin); z.headGrad.addColorStop(1, z.skinDark);
  z.bubble = makeZombieBubbleSprite(zFirst(w[0]));
  zb.zombies.push(z);
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

// คำจีนอยู่ในบับเบิ้ลที่วาดบน canvas เหนือหัวซอมบี้ — hit-test เฉพาะพื้นที่บับเบิ้ล
zcanvas.addEventListener("click", (e) => {
  if (!zb || zb.paused || zb.ending) return;
  const r = zcanvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * ZW / Math.max(1, r.width);
  const y = (e.clientY - r.top) * ZH / Math.max(1, r.height);
  const gy = zGroundY();
  const target = [...zAlive()].reverse().find((z) => {
    const bob = Math.sin(z.phase) * 3;
    const b = z.bubble;
    if (!b) return false;
    const left = z.x - b.w * z.scale / 2;
    const top = gy + (-120 + bob - b.ay) * z.scale;
    return x >= left && x <= left + b.w * z.scale &&
      y >= top && y <= top + b.h * z.scale;
  });
  if (target) crOpenCanvasTextBubble(target.word[0], e.clientX, e.clientY);
});

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
  // ท้องฟ้า + ดาว + จันทร์ อบไว้แล้ว (zBuildSky) — พื้นที่ใต้เส้นพื้นถูกถนนทับอยู่แล้ว
  c.drawImage(zSkyLayer.cv, 0, 0, zSkyLayer.w, zSkyLayer.h);

  // ดาวที่กะพริบ (ไม่กี่ดวง วาดสด)
  c.fillStyle = "#f2f0ff";
  for (const s of zStars) {
    s.tw += 0.05;
    c.globalAlpha = 0.5 + Math.sin(s.tw) * 0.45;
    c.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
  c.globalAlpha = 1;

  // ตึก 2 เลเยอร์ (parallax) — แถบที่อบไว้ ต่อกันวนไม่มีรอยต่อ
  zBlitStrip(c, zFarStrip, zb.scroll * 0.25, gy - zFarStrip.h);
  zBlitStrip(c, zNearStrip, zb.scroll * 0.5, gy - zNearStrip.h);

  // drifting fog — blob pre-render แล้ว drawImage แทน createRadialGradient ทุกเฟรม
  for (const f of zFog) {
    f.x -= f.sp * 0.016;
    if (f.x < -f.r) f.x = ZW + f.r;
    c.globalAlpha = f.a;
    c.drawImage(zFogSprite, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
  }
  c.globalAlpha = 1;

  // ขอบหญ้า + ถนน + เส้นถนน: แถบเดียวที่เลื่อนไปทั้งแถบ
  zBlitStrip(c, zGroundStrip, zb.scroll, gy - 6);
  // (vignette ย้ายไปรวมกับ color grade ใน zGradeLayer ท้าย zDraw)
}

function zBlitStrip(c, s, scroll, y) {
  const off = ((scroll % s.w) + s.w) % s.w;
  // ปัด x เป็นจำนวนเต็ม กันรอยต่อเส้นบาง ๆ ระหว่างแผ่น
  for (let x = -Math.round(off); x < ZW; x += s.w) c.drawImage(s.cv, x, y, s.w, s.h);
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
  // legs (with shading) — เงาใต้ขาใช้ sprite นุ่มที่แคชไว้ แทน shadowBlur ทุกเฟรม
  c.globalAlpha = 0.5;
  c.drawImage(zBodyShadowSprite, -24, -30, 48, 34);
  c.globalAlpha = 1;
  c.strokeStyle = zPoliceLegGrad; c.lineWidth = 9;
  c.beginPath(); c.moveTo(-4, -46); c.lineTo(-4 + swing * 12, -5); c.moveTo(4, -46); c.lineTo(4 - swing * 12, -5); c.stroke();
  c.fillStyle = "#0a0a0a"; c.fillRect(-4 + swing * 12 - 7, -6, 16, 6); c.fillRect(4 - swing * 12 - 7, -6, 16, 6);
  // back arm
  c.strokeStyle = "#2a45b8"; c.lineWidth = 8;
  c.beginPath(); c.moveTo(-8, -76); c.lineTo(-16, -52); c.stroke();
  // torso with vertical gradient + belt
  c.fillStyle = zPoliceTorsoGrad; zRoundRect(c, -14, -84, 28, 40, 6);
  // belt
  c.fillStyle = "#1a1a1a"; c.fillRect(-14, -50, 28, 5);
  c.fillStyle = "#ffd23c"; c.fillRect(-3, -50, 6, 5); // buckle
  // badge
  c.fillStyle = "#ffd23c"; c.beginPath(); c.arc(-6, -74, 3, 0, 6.28); c.fill();
  c.fillStyle = "#b8860b"; c.beginPath(); c.arc(-6, -74, 1.4, 0, 6.28); c.fill();
  // head (skin gradient) + face
  c.fillStyle = zPoliceHeadGrad; c.beginPath(); c.arc(0, -98, 12, 0, 6.28); c.fill();
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
    // แสงฟุ้งรอบปากกระบอก (แทน bloom เต็มจอที่เอาออกไป)
    c.save();
    c.globalCompositeOperation = "lighter";
    c.globalAlpha = fa * 0.8;
    c.drawImage(zGlowSprite, 60 - r - 34, -75 - 34, 68, 68);
    c.restore();
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
  // เงาหลักด้านหลังตัว (ให้ silhouette หลุดจากพื้นหลัง) — sprite นุ่มที่แคชไว้ แทน shadowBlur 14 ทุกเฟรม
  c.globalAlpha *= 0.55;
  c.drawImage(zBodyShadowSprite, -30, -96 + bob, 60, 68);
  c.globalAlpha /= 0.55;
  // legs (shaded)
  c.strokeStyle = zZombieLegGrad; c.lineWidth = 9;
  c.beginPath(); c.moveTo(-4, -44); c.lineTo(-4 - swing * 10, -5); c.moveTo(4, -44); c.lineTo(4 + swing * 10, -5); c.stroke();
  c.fillStyle = "#1a1a1a"; c.fillRect(-4 - swing * 10 - 6, -6, 14, 5); c.fillRect(4 + swing * 10 - 6, -6, 14, 5);
  // torso (torn shirt) with gradient (แคชต่อตัว ที่ bob=0 → translate ตาม bob)
  c.save(); c.translate(0, bob);
  c.fillStyle = z.torsoGrad; zRoundRect(c, -15, -82, 30, 40, 6);
  c.restore();
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
  c.save(); c.translate(0, bob);
  c.fillStyle = z.headGrad; c.beginPath(); c.arc(0, -96, 14, 0, 6.28); c.fill();
  c.restore();
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
  // glowing red eyes — แสงเรืองใช้ sprite นุ่มที่แคชไว้ แทน shadowBlur 8 ทุกเฟรม
  c.drawImage(zEyeGlowSprite, -14, -106 + bob, 16, 16);
  c.drawImage(zEyeGlowSprite, -6, -107 + bob, 16, 16);
  c.fillStyle = "#ff3b3b"; c.beginPath(); c.arc(-6, -98 + bob, 2.6, 0, 6.28); c.arc(2, -99 + bob, 2.6, 0, 6.28); c.fill();
  // fangs + bloody mouth
  c.fillStyle = "#3a0a0a"; c.fillRect(-10, -90 + bob, 11, 3);
  c.fillStyle = "#fff";
  c.beginPath(); c.moveTo(-8, -88 + bob); c.lineTo(-7, -84 + bob); c.lineTo(-6, -88 + bob); c.fill();
  c.beginPath(); c.moveTo(-2, -88 + bob); c.lineTo(-1, -84 + bob); c.lineTo(0, -88 + bob); c.fill();
  // blood drip
  c.fillStyle = "#a01010"; c.fillRect(-7, -84 + bob, 1.5, 4);
  // Chinese word above the head
  // (บับเบิล + เงา + rim light ถูก pre-render ไว้ใน z.bubble ตอน spawn)
  if (!z.dead) {
    const b = z.bubble;
    c.drawImage(b.cv, -b.w / 2, -120 + bob - b.ay, b.w, b.h);
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
  // particles: ควันวาดแบบปกติ (sprite นุ่ม) ก่อน แล้วสะเก็ดไฟ/เลือดวาดแบบแสงบวก (lighter)
  // → สะเก็ดซ้อนกันยิ่งสว่างเหมือนเรืองแสง
  for (const p of zb.particles) {
    if (!p.smoke) continue;
    c.globalAlpha = (1 - p.age / p.life) * 0.5;
    c.drawImage(zSmokeSprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  glowOn(c);
  for (const p of zb.particles) {
    if (p.smoke) continue;
    c.globalAlpha = 1 - p.age / p.life;
    c.fillStyle = p.color;
    c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.28); c.fill();
  }
  glowOff(c);
  c.globalAlpha = 1;
  // ไม่มี bloom() แล้ว: มันต้องอ่านภาพทั้งเฟรมกลับมาย่อ + เบลอ + วาดทับเต็มจอแบบ lighter ทุกเฟรม
  // ซึ่งเป็นต้นทุนก้อนใหญ่ที่สุดของเกมนี้บน GPU มือถือ (APK กระตุก) — แสงฟุ้งได้จาก lighter +
  // zGlowSprite ที่ปากกระบอกแทน (เกมอุกกาบาตก็เลิกใช้แล้ว — ฟังก์ชัน bloom ถูกลบออก)
  if (zb.floaters.length) {
    c.font = "800 22px 'Noto Sans Thai', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    // ขอบเข้มด้วย strokeText แทน shadowBlur (ถูกกว่ามากบน WebView)
    c.lineWidth = 4; c.strokeStyle = "rgba(0,0,0,.6)"; c.lineJoin = "round";
    for (const f of zb.floaters) {
      c.globalAlpha = 1 - f.age / f.life;
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = "#ffd76a";
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;
  }
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

  // vignette + color grading + CRT scanlines — ภาพเดียวที่อบไว้ (zBuildGradeLayer)
  c.drawImage(zGradeLayer.cv, 0, 0, ZW, ZH);

  // weapon upgrade flash (golden glow) — sprite นุ่มที่แคชไว้ แทน radial gradient ใหม่ทุกเฟรม
  if (zb.upgradeFlash > 0) {
    const ua = zb.upgradeFlash / 1.5, rr = Math.max(ZW, ZH) * 0.6;
    c.globalAlpha = ua * 0.24;
    c.drawImage(zGlowSprite, ZW / 2 - rr, ZH / 2 - rr, rr * 2, rr * 2);
    c.globalAlpha = 1;
  }
}

function zloop(t) {
  if (!zb) return;
  const dtMs = t - zb.lastTime;
  const dt = Math.min(dtMs / 1000, 0.05);
  zb.lastTime = t;
  zRQ.frame(dtMs, zb.paused || zb.ending);
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

