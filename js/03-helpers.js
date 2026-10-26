"use strict";
/* ================= Helpers ================= */

/* ---------- ป้ายระดับ HSK ของคำศัพท์ ----------
   คำศัพท์ของหมวดอื่นอาจมีคำที่อยู่ใน HSK ด้วย จึงค้นจากคลัง HSK โดยตรง
   ไม่ใช้ currentLevel อย่างเดียว (กรณีเลือกหลายระดับ เช่น 1+2) */
const CR_HSK_WORD_LEVEL = new Map();
const CR_HSK_ZH_LEVEL = new Map();
const CR_HSK_SENT_LEVEL = new WeakMap();
const CR_HSK_SENT_KEY_LEVEL = new Map();
let crHskIndexReady = false;
let crHskSentenceIndexReady = false;
function crBuildHskIndex() {
  if (crHskIndexReady) return;
  crHskIndexReady = true;
  if (typeof VOCAB === "undefined" || !VOCAB) return;
  for (const [level, words] of Object.entries(VOCAB)) {
    for (const word of words || []) {
      if (!word || !word[0]) continue;
      const zh = String(word[0]).split(/[｜|]/)[0].trim();
      const key = `${zh}|${word[1] || ""}`;
      if (!CR_HSK_WORD_LEVEL.has(key)) CR_HSK_WORD_LEVEL.set(key, level);
      if (!CR_HSK_ZH_LEVEL.has(zh)) CR_HSK_ZH_LEVEL.set(zh, level);
    }
  }
}
function crHskInfoForWord(word, fallbackLevel) {
  crBuildHskIndex();
  const zh = String((word && word[0]) || "").split(/[｜|]/)[0].trim();
  if (!zh) return crHskInfoForLevel(fallbackLevel);
  const level = CR_HSK_WORD_LEVEL.get(`${zh}|${(word && word[1]) || ""}`)
    || CR_HSK_ZH_LEVEL.get(zh)
    || "";
  if (!level) return crHskInfoForLevel(fallbackLevel);
  return { level, label: `HSK ${String(level).replace("-", "–")}` };
}
function crHskInfoForLevel(level) {
  if (currentCategory !== "hsk") return null;
  const parts = levelParts(level).map((part) => String(part).replace("-", "–"));
  if (!parts.length) return null;
  return {
    level: parts.length === 1 ? parts[0].replace("–", "-") : "multi",
    label: `HSK ${parts.join(" + ")}`,
  };
}
function crSentenceKey(sentence) {
  if (!sentence || !sentence[0]) return "";
  return `${sentence[0]}|${sentence[1] || ""}|${sentence[2] || ""}`;
}
function crBuildHskSentenceIndex() {
  if (crHskSentenceIndexReady) return;
  crHskSentenceIndexReady = true;
  if (typeof SENTENCES === "undefined" || !SENTENCES) return;
  for (const [level, sentences] of Object.entries(SENTENCES)) {
    for (const sentence of sentences || []) {
      if (!sentence || !sentence[0]) continue;
      CR_HSK_SENT_LEVEL.set(sentence, level);
      const key = crSentenceKey(sentence);
      if (key && !CR_HSK_SENT_KEY_LEVEL.has(key)) CR_HSK_SENT_KEY_LEVEL.set(key, level);
    }
  }
}
function crHskInfoForSentence(sentence) {
  if (currentCategory !== "hsk") return null;
  crBuildHskSentenceIndex();
  const level = CR_HSK_SENT_LEVEL.get(sentence) || CR_HSK_SENT_KEY_LEVEL.get(crSentenceKey(sentence));
  if (!level) return null;
  return { level, label: `HSK ${String(level).replace("-", "–")}` };
}
function crSetHskBadge(element, word, fallbackLevel) {
  if (!element) return;
  const info = crHskInfoForWord(word, fallbackLevel);
  element.hidden = !info;
  element.textContent = info ? info.label : "";
  if (info) {
    element.dataset.hsk = info.level;
    element.setAttribute("aria-label", `ระดับ ${info.label}`);
  } else {
    delete element.dataset.hsk;
    element.removeAttribute("aria-label");
  }
}
function crSetHskLevelBadge(element, level) {
  if (!element) return;
  const info = crHskInfoForLevel(level);
  element.hidden = !info;
  element.textContent = info ? info.label : "";
  if (info) {
    element.dataset.hsk = info.level;
    element.setAttribute("aria-label", `ระดับ ${info.label}`);
  } else {
    delete element.dataset.hsk;
    element.removeAttribute("aria-label");
  }
}
function crSetHskSentenceBadge(element, sentence) {
  if (!element) return;
  const info = crHskInfoForSentence(sentence);
  element.hidden = !info;
  element.textContent = info ? info.label : "";
  if (info) {
    element.dataset.hsk = info.level;
    element.setAttribute("aria-label", `ระดับ ${info.label}`);
  } else {
    delete element.dataset.hsk;
    element.removeAttribute("aria-label");
  }
}

