"use strict";
/* ================= Helpers ================= */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
// เปอร์เซ็นความก้าวหน้าของเซสชัน — จำนวนไอเท็มไม่ซ้ำที่ทำแล้ว / จำนวนทั้งหมดในระดับ
const progPct = (done, total) => `${total ? Math.round(done * 100 / total) : 0}%`;

/* ================= เครื่องมือวาดภาพที่ใช้ร่วมกัน (เกมอุกกาบาต + ซอมบี้) =================
   ทั้งสองเกมติดที่ fill-rate ของ GPU มือถือ: ต้นทุนต่อเฟรมสเกลตามจำนวนพิกเซลของ canvas
   - makeRenderQuality(): ความละเอียดที่วาด = min(DPR, 1.5, งบพิกเซลรวม) × q โดย q ลดลงเอง 15 %
     เมื่อ 90 เฟรมเฉลี่ยช้ากว่า ~45 fps (ต่ำสุด 0.6, ไม่ปรับขึ้นระหว่างเล่น, จำไว้ใน localStorage)
     เบราว์เซอร์ขยายภาพให้เต็มจอเองตอน composite แทบไม่มีต้นทุน
   - makeLayer()/softSprite(): ภาพที่อบไว้ครั้งเดียว → ต่อเฟรมแค่ drawImage
   - seededRng(): สุ่มแบบกำหนด seed ให้ฉากหน้าตาเดิมทุกครั้งที่ resize */
const RQ_MAX_DPR = 1.5, RQ_PX_BUDGET = 1.3e6, RQ_MIN = 0.6;
const RQ_WINDOW = 90, RQ_SLOW_MS = 22;
function makeRenderQuality(storageKey, onDrop) {
  let q = 1;
  try { const v = +localStorage.getItem(storageKey); if (v >= RQ_MIN && v <= 1) q = v; } catch {}
  let sum = 0, n = 0, warm = 0;
  return {
    get q() { return q; },
    scale(w, h) {
      const dpr = Math.min(window.devicePixelRatio || 1, RQ_MAX_DPR);
      const cap = Math.sqrt(RQ_PX_BUDGET / Math.max(1, w * h));
      return Math.max(0.5, Math.min(dpr, cap) * q);
    },
    reset() { sum = n = warm = 0; },
    // เรียกทุกเฟรม: idle = พัก/จบเกม/จอซ่อน → ไม่นับ
    frame(dtMs, idle) {
      if (idle || document.hidden) { sum = n = 0; return; }
      if (warm < 60) { warm++; return; }            // ข้ามช่วงเริ่มเกม (โหลดเสียง/ฟอนต์)
      if (dtMs > 100) return;                       // เฟรมสะดุดครั้งเดียว (GC/สลับแอป) ไม่นับ
      sum += dtMs; n++;
      if (n < RQ_WINDOW) return;
      const avg = sum / n;
      sum = n = 0;
      if (avg <= RQ_SLOW_MS || q <= RQ_MIN) return;
      q = Math.max(RQ_MIN, +(q * 0.85).toFixed(2));
      try { localStorage.setItem(storageKey, String(q)); } catch {}
      warm = 30;                                    // ให้เครื่องนิ่งก่อนวัดรอบถัดไป
      onDrop();
    },
  };
}
function makeLayer(w, h, scale) {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(w * scale));
  cv.height = Math.max(1, Math.ceil(h * scale));
  const c = cv.getContext("2d");
  c.scale(scale, scale);
  return { cv, c, w, h, scale };
}
// วงกลมนุ่ม (radial ทึบ→โปร่ง) ใช้แทน radial gradient/shadowBlur ต่อเฟรม
function softSprite(rgb, size) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const cc = cv.getContext("2d");
  const g = cc.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  cc.fillStyle = g;
  cc.fillRect(0, 0, size, size);
  return cv;
}
function seededRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/* ---- canvas เกมอุกกาบาต ----
   ภาพที่อบไว้ (ฉาก/ฐาน/sprite) สร้างใหม่แบบ lazy ในลูปเกม (meteorStaticsDirty) ไม่ใช่ใน resize
   เพราะ resize เกิดบ่อยตอนอยู่โหมดอื่น (เช่นคีย์บอร์ดมือถือเด้งในพจนานุกรม) */
const meteorRQ = makeRenderQuality("cr_meteor_quality", () => resize());
let meteorStaticsDirty = true;
let gyCache = 0;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  DPR = meteorRQ.scale(W, H);
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  gyCache = 0;
  meteorStaticsDirty = true;
}
window.addEventListener("resize", resize);

