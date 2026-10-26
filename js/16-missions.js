"use strict";
/* ================= เกมภารกิจประจำวัน (Daily Missions) =================
   บับเบิ้ล 📖 มุมซ้ายล่างของหน้าหลัก → รัน 4 เกมต่อเนื่องกันอัตโนมัติโดยไม่ต้องกลับเมนู
   - ความคืบหน้ารีเซ็ตทุกวันหลังเที่ยงคืน (เก็บใน localStorage รายวัน)
   - สุ่มระดับ HSK 1–6 แยกของแต่ละเกม คงที่ทั้งวัน (วนเกมที่ไม่ผ่านก็ระดับเดิม)
   - เกมใดไม่ผ่าน (จบเกม) จะนับเวลาถอยหลังแล้วเริ่มเกมนั้นซ้ำจนกว่าจะผ่าน
   - ผ่านครบทั้ง 4 → ปุ่มบับเบิ้ลเป็นสีทึบ (ยังไม่ครบ = สีสว่าง)
   - ออกกลางทางได้ทุกเมื่อ (ปุ่ม ✖ ของแถบภารกิจ / ปุ่มออกของเกมนั้น)
     เกมที่ผ่านไปแล้วถูกจดไว้ เริ่มใหม่จะไหลไปเกมถัดไปที่ยังไม่ผ่าน */

const MS_KEY = "cr_daily_missions_v1";
const MS_LEVELS = ["1", "2", "3", "4", "5", "6"]; // สุ่มเฉพาะ HSK 1–6
const MS_FAIL_WAIT = 5;     // วินาทีบนหน้าจบเกม ก่อนเริ่มเกมที่ไม่ผ่านซ้ำอัตโนมัติ
const MS_PASS_WAIT = 2600;  // มิลลิวินาที แสดงหน้า "ผ่าน" ก่อนไปเกมถัดไปอัตโนมัติ

const msDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function msSave(st) { localStorage.setItem(MS_KEY, JSON.stringify(st)); }

// อ่านสถานะของวันนี้ — ข้ามเที่ยงคืนแล้วคืนชุดใหม่ (ระดับสุ่มใหม่ + ล้างสถานะผ่าน)
function msState() {
  const today = msDayKey();
  let st = null;
  try { st = JSON.parse(localStorage.getItem(MS_KEY) || "null"); } catch (e) { st = null; }
  if (!st || st.d !== today || !st.levels || !st.done) {
    st = { d: today, done: {} };
    st.levels = {};
    MS_GAMES.forEach((g) => { st.levels[g.id] = pick(MS_LEVELS); });
    msSave(st);
  }
  MS_GAMES.forEach((g) => { if (!st.levels[g.id]) st.levels[g.id] = pick(MS_LEVELS); });
  return st;
}

const msFmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/* ---------- เลเวลวันเล่นต่อเนื่อง (เฉพาะแอป APK; ?streakPreview=1 สำหรับทดสอบบนเว็บ) ----------
   ทำภารกิจครบทั้ง 4 เกมในวันนั้น = สะสม 1 วัน → เลเวล = จำนวนวันติดต่อกัน (สูงสุด Lv 20 แต่นับวันต่อไปเรื่อยๆ)
   วันไหนไม่ได้ทำครบ (ขาด 1 วัน) → กลับไปเริ่ม Lv 0 ใหม่
   localStorage cr_mission_streak_v1 = { days: วันติดต่อกัน, last: วันล่าสุดที่ทำครบ YYYY-MM-DD, best, total } */
