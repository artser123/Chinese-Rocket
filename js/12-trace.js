"use strict";
/* ================= Handwriting copy mode (เกมคัดลายมือ) ================= */
// สุ่ม "คำ" ตามระดับ HSK แล้วให้คัดคำเดิมหลายช่อง (จำนวนช่องเลือกได้ 4/6/8/10 — คำหลายตัว = เขียนหลายตัวเรียงกันในช่องเดียว)
// ตรวจทีละขีดด้วย HanziWriter.quiz (เหมือนโหมดเขียนในเกมของเกมเขียนเป็นประโยค)
// แต่ "เลื่อนการโชว์คะแนน" ไปตอนกด ✅ ตรวจ — เขียนครบทุกช่องแล้วจึงคิดคะแนน + ไฮไลต์ขีดที่ผิด
// แล้วสุ่มคำใหม่แบบไม่ซ้ำจนครบกอง (เล่นครบกองแล้วสับใหม่ คำแรกไม่ซ้ำคำเดิม)
const TC_SLOT_OPTS = [4, 6, 8, 10];
const tcClampSlots = (n) => (TC_SLOT_OPTS.includes(+n) ? +n : 10);
let tcSlots = tcClampSlots(localStorage.getItem("cr_trace_slots"));
let tc = null;
let tcOutline = localStorage.getItem("cr_trace_outline") !== "off";
let tcAllWriters = []; // writer ทุกตัวของคำปัจจุบัน — ใช้ cancelQuiz และ refit ตอนจอเปลี่ยนขนาด
let tcSeqCounter = 0;  // ตัวนับ seq แบบเพิ่มขึ้นเรื่อยๆ (ไม่รีเซ็ตต่อคำ) กัน chain เก่าจับคู่ seq ชนกับคำใหม่

function tcSyncSetupUI() {
  const isTrace = gameMode === "trace";
  $("tcOutlineRow").style.display = isTrace ? "" : "none";
  $("tcSlotsRow").style.display = isTrace ? "" : "none";
  if (!isTrace) return;
  document.querySelectorAll("#tcOutlineSelect .tco-btn").forEach((b) => b.classList.toggle("selected", b.dataset.outline === (tcOutline ? "on" : "off")));
  document.querySelectorAll("#tcSlotsSelect .tcs-btn").forEach((b) => b.classList.toggle("selected", +b.dataset.slots === tcSlots));
}

// โหลดข้อมูลเส้นขีดผ่าน loader/แคชร่วมของโหมดเขียนอื่น (โหลดครั้งแรกต้องมีอินเทอร์เน็ต)
function tcLoadCharData(chars) { return cpLoadCharData(chars); }

function stopTrace() {
  if (!tc) return;
  tc.seq = ++tcSeqCounter; // ค่าไม่ซ้ำทั้งเซสชัน — ทำ in-flight chain ของคำเดิมเป็นโมฆะเสมอ
  tcAllWriters.forEach((w) => {
    try { w.cancelQuiz(); } catch (e) {}
    if (w._tcResolve) { try { w._tcResolve(); } catch (e) {} }
  });
  tcAllWriters = [];
  pencilSound.stop();
}

function quitTraceGame() {
  stopTrace();
  tc = null;
  stopSpeech();
  music.stop();
  switchScreen(menuEl);
  updateBestLine();
}

function startTraceGame(level) {
  const words = bombVocabulary(level);
  if (!words.length) return;
  stopTrace();
  currentLevel = level;
  lastStarter = () => startTraceGame(level);
  tc = { level, words, deck: shuffle(words.slice()), word: null, lastZh: null, chars: [],
         slots: [], activeSlot: -1, phase: "write", seq: 0, rounds: 0, wrongSlots: [] };
  music.start("trace");
  switchScreen($("trace"));
  $("tcResult").hidden = true;
  $("tcResult").replaceChildren();
  $("tcCheckBtn").hidden = false;
  $("tcRetryBtn").hidden = true;
  $("tcNextBtn").hidden = true;
  $("tcMuteBtn").textContent = muted ? "🔇" : "🔊";
  nextTraceWord();
}

