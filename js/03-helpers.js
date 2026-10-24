"use strict";
/* ================= Helpers ================= */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
// เปอร์เซ็นความก้าวหน้าของเซสชัน — จำนวนไอเท็มไม่ซ้ำที่ทำแล้ว / จำนวนทั้งหมดในระดับ
const progPct = (done, total) => `${total ? Math.round(done * 100 / total) : 0}%`;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);

/* ================= Additive glow (bloom ปลอม) =================
   ไฟ/ระเบิด/แสงปากกระบอก/ตัวอักษรเรืองแสง ใช้ "แสงแบบบวก" (lighter) แทนการวางสีทับ
   → สีซ้อนกันยิ่งสว่าง เหมือนแสงจริง ไม่ใช่คราบสีทึบ. ทั้งเซสชันใช้ ctx.globalCompositeOperation
   ที่เก็บ/คืนด้วย save/restore เสมอ เพื่อไม่ให้สถานะรั่วไปฟังก์ชันวาดอื่น */
function glowOn(c, alpha = 1) {
  c.save();
  c.globalCompositeOperation = "lighter";
  c.globalAlpha = alpha;
}
const glowOff = (c) => c.restore();
// เงามืดรอบตัวอักษรจีน ให้ตัวอักษรลอยออกจากพื้นหลัง (อ่านง่ายขึ้นบนมือถือ)
function textShadowOn(c, blur = 6, color = "rgba(0,0,0,.65)") {
  c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetY = 1;
}
function textShadowOff(c) { c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0; }

/* ================= Bloom ปลอม =================
   ย่อ canvas → เบลอ → วาดทับแบบบวก: ไฟ/ระเบิด/แสงปากกระบอกจะ "ฟุ้ง" เป็นแสงจริง
   เก็บสำเนาย่อในออฟสกรีนบัฟเฟอร์ 1 ใบต่อ canvas (WeakMap) จึงไม่สร้าง canvas ใหม่ทุกเฟรม
   ต้นทุนต่อเฟรม: drawImage ย่อ 1 ครั้ง + drawImage เบลอ 1 ครั้ง (เบลอจ่ายที่ภาพเล็ก 1/4)
   ต้องประกาศ "ก่อน" ฟังก์ชันที่เรียกใช้ เพราะ const/function ที่อยู่หลังจะยังไม่ถูก hoist
   (เดิมวางไว้หลัง loop → เฟรมแรก throw ReferenceError ทำให้เกมหยุดวาด) */
const bloomBuf = new WeakMap();
const BLOOM_DIV = 4;          // ย่อเหลือ 1/4 ก่อนเบลอ → เร็วและเบลอกว้างพอ
const BLOOM_BLUR = 7;         // รัศมีเบลอ (หน่วยของภาพย่อ)
const BLOOM_ALPHA = 0.5;      // ความแรงของแสงที่ทับกลับ
function bloom(src, sc, lw, lh) {
  if (!lw || !lh) return;
  let b = bloomBuf.get(src);
  if (!b) { b = document.createElement("canvas"); bloomBuf.set(src, b); }
  const bw = Math.max(1, Math.ceil(lw / BLOOM_DIV)), bh = Math.max(1, Math.ceil(lh / BLOOM_DIV));
  if (b.width !== bw || b.height !== bh) { b.width = bw; b.height = bh; }
  const bc = b.getContext("2d");
  bc.setTransform(1, 0, 0, 1, 0, 0);
  bc.globalAlpha = 1;
  bc.globalCompositeOperation = "source-over";
  bc.clearRect(0, 0, bw, bh);
  bc.drawImage(src, 0, 0, bw, bh);
  bc.filter = `blur(${BLOOM_BLUR}px)`; // เบลอตอนวาดกลับ → ต้นทุนจ่ายที่ภาพเล็ก
  sc.save();
  sc.globalCompositeOperation = "lighter";
  sc.globalAlpha = BLOOM_ALPHA;
  sc.drawImage(b, 0, 0, lw, lh);
  sc.restore();
  bc.filter = "none";
}
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

const groundY = () => rocketBar.offsetTop || H - 90;
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