const MS_STREAK_KEY = "cr_mission_streak_v1";
const MS_STREAK_ON = !!window.CR_OFFLINE_APP || /[?&]streakPreview=1\b/.test(location.search);
const MS_STREAK_LEVELS = [
  { icon: "🛖", th: "จุดเริ่มต้น", zh: "起点", py: "qǐdiǎn" },
  { icon: "🌱", th: "มือใหม่หัดบิน", zh: "新手", py: "xīnshǒu" },
  { icon: "🔧", th: "ศิษย์ช่างจรวด", zh: "学徒", py: "xuétú" },
  { icon: "🧑‍🚀", th: "นักบินฝึกหัด", zh: "学员", py: "xuéyuán" },
  { icon: "🔥", th: "จุดระเบิดเครื่องยนต์", zh: "点火", py: "diǎnhuǒ" },
  { icon: "🚀", th: "ทะยานขึ้นฟ้า", zh: "升空", py: "shēngkōng" },
  { icon: "☁️", th: "ทะลุกลุ่มเมฆ", zh: "穿云", py: "chuānyún" },
  { icon: "🌤️", th: "เหินฟ้าสูง", zh: "高空", py: "gāokōng" },
  { icon: "🛰️", th: "ดาวเทียมโคจร", zh: "卫星", py: "wèixīng" },
  { icon: "🌙", th: "นักสำรวจดวงจันทร์", zh: "探月", py: "tànyuè" },
  { icon: "🌕", th: "ผู้พิชิตดวงจันทร์", zh: "登月", py: "dēngyuè" },
  { icon: "🔴", th: "นักบุกเบิกดาวอังคาร", zh: "火星先锋", py: "huǒxīng xiānfēng" },
  { icon: "☄️", th: "นักล่าอุกกาบาต", zh: "流星猎手", py: "liúxīng lièshǒu" },
  { icon: "🪐", th: "นักเดินทางดาวเสาร์", zh: "土星旅人", py: "tǔxīng lǚrén" },
  { icon: "🌌", th: "นักท่องทางช้างเผือก", zh: "银河旅人", py: "yínhé lǚrén" },
  { icon: "⭐", th: "ผู้นำทางดวงดาว", zh: "星际领航", py: "xīngjì lǐngháng" },
  { icon: "🌠", th: "อัศวินดาวหาง", zh: "彗星骑士", py: "huìxīng qíshì" },
  { icon: "🐉", th: "มังกรอวกาศ", zh: "太空龙", py: "tàikōng lóng" },
  { icon: "🏯", th: "จอมยุทธ์แห่งดวงดาว", zh: "星辰侠客", py: "xīngchén xiákè" },
  { icon: "👑", th: "จักรพรรดิแห่งจักรวาล", zh: "宇宙之王", py: "yǔzhòu zhī wáng" },
  { icon: "🏆", th: "ปรมาจารย์ภาษาจีน", zh: "中文大师", py: "zhōngwén dàshī" },
];
const MS_STREAK_MAX = MS_STREAK_LEVELS.length - 1; // 20

function msPrevDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return msDayKey(new Date(y, m - 1, d - 1));
}
const msStreakLevel = (days) => Math.min(days, MS_STREAK_MAX);

function msStreakSave(s) { try { localStorage.setItem(MS_STREAK_KEY, JSON.stringify(s)); } catch (e) {} }

// อ่านสถิติ — ถ้าวันล่าสุดที่ทำครบไม่ใช่วันนี้หรือเมื่อวาน แปลว่าขาดไปแล้วอย่างน้อย 1 วัน → Lv 0
function msStreak() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(MS_STREAK_KEY) || "null"); } catch (e) { s = null; }
  if (!s || typeof s.days !== "number") s = { days: 0, last: "", best: 0, total: 0 };
  const today = msDayKey();
  if (s.days > 0 && s.last !== today && s.last !== msPrevDayKey(today)) {
    s.days = 0;
    msStreakSave(s);
  }
  return s;
}

// เรียกเมื่อภารกิจของวันนี้ครบทั้ง 4 เกม (นับวันละครั้ง) → { s, before, after }
function msStreakRecord() {
  const s = msStreak();
  const today = msDayKey();
  const before = msStreakLevel(s.days);
  if (s.last !== today) {
    s.days = s.last === msPrevDayKey(today) ? s.days + 1 : 1;
    s.last = today;
    s.best = Math.max(s.best || 0, s.days);
    s.total = (s.total || 0) + 1;
    msStreakSave(s);
  }
  return { s, before, after: msStreakLevel(s.days) };
}