/* ================= Additive glow =================
   ไฟ/ระเบิด/แสงปากกระบอก/ตัวอักษรเรืองแสง ใช้ "แสงแบบบวก" (lighter) แทนการวางสีทับ
   → สีซ้อนกันยิ่งสว่าง เหมือนแสงจริง ไม่ใช่คราบสีทึบ. ทั้งเซสชันใช้ ctx.globalCompositeOperation
   ที่เก็บ/คืนด้วย save/restore เสมอ เพื่อไม่ให้สถานะรั่วไปฟังก์ชันวาดอื่น */
function glowOn(c, alpha = 1) {
  c.save();
  c.globalCompositeOperation = "lighter";
  c.globalAlpha = alpha;
}
const glowOff = (c) => c.restore();
window.addEventListener("orientationchange", () => setTimeout(resize, 200));
resize();

function initStars() {
  stars = [];
  for (let i = 0; i < 130; i++) {
    const layer = i % 3;
    stars.push({
      x: Math.random(), y: Math.random(),
      r: rand(0.5, 1.5) + layer * 0.55,
      tw: rand(0, 6.28),
      spd: [4, 11, 24][layer],
    });
  }
}
initStars();

// แคช offsetTop (ล้างใน resize) — เดิมอ่านสดหลายครั้งต่อเฟรม (ต่ออุกกาบาตแต่ละลูก)
// จอเกมยังซ่อนอยู่ → offsetTop = 0 → ใช้ค่าสำรอง ไม่แคช
const groundY = () => gyCache || (rocketBar.offsetTop ? (gyCache = rocketBar.offsetTop) : H - 90);
const baseX = () => W / 2;
const baseY = () => groundY() - 24;

/* ================= Difficulty ================= */
function fallSpeed() {
  // px/s scaled by height; the ramp and cap depend on the chosen difficulty
  const d = DIFF[difficulty];
  const base = Math.min(d.base + destroyed * d.ramp, d.cap);
  return base * (H / 700);
}
function spawnInterval() {
  const d = DIFF[difficulty];
  return Math.max(d.spawnMin, d.spawn0 - destroyed * d.spawnDecay);
}
const maxOnScreen = () => Math.min(3 + Math.floor(destroyed / 12), 6);

