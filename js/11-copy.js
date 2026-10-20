"use strict";
/* ================= Sentence copying mode (เกมเขียนเป็นประโยค) ================= */
// สุ่มประโยคจาก SENTENCES ให้คัดลงลงสมุดฝึกเขียน — สับกองไม่ซ้ำจนครบแล้วสับใหม่
// แตะชิปคำเพื่อดูลำดับขีด (HanziWriter animation) ใช้ loadBombLibrary + แคช bombCharData
// ร่วมกับเกมระเบิดและพจนานุกรม — ไม่มีคะแนน/ชีวิต เล่นเพลงธีม sentence
let cpWriter = null; // HanziWriter instance เดียว ใช้ซ้ำทั้งเซสชันและข้ามคำ
let cpWriteMode = localStorage.getItem("cr_copy_write_mode") || "off"; // 'off' = เขียนนอกเกม, 'on' = เขียนในเกม
let cpPenOnly = localStorage.getItem("cr_copy_pen_only") === "on"; // ใช้เฉพาะ pointerType=pen ในโหมดเขียนอิสระ
let cpOutline = localStorage.getItem("cr_copy_outline") !== "off"; // true = แสดงเส้นนำการเขียน, false = ซ่อนแล้วใบ้เมื่อเขียนผิด
let cpWriteWriter = null; // HanziWriter ตรวจการเขียนในเกม (ใช้ซ้ำทั้งเซสชัน)

// อัปเดตแถวตั้งค่าของโหมดเขียนเป็นประโยค (รูปแบบการเขียน + เส้นนำ ใช้เฉพาะเขียนในเกม)
function cpSyncSetupUI() {
  const isCopy = gameMode === "copy";
  $("cpWriteRow").style.display = isCopy ? "" : "none";
  $("cpPenRow").style.display = isCopy && cpWriteMode === "free" ? "" : "none";
  // โหมดเขียนในเกม + เขียนแบบอิสระ ใช้แถว "เส้นนำการเขียน" ร่วมกัน (อิสระ = ตัวจางในช่อง ให้ลอก)
  $("cpOutlineRow").style.display = isCopy && cpWriteMode !== "off" ? "" : "none";
  if (!isCopy) return;
  document.querySelectorAll("#cpWriteSelect .cpw-btn").forEach((b) => b.classList.toggle("selected", b.dataset.write === cpWriteMode));
  document.querySelectorAll("#cpPenSelect .cpw-btn").forEach((b) => b.classList.toggle("selected", b.dataset.penOnly === (cpPenOnly ? "on" : "off")));
  document.querySelectorAll("#cpOutlineSelect .cpo-btn").forEach((b) => b.classList.toggle("selected", b.dataset.outline === (cpOutline ? "on" : "off")));
}

function startCopyGame(level) {
  const sPool = getSentencePool(level);
  if (!sPool || !sPool.length) return;
  currentLevel = level;
  lastStarter = () => startCopyGame(level);
  cp = { level, deck: shuffle(sPool.slice()), pos: 0,
         current: null, seen: 0, chars: [], charIndex: 0, seq: 0,
         done: new Set(), writeChars: [], writeIndex: 0 };
  stopSpeech();
  music.start("sentence");
  switchScreen($("copy"));
  $("cpCount").textContent = "0";
  $("cpProg").textContent = "0%";
  $("cpStrokes").hidden = true;
  cpHideWrite();
  cpAdvance();
}

// ดึงประโยคถัดไปจากกองที่สับไว้ — ครบกองแล้วสับใหม่ (ตัวแรกรอบใหม่ไม่ซ้ำตัวที่เพิ่งแสดง)
function cpAdvance() {
  if (!cp) return;
  if (cp.pos >= cp.deck.length) {
    const lastZh = cp.current && cp.current[0];
    cp.deck = shuffle(getSentencePool(cp.level).slice());
    if (cp.deck.length > 1 && cp.deck[0][0] === lastZh) {
      const i = cp.deck.findIndex((x) => x[0] !== lastZh);
      if (i > 0) [cp.deck[0], cp.deck[i]] = [cp.deck[i], cp.deck[0]];
    }
    cp.pos = 0;
  }
  if (!cp.deck.length) return;
  cp.current = cp.deck[cp.pos++];
  cp.seen++;
  cp.done.add(cp.current[0]);
  $("cpProg").textContent = progPct(cp.done.size, cp.deck.length);
  cpRender();
  const question = cp.current;
  speakSentence(question, false, () => clearCopyKaraoke(question),
    (progress) => updateCopyKaraoke(question, progress));
}

function cpRender() {
  const s = cp.current;
  cpHideWordPopup();
  cpRenderSentence(s);
  $("cpPy").textContent = s[1] || "";
  $("cpTh").textContent = s[2] || "";
  $("cpFocus").textContent = s[3] ? `📐 จุดไวยากรณ์: ${s[3]}` : "";
  $("cpCount").textContent = cp.seen;
  cpHideStrokes();
  const inGameWrite = cpWriteMode === "on";
  const freeWrite = cpWriteMode === "free";
  $("cpLabel").textContent = inGameWrite
    ? "เขียนตามประโยคในช่องด้านล่าง — ระบบจะตรวจว่าถูกต้อง • แตะคำในประโยคเพื่อดูคำแปล"
    : freeWrite
      ? `เขียนทั้งประโยคลงในแถบด้านล่างให้เหมือนที่สุด แล้วกด "ตรวจ" ครั้งเดียว — ผ่าน ${CP_FREE_MIN}% ไปประโยคถัดไปได้`
      : "คัดลงประโยคลงสมุดเพื่อฝึกเขียน — แตะคำในประโยคเพื่อดูคำแปล • แตะชิปด้านล่างเพื่อดูลำดับขีด";
  cpWriteSetup();
  // โหมดเขียนในเกม/เขียนแบบอิสระมีช่องเขียนด้านล่างแล้ว จึงซ่อนแถวปุ่มคำ + แผงลำดับขีด (ซ้ำซ้อน)
  const wrap = $("cpTokens");
  wrap.replaceChildren();
  wrap.hidden = inGameWrite || freeWrite;
  // ปุ่มไปประโยคถัดไปย้ายไปอยู่ใต้ช่องเขียนแล้ว — ซ่อนปุ่มเดิมในแถบล่างไม่ให้ซ้ำ
  $("cpNextBtn").hidden = inGameWrite || freeWrite;
  if (inGameWrite || freeWrite) return;
  (s[4] || []).forEach((tok) => {
    if (![...tok].some((c) => /[㐀-鿿豈-﫿]/.test(c))) {
      const span = document.createElement("span");
      span.className = "cp-tok-plain";
      span.textContent = tok;
      wrap.appendChild(span);
      return;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip cp-tok";
    b.textContent = tok;
    b.lang = "zh";
    b.addEventListener("click", () => { sfx.click(); cpOpenStrokes(tok, b); });
    wrap.appendChild(b);
  });
}

/* ---------- แตะคำในประโยค → ป๊อปอัปคำแปลรายคำ (ไม่ต้องมีช่องแยกในหน้า) ---------- */
// ประโยคใน #cpZh ถูกแบ่งเป็นชิ้นคำตาม s[4] (หน่วยเดียวกับชิปด้านล่าง) แล้วทำให้แต่ละชิ้นแตะได้
// แตะแล้วเด้งกล่องข้อความลอยเหนือคำนั้นพร้อมพินอิน + คำแปลไทย + ชนิดคำ
// หาคำแปลจาก VOCAB (HSK 1-9); คำที่ไม่พบทั้งคำจะแบ่งเป็นชิ้นที่รู้จักให้แทน
let cpPopupWord = null; // คำที่ป๊อปอัปกำลังแสดง (ให้ปุ่ม 🔊 ใช้)
let cpPopupChip = null; // ชิปที่แตะ — ใช้อ้างตำแหน่งลอยและไฮไลต์

const CP_POS_TH = {
  NOUN: "คำนาม", VERB: "คำกริยา", ADJ: "คำคุณศัพท์", ADV: "คำวิเศษณ์",
  PRON: "คำสรรพนาม", PREP: "คำบุพบท", CONJ: "คำสันธาน", DET: "คำนำหน้านาม",
  MODAL: "คำกริยาช่วย",
};

function renderZhTokens(el, s, onWordClick) {
  el.replaceChildren();
  const zh = s[0] || "";
  let pos = 0;
  const text = (t) => { if (t) el.appendChild(document.createTextNode(t)); };
  for (const tok of s[4] || []) {
    if (!tok) continue;
    const at = zh.indexOf(tok, pos);
    if (at < 0) continue; // ชิ้นคำไม่ตรงกับประโยค — ปล่อยให้เป็นข้อความธรรมดา
    text(zh.slice(pos, at));
    if (/[㐀-鿿豈-﫿]/.test(tok)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cp-zh-tok";
      b.lang = "zh";
      b.textContent = tok;
      b.addEventListener("click", () => {
        sfx.click();
        if (typeof onWordClick === "function") onWordClick(tok, b);
        cpShowWordPopup(tok, b);
      });
      el.appendChild(b);
    } else {
      text(tok);
    }
    pos = at + tok.length;
  }
  text(zh.slice(pos));
}

function cpRenderSentence(s) {
  renderZhTokens($("cpZh"), s);
}

// ดัชนีคำศัพท์ (สร้างครั้งเดียว): คำย่อ -> { py, th }
// รองรับรูปแบบหลายรูปในช่องเดียวอย่าง "爸爸｜爸" โดยจับคู่พินอินที่คั่นด้วย ｜ ให้ตรงกันด้วย
let cpWordIdx = null;
function cpWordIndex() {
  if (cpWordIdx) return cpWordIdx;
  cpWordIdx = new Map();
  for (const lvl of ["1", "2", "3", "4", "5", "6", "7-9"]) {
    for (const w of VOCAB[lvl] || []) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_IT !== "undefined") {
    for (const w of VOCAB_IT) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_HOTEL !== "undefined") {
    for (const w of VOCAB_HOTEL) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_FACTORY !== "undefined") {
    for (const w of VOCAB_FACTORY) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_TRADE !== "undefined") {
    for (const w of VOCAB_TRADE) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_OFFICE !== "undefined") {
    for (const w of VOCAB_OFFICE) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_FOOD !== "undefined") {
    for (const w of VOCAB_FOOD) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_MEDIA !== "undefined") {
    for (const w of VOCAB_MEDIA) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_BUSINESS !== "undefined") {
    for (const w of VOCAB_BUSINESS) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_PHONE !== "undefined") {
    for (const w of VOCAB_PHONE) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || cpWordIdx.has(zh)) return;
        cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
      });
    }
  }
  if (typeof VOCAB_READING !== "undefined") {
    for (const w of VOCAB_READING) {
      const variants = w[0].split(/[｜|]/).map((v) => v.trim());
      const pys = (w[1] || "").split(/[｜|]/).map((v) => v.trim());
      const th = (w[2] || "").trim();
      variants.forEach((zh, i) => {
        if (!zh || !th) return;
        const previous = cpWordIdx.get(zh);
        // Keep every existing translation unchanged; only fill dictionary
        // entries that currently have no Thai/English gloss at all.
        if (!previous || !previous.th) {
          cpWordIdx.set(zh, { py: pys.length === variants.length ? pys[i] : (pys[0] || ""), th });
        }
      });
    }
  }
  return cpWordIdx;
}