/* ---------- นิยาม 4 ภารกิจของแต่ละวัน (ลำดับตามที่รัน) ---------- */
const MS_GAMES = [
  {
    id: "vocab", icon: "📖", short: "คำศัพท์",
    name: "เกมคำศัพท์ (เลือกพินอิน)",
    desc: "เลือกพินอินให้ถูก • เปลี่ยนคำอัตโนมัติ • ตอบถูกให้ครบ 20 คำ • ไม่จำกัดชีวิต",
    target: 20,
    setup() { quizMode = "pinyin"; autoNext = true; quizLivesOn = false; },
    start(level) { startQuizGame(level); },
    alive() { return !!quiz; },
    passed() { return !!quiz && quiz.done.size >= this.target; },
    progressText() { return `${quiz ? quiz.done.size : 0}/20 คำ`; },
    stop() {
      if (quiz) { clearTimeout(quiz.nextTimer); quiz = null; }
      music.stop(); stopSpeech();
    },
  },
  {
    id: "sent", icon: "💬", short: "ทายประโยค",
    name: "เกมทายประโยค (จีน → ไทย)",
    desc: "อ่านจีนเลือกคำแปลไทย • ไม่แสดงพินอิน • เปลี่ยนประโยคอัตโนมัติ • ครบ 15 ประโยค • ไม่จำกัดชีวิต",
    target: 15,
    setup() { sentQuizDirection = "zh"; sentQuizShowPinyin = false; autoNext = true; quizLivesOn = false; },
    start(level) { startSentenceQuiz(level); },
    alive() { return !!sentQuiz; },
    passed() { return !!sentQuiz && sentQuiz.done.size >= this.target; },
    progressText() { return `${sentQuiz ? sentQuiz.done.size : 0}/15 ประโยค`; },
    stop() {
      if (sentQuiz) { clearTimeout(sentQuiz.nextTimer); sentQuiz = null; }
      cpHideWordPopup(); music.stop(); stopSpeech();
    },
  },
  {
    id: "match", icon: "🃏", short: "แฟลชการ์ด",
    name: "เกมแฟลชการ์ดจับคู่ (10 ใบ)",
    desc: "จับคู่จีน–พินอิน • 10 ใบ • ไม่จำกัดเวลา • เล่นให้ครบ 10 รอบ",
    target: 10,
    setup() {},
    start(level) { startMatchingGame(level, "pinyin", "hard", 0); },
    alive() { return !!matching; },
    passed() { return !!matching && matching.rounds >= this.target; },
    progressText() { return `${matching ? matching.rounds : 0}/10 รอบ`; },
    stop() { stopMatchingGame(); },
  },
  {
    id: "bomb", icon: "💣", short: "ปลดระเบิด",
    name: "เกมเขียนปลดระเบิด (ภารกิจ)",
    desc: "ความยากปานกลาง • ไม่จำกัดชีวิต • ไม่จำกัดเวลา • ปลดระเบิดครบ 20 คำจึงผ่าน (คำที่เลือกพินอินผิดไม่ถูกนับ)",
    target: 20,
    setup() {},
    start(level) { startBombGame(level, "medium", { mission: true }); },
    alive() { return !!bombGame; },
    passed() { return !!bombGame && bombGame.defused >= this.target; },
    progressText() { return `${bombGame ? bombGame.defused : 0}/20 คำ`; },
    stop() { stopBombGame(); },
  },
];

/* ---------- ตัวรันเนอร์ ---------- */
let msRun = null;          // { day, idx, phase: "playing" | "failwait" | "inter", failAt }
let msPollTimer = null;
let msSaved = null;        // ค่า global ก่อนเข้าภารกิจ (คืนตอนออก)
let msOvCfg = null;
let msOvTimer = null;
let msOverNoteEl = null;

function msApplyGlobals() {
  if (msSaved) return;
  msSaved = { quizMode, quizLivesOn, autoNext, sentQuizDirection, sentQuizShowPinyin, currentCategory };
  currentCategory = "hsk"; // ภารกิจใช้คลัง HSK เสมอ ไม่ยุ่งกับหมวดที่ผู้เล่นเลือกไว้
  updateCategoryDropdownUI();
}
function msRestoreGlobals() {
  if (!msSaved) return;
  quizMode = msSaved.quizMode;
  quizLivesOn = msSaved.quizLivesOn;
  autoNext = msSaved.autoNext;
  sentQuizDirection = msSaved.sentQuizDirection;
  sentQuizShowPinyin = msSaved.sentQuizShowPinyin;
  currentCategory = msSaved.currentCategory;
  updateCategoryDropdownUI();
  msSaved = null;
}

