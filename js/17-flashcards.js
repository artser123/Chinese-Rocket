"use strict";
/* ================= เกมทายแฟลชการ์ด (ทายรูป) =================
   โจทย์ = คำ (จีน + พินอิน + ไทย + ปุ่มเสียง) ตัวเลือก = รูปภาพ 4 ใบ (ครอปเฉพาะรูป ไม่มีตัวหนังสือ)
   ข้อมูล: window.FLASHCARD_CATS (data/flashcards.js) — 20 หมวด หมวดละ ~20 ใบ
   เลือกได้หลายหมวดพร้อมกัน / "ทั้งหมด" = ทุกหมวด • เล่นเรียงสุ่มไม่ซ้ำจนครบกอง
   ชีวิต 3 (ตามตั้งค่า) • เสียงคำ audio/zh + audio/th_fc (TTS สำรอง)
   เปิด/ปิดพินอิน + คำแปลไทยบนการ์ดคำได้ (ที่ปิดไว้จะเผยให้ดูหลังตอบถูก)
   ชุดภาพถ่ายใหม่ 59 ชุด (window.FLASHCARD_CATS_NEW, data/flashcards_new.js จาก
   tools/build_flashcard_new.py) เป็นข้อมูลส่วนตัว — โหลดเฉพาะใน APK หรือ localhost ?fcNewPreview=1
   (ภาพจากชุดของ kids-flashcards.com ใช้ส่วนตัวได้แต่ห้ามเผยแพร่ เหมือนพอดแคสต์ MaoMi) */
let fc = null;
const FC_ALL = "all";
const FC_SCORE_PER_CARD = 10;
// การเลือกหมวด = id คั่นด้วย "+" (หรือ "all") — คีย์เดิม cr_flashcards_cat เลือกได้หมวดเดียว ใช้ต่อได้เลย
let fcCats = (localStorage.getItem("cr_flashcards_cats") ?? localStorage.getItem("cr_flashcards_cat") ?? FC_ALL)
  .split("+").filter(Boolean);
let fcShowPy = localStorage.getItem("cr_flashcards_py") !== "off";
let fcShowTh = localStorage.getItem("cr_flashcards_th") !== "off";

const fcBaseCats = () => window.FLASHCARD_CATS || [];
const fcNewCats = () => window.FLASHCARD_CATS_NEW || [];
const fcAllCats = () => fcBaseCats().concat(fcNewCats());
const FC_NEW_ON = !!window.CR_OFFLINE_APP ||
  (POD_PREVIEW_HOST.test(location.hostname) && new URLSearchParams(location.search).get("fcNewPreview") === "1");

// โหลดชุดใหม่ครั้งเดียวตอนเปิดแอป แล้วอ่านหมวดที่เลือกไว้ใหม่ (id n01… ยังไม่รู้จักก่อนโหลดเสร็จ)
function fcLoadNewDeck() {
  if (!FC_NEW_ON || Array.isArray(window.FLASHCARD_CATS_NEW)) return;
  const script = document.createElement("script");
  script.src = "data/flashcards_new.js";
  script.onload = () => {
    fcCats = (localStorage.getItem("cr_flashcards_cats") ?? FC_ALL).split("+").filter(Boolean);
    if (gameMode === "flashcards" && $("setup").classList.contains("active")) {
      fcRenderSetupCats();
      updateStartBtn();
    }
  };
  document.head.appendChild(script);
}

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

// ---- เลือกหมวด: ปุ่มสรุปบรรทัดเดียวในหน้าตั้งค่า + หน้าต่างเลือก #fcCatPicker ----
// (เดิมเป็นชิป 80 อันเรียงยาวในหน้าตั้งค่า) — ค้นหา, แบ่งกลุ่มชุดหลัก/ชุดภาพถ่าย, เลือกทั้งกลุ่ม
// สถานะ "ทั้งหมด" แสดงที่ปุ่ม 🌟 (รายการหมวดไม่ติ๊ก = ไม่กรอง) เลือกหมวดใดหมวดหนึ่งแล้วออกจากโหมดทั้งหมด
function fcCatGroups() {
  const groups = [{ key: "base", label: "📚 ชุดการ์ดหลัก", cats: fcBaseCats() }];
  if (fcNewCats().length) groups.push({ key: "new", label: "📷 ชุดภาพถ่ายเพิ่มเติม", cats: fcNewCats() });
  return groups;
}

function fcRenderSetupCats() {
  const wrap = $("fcCatSelect");
  wrap.replaceChildren();
  for (const g of fcCatGroups()) {
    const sec = document.createElement("section");
    sec.className = "fc-pick-group";
    sec.dataset.group = g.key;
    const head = document.createElement("div");
    head.className = "fc-pick-head";
    const title = document.createElement("span");
    title.className = "fc-pick-title";
    title.textContent = `${g.label} (${g.cats.length})`;
    const all = document.createElement("button");
    all.type = "button";
    all.className = "fc-pick-groupbtn";
    all.dataset.group = g.key;
    head.append(title, all);
    const grid = document.createElement("div");
    grid.className = "fc-pick-grid";
    for (const c of g.cats) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fc-pick-item";
      b.dataset.cat = c.id;
      b.dataset.search = `${c.th} ${c.zh} ${c.id}`.toLowerCase();
      b.innerHTML = `<span class="fc-pick-icon" aria-hidden="true">${c.icon}</span>` +
        `<span class="fc-pick-name"></span><span class="fc-pick-n">${c.items.length}</span>` +
        `<span class="fc-pick-check" aria-hidden="true">✓</span>`;
      b.querySelector(".fc-pick-name").textContent = c.th;
      grid.appendChild(b);
    }
    sec.append(head, grid);
    wrap.appendChild(sec);
  }
  fcFilterPicker();
  fcSyncSetup();
}

