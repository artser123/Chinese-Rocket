"use strict";
/* ================= เกมทายแฟลชการ์ด (ทายรูป) =================
   โจทย์ = คำ (จีน + พินอิน + ไทย + ปุ่มเสียง) ตัวเลือก = รูปภาพ 4 ใบ (ครอปเฉพาะรูป ไม่มีตัวหนังสือ)
   ข้อมูล: window.FLASHCARD_CATS (data/flashcards.js) — 20 หมวด หมวดละ ~20 ใบ
   เลือกได้หลายหมวดพร้อมกัน / "ทั้งหมด" = ทุกหมวด • เล่นเรียงสุ่มไม่ซ้ำจนครบกอง
   ชีวิต 3 (ตามตั้งค่า) • เสียงคำ audio/zh + audio/th_fc (TTS สำรอง)
   เปิด/ปิดพินอิน + คำแปลไทยบนการ์ดคำได้ (ที่ปิดไว้จะเผยให้ดูหลังตอบถูก) */
let fc = null;
const FC_ALL = "all";
const FC_SCORE_PER_CARD = 10;
// การเลือกหมวด = id คั่นด้วย "+" (หรือ "all") — คีย์เดิม cr_flashcards_cat เลือกได้หมวดเดียว ใช้ต่อได้เลย
let fcCats = (localStorage.getItem("cr_flashcards_cats") ?? localStorage.getItem("cr_flashcards_cat") ?? FC_ALL)
  .split("+").filter(Boolean);
let fcShowPy = localStorage.getItem("cr_flashcards_py") !== "off";
let fcShowTh = localStorage.getItem("cr_flashcards_th") !== "off";

const fcAllCats = () => window.FLASHCARD_CATS || [];

// ตัด id ที่ไม่มีจริงออก • ว่าง หรือเลือกครบทุกหมวด = "ทั้งหมด"
function fcNormalizeCats() {
  const ids = fcAllCats().map((c) => c.id);
  const sel = fcCats.includes(FC_ALL) ? [] : ids.filter((id) => fcCats.includes(id));
  fcCats = !sel.length || sel.length === ids.length ? [FC_ALL] : sel;
}

function fcSelectedCats() {
  fcNormalizeCats();
  return fcCats[0] === FC_ALL ? fcAllCats() : fcAllCats().filter((c) => fcCats.includes(c.id));
}

// คีย์สถิติ: หมวดเดียวยังเป็น cr_best_flashcards_<id> เหมือนเดิม (คะแนนเก่าไม่หาย)
const fcBestKey = () => {
  fcNormalizeCats();
  return `cr_best_flashcards_${fcCats.slice().sort().join("+")}`;
};

function fcSelLabel() {
  const cats = fcSelectedCats();
  if (fcCats[0] === FC_ALL) return "ทุกหมวด";
  if (cats.length === 1) return `${cats[0].icon} ${cats[0].th}`;
  if (cats.length <= 3) return cats.map((c) => c.th).join(" + ");
  return `${cats.length} หมวด`;
}

// แต่ละใบจำหมวดของตัวเองไว้ — ตัวลวงต้องมาจากหมวดเดียวกับคำโจทย์
// คำซ้ำ (หมวดตัวเลขมีการ์ด 1–8 สองชุด / คำเดียวกันข้ามหมวด) ถามครั้งเดียว
function fcPool(cats = fcSelectedCats()) {
  const seen = new Set();
  return cats.flatMap((c) => c.items.map((it) => ({ ...it, cat: c })))
    .filter((it) => !seen.has(it.zh) && seen.add(it.zh));
}
const fcPoolSize = () => fcPool().length;

function fcRenderSetupCats() {
  const wrap = $("fcCatSelect");
  wrap.replaceChildren();
  const add = (id, text) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fc-cat-btn" + (id === FC_ALL ? " fc-cat-all" : "");
    b.dataset.cat = id;
    b.textContent = text;
    wrap.appendChild(b);
  };
  add(FC_ALL, "🌟 ทั้งหมด");
  for (const c of fcAllCats()) add(c.id, `${c.icon} ${c.th}`);
  fcSyncSetup();
}