function msBeginRun() {
  if (msRun) return;
  const st = msState();
  const first = MS_GAMES.findIndex((g) => !st.done[g.id]);
  if (first < 0) return;
  msApplyGlobals();
  msRun = { day: st.d, idx: first, phase: "playing", failAt: 0 };
  $("missionHud").hidden = false;
  msStartGame(first);
  clearInterval(msPollTimer);
  msPollTimer = setInterval(msTick, 400);
}

function msStartGame(i) {
  const run = msRun;
  if (!run) return;
  const st = msState();
  const g = MS_GAMES[i];
  run.idx = i;
  run.phase = "playing";
  run.failAt = 0;
  g.setup();
  g.start(st.levels[g.id]);
  msHudUpdate();
}

// หัวใจของภารกิจ: ตรวจทุก 400ms ว่า เกมปัจจุบันผ่าน / จบเกม(ไม่ผ่าน) / ผู้เล่นออก
function msTick() {
  const run = msRun;
  if (!run) return;
  const st = msState();
  if (st.d !== run.day) { msAbort(); return; }        // ข้ามเที่ยงคืน → ภารกิจใหม่
  if (!$("missionOverlay").hidden) return;             // กำลังตอบปุ่ม overlay (เช่น ยืนยันออก)
  if (run.phase === "inter") return;
  const g = MS_GAMES[run.idx];
  const active = document.querySelector(".screen.active");
  const activeId = active ? active.id : "";
  if (activeId === "menu" || activeId === "setup") { msAbort(); return; } // ผู้เล่นออกเอง
  if (g.passed()) { msPass(); return; }

  if (overEl.classList.contains("active")) {
    if (run.phase !== "failwait") {
      run.phase = "failwait";
      run.failAt = Date.now();
      msAddOverNote();
    } else if (g.alive()) {
      // ผู้เล่นกด "เล่นอีกครั้ง" เองก่อนนับถอยหลังจะหมด → เล่นต่อตามปกติ
      run.phase = "playing";
      run.failAt = 0;
      msRemoveOverNote();
      msHudUpdate();
    } else {
      const left = Math.max(0, Math.ceil(MS_FAIL_WAIT - (Date.now() - run.failAt) / 1000));
      const hud = $("msHudText");
      hud.textContent = `❌ ${g.short} ยังไม่ผ่าน — เริ่มใหม่ใน ${left} วิ`;
      hud.setAttribute("aria-label", hud.textContent);
      if (left <= 0) { msRemoveOverNote(); msStartGame(run.idx); }
    }
    return;
  }
  if (run.phase === "failwait") { run.phase = "playing"; run.failAt = 0; msRemoveOverNote(); }
  msHudUpdate();
}

function msPass() {
  const run = msRun;
  if (!run) return;
  const g = MS_GAMES[run.idx];
  g.stop();
  const st = msState();
  st.done[g.id] = true;
  msSave(st);
  run.phase = "inter";
  msHudUpdate();
  sfx.hit();
  const doneCount = MS_GAMES.filter((x) => st.done[x.id]).length;
  const nextIdx = MS_GAMES.findIndex((x) => !st.done[x.id]);
  if (nextIdx < 0) {
    let title = "ภารกิจประจำวันครบแล้ว!";
    let text = "ผ่านครบทั้ง 4 เกม — บับเบิ้ล 📖 จะเปลี่ยนเป็นสีทึบ กลับมาทำใหม่พรุ่งนี้หลังเที่ยงคืน";
    let icon = "🎉";
    if (MS_STREAK_ON) {
      const { s, before, after } = msStreakRecord();
      const lv = MS_STREAK_LEVELS[after];
      if (after > before) { icon = lv.icon; title = `เลเวลอัป! Lv ${after} ${lv.th}`; }
      text = `ผ่านครบทั้ง 4 เกม • สะสมต่อเนื่อง ${s.days} วัน — Lv ${after} ${lv.icon} ${lv.th} (${lv.zh})\n`
        + "กลับมาทำให้ครบทุกวันเพื่อเลื่อนเลเวล — ขาด 1 วันจะกลับไปเริ่ม Lv 0";
    }
    msShowOverlay({
      icon, title, text,
      btn: "กลับหน้าหลัก",
      onBtn() { msAbort(); },
    });
  } else {
    const ng = MS_GAMES[nextIdx];
    msShowOverlay({
      icon: "✅", title: `ผ่าน! ครบแล้ว ${doneCount}/${MS_GAMES.length} เกม`,
      text: `ถัดไป: ${ng.name} — HSK ${msState().levels[ng.id]}`,
      btn: "เริ่มเลย", autoMs: MS_PASS_WAIT,
      onBtn() { if (msRun) msStartGame(nextIdx); },
    });
  }
}