// สุ่มคำถัดไปจากกองที่สับไว้ — ครบกองแล้วสับใหม่ (คำแรกของรอบใหม่ไม่ซ้ำคำที่เพิ่งเล่น)
function nextTraceWord() {
  if (!tc) return;
  stopTrace(); // ยกเลิก quiz/โหลดของคำเดิม (seq ถูก bump ให้ผลลัพธ์เก่าเป็นโมฆะ)
  if (!tc.deck.length) {
    const lastZh = tc.lastZh;
    tc.deck = shuffle(tc.words.slice());
    if (tc.deck.length > 1 && tc.deck[tc.deck.length - 1][0] === lastZh) {
      [tc.deck[0], tc.deck[tc.deck.length - 1]] = [tc.deck[tc.deck.length - 1], tc.deck[0]];
    }
  }
  const word = tc.deck.pop();
  if (!word) { quitTraceGame(); return; }
  tc.word = word;
  tc.lastZh = word[0];
  tc.chars = [...word[0]].filter((c) => /[㐀-鿿豈-﫿]/.test(c));
  if (!tc.chars.length) { nextTraceWord(); return; } // กันคำที่ไม่มีตัวจีน (ไม่ควรเกิด)
  tc.rounds++;
  tc.phase = "write";
  tc.activeSlot = -1;
  tc.wrongSlots = [];
  $("tcRound").textContent = tc.rounds;
  $("tcZh").textContent = word[0];
  $("tcPy").textContent = word[1] || "";
  $("tcTh").textContent = word[2] || "";
  $("tcResult").hidden = true;
  $("tcCheckBtn").hidden = false;
  $("tcCheckBtn").disabled = true;
  $("tcRetryBtn").hidden = true;
  $("tcNextBtn").hidden = true;
  $("tcLabel").textContent = `คัดคำจีนลงช่องทั้ง ${tcSlots} ช่อง — เขียนให้ครบทุกช่องแล้วกด "ตรวจ"`;
  renderTraceGrid();
  $("tcStatus").textContent = "กำลังโหลดข้อมูลเส้นขีด…";
  const seq = tc.seq;
  tcLoadCharData(tc.chars).then(() => {
    if (!tc || tc.seq !== seq) return;
    if (!tc.chars.every((c) => bombCharData.get(c))) {
      $("tcStatus").textContent = "โหลดข้อมูลเส้นขีดไม่สำเร็จ — ต้องใช้อินเทอร์เน็ตครั้งแรก กด 'ข้ามคำ' แล้วลองใหม่";
      return;
    }
    speakWordHit(tc.word);
    tcActivateSlot(0);
  });
}

// สร้างตาราง 10 ช่องว่าง (ช่องละชุดช่องเขียนตามจำนวนตัวของคำ) — ยังไม่สร้าง writer จนกว่าจะถึงคิว
function renderTraceGrid() {
  const grid = $("tcGrid");
  grid.replaceChildren();
  grid.classList.toggle("wide", tc.chars.length >= 3); // คำยาว 3 ตัวขึ้นไปใช้ 1 คอลัมน์ให้เขียนสบาย
  grid.classList.toggle("single", tc.chars.length === 1); // คำตัวเดียว: ล็อกช่องเขียนให้เท่าคำ 2 ตัว (ดู style.css)
  tc.slots = [];
  for (let i = 0; i < tcSlots; i++) {
    const el = document.createElement("div");
    el.className = "tc-slot locked";
    const head = document.createElement("div");
    head.className = "tc-slot-head";
    const no = document.createElement("span");
    no.textContent = String(i + 1);
    const badge = document.createElement("span");
    badge.className = "tc-badge";
    head.append(no, badge);
    const row = document.createElement("div");
    row.className = "tc-chars";
    const cells = tc.chars.map(() => {
      const cell = document.createElement("div");
      cell.className = "tc-char";
      row.appendChild(cell);
      return cell;
    });
    el.append(head, row);
    el.addEventListener("click", () => tcSlotTap(i));
    grid.appendChild(el);
    tc.slots.push({ el, badge, cells, chars: [], done: false, acc: 1 });
  }
  updateTraceProgress();
}

function updateTraceProgress() {
  if (!tc) return;
  const done = tc.slots.filter((s) => s.done).length;
  $("tcProg").textContent = progPct(done, tcSlots);
  $("tcCheckBtn").disabled = done < tcSlots;
}