function fcSyncSetup() {
  fcNormalizeCats();
  document.querySelectorAll("#fcCatSelect .fc-cat-btn").forEach((b) => {
    const on = fcCats.includes(b.dataset.cat);
    b.classList.toggle("selected", on);
    b.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll(".fcd-btn").forEach((b) => {
    const show = b.dataset.fcshow === "py" ? fcShowPy : fcShowTh;
    b.classList.toggle("selected", (b.dataset.on === "1") === show);
  });
}

// "ทั้งหมด" ใช้แทนการเลือกทีละหมวด (เหมือน levelToggle ของระดับ HSK)
function fcToggleCat(id) {
  fcNormalizeCats();
  if (id === FC_ALL) fcCats = [FC_ALL];
  else if (fcCats[0] === FC_ALL) fcCats = [id];
  else fcCats = fcCats.includes(id) ? fcCats.filter((c) => c !== id) : [...fcCats, id];
  fcNormalizeCats();
  localStorage.setItem("cr_flashcards_cats", fcCats.join("+"));
  fcSyncSetup();
  updateStartBtn();
}

$("fcCatSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".fc-cat-btn");
  if (!btn) return;
  sfx.click();
  fcToggleCat(btn.dataset.cat);
});

document.querySelectorAll(".fcd-btn").forEach((b) => b.addEventListener("click", () => {
  sfx.click();
  const on = b.dataset.on === "1";
  if (b.dataset.fcshow === "py") fcShowPy = on;
  else fcShowTh = on;
  localStorage.setItem(`cr_flashcards_${b.dataset.fcshow}`, on ? "on" : "off");
  fcSyncSetup();
}));

function startFlashcardGame() {
  const cats = fcSelectedCats();
  const pool = fcPool(cats);
  if (pool.length < 4) return;
  stopFlashcardGame();
  gameMode = "flashcards";
  lastStarter = () => startFlashcardGame();
  fc = {
    cats, label: fcSelLabel(), bestKey: fcBestKey(),
    deck: shuffle(pool), total: pool.length,
    item: null, options: [], score: 0, lives: 3,
    answered: false, done: new Set(), nextTimer: null,
  };
  $("fcMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("fcMuteBtn").setAttribute("aria-pressed", String(muted));
  stopSpeech();
  music.start("flashcards");
  switchScreen($("flashcards"));
  updateFlashcardHUD();
  nextFcQuestion();
}

function updateFlashcardHUD() {
  if (!fc) return;
  $("fcScore").textContent = String(fc.score);
  $("fcLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, fc.lives)) + "🖤".repeat(Math.max(0, 3 - fc.lives))
    : "♾️ ไม่จำกัด";
  $("fcProg").textContent = progPct(fc.done.size, fc.total);
}

// ซ่อน/แสดงพินอิน + ไทยตามตั้งค่า • reveal = เผยส่วนที่ซ่อนไว้หลังตอบถูก
function fcApplyDisplay(reveal = false) {
  for (const [id, show] of [["fcPy", fcShowPy], ["fcTh", fcShowTh]]) {
    const el = $(id);
    el.hidden = !show && !reveal;
    el.classList.toggle("fc-revealed", !show && reveal);
  }
}

function nextFcQuestion() {
  if (!fc) return;
  fc.answered = false;
  $("fcNextBtn").classList.remove("show");
  $("fcPrompt").classList.remove("correct");
  $("fcOptions").classList.remove("answered");
  if (!fc.deck.length) { fcFinish(); return; }
  fc.item = fc.deck.pop();
  const cat = fc.item.cat;
  const others = shuffle(cat.items.filter((w) => w.zh !== fc.item.zh && w.img !== fc.item.img)).slice(0, 3);
  fc.options = shuffle([fc.item, ...others]);
  $("fcCatTag").textContent = `${cat.icon} ${cat.th} · ${cat.zh}`;
  $("fcZh").textContent = fc.item.zh;
  $("fcPy").textContent = fc.item.py || "";
  $("fcTh").textContent = fc.item.th || "";
  fcApplyDisplay();
  const wrap = $("fcOptions");
  wrap.replaceChildren();
  fc.options.forEach((o, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fc-opt";
    b.setAttribute("aria-label", `ตัวเลือกที่ ${i + 1}`);
    const img = document.createElement("img");
    img.src = o.img;
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    b.appendChild(img);
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); fcAnswer(i); });
    wrap.appendChild(b);
  });
  updateFlashcardHUD();
}