function msAbort() {
  const run = msRun;
  if (!run) return;
  MS_GAMES[run.idx].stop();
  msEnd();
  if (!menuEl.classList.contains("active")) switchScreen(menuEl);
  updateBestLine();
}

function msEnd() {
  clearInterval(msPollTimer); msPollTimer = null;
  clearTimeout(msOvTimer); msOvTimer = null; msOvCfg = null;
  $("missionOverlay").hidden = true;
  $("missionHud").hidden = true;
  msRemoveOverNote();
  msRun = null;
  msRestoreGlobals();
  msSyncFab();
}

/* ---------- แถบความคืบหน้าลอยบนจอระหว่างเล่นภารกิจ ---------- */
function msHudUpdate() {
  const run = msRun;
  if (!run) return;
  const st = msState();
  const doneCount = MS_GAMES.filter((x) => st.done[x.id]).length;
  const g = MS_GAMES[run.idx];
  const hud = $("msHudText");
  hud.textContent = `📖 ${doneCount}/${MS_GAMES.length} • ${g.short} ${g.progressText()}`;
  hud.setAttribute("aria-label", `ภารกิจ ${doneCount} จาก ${MS_GAMES.length} — ${g.short} ${g.progressText()}`);
}

// พักเกมที่รองรับการพักไว้ก่อนเปิด overlay ยืนยัน (ระเบิด/แฟลชการ์ด) กันเสียเวลา/เสียชีวิตระหว่างตัดสินใจ
function msPauseCurrent() {
  if (!msRun) return;
  const id = MS_GAMES[msRun.idx].id;
  if (id === "bomb" && bombGame && !bombGame.paused) pauseBombGame();
  if (id === "match" && matching && !matching.paused) pauseMatchingGame();
}
function msResumeCurrent() {
  if (!msRun) return;
  const id = MS_GAMES[msRun.idx].id;
  if (id === "bomb" && bombGame && bombGame.paused) resumeBombGame();
  if (id === "match" && matching && matching.paused) $("matchResumeBtn").click();
}

/* ---------- ป้ายเตือนบนหน้าจบเกมว่าภารกิจจะเริ่มใหม่เอง ---------- */
function msAddOverNote() {
  if (msOverNoteEl && msOverNoteEl.isConnected) return;
  const box = document.querySelector("#gameover .overlay-box");
  if (!box) return;
  const p = document.createElement("p");
  p.className = "ms-over-note";
  p.textContent = `📖 ภารกิจประจำวัน: เกมนี้ยังไม่ผ่าน — จะเริ่มใหม่อัตโนมัติใน ${MS_FAIL_WAIT} วิ (หรือกด "เล่นอีกครั้ง")`;
  box.insertBefore(p, $("againBtn"));
  msOverNoteEl = p;
}
function msRemoveOverNote() {
  if (msOverNoteEl) { msOverNoteEl.remove(); msOverNoteEl = null; }
}

/* ---------- overlay กลาง (ผ่าน/จบภารกิจ/ยืนยันออก) ---------- */
function msShowOverlay(cfg) {
  clearTimeout(msOvTimer);
  msOvCfg = cfg;
  $("msOvIcon").textContent = cfg.icon || "";
  $("msOvTitle").textContent = cfg.title || "";
  $("msOvText").textContent = cfg.text || "";
  $("msOvBtn").textContent = cfg.btn || "ตกลง";
  const btn2 = $("msOvBtn2");
  if (cfg.btn2) { btn2.hidden = false; btn2.textContent = cfg.btn2; }
  else btn2.hidden = true;
  $("missionOverlay").hidden = false;
  if (cfg.autoMs) msOvTimer = setTimeout(() => msOvAction(true), cfg.autoMs);
}
function msOvAction(primary) {
  const cfg = msOvCfg;
  if (!cfg || $("missionOverlay").hidden) return;
  clearTimeout(msOvTimer);
  msOvTimer = null; msOvCfg = null;
  $("missionOverlay").hidden = true;
  const run = primary ? cfg.onBtn : cfg.onBtn2;
  if (run) run();
}