// เปิดช่องที่ i ให้เขียนทีละตัว (ตัวที่ 1 → ตัวที่ 2 → …) แล้วปิดช่องเมื่อครบทุกตัว
async function tcActivateSlot(i) {
  if (!tc || tc.phase !== "write") return;
  const slot = tc.slots[i];
  if (!slot || slot.done) return;
  const seq = tc.seq;
  tc.activeSlot = i;
  tc.slots.forEach((s, j) => s.el.classList.toggle("active", j === i));
  slot.el.classList.remove("locked");
  slot.el.classList.add("active");
  $("tcStatus").textContent = `ช่องที่ ${i + 1} / ${tcSlots} — เขียน "${tc.word[0]}" ให้ครบทุกตัว`;
  try { slot.el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {}
  slot.chars = [];
  const chars = tc.chars;
  for (let k = 0; k < slot.cells.length; k++) {
    const char = chars[k];
    const cell = slot.cells[k];
    if (!cell || !char) break; // กันกรณี grid ของคำใหม่มีช่องไม่เท่าจำนวนตัว
    cell.replaceChildren();
    const data = bombCharData.get(char);
    if (!data) { $("tcStatus").textContent = "ไม่พบข้อมูลเส้นขีดของตัวนี้ — กด 'ข้ามคำ' เพื่อไปคำถัดไป"; return; }
    // ตั้งขนาด writer = ความกว้างจริงของช่อง เพื่อให้พิกัดการลากเส้นตรงกับที่แสดง (CSS ยืด SVG เต็มช่อง)
    const size = Math.max(48, Math.round(cell.clientWidth) || 90);
    let writer;
    try {
      writer = new window.HanziWriter(cell, {
        width: size, height: size, padding: 8,
        showCharacter: false, showOutline: tcOutline,
        strokeColor: "#203954", outlineColor: "#cbd2db", drawingColor: "#235a86", drawingWidth: 64,
        highlightColor: "#e5484d", highlightOnComplete: false,
        strokeHighlightSpeed: 0.7, strokeFadeDuration: 120,
        charDataLoader: (c) => bombCharData.get(c),
      });
    } catch (e) {
      $("tcStatus").textContent = "เปิดช่องเขียนไม่สำเร็จ — ลองใหม่หรือกด 'ข้ามคำ'";
      return;
    }
    tcAllWriters.push(writer);
    await writer.setCharacter(char);
    if (!tc || tc.seq !== seq) { try { writer.cancelQuiz(); } catch (e) {} return; }
    const entry = { writer, char, total: data.strokes.length, wrongStrokes: new Set(), attempts: 0 };
    slot.chars[k] = entry;
    await tcQuizChar(slot, entry, seq);
    if (!tc || tc.seq !== seq) return;
  }
  if (slot.chars.length === slot.cells.length) tcCompleteSlot(i);
}

// รัน quiz ตรวจทีละขีดของตัวอักษรหนึ่งตัว — resolve เมื่อเขียนครบ (หรือถูกยกเลิกกลางทาง)
function tcQuizChar(slot, entry, seq) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; entry.writer._tcResolve = null; resolve(); } };
    entry.writer._tcResolve = finish; // ให้ stopTrace/nextTraceWord ปลด promise ที่ค้างได้
    entry.writer.quiz({
      leniency: 1.4,
      markStrokeCorrectAfterMisses: 4,
      // ต้องน้อยกว่า markStrokeCorrectAfterMisses (4) เสมอ — พอผิดครบครั้งที่ 4 HanziWriter จะเข้า branch
      // "ยอมรับขีดนี้ให้ผ่าน" แล้วข้ามการโชว์ไฮไลต์ทันที เดิมตั้ง 4 ตอนเปิดเส้นไกด์(ค่าเริ่มต้น) จึงเขียนผิดกี่ครั้งก็ไม่มีเส้นแดงขึ้น
      showHintAfterMisses: 1,
      strokeHighlightSpeed: tcOutline ? 0.7 : 0.35,
      onMistake: (data) => {
        if (!tc || tc.seq !== seq) return;
        entry.attempts++;
        entry.wrongStrokes.add(data.strokeNum);
        $("tcStatus").textContent = `ช่องที่ ${tc.activeSlot + 1} — ขีดที่ ${data.strokeNum + 1} ยังไม่ถูก ลองใหม่ได้ (ไม่หักคะแนน)`;
      },
      onCorrectStroke: () => {},
      onComplete: () => { finish(); },
    });
  });
}

function tcCompleteSlot(i) {
  if (!tc) return;
  const slot = tc.slots[i];
  slot.done = true;
  slot.el.classList.remove("active", "locked");
  slot.el.classList.add("done");
  if (!slot.badge.textContent) slot.badge.textContent = "⭐";
  updateTraceProgress();
  const next = tc.slots.findIndex((s) => !s.done);
  if (next >= 0) {
    tcActivateSlot(next);
  } else {
    $("tcStatus").textContent = `เขียนครบทั้ง ${tc.slots.length} ช่องแล้ว — กด ✅ ตรวจ เพื่อดูคะแนนและจุดที่ผิด`;
    $("tcCheckBtn").disabled = false;
    sfx.hit();
  }
}