function fcAnswer(i) {
  if (!fc || fc.answered) return;
  const item = fc.item;
  const opt = fc.options[i];
  const btn = $("fcOptions").children[i];
  if (!opt || !btn || btn.classList.contains("wrong")) return;
  if (opt.zh === item.zh) {
    fc.answered = true;
    fc.score += FC_SCORE_PER_CARD;
    fc.done.add(item.img);
    btn.classList.add("correct");
    $("fcOptions").classList.add("answered");
    $("fcPrompt").classList.add("correct");
    fcApplyDisplay(true);
    sfx.hit();
    confettiBurst($("flashcards"), 20);
    music.nudge(0.05);
    updateFlashcardHUD();
    if (autoNext) {
      const cur = fc;
      fcSpeakWord(item, () => {
        if (fc !== cur || !fc.answered) return;
        fc.nextTimer = setTimeout(nextFcQuestion, 350);
      });
    } else {
      fcSpeakWord(item);
      $("fcNextBtn").classList.add("show");
    }
  } else {
    btn.classList.add("wrong");
    sfx.wrong();
    music.nudge(-0.12);
    if (quizLivesOn) {
      fc.lives--;
      updateFlashcardHUD();
      if (fc.lives <= 0) {
        fc.answered = true;
        fc.nextTimer = setTimeout(() => fcGameOver("💥 ชีวิตหมด!"), 1200);
      }
    }
  }
}

// เสียงคำ: จีนจาก audio/zh (ใช้ร่วมทุกโหมด) + ไทยจาก audio/th_fc ที่อ่าน "คำไทยบนการ์ด" ตรงตัว
// (audio/th/<คำ>.mp3 ใช้ร่วมกับชุดคำอื่นและมักอ่านคำแปลคนละแบบ เช่น 香蕉 → "กล้วยหอมเพิ่มพลังงาน")
function fcSpeakWord(item, onDone) {
  const key = wordAudioKey(item.zh, item.py);
  wordAudio.play([
    { url: `audio/zh/${key}.mp3`, tts: [item.zh, "zh-CN"] },
    { url: `audio/th_fc/${key}.mp3`, tts: [item.th, "th-TH"], duck: true },
  ], onDone);
}

function fcFinish() {
  const s = fc;
  const perfect = s.done.size === s.total;
  fcGameOver(perfect ? `🎉 ครบทุกการ์ด! (${s.label})` : "จบเกมทายแฟลชการ์ด", perfect);
}

function fcGameOver(title, finished = false) {
  clearTimeout(fc && fc.nextTimer);
  const s = fc;
  fc = null;
  music.stop();
  stopSpeech();
  if (finished) { sfx.hit(); confettiBurst(menuEl, 30); }
  else sfx.over();
  showGameOver(title, s.score,
    `🎴 ${s.label} • ตอบถูก ${s.done.size}/${s.total} ใบ` +
    (quizLivesOn ? "" : " • ไม่จำกัดชีวิต"),
    s.bestKey);
}

function stopFlashcardGame() {
  if (!fc) return;
  clearTimeout(fc.nextTimer);
  fc = null;
  music.stop();
  stopSpeech();
}

function quitFlashcardGame() {
  if (!fc) return;
  saveBest(fc.bestKey, fc.score);
  stopFlashcardGame();
  exitToSetup("flashcards");
}

$("fcMuteBtn").addEventListener("click", toggleMute);
$("fcQuitBtn").addEventListener("click", quitFlashcardGame);
$("fcSpeakBtn").addEventListener("click", () => {
  sfx.click();
  if (fc && fc.item) fcSpeakWord(fc.item);
});
$("fcNextBtn").addEventListener("click", () => { sfx.click(); nextFcQuestion(); });