/* ---------- ข้อความจีนกดเปิดบับเบิ้ลคำศัพท์ได้ทุกเกม ----------
   ข้อความบางโหมดถูกวาดลง canvas จึงใช้ toast/แผง DOM ที่แสดงคำเดียวกันเป็นจุดแตะ
   ส่วนข้อความ DOM ทั้งหมดมารวมที่นี่ เพื่อให้ปุ่ม "✍️ ดูเส้นขีด" ใน cpWordPopup
   ทำงานเหมือนกันทั้งเกมคำศัพท์ เกมประโยค เกมฟัง และโหมดที่มีข้อความจีน */
const CR_HAN_RE = /[㐀-鿿豈-﫿]/;
const CR_STROKE_TARGETS = [
  "#quizWord", "#spkZh", "#lisZh", "#tcZh",
  "#bombWord", "#bombWritingWord", "#bombRevealWord",
  ".fb-zh", ".toast-zh", ".vo-sent-zh",
  ".r-zh:not(.cpw-zh)",
];
function crStrokeTargetForEvent(target) {
  if (!target || !target.closest) return null;
  for (const selector of CR_STROKE_TARGETS) {
    const hit = target.closest(selector);
    if (hit) return hit;
  }
  return null;
}
function crOpenTextBubble(target) {
  if (!target || target.closest("#cpWordPopup")) return;
  // These already have a purpose-built word bubble and should not be opened twice.
  if (target.closest(".cp-zh-tok, .pod-word, .reader-word")) return;
  const zh = (target.dataset && target.dataset.strokeZh) || target.textContent || "";
  if (!CR_HAN_RE.test(zh) || typeof cpShowWordPopup !== "function") return;
  cpShowWordPopup(zh.trim(), target);
}
function crOpenCanvasTextBubble(zh, clientX, clientY) {
  if (!CR_HAN_RE.test(zh) || typeof cpShowWordPopup !== "function") return;
  // cpWordPopup already knows how to keep a normal DOM anchor inside the viewport.
  // A tiny virtual anchor lets canvas-rendered words use the same placement code.
  const anchor = {
    isConnected: true,
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({
      left: clientX, right: clientX, top: clientY, bottom: clientY,
      width: 0, height: 0,
    }),
  };
  cpShowWordPopup(zh.trim(), anchor);
}
document.addEventListener("click", (event) => {
  const target = crStrokeTargetForEvent(event.target);
  if (target) crOpenTextBubble(target);
});

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