const cpSimp = (s) => [...s].map((c) => TRAD2SIMP[c] || c).join("");

// ค้นคำแปลไทยของชิ้นคำจาก VOCAB (HSK 1-9)
function cpLookupWord(word) {
  const simp = cpSimp(word);
  const hit = cpWordIndex().get(simp);
  return {
    simp,
    py: hit ? hit.py : dictSentencePinyin(simp),
    th: hit ? hit.th : "",
    pos: cpWordPos(simp),
  };
}

function cpWordPos(simp) {
  if (typeof VOCAB_EXTRA === "undefined") return "";
  const e = VOCAB_EXTRA[simp];
  return e && e.pos ? (CP_POS_TH[e.pos] || e.pos) : "";
}

// คำที่ไม่พบทั้งคำ → แบ่งเป็นชิ้นที่รู้จัก (จับคู่ยาวสุดก่อน) เพื่อโชว์คำแปลรายชิ้น
function cpSegment(simp) {
  const idx = cpWordIndex();
  const { charPy } = dictPinyinIndex();
  const chars = [...simp];
  const parts = [];
  for (let i = 0; i < chars.length;) {
    for (let l = Math.min(6, chars.length - i); l >= 1; l--) {
      const cand = chars.slice(i, i + l).join("");
      const hit = idx.get(cand);
      if (hit || l === 1) {
        parts.push({ zh: cand, py: hit ? hit.py : (charPy.get(cand) || ""), th: hit ? hit.th : "" });
        i += l;
        break;
      }
    }
  }
  return parts;
}

function cpShowWordPopup(word, chip) {
  const info = cpLookupWord(word);
  $("cpWordTitle").textContent = word;
  $("cpWordPy").textContent = info.py || "";
  $("cpWordTh").textContent = info.th || "ไม่พบคำแปลเดี่ยวในคลังคำศัพท์";
  $("cpWordPos").textContent = info.pos ? `🔖 ${info.pos}` : "";
  const brk = $("cpWordBreak");
  brk.replaceChildren();
  if (!info.th) {
    for (const p of cpSegment(info.simp)) {
      const row = document.createElement("div");
      row.className = "cpw-break-row";
      const a = document.createElement("span"); a.className = "cpw-bzh"; a.lang = "zh"; a.textContent = p.zh;
      const b = document.createElement("span"); b.className = "cpw-bpy"; b.textContent = p.py || "";
      const d = document.createElement("span"); d.className = "cpw-bth"; d.textContent = p.th || "—";
      row.append(a, b, d);
      brk.appendChild(row);
    }
  }
  brk.hidden = !brk.childElementCount;
  cpPopupWord = word;
  if (cpPopupChip && cpPopupChip !== chip) cpPopupChip.classList.remove("active");
  cpPopupChip = chip;
  chip.classList.add("active");
  const pop = $("cpWordPopup");
  pop.hidden = false;
  cpPlaceWordPopup(chip); // วัดขนาดหลัง unhide เพื่อวางกล่องให้พ้นขอบจอ
}