function fcSyncSetup() {
  fcNormalizeCats();
  const isAll = fcCats[0] === FC_ALL;
  document.querySelectorAll("#fcCatSelect .fc-pick-item").forEach((b) => {
    const on = !isAll && fcCats.includes(b.dataset.cat);
    b.classList.toggle("selected", on);
    b.setAttribute("aria-pressed", String(on));
  });
  for (const g of fcCatGroups()) {
    const btn = document.querySelector(`#fcCatSelect .fc-pick-groupbtn[data-group="${g.key}"]`);
    if (btn) btn.textContent = !isAll && g.cats.every((c) => fcCats.includes(c.id)) ? "ล้างกลุ่มนี้" : "เลือกทั้งกลุ่ม";
  }
  $("fcPickerAll").classList.toggle("selected", isAll);
  $("fcPickerAll").setAttribute("aria-pressed", String(isAll));
  const label = fcSelLabel(), n = fcPoolSize();
  $("fcCatSummary").textContent = isAll ? "🌟 ทุกหมวด" : label;
  $("fcCatCount").textContent = `${n} ใบ`;
  $("fcPickerInfo").textContent = isAll ? `ทุกหมวด • ${n} ใบ` : `เลือก ${fcCats.length} หมวด • ${n} ใบ`;
  document.querySelectorAll(".fcd-btn").forEach((b) => {
    const show = b.dataset.fcshow === "py" ? fcShowPy : fcShowTh;
    b.classList.toggle("selected", (b.dataset.on === "1") === show);
  });
}

function fcSaveCats() {
  fcNormalizeCats();
  localStorage.setItem("cr_flashcards_cats", fcCats.join("+"));
  fcSyncSetup();
  updateStartBtn();
}

// "ทั้งหมด" ใช้แทนการเลือกทีละหมวด (เหมือน levelToggle ของระดับ HSK)
function fcToggleCat(id) {
  fcNormalizeCats();
  if (id === FC_ALL) fcCats = [FC_ALL];
  else if (fcCats[0] === FC_ALL) fcCats = [id];
  else fcCats = fcCats.includes(id) ? fcCats.filter((c) => c !== id) : [...fcCats, id];
  fcSaveCats();
}

// เลือก/ล้างทั้งกลุ่ม (ล้างจนว่าง = กลับเป็นทั้งหมด ผ่าน fcNormalizeCats)
function fcToggleGroup(key) {
  fcNormalizeCats();
  const g = fcCatGroups().find((x) => x.key === key);
  if (!g) return;
  const ids = g.cats.map((c) => c.id);
  const cur = fcCats[0] === FC_ALL ? [] : fcCats;
  fcCats = ids.every((id) => cur.includes(id)) ? cur.filter((id) => !ids.includes(id))
    : [...new Set([...cur, ...ids])];
  fcSaveCats();
}

function fcFilterPicker() {
  const q = $("fcPickerSearch").value.trim().toLowerCase();
  document.querySelectorAll("#fcCatSelect .fc-pick-group").forEach((sec) => {
    let shown = 0;
    sec.querySelectorAll(".fc-pick-item").forEach((b) => {
      const hit = !q || b.dataset.search.includes(q);
      b.hidden = !hit;
      if (hit) shown++;
    });
    sec.hidden = !shown;
    sec.querySelector(".fc-pick-groupbtn").hidden = !!q; // ปุ่มทั้งกลุ่มตอนค้นหาจะกำกวม
  });
}

let fcPickerReturn = null;
function fcOpenPicker() {
  const pk = $("fcCatPicker");
  if (!pk.hidden) return;
  fcPickerReturn = document.activeElement;
  $("fcPickerSearch").value = "";
  fcRenderSetupCats();
  pk.hidden = false;
  $("fcCatOpen").setAttribute("aria-expanded", "true");
  $("fcPickerDone").focus({ preventScroll: true });
}

function fcClosePicker() {
  const pk = $("fcCatPicker");
  if (pk.hidden) return false;
  pk.hidden = true;
  $("fcCatOpen").setAttribute("aria-expanded", "false");
  (fcPickerReturn || $("fcCatOpen")).focus?.({ preventScroll: true });
  return true;
}

$("fcCatOpen").addEventListener("click", () => { sfx.click(); fcOpenPicker(); });
$("fcPickerClose").addEventListener("click", () => { sfx.click(); fcClosePicker(); });
$("fcPickerDone").addEventListener("click", () => { sfx.click(); fcClosePicker(); });
$("fcPickerAll").addEventListener("click", () => { sfx.click(); fcToggleCat(FC_ALL); });
$("fcPickerSearch").addEventListener("input", fcFilterPicker);
$("fcCatPicker").addEventListener("click", (e) => { if (e.target === e.currentTarget) fcClosePicker(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && fcClosePicker()) e.preventDefault(); });
$("fcCatSelect").addEventListener("click", (e) => {
  const group = e.target.closest(".fc-pick-groupbtn");
  if (group) { sfx.click(); fcToggleGroup(group.dataset.group); return; }
  const btn = e.target.closest(".fc-pick-item");
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
  fcClosePicker();
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
    { url: `audio/th_fc/${item.ta || key}.mp3`, tts: [item.th, "th-TH"], duck: true },
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
fcLoadNewDeck();