/* ================= Game flow ================= */
function startGame(level) {
  currentLevel = level;
  pool = getVocabPool(level);
  if (!pool.length) pool = getVocabPool("1");
  lastStarter = () => startGame(level);
  meteors = []; missiles = []; particles = []; rings = []; floaters = [];
  shakeT = 0;
  lives = 3; score = 0; destroyed = 0; combo = 0;
  spawnTimer = 0; nextSpawn = 0.5;
  options = [];
  metDone = new Set();
  updateHUD();
  refreshOptions();
  renderOptions();
  switchScreen(gameEl);
  // resize หลังจอแสดงแล้ว: groundY อ่าน offsetTop จริง และฉาก (สีตามระดับ HSK) ถูกอบใหม่
  resize();
  meteorResetFx();
  meteorRQ.reset();
  running = true; paused = false;
  $("pauseOverlay").classList.remove("show");
  stopSpeech();
  music.start("meteor");
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function switchScreen(el) {
  [menuEl, gameEl, overEl, $("quiz"), $("sentQuiz"), $("sent"), $("fill"), $("zombie"), $("matching"), $("bomb"), $("dict"), $("speak"), $("listen"), $("podcast"), $("reader"), $("copy"), $("trace"), $("vocaboverview"), $("setup")].forEach((s) => s.classList.remove("active"));
  el.classList.add("active");
  // เลเยอร์ FX ของโหมดระเบิดเป็น fixed เต็มจอ — ซ่อนไว้เสมอถ้าไม่ได้อยู่หน้าเกมระเบิด
  const bombFxEl = $("bombFx");
  if (bombFxEl) bombFxEl.style.display = el === $("bomb") ? "" : "none";
}

function endGame() {
  running = false;
  music.stop();
  stopSpeech();
  sfx.over();
  showGameOver("💥 เกมจบ!", score,
    `ทำลายอุกกาบาต ${destroyed} ลูก • ${levelDisplayName(currentLevel)} • ${DIFF[difficulty].label}`,
    `cr_best_${catPrefix()}${currentLevel}_${difficulty}`);
}

function saveBest(bestKeyStr, scoreVal) {
  if (scoreVal > (+localStorage.getItem(bestKeyStr) || 0)) localStorage.setItem(bestKeyStr, scoreVal);
}

function showGameOver(title, scoreVal, statsText, bestKeyStr) {
  $("overTitle").textContent = title;
  const best = +localStorage.getItem(bestKeyStr) || 0;
  const isBest = scoreVal > best;
  if (isBest) localStorage.setItem(bestKeyStr, scoreVal);
  $("finalScore").textContent = scoreVal + " คะแนน";
  $("finalStats").textContent = statsText + ` • สถิติ: ${Math.max(best, scoreVal)}`;
  $("newBest").textContent = isBest ? "🎉 สถิติใหม่!" : "";
  switchScreen(overEl);
}

/* ================= Fullscreen cover viewer ================= */
// รูปปกของโหมดพอดแคสต์และเกมอ่านบทความ: แตะแล้วเปิดรูปเต็มจอใน overlay
// ตัวเดียว (#imgLightbox ใน index.html) ปิดได้ 3 ทาง — ปุ่มกากบาท, แตะพื้นหลัง,
// กด Escape. overlay อยู่นอก .screen ทุกตัว จึงไม่ผูกกับ switchScreen()
let imgLightboxBack = null;

function crOpenImageLightbox(src, alt) {
  const box = $("imgLightbox");
  const img = $("imgLightboxImg");
  if (!box || !img || !src) return;
  imgLightboxBack = document.activeElement;
  img.alt = alt || "";
  img.src = src;
  box.hidden = false;
  const close = $("imgLightboxClose");
  if (close) close.focus({ preventScroll: true });
}

function crCloseImageLightbox() {
  const box = $("imgLightbox");
  const img = $("imgLightboxImg");
  if (!box || box.hidden) return;
  box.hidden = true;
  if (img) img.removeAttribute("src");
  const back = imgLightboxBack;
  imgLightboxBack = null;
  if (back && typeof back.focus === "function") back.focus({ preventScroll: true });
}

// รูปปกในปุ่ม .cover-btn: ซ่อนไว้จนไฟล์โหลดสำเร็จจริง เพื่อไม่ให้บทความที่ยังไม่มี
// รูปเหลือช่องว่างหรือไอคอนรูปแตก และไม่ทำให้ลิสต์เลื่อน
// ระวัง: การตั้ง img.src เป็นค่าเดิมที่โหลดอยู่แล้ว "ไม่ยิง load event อีก" จึงต้อง
// เช็ค complete/naturalWidth ด้วย ไม่งั้นรูปจะค้างซ่อนเมื่อฟังก์ชันถูกเรียกซ้ำ
function crCoverImage(img, url, onShown) {
  if (!img) return;
  const button = img.closest(".cover-btn");
  const show = (on) => {
    img.hidden = !on;
    if (button) button.hidden = !on;
  };
  const shown = () => { show(true); if (onShown) onShown(); };
  if (img.getAttribute("src") === url && img.complete && img.naturalWidth > 0) {
    shown();
    return;
  }
  show(false);
  img.alt = "";
  img.decoding = "async";
  img.onload = shown;
  img.onerror = () => { img.removeAttribute("src"); show(false); };
  img.src = url;
  if (img.complete && img.naturalWidth > 0) shown(); // แคชแล้ว: load อาจไม่ยิง
}

// ปุ่มครอบรูป -> เปิด overlay ด้วยรูปที่โหลดอยู่จริง (currentSrc ให้ Chrome เลือก
// จาก srcset เอง, fallback เป็น src)
function crWireCoverButton(imgId) {
  const img = $(imgId);
  const button = img && img.closest(".cover-btn");
  if (!button) return;
  button.addEventListener("click", () => {
    if (!img || img.hidden) return;
    crOpenImageLightbox(img.currentSrc || img.src, img.alt);
  });
}

if ($("imgLightbox")) {
  $("imgLightboxClose").addEventListener("click", crCloseImageLightbox);
  $("imgLightbox").addEventListener("click", (event) => {
    if (event.target === $("imgLightbox")) crCloseImageLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") crCloseImageLightbox();
  });
}

/* ---------- เปิดเว็บภายนอกในแอพ (Bing Translator ฯลฯ) ---------- */
// ใน APK: เปิดหน้าเว็บใน WebView ของแอพเอง (NativeBrowser plugin) แทนการเด้งไป
// เบราว์เซอร์ภายนอก — ปุ่ม ✕ หรือปุ่ม back ของระบบในหน้านั้นกลับมาหน้าเกมเดิมได้
// บนเว็บ (GitHub Pages) ยังเปิดเป็นแท็บใหม่เหมือนเดิม
function crOpenWeb(url) {
  if (!url) return;
  if (window.CR_OFFLINE_APP && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBrowser) {
    try {
      window.Capacitor.Plugins.NativeBrowser.open({ url: String(url) });
      return;
    } catch (e) { /* fall through ไปเปิดแท็บใหม่ */ }
  }
  window.open(url, "_blank", "noopener");
}

// ลิงก์ <a data-cr-web> ทั้งหมด (ปุ่ม Bing ในผลค้นหาพจนานุกรม) เปิดในแอพแทนแท็บใหม่
document.addEventListener("click", (e) => {
  const a = e.target && e.target.closest ? e.target.closest("a[data-cr-web]") : null;
  if (!a) return;
  e.preventDefault();
  crOpenWeb(a.href || a.getAttribute("href"));
});