// ปุ่ม ✖ มุมขวาบนของเกม: ย้อนกลับไปหน้าตั้งค่าของโหมดนั้นก่อน (ไม่ใช่หน้าหลัก)
// ยกเว้นเกมที่ไม่ได้เข้าผ่านหน้าตั้งค่า — เกมภารกิจประจำวัน (msRun) หรือ gameMode เป็นโหมดอื่น — กลับหน้าหลักเหมือนเดิม
function exitToSetup(mode) {
  const viaSetup = gameMode === mode && !(typeof msRun !== "undefined" && msRun);
  switchScreen(viaSetup ? $("setup") : menuEl);
  if (viaSetup) updateStartBtn();
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

/* ---------- ช่วยตัวตรวจขีดของ HanziWriter กับขีดสั้น (จุด/ขีดเล็ก/ตะขอ) ---------- */
// HanziWriter 3.7.3 quiz ตรวจขีดด้วย 5 เงื่อนไข และ "shapeFit" (Fréchet บนเส้นที่ถูก normalize ตามความยาวขีดเอง)
// คือตัวที่ทำให้ขีดสั้นไม่ติด: นิ้วสั่น/จุดแตะเลื่อน 1–3 px คงที่ แต่จุด 点 ในช่องเขียนเล็ก ๆ ยาวแค่ 5–12 px
// สัญญาณรบกวนจึงใหญ่พอ ๆ กับตัวขีด (จำลองแล้ว: ช่อง 75 px ขีดสั้นผ่านแค่ ~85 %, ช่อง 60 px ~72 %)
// และ HanziWriter ทิ้งตำแหน่งตอนยกนิ้ว (touchend/mouseup) ไป จุดที่ปัดเร็ว ๆ จึงเหลือแค่ 2–3 จุด
// แก้ 3 ชั้น (ไม่แตะไลบรารี เพราะเว็บโหลดจาก CDN แบบ SRI): (1) ต่อจุดยกนิ้วเข้าไปท้ายเส้น
// (2) ตัด jitter ระดับ px ก่อนส่งให้ตัวตรวจเดิม (3) ขีดเป้าหมายที่สั้นบนจอ ถ้าตัวตรวจเดิมปฏิเสธ ให้ตรวจซ้ำด้วยเกณฑ์
// ที่คิดเผื่อ noise เป็น px — ต้องถูกตำแหน่ง ทิศ ขนาด และรูปทรงคร่าว ๆ และต้องใกล้ขีดนี้ที่สุดในบรรดาขีดที่ยังไม่เขียน
// ผ่านแล้วบังคับยอมรับผ่าน markStrokeCorrectAfterMisses ชั่วคราว (= ทางเดียวกับที่ไลบรารีใช้ยอมรับขีดเอง)
// ขีดถอยหลัง ขีดผิดลำดับ ขีดผิดที่ เส้นยาวแทนจุด และขีดมั่วยังถูกปฏิเสธเหมือนเดิม (ทดสอบด้วย medians ของ hanzi-writer-data)
// HW-STROKE-FIX BEGIN (ฟังก์ชันล้วน — สคริปต์ทดสอบดึงโค้ดช่วงนี้ไปรันตรง ๆ ห้ามอ้าง DOM/ตัวแปรอื่นในช่วงนี้)
const HW_LIFT_MIN_PX = 0.75; // ต่อจุดยกนิ้วเมื่อห่างจากจุดล่าสุดอย่างน้อยเท่านี้ (แตะเฉย ๆ จะยังถูกข้ามเหมือนเดิม)
const HW_JITTER_PX = 1.2;    // จุดที่ห่างจากจุดก่อนหน้าน้อยกว่านี้ถือเป็นนิ้วสั่น
const HW_SHORT_PX = 30;      // ขีดเป้าหมายที่ยาวบนจอไม่เกินนี้ได้ตรวจรอบสอง
function hwDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function hwLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += hwDist(pts[i], pts[i - 1]); return L; }
function hwResample(pts, n) {
  const L = hwLen(pts), out = [pts[0]];
  if (!L) return Array(n).fill(pts[0]);
  let seg = 1, acc = 0;
  for (let k = 1; k < n - 1; k++) {
    const d = (L * k) / (n - 1);
    while (seg < pts.length - 1 && acc + hwDist(pts[seg], pts[seg - 1]) < d) { acc += hwDist(pts[seg], pts[seg - 1]); seg++; }
    const s = hwDist(pts[seg], pts[seg - 1]), t = s ? (d - acc) / s : 0;
    out.push({ x: pts[seg - 1].x + (pts[seg].x - pts[seg - 1].x) * t, y: pts[seg - 1].y + (pts[seg].y - pts[seg - 1].y) * t });
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// ตัด jitter ระดับ px (upx = หน่วยตัวอักษร 1024 ต่อ 1 px บนจอ): ทิ้งจุดที่กระจุกกันตอนนิ้วช้า/หยุด
// แล้วเกลี่ยจุดกลางด้วย [1,2,1] — จุดต้น/ปลายคงไว้ ขีดยาว ๆ แทบไม่เปลี่ยน เพราะระยะที่ตัดเป็น px ไม่ใช่สัดส่วน
function hwCleanStroke(points, upx) {
  if (!points || points.length < 3 || !(upx > 0)) return points;
  const gap = HW_JITTER_PX * upx, last = points[points.length - 1];
  const kept = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (hwDist(points[i], kept[kept.length - 1]) >= gap) kept.push(points[i]);
  while (kept.length > 1 && hwDist(last, kept[kept.length - 1]) < gap) kept.pop();
  kept.push(last);
  if (kept.length < 3) return kept;
  return kept.map((p, i) => (i === 0 || i === kept.length - 1) ? p
    : { x: (kept[i - 1].x + 2 * p.x + kept[i + 1].x) / 4, y: (kept[i - 1].y + 2 * p.y + kept[i + 1].y) / 4 });
}
// ตรวจรอบสองสำหรับขีดเป้าหมายที่สั้นบนจอ — points/medians อยู่ในพิกัดตัวอักษรของ HanziWriter
function hwShortStrokeOk(points, character, strokeNum, options, upx) {
  const strokes = character && character.strokes;
  const target = strokes && strokes[strokeNum] && strokes[strokeNum].points;
  if (!target || target.length < 2 || !points || points.length < 2 || !(upx > 0)) return false;
  const tLen = hwLen(target), len = hwLen(points);
  if (tLen / upx > HW_SHORT_PX) return false;
  const leniency = options.leniency || 1, noise = 2 * upx;
  // ขนาด: ไม่เล็กเป็นแค่จิ้ม และไม่ยาวเป็นเส้นแทนจุด
  if (len < 0.3 * tLen || len > 2.2 * tLen + 6 * upx) return false;
  // ทิศ: เวกเตอร์ต้น→ปลายต้องไปทางเดียวกัน (ภายใน ~60°) — ขีดถอยหลัง/ผิดทิศไม่ผ่าน
  const tv = { x: target[target.length - 1].x - target[0].x, y: target[target.length - 1].y - target[0].y };
  const uv = { x: points[points.length - 1].x - points[0].x, y: points[points.length - 1].y - points[0].y };
  const tc = Math.hypot(tv.x, tv.y), uc = Math.hypot(uv.x, uv.y);
  if (!uc || !tc || (tv.x * uv.x + tv.y * uv.y) / (tc * uc) < 0.5) return false;
  // ความตรง: ขีดมั่ว/วนไปมาไม่ผ่าน (เทียบกับความตรงของขีดเป้าหมายเอง)
  if (uc / len < 0.45 * (tc / tLen)) return false;
  // ตำแหน่ง: กึ่งกลางเส้นต้องใกล้กึ่งกลางขีด และต้นกับปลายอยู่ในเกณฑ์เดียวกับ HanziWriter (250 × leniency)
  const N = 9, U = hwResample(points, N), T = hwResample(target, N);
  if (hwDist(U[4], T[4]) > 0.4 * tLen + 50 + noise) return false;
  if (hwDist(U[0], T[0]) > 250 * leniency || hwDist(U[N - 1], T[N - 1]) > 250 * leniency) return false;
  // รูปทรงคร่าว ๆ: ย้ายจุดศูนย์กลางมาทับกัน ย่อ/ขยายให้ยาวเท่ากัน แล้ววัดระยะเฉลี่ยจุดต่อจุด (เผื่อ noise เป็น px)
  const c = (P) => P.reduce((a, p) => ({ x: a.x + p.x / N, y: a.y + p.y / N }), { x: 0, y: 0 });
  const cu = c(U), ct = c(T), k = tLen / len;
  let dev = 0;
  for (let i = 0; i < N; i++) dev += Math.hypot((U[i].x - cu.x) * k - (T[i].x - ct.x), (U[i].y - cu.y) * k - (T[i].y - ct.y)) / N;
  if (dev > 0.22 * tLen + noise) return false;
  // ต้องใกล้ขีดนี้ที่สุดเมื่อเทียบกับขีดอื่นทั้งตัว (กันเขียนผิดลำดับ/ซ้ำขีดเดิม เช่น จุดสองจุดของ 冫)
  const myD = hwDist(U[4], T[4]);
  for (let j = 0; j < strokes.length; j++) {
    const o = j !== strokeNum && strokes[j].points;
    if (o && o.length > 1 && hwDist(U[4], hwResample(o, N)[4]) < myD) return false;
  }
  return true;
}
// HW-STROKE-FIX END

// ผูกตัวช่วยเข้ากับ writer หนึ่งตัว — เรียกครั้งเดียวหลังสร้าง HanziWriter ที่จะใช้ quiz() (copy / trace / bomb)
// แพตช์ Quiz.prototype.endUserStroke ครั้งเดียวตอนเริ่มขีดแรก (คลาส Quiz ไม่ได้ export ออกมา จึงหยิบจาก writer._quiz)
let hwActiveWriter = null;
let hwStrokeFixOn = true; // สวิตช์ดีบัก: ตั้ง false ใน console เพื่อเทียบกับพฤติกรรมเดิมของ HanziWriter
function hwPatchQuizProto(quiz) {
  const proto = quiz && Object.getPrototypeOf(quiz);
  if (!proto || proto.__crShortStroke || typeof proto.endUserStroke !== "function") return;
  proto.__crShortStroke = true;
  const orig = proto.endUserStroke;
  proto.endUserStroke = function () {
    const us = this._userStroke;
    let force = false;
    if (hwStrokeFixOn) try {
      const scale = this._positioner && this._positioner.scale;
      if (us && us.points && us.points.length > 1 && this._character && scale > 0) {
        const upx = 1 / scale;
        us.points = hwCleanStroke(us.points, upx);
        force = hwShortStrokeOk(us.points, this._character, this._currentStrokeIndex, this._options || {}, upx);
      }
    } catch (e) { force = false; }
    if (!force || !this._options) return orig.call(this);
    // ยอมรับขีดนี้ด้วย branch "isForceAccepted" ของไลบรารีเอง แล้วคืนค่าเดิมทันที
    const saved = this._options.markStrokeCorrectAfterMisses;
    this._options.markStrokeCorrectAfterMisses = 1;
    try { return orig.call(this); } finally { this._options.markStrokeCorrectAfterMisses = saved; }
  };
}
function hwEnhanceWriter(writer) {
  const node = writer && writer.target && writer.target.node;
  if (!node || writer.__crEnhanced) return;
  writer.__crEnhanced = true;
  // capture บน node เดียวกัน ทำงานก่อน listener ของ HanziWriter → แพตช์ prototype ทันก่อนขีดแรกจบ
  const onStart = () => { hwActiveWriter = writer; if (writer._quiz) hwPatchQuizProto(writer._quiz); };
  node.addEventListener("touchstart", onStart, { capture: true, passive: true });
  node.addEventListener("mousedown", onStart, true);
  if (hwEnhanceWriter.wired) return;
  hwEnhanceWriter.wired = true;
  // HanziWriter จบขีดจาก touchend/mouseup ที่ document (bubble) แต่ไม่เก็บตำแหน่งยกนิ้ว —
  // capture ที่ document มาก่อนเสมอ จึงต่อจุดนั้นเข้าไปท้ายเส้นได้ก่อนตรวจ
  const onEnd = (getPoint) => {
    const w = hwActiveWriter, quiz = w && w._quiz, us = quiz && quiz._userStroke;
    if (!hwStrokeFixOn || !us || !us.externalPoints || !us.externalPoints.length) return;
    try {
      const p = getPoint(w.target);
      const last = us.externalPoints[us.externalPoints.length - 1];
      if (p && isFinite(p.x) && isFinite(p.y) && hwDist(p, last) >= HW_LIFT_MIN_PX) quiz.continueUserStroke(p);
    } catch (err) { /* ไม่มีจุดยกนิ้วก็ตรวจแบบเดิม */ }
  };
  document.addEventListener("touchend", (e) => {
    const t = e.changedTouches && e.changedTouches[0];
    if (t) onEnd((target) => target._getTouchPoint({ touches: [t] }));
  }, true);
  // เมาส์: HanziWriter ฟัง mousemove เฉพาะในช่องเขียน ถ้าปล่อยนอกช่องจะเป็นจุดกระโดด จึงต่อเฉพาะตอนปล่อยในช่อง
  document.addEventListener("mouseup", (e) => onEnd((target) => (target.node.contains(e.target) ? target._getMousePoint(e) : null)), true);
}