/* ---------- บับเบิ้ล 📖 ที่มุมซ้ายล่างของหน้าหลัก ---------- */
function msSyncFab() {
  const fab = $("missionFab");
  if (!fab) return;
  const st = msState();
  const doneCount = MS_GAMES.filter((g) => st.done[g.id]).length;
  const all = doneCount === MS_GAMES.length;
  fab.hidden = !menuEl.classList.contains("active");
  fab.classList.toggle("all-done", all);
  $("missionFabBadge").textContent = all ? "✓" : `${doneCount}/${MS_GAMES.length}`;
  fab.title = all
    ? "เกมภารกิจประจำวัน — ทำครบแล้ววันนี้ 🎉 (รีเซ็ตเที่ยงคืน)"
    : `เกมภารกิจประจำวัน — ผ่านแล้ว ${doneCount}/${MS_GAMES.length} (รีเซ็ตทุกวันเที่ยงคืน)`;
  const streakEl = $("missionFabStreak");
  if (MS_STREAK_ON && streakEl) {
    // วันนี้ทำครบไปก่อนมีระบบเลเวล (หรือก่อนอัปเดต) → นับให้ย้อนหลังของวันนี้
    if (all && msStreak().last !== st.d) msStreakRecord();
    const s = msStreak();
    const lv = msStreakLevel(s.days);
    streakEl.hidden = false;
    streakEl.textContent = `Lv${lv}`;
    streakEl.classList.toggle("zero", lv === 0);
    fab.title += ` • Lv ${lv} ${MS_STREAK_LEVELS[lv].th} (ต่อเนื่อง ${s.days} วัน)`;
  }
  fab.setAttribute("aria-label", fab.title);
}

// การ์ดเลเวลในหน้าต่างภารกิจ
function msRenderStreak(st) {
  const box = $("missionStreak");
  if (!box) return;
  box.hidden = !MS_STREAK_ON;
  if (!MS_STREAK_ON) return;
  const s = msStreak();
  const lvNum = msStreakLevel(s.days);
  const lv = MS_STREAK_LEVELS[lvNum];
  const doneToday = s.last === st.d;
  box.replaceChildren();

  const top = document.createElement("div");
  top.className = "ms-streak-top";
  const icon = document.createElement("span");
  icon.className = "ms-streak-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = lv.icon;
  const body = document.createElement("div");
  body.className = "ms-streak-body";
  const name = document.createElement("div");
  name.className = "ms-streak-name";
  const chip = document.createElement("span");
  chip.className = "ms-streak-lv";
  chip.textContent = `Lv ${lvNum}`;
  name.append(chip, document.createTextNode(lv.th));
  const zh = document.createElement("div");
  zh.className = "ms-streak-zh";
  const zhText = document.createElement("span");
  zhText.lang = "zh";
  zhText.textContent = lv.zh;
  const py = document.createElement("span");
  py.lang = "zh-Latn";
  py.className = "ms-streak-py";
  py.textContent = lv.py;
  zh.append(zhText, py);
  body.append(name, zh);
  const days = document.createElement("div");
  days.className = "ms-streak-days";
  const num = document.createElement("b");
  num.textContent = s.days;
  days.append(num, document.createTextNode("วันติดต่อกัน"));
  top.append(icon, body, days);

  const bar = document.createElement("div");
  bar.className = "ms-streak-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", `เลเวล ${lvNum} จาก ${MS_STREAK_MAX}`);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(MS_STREAK_MAX));
  bar.setAttribute("aria-valuenow", String(lvNum));
  const fill = document.createElement("span");
  fill.style.width = `${(lvNum / MS_STREAK_MAX) * 100}%`;
  bar.appendChild(fill);

  const next = document.createElement("p");
  next.className = "ms-streak-next";
  const nextLv = MS_STREAK_LEVELS[lvNum + 1];
  let msg = nextLv
    ? `${doneToday ? "พรุ่งนี้" : "วันนี้"}ทำครบ 4 เกม → Lv ${lvNum + 1} ${nextLv.icon} ${nextLv.th}`
    : `🏆 เลเวลสูงสุดแล้ว! ทำครบทุกวันเพื่อสะสมวันต่อไปเรื่อยๆ`;
  if (s.best) msg += ` • สถิติสูงสุด ${s.best} วัน`;
  next.textContent = msg;

  const warn = document.createElement("p");
  warn.className = "ms-streak-warn";
  warn.textContent = doneToday
    ? "✅ วันนี้นับแล้ว — ขาด 1 วันจะกลับไปเริ่ม Lv 0"
    : s.days > 0
      ? `⚠️ วันนี้ยังไม่ครบ — ทำให้ครบก่อนเที่ยงคืน ไม่งั้นกลับไปเริ่ม Lv 0`
      : "ทำภารกิจครบ 4 เกมในวันเดียว = สะสม 1 วัน (ขาด 1 วันกลับไป Lv 0)";
  warn.classList.toggle("ok", doneToday);

  box.append(top, bar, next, warn);
}
// โผล่เฉพาะหน้าหลัก — ตามการสลับ .active ของ #menu จากทุกทาง (switchScreen)
new MutationObserver(msSyncFab).observe(menuEl, { attributes: true, attributeFilter: ["class"] });