// แตะช่องในโหมดผลตรวจ → สาธิตลำดับขีดที่ถูกของช่องนั้น
function tcSlotTap(i) {
  if (!tc || tc.phase !== "result") return;
  const slot = tc.slots[i];
  if (!slot || !slot.chars.length) return;
  sfx.click();
  slot.chars.forEach((c, k) => {
    if (!c) return;
    setTimeout(() => { if (tc) { try { c.writer.animateCharacter(); } catch (e) {} } }, k * 800);
  });
  $("tcStatus").textContent = `สาธิตลำดับขีดของช่องที่ ${i + 1} — ดูเสร็จแล้วกด 'ลองใหม่ช่องที่ผิด' ได้`;
}

// กด ✅ ตรวจ: รวมผลทุกช่อง → คะแนน + ไฮไลต์ขีดที่เขียนผิด
function tcCheck() {
  if (!tc || tc.phase !== "write") return;
  tc.phase = "result";
  tc.wrongSlots = [];
  let sum = 0;
  tc.slots.forEach((slot, i) => {
    tcClearWrongOverlays(slot);
    let wrong = 0, total = 0;
    slot.chars.forEach((c) => { if (!c) return; wrong += c.wrongStrokes.size; total += c.total; });
    slot.acc = total ? (total - wrong) / total : 1;
    sum += slot.acc;
    slot.el.classList.remove("active", "locked");
    if (wrong) {
      tc.wrongSlots.push(i);
      slot.el.classList.add("wrong");
      slot.badge.textContent = `✗ ${wrong}`;
      // โชว์ตัวจริง + ลากเส้นแดงทับขีดที่เขียนผิดค้างไว้ให้เห็นชัด
      slot.chars.forEach((c, k) => {
        if (!c || !c.wrongStrokes.size) return;
        try { c.writer.showOutline({ duration: 0 }); } catch (e) {}
        tcMarkWrong(c, slot.cells[k]);
      });
    } else {
      slot.el.classList.add("done");
      slot.badge.textContent = "⭐";
    }
  });
  const score = Math.round((sum / (tc.slots.length || 1)) * 100);
  saveBest(`cr_best_${catPrefix()}${tc.level}_trace`, score);
  const perfect = tc.slots.filter((s) => s.acc >= 1).length;
  const wrongCount = tc.slots.reduce((n, s) => n + s.chars.reduce((m, c) => m + (c ? c.wrongStrokes.size : 0), 0), 0);
  const res = $("tcResult");
  res.replaceChildren();
  const sc = document.createElement("span");
  sc.className = "tc-score";
  sc.textContent = `${score} คะแนน`;
  res.appendChild(sc);
  const line = document.createElement("div");
  line.textContent = wrongCount
    ? `เขียนครบ ${tc.slots.length} ช่อง • สมบูรณ์ ${perfect}/${tc.slots.length} ช่อง • ขีดที่ผิดรวม ${wrongCount} จุด (ไฮไลต์สีแดงในช่อง)`
    : "🎉 สมบูรณ์ทุกช่อง! ไม่มีขีดผิดเลย";
  res.appendChild(line);
  const tip = document.createElement("div");
  tip.textContent = wrongCount
    ? "แตะช่องไหนก็ได้เพื่อดูสาธิตวิธีเขียนที่ถูก แล้ว 'ลองใหม่ช่องที่ผิด' หรือ 'คำใหม่'"
    : "กด 'คำใหม่' เพื่อคัดคำถัดไป (สุ่มไม่ซ้ำจนครบกอง)";
  res.appendChild(tip);
  res.hidden = false;
  $("tcCheckBtn").hidden = true;
  $("tcRetryBtn").hidden = !wrongCount;
  $("tcNextBtn").hidden = false;
  $("tcStatus").textContent = wrongCount ? "มีช่องที่เขียนผิด — ดูไฮไลต์สีแดงแล้วแก้ได้เลย" : "เยี่ยม! เขียนถูกทุกช่อง";
  if (perfect === tcSlots) sfx.hit(); else sfx.click();
}

// ลองใหม่เฉพาะช่องที่เขียนผิด — รีเซ็ตช่องเหล่านั้นแล้วให้เขียนใหม่ตามลำดับ
function tcRetryWrong() {
  if (!tc || tc.phase !== "result") return;
  const wrongs = tc.wrongSlots.slice();
  if (!wrongs.length) return;
  const removed = new Set();
  wrongs.forEach((i) => tc.slots[i].chars.forEach((c) => { if (c) removed.add(c.writer); }));
  wrongs.forEach((i) => {
    const slot = tc.slots[i];
    slot.done = false;
    slot.acc = 1;
    slot.chars.forEach((c) => { if (c) { try { c.writer.cancelQuiz(); } catch (e) {} if (c.writer._tcResolve) c.writer._tcResolve(); } });
    slot.chars = [];
    slot.cells.forEach((cell) => cell.replaceChildren());
    slot.el.classList.remove("done", "wrong", "active");
    slot.el.classList.add("locked");
    slot.badge.textContent = "";
  });
  tcAllWriters = tcAllWriters.filter((w) => !removed.has(w));
  tc.wrongSlots = [];
  tc.phase = "write";
  $("tcResult").hidden = true;
  $("tcRetryBtn").hidden = true;
  $("tcNextBtn").hidden = true;
  $("tcCheckBtn").hidden = false;
  updateTraceProgress();
  tcActivateSlot(wrongs[0]);
}