function cpPlaceWordPopup(chip) {
  const pop = $("cpWordPopup");
  const r = chip.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const pad = 8;
  const left = Math.max(pad, Math.min(r.left + r.width / 2 - pr.width / 2, window.innerWidth - pr.width - pad));
  let top = r.bottom + 10;
  if (top + pr.height > window.innerHeight - pad) top = r.top - pr.height - 10;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(pad, top)}px`;
  pop.classList.add("show");
}

function cpHideWordPopup() {
  const pop = $("cpWordPopup");
  if (pop && !pop.hidden) { pop.hidden = true; pop.classList.remove("show"); }
  if (cpPopupChip) cpPopupChip.classList.remove("active");
  cpPopupChip = null;
  cpPopupWord = null;
}

$("cpWordCloseBtn").addEventListener("click", () => { sfx.click(); cpHideWordPopup(); });
$("cpWordSpeakBtn").addEventListener("click", () => {
  sfx.click();
  if (cpPopupWord) {
    const audioKey = wordAudioKey(cpPopupWord, cpPopupWord === "了" ? "le" : "");
    const spoken = audioKey === "了-le" ? "le" : cpPopupWord;
    playWordAudio(audioKey, [[spoken, "zh-CN"]]);
  }
});
// ปิดป๊อปอัปเมื่อแตะที่อื่น เลื่อนจอ หรือกลับไปโหมดอื่น (ป๊อปอัปเป็น position:fixed จึงไม่ตามจอ)
document.addEventListener("pointerdown", (e) => {
  const pop = $("cpWordPopup");
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target) || (e.target.closest && e.target.closest(".cp-zh-tok"))) return;
  cpHideWordPopup();
});
window.addEventListener("scroll", cpHideWordPopup, true);
// หมุนจอ/เปลี่ยนขนาด → ย้ายกล่องไปเกาะคำเดิมต่อ ถ้าคำนั้นยังอยู่
window.addEventListener("resize", () => {
  if ($("cpWordPopup").hidden) return;
  if (cpPopupChip && cpPopupChip.isConnected) cpPlaceWordPopup(cpPopupChip);
  else cpHideWordPopup();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    cpHideWordPopup();
    cpFreeHideConfirm();
  }
});

function cpHideStrokes() {
  $("cpStrokes").hidden = true;
  if (cp) cp.seq++; // invalidate any in-flight stroke-data load from the old word
  if (cpWriter) try { cpWriter.cancelCharacterAnimation(); } catch (e) {}
}

/* ---------- In-game writing check (เขียนในเกม) ---------- */
// ใช้ HanziWriter.quiz ตรวจการเขียนทีละตัวอักษรจีนของประโยค (ฟังก์ชันตรวจเดียวกับเกมเขียนปลดระเบิด)
// โหลดข้อมูลเส้นขีดผ่าน loadBombLibrary + แคช bombCharData ร่วมกับโหมดอื่น

async function cpLoadCharData(chars) {
  await loadBombLibrary();
  await Promise.all([...new Set(chars)].map(async (char) => {
    if (bombCharData.has(char)) return;
    try {
      const dataUrl = window.CR_OFFLINE_APP
        ? `vendor3/hanzi-writer-data/${encodeURIComponent(char)}.json`
        : `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`;
      const res = await fetch(dataUrl);
      const data = res.ok ? await res.json() : null;
      bombCharData.set(char, data && data.strokes && data.strokes.length ? data : null);
    } catch (e) { /* network error — leave uncached so the next try retries */ }
  }));
}

// ขนาดช่องเขียนของ "เขียนในเกม" — ตั้งเล็กไว้ (~ครึ่งของเดิม) เพราะเขียนด้วยปากกาจริงช่องใหญ่เกินไป
// ขอบใน (padding) คิดตามสัดส่วนขนาดช่องเสมอ (~6%) ไม่งั้นเงาตัวอักษรจะชิดขอบเมื่อช่องเล็กลง
const CP_WRITE_MAX = 130;
function cpWritePad(size) { return Math.max(6, Math.round(size * 0.06)); }

function cpWriteFit() {
  const size = Math.min(CP_WRITE_MAX, Math.max(90, $("cpWriteWriter").clientWidth || 110));
  if (cpWriteWriter) cpWriteWriter.updateDimensions({ width: size, height: size, padding: cpWritePad(size) });
  return size;
}

function cpHideWrite() {
  $("cpWrite").hidden = true;
  cpFreeHide();
  cpWriteNextEnabled(false);
  pencilSound.stop();
  if (cp) cp.seq++; // invalidate any in-flight load/quiz of the old sentence
  if (cpWriteWriter) try { cpWriteWriter.cancelQuiz(); } catch (e) {}
}

// ปุ่ม "เขียนเสร็จ — ประโยคถัดไป" ในโหมดเขียนในเกม: กดได้เมื่อเขียนครบทุกตัวเท่านั้น
function cpWriteNextEnabled(on) {
  $("cpWriteNextBtn").disabled = !on;
}

function cpWriteSetup() {
  if (!cp) return;
  const chars = [...(cp.current[0] || "")].filter((c) => /[㐀-鿿豈-﫿]/.test(c));
  cp.writeChars = chars;
  cp.writeIndex = 0;
  // เขียนแบบอิสระ: แถบยาวช่องละตัว ตรวจครั้งเดียว (ไม่มี quiz รายขีด)
  if (cpWriteMode === "free" && chars.length) { cpFreeSetup(); return; }
  if (cpWriteMode !== "on" || !chars.length) { cpHideWrite(); return; }
  $("cpWrite").hidden = false;
  cpWriteChar();
}

function renderCpWriteChips() {
  const wrap = $("cpWriteChars");
  wrap.replaceChildren();
  if (!cp) return;
  const n = cp.writeChars.length;
  $("cpWriteProgress").textContent = `${Math.min(cp.writeIndex + 1, n)} / ${n}`;
  cp.writeChars.forEach((char, i) => {
    const span = document.createElement("span");
    span.className = "bomb-char" + (i < cp.writeIndex ? " done" : i === cp.writeIndex ? " current" : "");
    span.textContent = char;
    wrap.appendChild(span);
  });
  cpWriteNextEnabled(n > 0 && cp.writeIndex >= n); // เปิดปุ่มเมื่อเขียนครบทุกตัวแล้ว
}

async function cpWriteChar() {
  if (!cp || cpWriteMode !== "on") return;
  const index = cp.writeIndex;
  const char = cp.writeChars[index];
  if (!char) return;
  const seq = ++cp.seq;
  const status = $("cpWriteStatus");
  status.textContent = "กำลังโหลดข้อมูลเส้นขีด…";
  renderCpWriteChips();
  try {
    await cpLoadCharData([char]);
    if (!cp || cp.seq !== seq) return;
    if (!bombCharData.get(char)) throw new Error("no stroke data");
    if (!cpWriteWriter) {
      const size = cpWriteFit();
      cpWriteWriter = new window.HanziWriter($("cpWriteWriter"), {
        width: size, height: size, padding: cpWritePad(size),
        showCharacter: false, showOutline: true,
        strokeColor: "#203954", outlineColor: "#cbd2db", drawingColor: "#235a86", drawingWidth: 64,
        highlightColor: "#26a477", highlightOnComplete: false,
        strokeHighlightSpeed: 0.7, strokeFadeDuration: 120,
        charDataLoader: (c) => bombCharData.get(c),
      });
    } else {
      cpWriteFit();
    }
    await cpWriteWriter.setCharacter(char);
    if (!cp || cp.seq !== seq) return;
    // เส้นนำการเขียน: เปิด = โชว์เงาตัวอักษร, ปิด = ซ่อนแล้วใบ้ขีดถัดไปเมื่อเขียนผิด
    try {
      if (cpOutline) cpWriteWriter.showOutline({ duration: 0 });
      else cpWriteWriter.hideOutline({ duration: 0 });
    } catch (e) {}
    status.textContent = `เขียนตัวที่ ${index + 1}: ${char}`;
    cpWriteWriter.quiz({
      leniency: 1.4,
      markStrokeCorrectAfterMisses: 4,
      // ต้องน้อยกว่า markStrokeCorrectAfterMisses (4) เสมอ — ครั้งที่ 4 HanziWriter จะเข้า branch ยอมรับขีดให้ผ่าน
      // แล้วข้ามโค้ดโชว์เส้นสาธิตทันที เดิมใช้ cpOutline ? 4 : 1 จึงไม่มีเส้นสาธิตขึ้นเลยตอนเปิดเส้นนำ (ค่าเริ่มต้น)
      showHintAfterMisses: 1,
      strokeHighlightSpeed: cpOutline ? 0.7 : 0.35,
      onMistake: (data) => {
        if (!cp || cp.seq !== seq) return;
        status.textContent = `ขีดที่ ${data.strokeNum + 1} ยังไม่ถูก — ดูเส้นสีเขียวสาธิตวิธีเขียน แล้วลองใหม่ • ไม่มีโทษ`;
      },
      onCorrectStroke: (data) => {
        if (!cp || cp.seq !== seq) return;
        status.textContent = data.strokesRemaining
          ? `ถูกต้อง! ต่อไปขีดที่ ${data.strokeNum + 2} • เหลือ ${data.strokesRemaining} ขีด`
          : "ถูกต้อง! เขียนครบทุกขีดแล้ว";
      },
      onComplete: () => {
        if (!cp || cp.seq !== seq) return;
        cpWriteCompleteChar();
      },
    });
  } catch (e) {
    if (cp && cp.seq === seq) status.textContent = "โหลดข้อมูลเส้นขีดไม่สำเร็จ — ต้องใช้อินเทอร์เน็ตครั้งแรก แตะ 'ข้าม' ไปประโยคถัดไป แล้วลองเขียนประโยคนี้ใหม่";
  }
}

function cpWriteCompleteChar() {
  if (!cp) return;
  sfx.hit();
  // อ่านตัวอักษรจีนที่เพิ่งเขียนเสร็จ (ไฟล์ mp3 — Android WebView ไม่มี speechSynthesis จึงใช้ speak() ไม่ได้)
  if (cp.writeChars[cp.writeIndex]) speakChar(cp.writeChars[cp.writeIndex]);
  cp.writeIndex++;
  renderCpWriteChips();
  if (cp.writeIndex >= cp.writeChars.length) {
    $("cpWriteStatus").textContent = "🎉 เขียนครบทุกตัวแล้ว! กดปุ่ม 'เขียนเสร็จ — ประโยคถัดไป' ด้านบนได้เลย";
    return;
  }
  cpWriteChar();
}

/* ---------- Free writing check (เขียนแบบอิสระ) ---------- */
// แถบยาวต่อเนื่องที่แบ่งเป็นช่องละตัวอักษรจีน (มีเส้นคั่นจางๆ ต่อช่อง + ตัวจางให้ลอกเมื่อเปิดเส้นนำ)
// เขียนรวดเดียวทั้งประโยคแล้วกด "ตรวจ" ครั้งเดียว — เทียบรูปทรงลายมือกับเส้นกลาง (medians) ของแต่ละตัว
// จากแคชข้อมูลเส้นขีด bombCharData เดียวกับโหมดเขียนในเกม/คัดลายมือ
// คะแนนต่อตัว = ความใกล้ของรูปทรง (Chamfer หลังปรับสเกล/จัดกลาง) × โทษจำนวนขีดที่ไม่ตรง
// ผ่านที่ CP_FREE_MIN% แล้วค่อยปลดล็อกปุ่มไปประโยคถัดไป (ทำงานออฟไลน์ได้หลังข้อมูลเส้นขีดถูกแคชแล้ว)
const CP_FREE_MIN = 70; // เกณฑ์ผ่าน (%) — ทั้งคะแนนรวมและ "ผ่าน/ไม่ผ่าน" ต่อช่องใช้ค่าเดียวกันนี้
const CP_FREE_GAP = 0; // 0 = ช่องต่อกันเป็นแถบเดียว แบ่งด้วยเส้นกรอบจางๆ (ต้องตรงกับ gap ของ .cpfree-grid ใน style.css)
// ช่องเล็กสุดที่ยอมให้เขียน (px) — ประโยคยาวจะขึ้นบรรทัดใหม่แทนการบีบช่องให้เล็กลง
// (เดิม ~62px เล็กเกินไปสำหรับเขียนด้วยนิ้ว/ปากกา)
const CP_FREE_MIN_CELL = 84;
// พารามิเตอร์การให้คะแนน รวมไว้ที่เดียว (หน่วยระยะ = ขนาดตัวอักษรที่เขียน, 1 = เต็มตัว)
// ค่าชุดนี้ผ่านการทดลองกับลายมือจำลอง: ลอกถูกแต่สั่น/เอียง/ขีดสั้น → 85-89% • ขีดมั่ว/เขียนตัวอื่น/ลากเส้นเดียว → ≤45%
const CP_FREE_CFG = {
  rc: 12,          // จำนวนจุดต่อขีดหลังปรับระยะให้เท่ากัน ก่อนเทียบรูปทรง
  shapeTol: 0.34,  // ระยะ Chamfer ที่ถือว่า "รูปทรงคนละเรื่อง"
  endTol: 0.52,    // ระยะจุดเริ่ม/จุดจบที่ยอมรับได้
  angCap: 1.8,     // มุมที่ต่างกันแล้วถือว่าสวนทาง (เรเดียน) — ตั้งกว้างเพราะลายมือเอียงได้
  wShape: 0.34, wEnd: 0.18, wLen: 0.15, wDir: 0.15, // น้ำหนัก (รวม = 1; wEnd ใช้ทั้งจุดเริ่มและจุดจบ)
  singleScore: 0.5, // เขียนรวดเดียวทั้งตัว (1 ขีด) → ให้ได้ไม่เกินนี้ จึงไม่ผ่านเกณฑ์เสมอ
  countFloor: 0.6,  // โทษจำนวนขีดที่ไม่ตรง: countFloor + (1-countFloor) × สัดส่วนที่ตรง
};
// หมึกเขียน: ระหว่างลากวาดทีละช่วงด้วยสีทึบ (กันรอยต่อซ้อนกันเป็นจุดดำ) แต่ตอนวาดทั้งผืนใหม่ใช้สีโปร่งแสง
// เพื่อให้ "เงาตัวอักษร" ที่ลอกอยู่ข้างหลังมองเห็นทะลุผ่านเส้นที่เขียนแล้วได้
const CP_FREE_INK = "#8fd8ff";
const CP_FREE_INK_SOFT = "rgba(143, 216, 255, .66)";
// ความหนาปากกา (px) — บางพอไม่ให้บังเงาตัวอักษร แต่ยังลากได้ถนัดทั้งจอเล็ก/จอใหญ่
const CP_FREE_PEN_W = () => Math.max(2.2, Math.min(4.2, cpFreeCell * 0.045));
let cpFree = null;
let cpFreeCanvas = null;
let cpFreeCtx = null;
let cpFreeW = 0, cpFreeH = 0; // ขนาดพื้นที่เขียน (CSS px) — canvas attrs = ×devicePixelRatio
let cpFreeCols = 0;           // จำนวนคอลัมน์ของผังช่องปัจจุบัน (ใช้ตัดสินตอนจอเปลี่ยนขนาด)
let cpFreeCell = 0;           // ขนาดช่อง (px) — จุดลายมือเก็บเป็น "หน่วยช่อง" (1 = ด้านของช่อง)
let cpFreeOrigX = 0, cpFreeOrigY = 0; // มุมบนซ้ายของผังช่อง เทียบกับ canvas

function cpFreeEnabled() { return cpWriteMode === "free" && !!cp && !!cpFree && !$("cpFree").hidden; }
function cpFreePointerAllowed(e) { return !cpPenOnly || e.pointerType === "pen"; }
function cpFreeCanStart(e) {
  return cpFreeEnabled() && e.isPrimary && e.button === 0 && cpFreePointerAllowed(e) && cpFree.pointerId == null;
}
function cpFreeStatus(text) { $("cpFreeStatus").textContent = text || ""; }
function cpFreeNextEnabled(on) { $("cpFreeNextBtn").disabled = !on; }

function cpFreeSyncButtons() {
  const has = !!cpFree && cpFree.strokes.length > 0;
  $("cpFreeUndoBtn").disabled = !has;
  $("cpFreeClearBtn").disabled = !has;
}

function cpFreeSetup() {
  if (!cp) return;
  $("cpFree").hidden = false;
  cpFree = { chars: cp.writeChars.slice(), cells: [], strokes: [], cur: null, drawing: false, pointerId: null, result: null, results: null, eraser: false, erasing: false };
  cpFreeSetEraser(false); // ประโยคใหม่เริ่มที่โหมดเขียนเสมอ (กันเผลอลบโดยไม่ตั้งใจ)
  $("cpFreeHint").textContent = `${cpFree.chars.length} ตัว • ผ่าน ${CP_FREE_MIN}%`;
  cpFreeLayout();
  cpFreeReset(true);
  cpFreeStatus("เขียนตัวอักษรจีนให้ครบทุกตัวในแต่ละช่อง แล้วกด “ตรวจ” หนึ่งครั้ง");
  cpLoadCharData(cpFree.chars); // อุ่นแคชข้อมูลเส้นขีดล่วงหน้า (ใช้ตอนตรวจอยู่ดี)
  // เผื่อกรณีวัดความกว้างตอนเพิ่งสลับหน้า (จออาจยังไม่ทันมีขนาด) — จัดผังใหม่อีกครั้งในเฟรมถัดไป
  requestAnimationFrame(() => { if (cpFree) cpFreeReflow(); });
}

function cpFreeShowConfirm() {
  const modal = $("cpFreeConfirmModal");
  if (!modal) return;
  modal.classList.add("show");
  modal.removeAttribute("hidden");
  $("cpFreeConfirmNoBtn")?.focus();
}

function cpFreeHideConfirm() {
  const modal = $("cpFreeConfirmModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("hidden", "");
}

function cpFreeHide() {
  const panel = $("cpFree");
  if (panel) panel.hidden = true;
  cpFreeHideConfirm();
  cpFree = null;
  cpFreeCtx = null;
  cpFreeSetEraser(false);
  cpFreeSyncButtons();
  cpFreeNextEnabled(false);
}

// คำนวณจำนวนคอลัมน์/ขนาดช่องจากความกว้างจริงของแถบ — ช่องไม่เล็กกว่า CP_FREE_MIN_CELL
// (ประโยคยาวจึงตกบรรทัดเองแทนที่จะบีบช่องให้เขียนไม่ถนัด)
function cpFreeColsFor(width, n) {
  const gap = CP_FREE_GAP;
  return Math.max(1, Math.min(n, Math.floor((width + gap) / CP_FREE_MIN_CELL)));
}

function cpFreeLayout() {
  const grid = $("cpFreeGrid");
  grid.replaceChildren();
  const n = cpFree.chars.length;
  const gap = CP_FREE_GAP;
  const wrapW = Math.max(160, grid.parentElement.clientWidth || 0);
  const cols = cpFreeColsFor(wrapW, n);
  const cell = Math.min(104, Math.floor((wrapW + gap) / cols - gap));
  cpFreeCols = cols;
  cpFreeCell = cell;
  grid.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
  // เปิด "เส้นนำการเขียน" = เห็นตัวจางๆ ในช่องให้ลอก / ปิด = ช่องเปล่า (มีแค่เส้นกรอบ)
  grid.classList.toggle("no-guide", !cpOutline);
  cpFree.cells = cpFree.chars.map((char, i) => {
    const el = document.createElement("div");
    const col = i % cols;
    // ช่องแรก/ช่องสุดท้ายของแต่ละบรรทัด = ขอบแถว (ได้เส้นซ้ายกลับมา + มุมโค้ง) — ดู .rowstart/.rowend ใน style.css
    el.className = "cpfree-cell"
      + (col === 0 ? " rowstart" : "")
      + (col === cols - 1 || i === n - 1 ? " rowend" : "");
    el.style.width = el.style.height = `${cell}px`;
    el.style.fontSize = `${Math.round(cell * 0.62)}px`;
    el.textContent = char;
    el.setAttribute("aria-hidden", "true");
    grid.appendChild(el);
    return { char, el };
  });
  cpFreeSize();
}

function cpFreeSize() {
  cpFreeCanvas = $("cpFreeCanvas");
  const stage = cpFreeCanvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  cpFreeW = stage.clientWidth;
  cpFreeH = stage.clientHeight;
  cpFreeCanvas.width = Math.max(1, Math.round(cpFreeW * dpr));
  cpFreeCanvas.height = Math.max(1, Math.round(cpFreeH * dpr));
  cpFreeCtx = cpFreeCanvas.getContext("2d");
  cpFreeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cpFreeCtx.lineCap = "round";
  cpFreeCtx.lineJoin = "round";
  cpFreeCtx.strokeStyle = CP_FREE_INK;
  // เส้นบางๆ พอ — หนาไปจะบังเงาตัวอักษรที่ลอกอยู่ข้างหลัง (ตอนวาดจริงใช้สีทึบ 1 เส้น/ขีด ไม่ทับกันเป็นจุด)
  cpFreeCtx.lineWidth = CP_FREE_PEN_W();
  // เก็บมุมบนซ้ายของผังช่องไว้เทียบกับ canvas — จุดลายมือเก็บเป็นหน่วยช่อง จึงวาด/วัดได้ตรงเสมอ
  const cr = cpFreeCanvas.getBoundingClientRect();
  const gr = $("cpFreeGrid").getBoundingClientRect();
  cpFreeOrigX = gr.left - cr.left;
  cpFreeOrigY = gr.top - cr.top;
  cpFreePaint();
}

// จุดเก็บเป็น "หน่วยช่อง" (1 = ด้านของช่อง) → เปลี่ยนขนาดจอแล้วรูปทรงยังเทียบได้เหมือนเดิม
// ขีดที่เขียนเสร็จแล้ววาดด้วยสีโปร่งแสง เพื่อให้เงาตัวอักษรที่ลอกอยู่ข้างหลังยังเห็นทะลุผ่านได้
function cpFreePaint() {
  if (!cpFreeCtx) return;
  cpFreeCtx.clearRect(0, 0, cpFreeW, cpFreeH);
  if (!cpFree) return;
  const size = cpFreeCell || 1;
  cpFreeCtx.strokeStyle = CP_FREE_INK_SOFT;
  const draw = (pts) => {
    if (!pts.length) return;
    cpFreeCtx.beginPath();
    pts.forEach((p, i) => {
      const x = cpFreeOrigX + p[0] * size, y = cpFreeOrigY + p[1] * size;
      if (i) cpFreeCtx.lineTo(x, y); else cpFreeCtx.moveTo(x, y);
    });
    cpFreeCtx.stroke();
  };
  cpFree.strokes.forEach(draw);
  if (cpFree.cur) draw(cpFree.cur);
}

// แสดง % ต่อช่องจากผลตรวจล่าสุด (เรียกซ้ำได้หลังจัดผังช่องใหม่ เช่นตอนจอเปลี่ยนขนาด)
function cpFreeApplyBadges() {
  if (!cpFree) return;
  const list = cpFree.results || [];
  cpFree.cells.forEach((cell, i) => {
    cell.el.classList.remove("ok", "bad");
    const old = cell.el.querySelector(".cpfree-pct");
    if (old) old.remove();
    const r = list[i];
    if (!r || r.score === null) return;
    const ok = r.score * 100 >= CP_FREE_MIN; // เกณฑ์เดียวกับคะแนนรวม
    cell.el.classList.toggle("ok", ok);
    cell.el.classList.toggle("bad", !ok);
    const tag = document.createElement("span");
    tag.className = "cpfree-pct";
    // ขนาดตัวเลขตามขนาดช่อง (ช่องเล็กลงตอนประโยคยาว/จอแคบ ก็ยังอ่านออก)
    tag.style.fontSize = `${Math.max(9, Math.min(13, Math.round(cpFreeCell * 0.17)))}px`;
    tag.textContent = `${Math.round(r.score * 100)}%`;
    cell.el.appendChild(tag);
  });
}

// ล้างเฉพาะ "ผลตรวจ" (เก็บลายมือไว้) — ใช้เมื่อมี/ลบขีดหลังตรวจแล้ว ผลเดิมใช้ไม่ได้อีก
function cpFreeClearResult() {
  if (!cpFree || !cpFree.result) return;
  cpFree.result = null;
  cpFree.results = null;
  cpFreeApplyBadges();
  const box = $("cpFreeResult");
  box.hidden = true;
  box.replaceChildren();
  cpFreeNextEnabled(false);
}

// ล้างลายมือ + ผลตรวจ (keepStatus = true เก็บข้อความสถานะไว้ ไม่ต้องเขียนใหม่)
function cpFreeReset(keepStatus) {
  if (!cpFree) return;
  cpFree.strokes = [];
  cpFree.cur = null;
  cpFree.drawing = false;
  cpFree.pointerId = null;
  cpFreeClearResult();
  cpFreeSyncButtons();
  cpFreePaint();
  if (!keepStatus) cpFreeStatus("");
}

// จอเปลี่ยนขนาด — ผังช่องถูกคำนวณใหม่ ถ้าจำนวนคอลัมน์เปลี่ยน ลายมือเดิมจะไปอยู่ผิดช่องจึงล้างทิ้ง
function cpFreeReflow() {
  if (!cpFree) return;
  const wrapW = Math.max(160, $("cpFreeGrid").parentElement.clientWidth || 0);
  const reflowed = cpFreeColsFor(wrapW, cpFree.chars.length) !== cpFreeCols;
  cpFreeLayout();
  if (reflowed) {
    cpFreeReset(true); // ช่องย้ายตำแหน่ง — ลายมือเดิมจะไปอยู่ผิดช่อง จึงล้างทิ้ง
    cpFreeStatus("ขนาดจอเปลี่ยน — ล้างลายมือเดิมแล้ว เขียนใหม่อีกครั้งได้เลย");
    return;
  }
  cpFreeApplyBadges(); // ผังเดิมแค่ขนาดเปลี่ยน — คืน % ต่อช่องให้ตรงกับช่องที่สร้างใหม่
}

function cpFreePos(e) {
  const gr = $("cpFreeGrid").getBoundingClientRect();
  const size = cpFreeCell || 1;
  return [(e.clientX - gr.left) / size, (e.clientY - gr.top) / size];
}

function cpFreeDown(e) {
  if (!cpFreeCanStart(e)) return;
  e.preventDefault();
  cpFree.pointerId = e.pointerId;
  try { cpFreeCanvas.setPointerCapture(e.pointerId); } catch (err) {}
  // โหมดยางลบ: แตะ/ลากบนเส้นที่ต้องการลบ (ไม่วาดเส้นใหม่)
  if (cpFree.eraser) {
    cpFree.erasing = true;
    cpFreeEraseAt(cpFreePos(e));
    return;
  }
  if (cpFree.cur && cpFree.cur.length) cpFree.strokes.push(cpFree.cur); // เก็บขีดที่ค้างอยู่ก่อนเริ่มขีดใหม่
  cpFreeClearResult(); // เขียนเพิ่มหลังตรวจแล้ว → ผลเดิมใช้ไม่ได้ ต้องตรวจใหม่
  cpFree.drawing = true;
  cpFree.cur = [cpFreePos(e)];
  cpFreePaint();
  cpFreeSyncButtons();
  cpFreeStatus("เขียนต่อได้เลย — กด “ตรวจ” เมื่อเขียนครบทุกตัว");
}

function cpFreeMove(e) {
  if (!cpFree || e.pointerId !== cpFree.pointerId || !cpFreePointerAllowed(e)) return;
  if (cpFree.eraser) { // ยางลบ: ลากผ่านเส้นไหนก็ลบเส้นนั้น
    if (cpFree.erasing) cpFreeEraseAt(cpFreePos(e));
    return;
  }
  if (!cpFree.drawing || !cpFree.cur) return;
  const p = cpFreePos(e);
  const prev = cpFree.cur[cpFree.cur.length - 1];
  cpFree.cur.push(p);
  const size = cpFreeCell || 1;
  cpFreeCtx.strokeStyle = CP_FREE_INK; // ทึบเฉพาะช่วงที่กำลังลาก (ทับกันก็ไม่เป็นจุดดำ)
  cpFreeCtx.beginPath();
  cpFreeCtx.moveTo(cpFreeOrigX + prev[0] * size, cpFreeOrigY + prev[1] * size);
  cpFreeCtx.lineTo(cpFreeOrigX + p[0] * size, cpFreeOrigY + p[1] * size);
  cpFreeCtx.stroke();
}

function cpFreeUp(e) {
  if (!cpFree || e.pointerId !== cpFree.pointerId) return;
  const release = () => { try { if (cpFreeCanvas.hasPointerCapture(e.pointerId)) cpFreeCanvas.releasePointerCapture(e.pointerId); } catch (err) {} };
  if (cpFree.erasing) { cpFree.erasing = false; cpFree.pointerId = null; release(); return; }
  if (!cpFree.drawing) { cpFree.pointerId = null; release(); return; }
  cpFree.drawing = false;
  cpFree.pointerId = null;
  const pts = cpFree.cur || [];
  cpFree.cur = null;
  // จุดเดี่ยว (เช่น 丶 ที่แตะเฉยๆ) ไม่ให้หายไป — เติมจุดเลื่อนจิ๋วให้เป็นขีดสั้นๆ
  if (pts.length === 1) pts.push([pts[0][0] + 0.001, pts[0][1] + 0.001]);
  if (pts.length) cpFree.strokes.push(pts);
  cpFreePaint();
  cpFreeSyncButtons();
  release();
}

/* ---------- ยางลบ (กดปุ่มแล้วแตะเส้นที่ไม่ต้องการเพื่อลบ) ---------- */
// รัศมีจับเส้นของยางลบ (หน่วยช่อง) — ประมาณ 10-13px ไม่ว่าช่องจะใหญ่แค่ไหน
function cpFreeEraseRadius() { return Math.max(10, cpFreeCell * 0.13) / (cpFreeCell || 1); }

// ระยะจากจุด p ถึงเส้น polylines (ใกล้สุดในทุกช่วงเส้นของขีดนั้น)
function cpFreeStrokeDist(pts, p) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    let d;
    if (!b) {
      d = Math.hypot(a[0] - p[0], a[1] - p[1]);
    } else {
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const len2 = vx * vx + vy * vy;
      const t = len2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
      d = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
    }
    if (d < best) best = d;
  }
  return best;
}

// ลบ "เส้นที่ใกล้จุดแตะที่สุด" 1 เส้น ถ้าอยู่ในรัศมี (เส้นอื่นไม่โดน)
function cpFreeEraseAt(p) {
  if (!cpFree || !cpFree.strokes.length) return false;
  let bi = -1, bd = Infinity;
  cpFree.strokes.forEach((s, i) => {
    const d = cpFreeStrokeDist(s, p);
    if (d < bd) { bd = d; bi = i; }
  });
  if (bi < 0 || bd > cpFreeEraseRadius()) return false;
  cpFree.strokes.splice(bi, 1);
  cpFreeClearResult(); // ลายมือเปลี่ยน → คะแนนเดิมใช้ไม่ได้ ต้องตรวจใหม่
  cpFreePaint();
  cpFreeSyncButtons();
  cpFreeStatus(cpFree.strokes.length
    ? `ลบไป 1 ขีด (เหลือ ${cpFree.strokes.length} ขีด) — แตะเส้นอื่นที่ต้องการลบต่อได้`
    : "ลบหมดแล้ว — เขียนใหม่ได้เลย");
  return true;
}

// เปิด/ปิดโหมดยางลบ (ปุ่ม 🩹) — เปิดแล้วแตะ = ลบ ไม่ใช่เขียน
function cpFreeSetEraser(on) {
  const on2 = !!on;
  if (cpFree) {
    cpFree.eraser = on2;
    cpFree.erasing = false;
    cpFree.cur = null;
    cpFree.drawing = false;
    cpFree.pointerId = null;
  }
  const panel = $("cpFree");
  if (panel) panel.classList.toggle("erasing", on2);
  const btn = $("cpFreeEraseBtn");
  if (btn) {
    btn.classList.toggle("on", on2);
    btn.setAttribute("aria-pressed", on2 ? "true" : "false");
  }
  cpFreePaint();
}

// ---------- ตรวจคะแนน ----------
// ปรับเส้นให้เหลือจุดจำนวนคงที่ ระยะห่างเท่ากันตามความยาวจริงของเส้น (resample)
function cpFreeResample(pts, count) {
  const flat = (p) => [p[0], p[1]];
  if (!pts.length) return [];
  if (pts.length === 1) return Array.from({ length: count }, () => flat(pts[0]));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return Array.from({ length: count }, () => flat(pts[0]));
  const out = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[seg]) / segLen));
    out.push([
      pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t,
      pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t,
    ]);
  }
  return out;
}

// ระยะห่างแบบ Chamfer สองทาง (เฉลี่ยระยะจากจุดหนึ่งไปยังจุดที่ใกล้สุดของอีกชุด แล้วกลับกัน)
function cpFreeChamfer(a, b) {
  if (!a.length || !b.length) return 1;
  const one = (from, to) => {
    let sum = 0;
    for (const p of from) {
      let best = Infinity;
      for (const q of to) {
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
        if (d < best) best = d;
      }
      sum += Math.sqrt(best);
    }
    return sum / from.length;
  };
  return (one(a, b) + one(b, a)) / 2;
}

// ปรับสเกลแบบอัตราส่วนด้านคงที่ + จัดกลางกล่องหน่วยเดียว (1 = ขนาดตัวอักษร)
// แล้วคืนข้อมูลต่อขีด: จุดที่ปรับระยะเท่ากันแล้ว, จุดเริ่ม/จบ, ความยาวเส้นจริง
function cpFreeNormStrokes(strokeSets) {
  const raw = (strokeSets || []).filter((s) => s && s.length);
  const lens = raw.map((s) => {
    let len = 0;
    for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    return len;
  });
  const resampled = raw.map((s) => cpFreeResample(s, CP_FREE_CFG.rc));
  const all = resampled.flat();
  if (!all.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const scale = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return resampled.map((pts, i) => {
    const mapped = pts.map((p) => [(p[0] - cx) / scale, (p[1] - cy) / scale]);
    return { pts: mapped, len: lens[i] / scale, start: mapped[0], end: mapped[mapped.length - 1] };
  });
}

const cpFreeSim = (d, tol) => Math.min(1, Math.max(0, 1 - d / tol));

// เทียบขีดหนึ่งคู่: รูปทรง + จุดเริ่ม/จุดจบ + ความยาว + ทิศทาง (น้ำหนักรวม = 1)
// ทิศทางกับจุดเริ่ม/จบสำคัญมาก เพราะแยก "เขียนตัวจริง" ออกจาก "ขีดมั่ว/เขียนตัวอื่น" ได้
function cpFreePairSim(a, b) {
  const CFG = CP_FREE_CFG;
  const dShape = cpFreeChamfer(a.pts, b.pts);
  const dStart = Math.hypot(a.start[0] - b.start[0], a.start[1] - b.start[1]);
  const dEnd = Math.hypot(a.end[0] - b.end[0], a.end[1] - b.end[1]);
  const lenSim = 1 - Math.min(1, Math.abs(a.len - b.len) / Math.max(0.02, Math.max(a.len, b.len)));
  let dirSim;
  if (a.len < 0.05 || b.len < 0.05) dirSim = a.len < 0.05 && b.len < 0.05 ? 1 : 0.25; // จุด/ขีดจิ๋ว ไม่คิดทิศทาง
  else {
    const va = Math.atan2(a.end[1] - a.start[1], a.end[0] - a.start[0]);
    const vb = Math.atan2(b.end[1] - b.start[1], b.end[0] - b.start[0]);
    let d = Math.abs(va - vb);
    if (d > Math.PI) d = Math.PI * 2 - d;
    dirSim = 1 - Math.min(1, d / CFG.angCap);
  }
  return CFG.wShape * cpFreeSim(dShape, CFG.shapeTol)
    + CFG.wEnd * cpFreeSim(dStart, CFG.endTol)
    + CFG.wEnd * cpFreeSim(dEnd, CFG.endTol)
    + CFG.wLen * lenSim
    + CFG.wDir * dirSim;
}

// ข้อมูล medians ของ hanzi-writer-data เป็นพิกัด "y คว่ำ" (y ชี้ขึ้น) — HanziWriter จึงต้องวาดด้วย scale(…, -…)
// แต่ลายมือที่ผู้ใช้เขียนเป็นพิกัดจอ (y ชี้ลง) จึงต้องกลับแกน y ของข้อมูลก่อนเทียบเสมอ
// ถ้าไม่กลับ ผู้เขียนต้องเขียนกลับหัว (พลิกบน-ล่าง) จึงจะได้คะแนนเต็ม ซึ่งเป็นบั๊ก
const cpFreeFlipY = (strokes) => strokes.map((s) => s.map((p) => [p[0], -p[1]]));

// คะแนนของช่องหนึ่ง: จับคู่ขีดตามลำดับ (ขีดที่ 1 ของผู้ใช้ ↔ ขีดแรกของตัวจริง) แล้วคิดโทษจำนวนขีดที่ไม่ตรง
function cpFreeCharScore(userStrokes, char) {
  const data = bombCharData.get(char);
  const target = ((data && data.medians) || []).filter((m) => m && m.length);
  if (!target.length) return { score: null }; // ไม่มีข้อมูลเส้นขีด (ออฟไลน์ครั้งแรก) — ข้ามการคิดคะแนน
  if (!userStrokes || !userStrokes.length) return { score: 0 };
  const CFG = CP_FREE_CFG;
  const u = cpFreeNormStrokes(userStrokes);
  const t = cpFreeNormStrokes(cpFreeFlipY(target)); // กลับแกน y ให้เป็นทิศเดียวกับลายมือผู้ใช้
  if (!u.length || !t.length) return { score: 0 };
  // เขียนรวดเดียวทั้งตัว (1 ขีด แทนที่จะแยกทุกขีด) → ให้ได้ไม่เกิน CFG.singleScore จึงไม่ผ่านเกณฑ์เสมอ
  if (u.length === 1 && t.length > 1) {
    const d = cpFreeChamfer(u[0].pts, t.flatMap((s) => s.pts));
    return { score: CFG.singleScore * cpFreeSim(d, CFG.shapeTol) };
  }
  let sum = 0;
  for (let k = 0; k < u.length; k++) {
    // จับคู่ตามลำดับแบบเทียบสัดส่วน (จำนวนขีดเท่ากัน = จับคู่ 1:1 ตรงๆ)
    const j = Math.min(t.length - 1, Math.round((k * (t.length - 1)) / Math.max(1, u.length - 1)));
    sum += cpFreePairSim(u[k], t[j]);
  }
  const ratio = Math.min(u.length, t.length) / Math.max(u.length, t.length);
  return { score: (sum / u.length) * (CFG.countFloor + (1 - CFG.countFloor) * ratio) };
}

// ตำแหน่งจุดกลางของช่องที่ i ใน "หน่วยช่อง" (คำนวณจากดัชนีในผังตรงๆ ไม่ต้องวัด DOM)
// ใช้ทั้งตอนจัดขีดเข้าช่อง (cpFreeGroups) และตอนให้คะแนน
function cpFreeCellCenter(i) {
  const step = 1 + CP_FREE_GAP / (cpFreeCell || 1);
  return [(i % cpFreeCols) * step + 0.5, Math.floor(i / cpFreeCols) * step + 0.5];
}

// แยกขีดเข้าช่อง: ปรับพิกัดลายมือทั้งแถวให้ตรงกับผังก่อน แล้วจับขีดเข้าช่องที่ใกล้ที่สุด
// เหตุผล: ของเดิมจับด้วย "จุดกลางขีด vs จุดกลางช่อง" บนพิกัดดิบ ทำให้เขียนเหลื่อม/ห่าง/ชิดกันนิดหน่อย
// (หรือเขียนต่อเนื่องแบบสมุด) ขีดที่เลยขอบช่องไปก็ตกไปช่องข้างๆ → ช่องนั้นได้ขีดตัวอื่นปนมา → คะแนนต่ำผิดๆ ทั้งที่เขียนถูก
// การปรับสเกล/เลื่อนให้ลายมือของแต่ละบรรทัดกินพื้นที่ตรงกับช่องของบรรทัดนั้น ช่วยให้จัดช่องได้ถูกแม้ระยะห่างเพี้ยน
function cpFreeGroups() {
  const cols = cpFreeCols || 1;
  const n = cpFree.chars.length;
  const rows = Math.max(1, Math.ceil(n / cols));
  const groups = Array.from({ length: n }, () => []);
  if (!cpFree.strokes.length) return groups;
  const clampK = (k) => Math.min(1.35, Math.max(0.75, k || 1));
  const items = cpFree.strokes.map((pts, idx) => {
    let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      sx += p[0]; sy += p[1];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return { pts: pts, idx: idx, cx: sx / pts.length, cy: sy / pts.length, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  });
  // 1) ปรับแนวตั้งทั้งแผงให้ลายมือกินพื้นที่ตรงกับจำนวนบรรทัด แล้วแยกขีดเข้าบรรทัด
  let y0 = Infinity, y1 = -Infinity;
  items.forEach((it) => { if (it.minY < y0) y0 = it.minY; if (it.maxY > y1) y1 = it.maxY; });
  const ky = clampK(rows / Math.max(0.001, y1 - y0));
  const oy = -y0 * ky;
  const perRow = Array.from({ length: rows }, () => []);
  items.forEach((it) => {
    const cy = it.cy * ky + oy;
    perRow[Math.min(rows - 1, Math.max(0, Math.floor(cy)))].push(it);
  });
  // 2) ปรับแนวนอนแยกทีละบรรทัด (ความกว้างลายมือของบรรทัดนั้น → ความกว้างของช่องในบรรทัดนั้น)
  for (let r = 0; r < rows; r++) {
    const list = perRow[r];
    if (!list.length) continue;
    const first = r * cols;
    const count = Math.min(cols, n - first);
    if (count <= 0) continue;
    let x0 = Infinity, x1 = -Infinity;
    list.forEach((it) => { if (it.minX < x0) x0 = it.minX; if (it.maxX > x1) x1 = it.maxX; });
    const kx = clampK(count / Math.max(0.001, x1 - x0));
    const ox = -x0 * kx;
    list.forEach((it) => {
      const x = it.cx * kx + ox; // ตำแหน่งแนวนอนของขีดหลังปรับให้ตรงผัง
      let bi = 0, bd = Infinity;
      for (let c = 0; c < count; c++) {
        const d = Math.abs(x - cpFreeCellCenter(first + c)[0]);
        if (d < bd) { bd = d; bi = c; }
      }
      groups[first + bi].push(it.pts);
    });
  }
  return groups;
}

async function cpFreeCheck() {
  if (!cp || !cpFree) return;
  const seq = cp.seq;
  const chars = cpFree.chars;
  $("cpFreeCheckBtn").disabled = true;
  cpFreeStatus("กำลังตรวจลายมือ…");
  try {
    await cpLoadCharData(chars); // ต้องมีอินเทอร์เน็ตครั้งแรกเท่านั้น หลังจากนั้นใช้แคช
    if (!cp || cp.seq !== seq || !cpFree) return;
    const groups = cpFreeGroups();
    const results = chars.map((char, i) => Object.assign({ char }, cpFreeCharScore(groups[i], char)));
    const scored = results.filter((r) => r.score !== null);
    const skipped = results.length - scored.length;
    if (!scored.length) {
      cpFreeStatus("โหลดข้อมูลเส้นขีดไม่ได้ — ตรวจต้องใช้อินเทอร์เน็ตครั้งแรก กด “ตรวจ” อีกครั้งเพื่อลองใหม่");
      return;
    }
    const pct = Math.round((scored.reduce((a, r) => a + r.score, 0) / scored.length) * 100);
    cpFreeShowResult(results, pct, skipped);
  } finally {
    $("cpFreeCheckBtn").disabled = false;
  }
}

function cpFreeShowResult(results, pct, skipped) {
  if (!cpFree) return;
  const pass = pct >= CP_FREE_MIN;
  cpFree.result = { pct, pass };
  cpFree.results = results;
  cpFreeApplyBadges();
  const weak = results.filter((r) => r.score !== null && r.score * 100 < CP_FREE_MIN).map((r) => r.char);
  const box = $("cpFreeResult");
  box.replaceChildren();
  const total = document.createElement("div");
  total.className = "cpfree-total" + (pass ? " ok" : "");
  total.textContent = `${pct}%`;
  const verdict = document.createElement("div");
  verdict.className = "cpfree-verdict";
  verdict.textContent = pass
    ? `🎉 ผ่านเกณฑ์ ${CP_FREE_MIN}% — กด “ประโยคถัดไป” ได้เลย`
    : `ยังไม่ผ่านเกณฑ์ ${CP_FREE_MIN}% — ${weak.length ? `ตัวที่ควรซ้อมเพิ่ม: ${weak.join(" ")}` : "ลองเขียนให้ชัดขึ้นอีกนิด"}`;
  box.append(total, verdict);
  if (skipped) {
    const note = document.createElement("div");
    note.className = "cpfree-note";
    note.textContent = `⚠️ ตรวจไม่ได้ ${skipped} ตัว (ยังไม่มีข้อมูลเส้นขีด) จึงคิดคะแนนจาก ${results.length - skipped} ตัว`;
    box.appendChild(note);
  }
  box.hidden = false;
  cpFreeNextEnabled(pass);
  cpFreeStatus(pass ? "เยี่ยม! ไปประโยคถัดไปได้เลย" : "แก้ตัวที่ยังไม่ผ่าน แล้วกด “ตรวจ” อีกครั้งได้");
  if (pass) sfx.correct(); else sfx.wrong();
}

// ยางลบเปิดอยู่ = ไม่มีเสียงดินสอ และไม่วาดเส้นใหม่ (ดู cpFreeDown/Move)
$("cpFreeCanvas").addEventListener("pointerdown", (e) => { if (cpFreeCanStart(e) && !cpFree.eraser) pencilSound.start(e); cpFreeDown(e); });
$("cpFreeCanvas").addEventListener("pointermove", (e) => { if (!cpFree || !cpFree.eraser) pencilSound.move(e); cpFreeMove(e); });
$("cpFreeCanvas").addEventListener("pointerup", cpFreeUp);
$("cpFreeCanvas").addEventListener("pointercancel", cpFreeUp);
$("cpFreeCanvas").addEventListener("pointerleave", () => pencilSound.stop());
$("cpFreeUndoBtn").addEventListener("click", () => {
  if (!cpFree || !cpFree.strokes.length) return;
  sfx.click();
  cpFree.strokes.pop();
  cpFreeClearResult();
  cpFreePaint();
  cpFreeSyncButtons();
  cpFreeStatus("");
});
$("cpFreeEraseBtn").addEventListener("click", () => {
  if (!cpFree) return;
  sfx.click();
  const on = !cpFree.eraser; // กดซ้ำ = ปิดยางลบ กลับไปเขียน
  cpFreeSetEraser(on);
  cpFreeStatus(on
    ? "โหมดยางลบเปิดอยู่ — แตะหรือลากบนเส้นที่ต้องการลบ (กดปุ่มยางลบอีกครั้งเพื่อกลับไปเขียน)"
    : "ปิดยางลบแล้ว — เขียนต่อได้เลย");
});
$("cpFreeClearBtn").addEventListener("click", () => {
  if (!cpFree || !cpFree.strokes.length) return;
  sfx.click();
  cpFreeShowConfirm();
});
$("cpFreeConfirmNoBtn").addEventListener("click", () => {
  sfx.click();
  cpFreeHideConfirm();
});
$("cpFreeConfirmYesBtn").addEventListener("click", () => {
  if (!cpFree) {
    cpFreeHideConfirm();
    return;
  }
  sfx.click();
  cpFreeHideConfirm();
  cpFreeReset(true);
  cpFreeStatus("ล้างลายมือแล้ว — เริ่มเขียนใหม่ได้เลย");
});
$("cpFreeConfirmModal").addEventListener("click", (e) => {
  if (e.target === $("cpFreeConfirmModal")) {
    sfx.click();
    cpFreeHideConfirm();
  }
});
$("cpFreeCheckBtn").addEventListener("click", () => {
  if ($("cpFreeCheckBtn").disabled) return;
  sfx.click();
  cpFreeCheck();
});
$("cpFreeNextBtn").addEventListener("click", () => {
  if ($("cpFreeNextBtn").disabled) return;
  sfx.click();
  cpAdvance();
});

function cpStrokeFit() {
  const size = Math.min(220, Math.max(140, $("cpStrokeWriter").clientWidth || 200));
  if (cpWriter) cpWriter.updateDimensions({ width: size, height: size, padding: 10 });
  return size;
}

// เปิดแผงลำดับขีดของคำที่แตะ — โหลด HanziWriter + ข้อมูลเส้นครั้งแรกเท่านั้น
// (ต้องใช้อินเทอร์เน็ต; โหลดไม่สำเร็จแตะคำเดิมซ้ำเพื่อลองใหม่ ไม่กระทบอะไร)
async function cpOpenStrokes(word, chip) {
  if (!cp || cpWriteMode === "on") return;
  document.querySelectorAll("#cpTokens .cp-tok").forEach((c) => c.classList.remove("current"));
  chip.classList.add("current");
  $("cpStrokes").hidden = false;
  $("cpStrokeWord").textContent = word;
  const chars = [...word].filter((c) => /[㐀-鿿豈-﫿]/.test(c));
  const seq = ++cp.seq;
  const status = $("cpStrokeStatus");
  status.textContent = "กำลังโหลดข้อมูลเส้นขีด…";
  try {
    await cpLoadCharData(chars);
    if (!cp || cp.seq !== seq) return;
    if (!chars.length) { status.textContent = "คำนี้ไม่มีตัวอักษรจีนให้ดูเส้นขีด"; return; }
    if (!chars.some((c) => bombCharData.get(c))) throw new Error("no stroke data");
    cp.chars = chars;
    cp.charIndex = 0;
    if (!cpWriter) {
      const size = cpStrokeFit();
      cpWriter = new window.HanziWriter($("cpStrokeWriter"), {
        width: size, height: size, padding: 10,
        showCharacter: false, showOutline: true,
        strokeColor: "#203954", outlineColor: "#b8c4d0",
        charDataLoader: (char) => bombCharData.get(char),
      });
    } else {
      cpStrokeFit();
    }
    const chips = $("cpStrokeChars");
    chips.replaceChildren();
    chars.forEach((char, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dict-stroke-chip";
      b.textContent = char;
      b.lang = "zh";
      b.addEventListener("click", () => { sfx.click(); cpStrokePlay(i); });
      chips.appendChild(b);
    });
    chips.hidden = chars.length < 2;
    status.textContent = "";
    cpStrokePlay(0);
  } catch (e) {
    if (cp && cp.seq === seq) status.textContent = "โหลดข้อมูลเส้นขีดไม่สำเร็จ — ต้องใช้อินเทอร์เน็ตครั้งแรก แตะคำอีกครั้งเพื่อลองใหม่";
  }
}

async function cpStrokePlay(index) {
  if (!cp || !cpWriter) return;
  cp.charIndex = index;
  const char = cp.chars[index];
  const seq = ++cp.seq;
  document.querySelectorAll("#cpStrokeChars .dict-stroke-chip").forEach((c, i) => {
    c.classList.toggle("current", i === index);
  });
  const status = $("cpStrokeStatus");
  if (!bombCharData.get(char)) {
    status.textContent = `ไม่มีข้อมูลเส้นขีดของ "${char}"`;
    return;
  }
  status.textContent = "";
  try {
    await cpWriter.setCharacter(char);
    if (!cp || cp.seq !== seq) return;
    cpWriter.loopCharacterAnimation();
  } catch (e) {
    if (cp && cp.seq === seq) status.textContent = `โหลดเส้นขีดของ "${char}" ไม่สำเร็จ`;
  }
}

$("cpListenBtn").addEventListener("click", () => {
  sfx.click();
  if (cp && cp.current) {
    const question = cp.current;
    speakSentence(question, false, () => clearCopyKaraoke(question),
      (progress) => updateCopyKaraoke(question, progress));
  }
});
$("cpSkipBtn").addEventListener("click", () => { sfx.click(); cpAdvance(); });
$("cpNextBtn").addEventListener("click", () => { sfx.click(); cpAdvance(); });
$("cpMuteBtn").addEventListener("click", toggleMute);
// โหมดเขียนในเกม: เขียนครบทุกตัวแล้วปุ่มนี้จึงกดได้ (ยังไม่ครบ = ปุ่มเทา กดไม่ได้)
$("cpWriteNextBtn").addEventListener("click", () => {
  if ($("cpWriteNextBtn").disabled) return;
  sfx.click();
  cpAdvance();
});
$("cpQuitBtn").addEventListener("click", () => {
  sfx.click();
  cpHideWordPopup();
  cpHideWrite();
  cp = null;
  cpHideStrokes();
  stopSpeech();
  music.stop();
  switchScreen(menuEl);
  updateBestLine();
});