/* ---------- หน้าต่างสรุปภารกิจ ---------- */
function msRenderPanel() {
  const st = msState();
  const list = $("missionList");
  list.replaceChildren();
  MS_GAMES.forEach((g) => {
    const done = !!st.done[g.id];
    const row = document.createElement("div");
    row.className = "ms-row" + (done ? " done" : "");
    const icon = document.createElement("span");
    icon.className = "ms-row-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = g.icon;
    const body = document.createElement("div");
    body.className = "ms-row-body";
    const name = document.createElement("div");
    name.className = "ms-row-name";
    const chip = document.createElement("span");
    chip.className = "ms-lvl-chip";
    chip.textContent = `HSK ${st.levels[g.id]}`;
    name.append(chip, document.createTextNode(g.name));
    const desc = document.createElement("div");
    desc.className = "ms-row-desc";
    desc.textContent = g.desc;
    body.append(name, desc);
    const state = document.createElement("span");
    state.className = "ms-row-state";
    state.textContent = done ? "✅ ผ่าน" : "⬜ รอเล่น";
    row.append(icon, body, state);
    list.appendChild(row);
  });
  const doneCount = MS_GAMES.filter((g) => st.done[g.id]).length;
  msRenderStreak(st);
  $("missionPanelSub").textContent = `วันนี้ผ่านแล้ว ${doneCount}/${MS_GAMES.length} เกม • เล่นเกมที่ยังไม่ผ่านต่อเนื่องอัตโนมัติ`;
  const startBtn = $("missionStartBtn");
  startBtn.hidden = doneCount === MS_GAMES.length;
  startBtn.textContent = doneCount
    ? `▶ เล่นภารกิจต่อ (เหลือ ${MS_GAMES.length - doneCount} เกม)`
    : "▶ เริ่มภารกิจประจำวัน";
}

/* ---------- การกดปุ่ม ---------- */
$("missionFab").addEventListener("click", () => {
  sfx.click();
  msRenderPanel();
  $("missionPanel").hidden = false;
});
$("missionCloseBtn").addEventListener("click", () => {
  sfx.click();
  $("missionPanel").hidden = true;
});
$("missionPanel").addEventListener("click", (e) => {
  if (e.target === $("missionPanel")) $("missionPanel").hidden = true;
});
$("missionStartBtn").addEventListener("click", () => {
  sfx.click();
  $("missionPanel").hidden = true;
  msBeginRun();
});
$("msHudQuit").addEventListener("click", () => {
  sfx.click();
  if (!msRun) return;
  msPauseCurrent();
  const g = MS_GAMES[msRun.idx];
  msShowOverlay({
    icon: "📖", title: "ออกจากเกมภารกิจ?",
    text: `กำลังเล่น: ${g.name} — เกมที่ผ่านแล้วจะถูกเก็บไว้ กลับมาเล่นต่อได้ทั้งวัน`,
    btn: "ออกจากภารกิจ", btn2: "เล่นต่อ",
    onBtn() { msAbort(); },
    onBtn2() { msResumeCurrent(); },
  });
});
$("msOvBtn").addEventListener("click", () => { sfx.click(); msOvAction(true); });
$("msOvBtn2").addEventListener("click", () => { sfx.click(); msOvAction(false); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("missionPanel").hidden && !msRun) $("missionPanel").hidden = true;
});

msSyncFab();