// ลากเส้นแดงทับขีดที่เขียนผิด (ค้างไว้ ไม่จางเหมือน highlightStroke ของ HanziWriter)
// ใช้ median ของตัวอักษรแปลงเป็นพิกัด px ด้วย getScreenCTM() ของกลุ่มเส้นใน SVG
function tcClearWrongOverlays(slot) {
  if (!slot) return;
  slot.cells.forEach((cell) => { const ov = cell.querySelector(".tc-wrong-overlay"); if (ov) ov.remove(); });
}
function tcMarkWrong(entry, cell) {
  if (!entry || !cell || !entry.wrongStrokes.size) return;
  const svg = cell.querySelector("svg");
  const group = svg && svg.querySelector("g[transform]");
  if (!group || !group.getScreenCTM) return;
  const data = bombCharData.get(entry.char);
  if (!data || !data.medians) return;
  const ctm = group.getScreenCTM();
  const r = cell.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const NS = "http://www.w3.org/2000/svg";
  let ov = cell.querySelector(".tc-wrong-overlay");
  if (!ov) { ov = document.createElementNS(NS, "svg"); cell.appendChild(ov); }
  ov.classList.add("tc-wrong-overlay");
  ov.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
  ov.replaceChildren();
  entry.wrongStrokes.forEach((st) => {
    const m = data.medians[st];
    if (!m || !m.length) return;
    const pts = m.map((p) => `${(ctm.a * p[0] + ctm.c * p[1] + ctm.e - r.left).toFixed(1)},${(ctm.b * p[0] + ctm.d * p[1] + ctm.f - r.top).toFixed(1)}`).join(" ");
    const line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", pts);
    line.setAttribute("class", "tc-wrong-stroke");
    ov.appendChild(line);
  });
}

function tcFitWriters() {
  if (!tc) return;
  tc.slots.forEach((slot) => {
    slot.cells.forEach((cell, k) => {
      const c = slot.chars[k];
      if (!c) return;
      const size = Math.max(48, Math.round(cell.clientWidth) || 90);
      try { c.writer.updateDimensions({ width: size, height: size, padding: 8 }); } catch (e) {}
      // วาดเส้นแดงทับขีดที่ผิดใหม่ให้ตรงกับขนาดช่องใหม่
      if (tc.phase === "result" && c.wrongStrokes.size) {
        const ov = cell.querySelector(".tc-wrong-overlay");
        if (ov) ov.remove();
        tcMarkWrong(c, cell);
      }
    });
  });
}

$("tcMuteBtn").addEventListener("click", toggleMute);
$("tcListenBtn").addEventListener("click", () => { sfx.click(); if (tc && tc.word) speakWordHit(tc.word); });
$("tcSkipBtn").addEventListener("click", () => { sfx.click(); nextTraceWord(); });
$("tcCheckBtn").addEventListener("click", () => { if ($("tcCheckBtn").disabled) return; sfx.click(); tcCheck(); });
$("tcRetryBtn").addEventListener("click", () => { sfx.click(); tcRetryWrong(); });
$("tcNextBtn").addEventListener("click", () => { sfx.click(); nextTraceWord(); });
$("tcQuitBtn").addEventListener("click", () => { sfx.click(); quitTraceGame(); });
$("tcGrid").addEventListener("pointerdown", (e) => pencilSound.start(e));
$("tcGrid").addEventListener("pointermove", (e) => pencilSound.move(e));
$("tcGrid").addEventListener("pointerleave", stopPencilPointer);

window.addEventListener("resize", () => {
  if (cp && cpWriter && !$("cpStrokes").hidden) cpStrokeFit();
  if (cp && cpWriteWriter && !$("cpWrite").hidden) cpWriteFit();
  if (cp && cpFree) cpFreeReflow();
  if (tc) tcFitWriters();
});

$("cards").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card || card.classList.contains("locked")) return;
  sfx.click();
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
  gameMode = card.dataset.mode;
  // ไอคอนตัวใหญ่บนหน้าตั้งค่า — คัดลอกข้อความ+คลาสจากไอคอนของการ์ด (เช่น bomb-card-icon)
  const iconEl = card.querySelector(".card-icon");
  $("setupIcon").className = iconEl.className + " setup-icon-on";
  $("setupIcon").textContent = iconEl.textContent;
  if (gameMode === "dict") {
    // Dictionary mode: no setup panel needed, go straight in
    startDict();
    return;
  }
  if (gameMode === "podcast") {
    startPodcastGame();
    return;
  }
  if (gameMode === "reader") {
    startReaderGame();
    return;
  }
  const hasSentenceData = currentCategory === "hsk"
    ? SENT_OK
    : currentCategory === "it"
    ? (typeof SENTENCES_IT !== "undefined" && SENTENCES_IT.length > 0)
    : currentCategory === "hotel"
    ? (typeof SENTENCES_HOTEL !== "undefined" && SENTENCES_HOTEL.length > 0)
    : currentCategory === "factory"
    ? (typeof SENTENCES_FACTORY !== "undefined" && SENTENCES_FACTORY.length > 0)
    : currentCategory === "trade"
    ? (typeof SENTENCES_TRADE !== "undefined" && SENTENCES_TRADE.length > 0)
    : currentCategory === "office"
    ? (typeof SENTENCES_OFFICE !== "undefined" && SENTENCES_OFFICE.length > 0)
    : currentCategory === "food"
    ? (typeof SENTENCES_FOOD !== "undefined" && SENTENCES_FOOD.length > 0)
    : currentCategory === "media"
    ? (typeof SENTENCES_MEDIA !== "undefined" && SENTENCES_MEDIA.length > 0)
    : currentCategory === "business"
    ? (typeof SENTENCES_BUSINESS !== "undefined" && SENTENCES_BUSINESS.length > 0)
    : currentCategory === "phone"
    ? (typeof SENTENCES_PHONE !== "undefined" && SENTENCES_PHONE.length > 0)
    : (typeof SENTENCES_GYM !== "undefined" && SENTENCES_GYM.length > 0);
  if ((gameMode === "sentence" || gameMode === "sentencequiz" || gameMode === "fillblank" || gameMode === "speak" || gameMode === "copy") && !hasSentenceData) {
    $("setupTitle").textContent = MODE_TITLES[gameMode];
    switchScreen($("setup"));
    $("startBtn").disabled = true;
    $("startBtn").textContent = "⚠️ ข้อมูลประโยคไม่พร้อมใช้งาน";
    return;
  }
  const isMatching = gameMode === "matching";
  const arcade = gameMode === "meteor" || gameMode === "zombie";
  $("setupTitle").textContent = MODE_TITLES[gameMode];
  $("diffRow").style.display = arcade || isMatching || gameMode === "bomb" ? "" : "none";
  $("timeRow").style.display = gameMode === "zombie" || isMatching ? "" : "none";
  $("fmtRow").style.display = gameMode === "vocab" || isMatching ? "" : "none";
  $("sentQuizDirRow").style.display = gameMode === "sentencequiz" ? "" : "none";
  $("sentQuizPinyinRow").style.display = gameMode === "sentencequiz" ? "" : "none";
  $("lifeRow").style.display = arcade || isMatching || gameMode === "bomb" || gameMode === "listen" || gameMode === "copy" || gameMode === "trace" ? "none" : "";
  $("nextRow").style.display = arcade || isMatching || gameMode === "bomb" || gameMode === "listen" || gameMode === "copy" || gameMode === "trace" ? "none" : "";
  $("bombSetupRow").style.display = gameMode === "bomb" ? "" : "none";
  $("lisTypeRow").style.display = gameMode === "listen" ? "" : "none";
  $("lisSpeedRow").style.display = gameMode === "listen" ? "" : "none";
  cpSyncSetupUI();
  tcSyncSetupUI();
  document.querySelectorAll(".diff-btn").forEach((b, i) => {
    b.textContent = isMatching ? MATCH_DIFF[b.dataset.diff].label : originalDiffLabels[i];
  });
  renderLevelSelect();
  switchScreen($("setup"));
  updateStartBtn();
});

$("setupBackBtn").addEventListener("click", () => {
  sfx.click();
  switchScreen(menuEl);
});

$("levelSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".level-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".level-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedLevel = btn.dataset.level;
  updateStartBtn();
});

$("diffSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".diff-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  difficulty = btn.dataset.diff;
  updateStartBtn();
});

$("timeSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".time-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".time-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  zDuration = +btn.dataset.time;
  updateStartBtn();
});

$("ansSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".ans-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".ans-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  quizMode = btn.dataset.ans;
  updateStartBtn();
});

$("sentQuizDirSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".sqd-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".sqd-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  sentQuizDirection = btn.dataset.sqd === "th" ? "th" : "zh";
  localStorage.setItem("cr_sentence_quiz_direction", sentQuizDirection);
  updateStartBtn();
});
document.querySelectorAll(".sqd-btn").forEach((b) => b.classList.toggle("selected", b.dataset.sqd === sentQuizDirection));

$("sentQuizPinyinSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".sqp-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".sqp-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  sentQuizShowPinyin = btn.dataset.sqp === "on";
  localStorage.setItem("cr_sentence_quiz_pinyin", sentQuizShowPinyin ? "on" : "off");
  updateStartBtn();
});
document.querySelectorAll(".sqp-btn").forEach((b) => b.classList.toggle("selected", (b.dataset.sqp === "on") === sentQuizShowPinyin));

$("lifeSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".life-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".life-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  quizLivesOn = btn.dataset.life === "on";
  updateStartBtn();
});

$("nextSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".next-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".next-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  autoNext = btn.dataset.next === "auto";
});

// โหมดฝึกฟัง: เลือกคำศัพท์ (HSK 1-9) หรือประโยค (HSK 1-5 เท่านั้น)
$("lisTypeSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".lis-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".lis-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  lisType = btn.dataset.lis;
  if (gameMode === "listen") {
    renderLevelSelect();
  }
  updateStartBtn();
});

$("lisSpeedSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".spd-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".spd-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  lisGap = +btn.dataset.gap;
  updateStartBtn();
});

// โหมดเขียนเป็นประโยค: เขียนนอกเกม (คัดลงสมุด) หรือเขียนในเกม (มีช่องเขียน + ตรวจการเขียน)
$("cpWriteSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".cpw-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".cpw-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  cpWriteMode = btn.dataset.write;
  localStorage.setItem("cr_copy_write_mode", cpWriteMode);
  cpSyncSetupUI();
});

$("cpPenSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".cpw-btn");
  if (!btn) return;
  sfx.click();
  cpPenOnly = btn.dataset.penOnly === "on";
  localStorage.setItem("cr_copy_pen_only", cpPenOnly ? "on" : "off");
  cpSyncSetupUI();
});

// โหมดเขียนในเกม: เปิด/ปิดเส้นนำการเขียน (ปิด = ใบ้ลำดับขีดถัดไปเมื่อเขียนผิด)
$("cpOutlineSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".cpo-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll(".cpo-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  cpOutline = btn.dataset.outline === "on";
  localStorage.setItem("cr_copy_outline", cpOutline ? "on" : "off");
});

// โหมดคัดลายมือ: เปิด/ปิดเส้นนำการเขียน (ปิด = ใบ้ลำดับขีดถัดไปเมื่อเขียนผิด)
// โหมดคัดลายมือ: จำนวนช่องที่ต้องคัด (4/6/8/10 ช่อง) — มีผลกับการเล่นรอบถัดไป
$("tcSlotsSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".tcs-btn");
  if (!btn) return;
  sfx.click();
  tcSlots = tcClampSlots(btn.dataset.slots);
  localStorage.setItem("cr_trace_slots", String(tcSlots));
  tcSyncSetupUI();
  updateStartBtn(); // ปุ่มเริ่มเกมบอกจำนวนช่องอยู่ → ต้องอัปเดตทันทีที่เปลี่ยน
});

$("tcOutlineSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".tco-btn");
  if (!btn) return;
  sfx.click();
  document.querySelectorAll("#tcOutlineSelect .tco-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  tcOutline = btn.dataset.outline === "on";
  localStorage.setItem("cr_trace_outline", tcOutline ? "on" : "off");
});

$("startBtn").addEventListener("click", () => {
  if (!selectedLevel || !gameMode) return;
  sfx.click();
  if (gameMode === "vocab") startQuizGame(selectedLevel);
  else if (gameMode === "sentence") startSentGame(selectedLevel);
  else if (gameMode === "sentencequiz") startSentenceQuiz(selectedLevel);
  else if (gameMode === "fillblank") startFillGame(selectedLevel);
  else if (gameMode === "zombie") startZombieGame(selectedLevel);
  else if (gameMode === "matching") startMatchingGame(selectedLevel);
  else if (gameMode === "bomb") startBombGame(selectedLevel);
  else if (gameMode === "speak") startSpeakGame(selectedLevel);
  else if (gameMode === "listen") startListenGame(selectedLevel);
  else if (gameMode === "copy") startCopyGame(selectedLevel);
  else if (gameMode === "trace") startTraceGame(selectedLevel);
  else startGame(selectedLevel);
});

$("pauseBtn").addEventListener("click", () => {
  if (!running || paused) return;
  paused = true;
  sfx.click();
  $("pauseOverlay").classList.add("show");
});
$("resumeBtn").addEventListener("click", () => {
  paused = false;
  sfx.click();
  $("pauseOverlay").classList.remove("show");
  lastTime = performance.now();
});
$("quitBtn").addEventListener("click", () => {
  sfx.click();
  saveBest(`cr_best_${catPrefix()}${currentLevel}_${difficulty}`, score);
  running = false;
  paused = false;
  music.stop();
  stopSpeech();
  $("pauseOverlay").classList.remove("show");
  switchScreen(menuEl);
  updateBestLine();
});
$("muteBtn").addEventListener("click", toggleMute);

$("againBtn").addEventListener("click", () => { sfx.click(); if (lastStarter) lastStarter(); });
$("menuBtn").addEventListener("click", () => { sfx.click(); switchScreen(menuEl); updateBestLine(); });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) { pauseMatchingGame(); pauseBombGame(); cpHideWordPopup(); }
  // Android's Google recognition UI is a separate activity; don't invalidate
  // its pending result when it temporarily hides the WebView.
  if (document.hidden && spk && !spkNativeActive) spkStopAll();
  if (document.hidden && running && !paused) {
    paused = true;
    $("pauseOverlay").classList.add("show");
  }
  if (document.hidden && zb && !zb.paused) {
    zb.paused = true;
    $("zPauseOverlay").classList.add("show");
  }
  // โหมดฝึกฟังใช้ native media playback; ขณะเล่นขอ Screen Wake Lock ด้วย (จอไม่ดับ
  // จนกว่าจะกดพัก/ออก) — พอสลับแอป/ล็อกจอ เว็บเครื่องจะปล่อยเองและขอใหม่เมื่อกลับมาเห็นจอ
  if (!document.hidden && lis) {
    crSetPlaybackState(lis.playing);
    if (lis.playing && lisMediaAudio.paused && !lis.timer) lisPlayCurrent();
  }
});

// prevent double-tap zoom on iOS
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

/* ================= Category Selector Initialization ================= */
const catSelectEl = $("categorySelect");
if (catSelectEl) {
  catSelectEl.value = currentCategory in CATEGORIES ? currentCategory : "hsk";
  catSelectEl.addEventListener("change", (e) => {
    sfx.click();
    setCategory(e.target.value);
  });
}
updateCategoryDropdownUI();

// Native Android hardware-back navigation: unwind overlays, then return from
// gameplay to its setup screen. The home screen returns false so Android exits.
window.__handleAndroidBack = function () {
  const active = document.querySelector(".screen.active");
  if (!active || active === menuEl) return false;

  const overlays = [
    ["pauseOverlay", "resumeBtn"],
    ["zPauseOverlay", "zResumeBtn"],
    ["bombPauseOverlay", "bombResumeBtn"],
    ["matchPauseOverlay", "matchResumeBtn"],
  ];
  for (const [overlayId, resumeId] of overlays) {
    if ($(overlayId)?.classList.contains("show")) {
      $(resumeId)?.click();
      return true;
    }
  }

  if (active === $("setup")) {
    $("setupBackBtn").click();
    return true;
  }
  if (active === overEl) {
    $("menuBtn").click();
    return true;
  }

  // The podcast and the HSK story reader have two levels: the reading/player
  // page and the episode/story list. Android back goes back to the list first
  // (same as the on-page "← เลือกตอนอื่น" / "← เลือกบทอ่าน" buttons); only a
  // further back leaves the mode for the home screen.
  if (active === $("podcast") && !$("podPlayer").hidden) {
    if (typeof podBackToList === "function") {
      sfx.click();
      podBackToList();
      return true;
    }
  }
  if (active === $("reader") && !$("readerPlayer").hidden) {
    if (typeof readerBackToList === "function") {
      sfx.click();
      readerBackToList();
      return true;
    }
  }

  const quitByScreen = {
    game: "quitBtn",
    quiz: "quizQuitBtn",
    sentQuiz: "sentQuizQuitBtn",
    sent: "sentQuitBtn",
    fill: "fillQuitBtn",
    zombie: "zQuitBtn",
    matching: "matchQuitBtn",
    bomb: "bombQuitBtn",
    dict: "dictQuitBtn",
    speak: "spkQuitBtn",
    listen: "lisQuitBtn",
    podcast: "podQuitBtn",
    reader: "readerQuitBtn",
    copy: "cpQuitBtn",
    trace: "tcQuitBtn",
  };
  const quit = $(quitByScreen[active.id]);
  if (quit) quit.click();
  else {
    sfx.click();
    switchScreen(menuEl);
    updateBestLine();
  }

  if (gameMode && gameMode !== "dict" && gameMode !== "podcast" && gameMode !== "reader") {
    switchScreen($("setup"));
    updateStartBtn();
  }
  return true;
};
