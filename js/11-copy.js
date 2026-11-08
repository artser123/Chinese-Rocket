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
  music.start("copy"); // ชุดเพลงของตัวเอง (เดิมใช้ร่วมกับเกมเรียงประโยค)
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
  for (const src of categoryVocabSources()) {
    for (const w of src.words) {
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
  // "อธิบายทั้งประโยค": ซ่อนเมื่อไม่มีประโยครอบคำ และในเกมเติมคำก่อนตอบ (คำแปลทั้งประโยคจะเฉลยช่องว่าง)
  const sent = typeof cpPopupSentence === "function" ? cpPopupSentence() : "";
  $("cpWordAiSentBtn").hidden = !AI_ON || !sent || sent === word || sent.includes("＿");
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
$("cpWordStrokeBtn").addEventListener("click", () => {
  sfx.click();
  const word = cpPopupWord;
  if (!word) return;
  const info = cpLookupWord(word);
  cpHideWordPopup();
  // Reuse the vocabulary overview's centered HanziWriter popup and cache.
  if (typeof voOpenStrokes === "function") {
    voOpenStrokes({ zh: word, py: info.py || "", th: info.th || "" });
  }
});
// ปุ่ม Bing ในป๊อปอัปคำศัพท์ (ใช้ร่วมทุกโหมดที่แตะคำได้) — เปิดในเว็บของแอพ (APK)
// แล้วกดย้อนกลับกลับมาหน้าเกมเดิมได้; ปิดป๊อปอัปก่อนเพื่อไม่ให้ค้างระหว่างดูเว็บ
$("cpWordBingBtn").addEventListener("click", () => {
  sfx.click();
  const word = cpPopupWord;
  if (word) crPopupHoldAway();
  cpHideWordPopup();
  if (word) crOpenWeb(dictBingUrl(word));
});

// ===== ถาม AI ในป๊อปอัปคำศัพท์ (Cloudflare Worker → Gemini Flash) =====
// URL ของ Worker และ APP_TOKEN เก็บใน localStorage ของเครื่องเท่านั้น — repo เป็นสาธารณะ
// (GitHub Pages) จึงห้ามเขียนลงโค้ด; คำตอบแคชไว้ในเครื่อง (IndexedDB) ถามซ้ำไม่เสียเงิน
// แคชคำตอบ AI ใน IndexedDB (ฐาน cr_ai, store answers: {k, a, t}) — จำได้ AI_CACHE_MAX รายการล่าสุด
// ไม่ใช้ localStorage แล้ว: เพดาน ~5–10 MB ใช้ร่วมกับคะแนน/ภารกิจ (เต็มแล้วข้อมูลพวกนั้นบันทึกไม่ได้)
// และต้อง parse ทั้งก้อนทุกครั้ง; ของเก่าใน cr_ai_cache_v1 ถูกย้ายมาเองครั้งแรกที่เปิดฐาน
const AI_CACHE_LEGACY = "cr_ai_cache_v1";
const AI_CACHE_MAX = 10000;
const AI_DB = "cr_ai";
const AI_STORE = "answers";
const AI_CHAT_META = "chatMeta"; // {id, t, c, title, n, thumb, text}
const AI_CHAT_MSGS = "chatMsgs"; // {id, msgs: [{q, a, img}]}
const AI_CHAT_MAX = 300;         // เก็บแชทล่าสุดกี่บทสนทนา (เกินแล้วลบที่เก่าสุด)
let aiDbPromise = null;
const aiMemCache = new Map(); // สำรองเมื่อเปิด IndexedDB ไม่ได้ (โหมดส่วนตัวบางเบราว์เซอร์) — จำแค่ระหว่างเปิดแอป
const AI_DEFAULT_Q = "อธิบายความหมายและการใช้คำนี้ในประโยคนี้";
// คำเดี่ยวที่ไม่มีประโยคประกอบ (ปุ่ม 🤖 ในเกมรวมคำศัพท์)
const AI_WORD_ONLY_Q = "อธิบายความหมายและการใช้คำนี้ คำที่มักใช้คู่กัน และยกตัวอย่างประโยค 2 ประโยค";
// ปุ่ม 🤖 ค้นหาด้วย AI ในพจนานุกรม — ข้อความที่พิมพ์ส่งไปในช่อง sentence (คำถามต่อจึงยังเห็นบริบท)
const AI_DICT_TH_Q = `ข้อความในบรรทัด "ประโยค" เป็นภาษาไทย ให้แปลเป็นภาษาจีน:
1) คำแปลภาษาจีนที่เป็นธรรมชาติ พร้อม pinyin (ถ้าพูดได้หลายแบบ ให้ 2–3 แบบ และบอกว่าต่างกันอย่างไร)
2) แยกคำศัพท์สำคัญ พร้อม pinyin และความหมาย
3) โครงสร้างไวยากรณ์ที่ใช้ อธิบายสั้น ๆ
4) บริบทการใช้และข้อควรระวัง`;
const AI_DICT_ZH_Q = `ข้อความในบรรทัด "ประโยค" เป็นภาษาจีน ให้อธิบายเป็นภาษาไทย:
1) pinyin และคำแปลภาษาไทยที่เป็นธรรมชาติ
2) แยกคำศัพท์ทีละคำ พร้อม pinyin และความหมาย
3) โครงสร้างไวยากรณ์ที่ใช้ อธิบายสั้น ๆ
4) บริบทการใช้ และยกตัวอย่างประโยคเพิ่ม 1–2 ประโยค`;
const AI_DICT_PY_Q = `ข้อความในบรรทัด "ประโยค" น่าจะเป็นพินอินหรือภาษาอื่น ให้บอกว่าเป็นคำ/ประโยคจีนอะไร (ตัวจีน + pinyin ที่ถูกต้อง ถ้าเป็นไปได้หลายคำ ให้บอกคำที่พบบ่อย 2–3 คำ) แปลเป็นภาษาไทย อธิบายการใช้ และยกตัวอย่างประโยค`;
// โหมดทั้งประโยค: ส่ง word ว่าง ให้ AI โฟกัสที่ประโยค (คำตอบยาวกว่าปกติ — ต้องตั้ง maxOutputTokens ใน Worker ≥ 2048)
const AI_SENTENCE_Q = `อธิบายภาพรวมของประโยคนี้อย่างละเอียด:
1) แปลทั้งประโยคเป็นภาษาไทยที่เป็นธรรมชาติ
2) แยกคำศัพท์ทีละคำ พร้อม pinyin และความหมายในประโยคนี้
3) โครงสร้างไวยากรณ์/รูปประโยคที่ใช้ อธิบายสั้น ๆ
4) บริบท: ใช้ในสถานการณ์แบบไหน น้ำเสียงทางการหรือไม่ และข้อควรระวัง`;
// คำถามสำเร็จรูป → รหัสสั้นในคีย์แคช (ต้องอยู่หลังค่าคงที่ทุกตัวที่อ้างถึง: const ใช้ก่อนประกาศไม่ได้)
const AI_CANNED_Q = new Map([
  [AI_DEFAULT_Q, "#w"], [AI_SENTENCE_Q, "#s"], [AI_WORD_ONLY_Q, "#v"],
  [AI_DICT_TH_Q, "#dt"], [AI_DICT_ZH_Q, "#dz"], [AI_DICT_PY_Q, "#dp"],
]);

// ผู้ให้บริการ: "gemini" = Cloudflare Worker → Gemini (workers.dev/Google เข้าไม่ได้ในจีนถ้าไม่มี VPN)
// "deepseek" / "qwen" = เรียก API แบบ OpenAI ตรงจากแอป (ทั้งสองเจ้าเปิด CORS ให้แล้ว, ใช้ในจีนได้)
// — key อยู่ใน localStorage ของเครื่องเท่านั้น
// Qwen: key ของบัญชี Alibaba Cloud สากล (สิงคโปร์) ใช้ได้กับ dashscope-intl เท่านั้น ส่วนบัญชีจีนใช้ dashscope
// — แอปลองทั้งสองที่แล้วจำที่ใช้ได้ไว้ใน cr_ai_qwen_region จึงไม่ต้องถามผู้ใช้
const AI_COMPAT = {
  deepseek: {
    name: "DeepSeek",
    keyLs: "cr_ai_ds_key",
    // deepseek-flash = V4.1-Flash (ชื่อปัจจุบันในหน้าราคา พ.ย. 2026; ชื่อเก่า deepseek-chat ไม่อยู่ในเอกสารแล้ว)
    // รับรูปได้ด้วย (image_url แบบ data URL, ≤ 384 token ต่อรูป)
    model: "deepseek-flash",
    maxOut: 8192,
    urls: { main: "https://api.deepseek.com/chat/completions" },
    topUp: "platform.deepseek.com",
  },
  qwen: {
    name: "Qwen",
    keyLs: "cr_ai_qwen_key",
    model: "qwen-plus",
    visionModel: "qwen-vl-plus", // qwen-plus อ่านรูปไม่ได้ — คำถามที่มีรูป (รวมรูปในบทสนทนาก่อนหน้า) ใช้รุ่น VL
    maxOut: 8192,
    urls: {
      intl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      cn: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    },
    regionLs: "cr_ai_qwen_region",
    topUp: "Alibaba Cloud Model Studio",
  },
};
const AI_PROVIDER_LABEL = { gemini: "✨ Gemini", deepseek: "🐋 DeepSeek", qwen: "🟣 Qwen" };
// คำสั่งระบบชุดเดียวกับใน Worker (tools/cloudflare_worker_ai.js) ให้คำตอบทุกเจ้าออกมาแนวเดียวกัน
const AI_SYSTEM = `คุณคือครูสอนภาษาจีนให้คนไทย
- ตอบเป็นภาษาไทย อ่านง่ายบนมือถือ
- อธิบายความหมาย การใช้ และไวยากรณ์ ให้เหมาะกับระดับ HSK ที่ระบุ
- ทุกครั้งที่เขียนตัวอักษรจีน ไม่ว่าคำเดียว วลี หรือทั้งประโยค ต้องมี pinyin พร้อมวรรณยุกต์กำกับในวงเล็บต่อท้ายทันที เช่น 学习 (xuéxí) ห้ามมีตัวจีนที่ไม่มี pinyin
- ยกตัวอย่างประโยค 1–2 ประโยค พร้อม pinyin และคำแปลไทย
- ถ้าคำมีหลายความหมาย/หลายเสียงอ่าน ให้ยึดความหมายตามประโยคที่ให้มา
- ถ้าถูกขอให้อธิบายละเอียดหรือแยกทีละคำ ให้ตอบครบทุกข้อ ห้ามตัดจบกลางคัน
- ห้ามใช้คำลงท้าย ครับ/ค่ะ
- ไม่ต้องใช้หัวข้อใหญ่ ใช้ขีด - เป็นข้อ ๆ ได้`;

// การ์ด "ถามอาจารย์ AI" บนหน้าแรก: คุยอิสระ ไม่ผูกกับคำ/ประโยคในเกม
// (Worker ฝั่ง Gemini มีคำสั่งชุดเดียวกันใน tools/cloudflare_worker_ai.js — แก้ให้ตรงกันด้วย)
const AI_CHAT_SYSTEM = `คุณคืออาจารย์สอนภาษาจีนที่ใจดี อธิบายเก่ง และแม่นยำ สอนผู้เรียนชาวไทย
- ตอบเป็นภาษาไทย อ่านง่ายบนมือถือ
- ทุกครั้งที่เขียนตัวอักษรจีน ไม่ว่าคำเดียวหรือทั้งประโยค ต้องมี pinyin พร้อมวรรณยุกต์กำกับในวงเล็บต่อท้ายทันที เช่น 学习 (xuéxí) ห้ามมีตัวจีนที่ไม่มี pinyin
- ประโยคตัวอย่างทุกประโยคต้องมีคำแปลภาษาไทย
- อธิบายความหมาย วิธีใช้ และโครงสร้างไวยากรณ์ พร้อมยกตัวอย่าง 2–3 ประโยค
- ปิดท้ายทุกคำตอบด้วยหัวข้อ "ข้อควรระวัง" บอกจุดที่คนไทยมักใช้ผิด คำที่สับสนง่าย หรือความต่างด้านความสุภาพ/บริบท
- ถ้าคำถามไม่เกี่ยวกับภาษาจีนหรือวัฒนธรรมจีน ให้ตอบสั้น ๆ แล้วชวนกลับมาเรื่องภาษาจีน
- ห้ามใช้คำลงท้าย ครับ/ค่ะ
- ไม่ต้องใช้หัวข้อใหญ่ ใช้ขีด - เป็นข้อ ๆ ได้`;
// Worker เดิมที่ยังไม่รู้จัก chat: ส่งกฎย่อติดไปกับคำถาม ให้ Gemini ตอบแบบอาจารย์ด้วย
const AI_CHAT_HINT = "[ตอบแบบอาจารย์สอนภาษาจีน: ตัวจีนทุกตัวต้องมี pinyin กำกับในวงเล็บ อธิบายวิธีใช้ ยกตัวอย่างพร้อมคำแปล และปิดท้ายด้วยข้อควรระวัง]\n";
// ปุ่มอธิบายคำ/ประโยค: Worker ที่ยังไม่ได้ deploy คำสั่งระบบรุ่นใหม่ก็ยังใส่ pinyin ให้ทุกตัวจีน
const AI_PINYIN_HINT = "[ตัวอักษรจีนทุกตัวในคำตอบต้องมี pinyin พร้อมวรรณยุกต์กำกับในวงเล็บต่อท้าย เช่น 学习 (xuéxí)]\n";
const AI_CHAT_HISTORY = 6; // ส่งคำถาม-คำตอบย้อนหลังไปกี่คู่
// ส่งรูปโดยไม่พิมพ์คำถาม (ปุ่ม 📷/🖼️ ในโหมดถามอาจารย์)
const AI_PHOTO_Q = `อ่านตัวอักษรจีนทั้งหมดในรูปนี้ แล้วสอนแบบอาจารย์:
1) ข้อความจีนที่เห็นในรูป เรียงตามตำแหน่ง พร้อม pinyin
2) แปลเป็นภาษาไทยที่เป็นธรรมชาติ และบอกว่ารูปนี้น่าจะเป็นอะไร (ป้าย เมนู ฉลาก ฯลฯ)
3) คำศัพท์สำคัญ พร้อม pinyin และความหมาย
4) ไวยากรณ์หรือรูปประโยคที่น่าสนใจ
5) ข้อควรระวัง
ถ้าอ่านบางตัวไม่ชัดให้บอกตรง ๆ ห้ามเดา ถ้าในรูปไม่มีตัวจีน ให้บอกว่าเห็นอะไร แล้วสอนคำศัพท์ภาษาจีนของสิ่งที่เห็น`;
const AI_PHOTO_MAX = 1280; // ย่อด้านยาวของรูปก่อนส่ง (อัปโหลดเร็ว, token น้อย, ตัวจีนเล็ก ๆ ยังอ่านออก)
const AI_CHAT_SUGGEST = [
  "了 กับ 过 ใช้ต่างกันยังไง",
  "就 กับ 才 ต่างกันอย่างไร",
  "把 ใช้ยังไง ยกตัวอย่างหน่อย",
  "สอนประโยคสั่งอาหารในร้านอาหาร",
  "พูดขอบคุณแบบสุภาพมีแบบไหนบ้าง",
  "的 地 得 ต่างกันยังไง",
];

function aiLs(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }

function aiProvider() {
  const p = aiLs("cr_ai_provider");
  if (p === "gemini" || AI_COMPAT[p]) return p;
  return aiLs("cr_ai_url") ? "gemini" : "deepseek"; // ผู้ที่ตั้ง Worker ไว้ก่อนมีตัวเลือกนี้ ใช้ Gemini ต่อ
}

function aiConfig() {
  const provider = aiProvider();
  if (AI_COMPAT[provider]) {
    const key = aiLs(AI_COMPAT[provider].keyLs);
    return key ? { provider, key } : null;
  }
  const url = aiLs("cr_ai_url");
  const token = aiLs("cr_ai_token");
  return url && token ? { provider: "gemini", url, token } : null;
}

async function askCompat(cfg, payload) {
  const p = AI_COMPAT[cfg.provider];
  const ctx = [
    payload.word && `คำ: ${payload.word}`,
    payload.pinyin && `pinyin: ${payload.pinyin}`,
    payload.thai && `คำแปลในแอป: ${payload.thai}`,
    payload.sentence && `ประโยค: ${payload.sentence}`,
    payload.level && `ระดับผู้เรียน: HSK ${payload.level}`,
  ].filter(Boolean).join("\n");
  // โหมดถามอาจารย์: ใช้คำสั่งระบบของอาจารย์ + ส่งบทสนทนาก่อนหน้าไปด้วย (ถามต่อแบบ "แล้วคำนี้ล่ะ" ได้)
  // รูป (data URL) ส่งเป็น content แบบ array ตามรูปแบบ OpenAI — ใส่ได้เฉพาะข้อความของ user
  const userContent = (text, img) => img
    ? [{ type: "text", text }, { type: "image_url", image_url: { url: img } }]
    : text;
  const history = (payload.history || []).flatMap((h) => [
    { role: "user", content: userContent(h.q, h.img) },
    { role: "assistant", content: h.a },
  ]);
  const hasImage = !!payload.image || (payload.history || []).some((h) => h.img);
  const body = JSON.stringify({
    model: hasImage && p.visionModel ? p.visionModel : p.model,
    temperature: 0.4,
    max_tokens: p.maxOut,
    messages: [
      { role: "system", content: payload.chat ? AI_CHAT_SYSTEM : AI_SYSTEM },
      ...history,
      { role: "user", content: userContent(payload.chat ? payload.q : (ctx ? ctx + "\n\n" : "") + "คำถาม: " + payload.q, payload.image) },
    ],
  });
  // ภูมิภาคที่เคยใช้ได้มาก่อน ไม่งั้นลองทุกที่ตามลำดับ (401 = key ไม่ใช่ของที่นี่ → ลองที่ถัดไป)
  const saved = p.regionLs && aiLs(p.regionLs);
  const regions = Object.keys(p.urls).sort((a, b) => (b === saved) - (a === saved));
  let r, data, region;
  for (region of regions) {
    try {
      r = await fetch(p.urls[region], {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
        body,
      });
    } catch {
      throw new Error(`เชื่อมต่อ ${p.name} ไม่ได้ — ตรวจอินเทอร์เน็ต`);
    }
    data = await r.json().catch(() => ({}));
    if (r.status !== 401) break;
  }
  if (r.status === 401) {
    try { localStorage.removeItem(p.keyLs); } catch {}
    throw new Error(`API key ของ ${p.name} ไม่ถูกต้อง — กด ⚙️ เพื่อใส่ใหม่`);
  }
  if (p.regionLs && r.ok) { try { localStorage.setItem(p.regionLs, region); } catch {} }
  const msg = (data.error && data.error.message) || "";
  if (r.status === 402 || /arrearage|insufficient.?balance/i.test(msg + " " + (data.error && data.error.code || ""))) {
    throw new Error(`ยอดเงินใน ${p.name} หมด — เติมเงินที่ ${p.topUp}`);
  }
  if (!r.ok) throw new Error(msg || `${p.name} HTTP ${r.status}`);
  const choice = (data.choices && data.choices[0]) || {};
  const text = String((choice.message && choice.message.content) || "").trim();
  return { answer: text || `(ไม่มีคำตอบ: ${choice.finish_reason || "unknown"})`, truncated: choice.finish_reason === "length" };
}

// คำถามสำเร็จรูปสองแบบยาวหลายร้อยตัวอักษร — ใช้รหัสสั้นในคีย์แทน (คำถามพิมพ์เองใช้ข้อความเต็ม)
// AI_CACHE_VER: เปลี่ยนเมื่อรูปแบบคำตอบเปลี่ยน (2 = บังคับ pinyin กำกับทุกตัวจีน) ให้ถามใหม่แทนคำตอบเก่าในแคช
// — คีย์รุ่นเก่าไม่ถูกใช้อีก และค่อย ๆ ถูกลบโดย aiCachePrune (ใช้นานที่สุดก่อน)
const AI_CACHE_VER = 2;
function aiCacheKey(word, sentence, q) {
  const qid = AI_CANNED_Q.get(q) || q;
  return JSON.stringify([word || "", sentence || "", qid, AI_CACHE_VER]);
}

function aiReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function aiDb() {
  if (aiDbPromise) return aiDbPromise;
  aiDbPromise = new Promise((resolve) => {
    let req;
    // v2 = เพิ่มประวัติแชทของโหมดถามอาจารย์ AI (คำตอบที่แคชไว้ในรุ่น 1 ยังอยู่ครบ)
    try { req = indexedDB.open(AI_DB, 2); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AI_STORE)) {
        db.createObjectStore(AI_STORE, { keyPath: "k" }).createIndex("t", "t");
      }
      // แยกเป็นสองที่: รายการ (ชื่อ/วันที่/รูปย่อ/ข้อความไว้ค้นหา — โหลดทั้งหมดได้เร็ว)
      // กับเนื้อหาเต็ม (รูปขนาดที่ส่งให้ AI — โหลดเฉพาะแชทที่เปิด)
      if (!db.objectStoreNames.contains(AI_CHAT_META)) {
        db.createObjectStore(AI_CHAT_META, { keyPath: "id" }).createIndex("t", "t");
      }
      if (!db.objectStoreNames.contains(AI_CHAT_MSGS)) db.createObjectStore(AI_CHAT_MSGS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).then(async (db) => {
    if (db) await aiMigrateLegacy(db);
    return db;
  });
  return aiDbPromise;
}

// ย้ายคำตอบเดิมจาก localStorage (คีย์ [word, sentence, คำถามเต็ม]) แล้วลบของเดิมทิ้ง
async function aiMigrateLegacy(db) {
  let old;
  try { old = localStorage.getItem(AI_CACHE_LEGACY); } catch { return; }
  if (!old) return;
  let map = {};
  try { map = JSON.parse(old) || {}; } catch {}
  try {
    const tx = db.transaction(AI_STORE, "readwrite");
    const store = tx.objectStore(AI_STORE);
    const now = Date.now();
    Object.entries(map).forEach(([k, a], i) => {
      try {
        const [w, s, q] = JSON.parse(k);
        if (typeof a === "string" && a) store.put({ k: aiCacheKey(w, s, q), a, t: now - (1e6 - i) }); // คงลำดับเก่า→ใหม่
      } catch {}
    });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    localStorage.removeItem(AI_CACHE_LEGACY);
  } catch {}
}

async function aiCacheGet(key) {
  const db = await aiDb();
  if (!db) return aiMemCache.get(key) || null;
  try {
    const store = db.transaction(AI_STORE, "readwrite").objectStore(AI_STORE);
    const rec = await aiReq(store.get(key));
    if (!rec) return null;
    rec.t = Date.now(); // ใช้ล่าสุด = ถูกลบทีหลังสุด
    store.put(rec);
    return rec.a;
  } catch { return null; }
}

async function aiCacheSet(key, answer) {
  const db = await aiDb();
  if (!db) { aiMemCache.set(key, answer); return; }
  try {
    const store = db.transaction(AI_STORE, "readwrite").objectStore(AI_STORE);
    await aiReq(store.put({ k: key, a: answer, t: Date.now() }));
    const extra = (await aiReq(store.count())) - AI_CACHE_MAX;
    if (extra > 0) aiCachePrune(db, extra);
  } catch {}
}

// ลบรายการที่ใช้นานที่สุด extra รายการ (ไล่ index t จากเก่าสุด)
function aiCachePrune(db, extra) {
  try {
    const req = db.transaction(AI_STORE, "readwrite").objectStore(AI_STORE).index("t").openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || extra <= 0) return;
      cur.delete();
      extra--;
      cur.continue();
    };
  } catch {}
}

async function askAi(payload) {
  // โหมดถามอาจารย์: แคชเฉพาะคำถามแรกของบทสนทนา (คำถามต่อขึ้นกับคำตอบก่อนหน้า ใช้ซ้ำไม่ได้)
  // คำถามที่มีรูปไม่แคช (คำถามเดียวกันใช้กับรูปคนละรูป)
  const chat = !!payload.chat;
  const key = chat ? (payload.image || (payload.history && payload.history.length) ? null : aiCacheKey("", "#chat", payload.q))
    : aiCacheKey(payload.word, payload.sentence, payload.q);
  const hit = key && await aiCacheGet(key);
  if (hit) return hit;
  const cfg = aiConfig();
  if (!cfg) throw new Error("ยังไม่ได้ตั้งค่า AI");
  if (AI_COMPAT[cfg.provider]) {
    const ds = await askCompat(cfg, payload);
    if (ds.truncated) return ds.answer + "…\n\n✂️ คำตอบถูกตัด (ยาวเกินเพดานของโมเดล)";
    if (key) aiCacheSet(key, ds.answer);
    return ds.answer;
  }
  let r;
  try {
    r = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Token": cfg.token },
      body: JSON.stringify({ ...payload, q: (chat ? AI_CHAT_HINT : AI_PINYIN_HINT) + payload.q }),
    });
  } catch {
    throw new Error("เชื่อมต่อ AI ไม่ได้ — ตรวจอินเทอร์เน็ตหรือ URL ของ Worker (อยู่ในจีน: กด ⚙️ แล้วเลือก DeepSeek)");
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    try { localStorage.removeItem("cr_ai_token"); } catch {}
    throw new Error("APP_TOKEN ไม่ถูกต้อง — กด 🤖 อีกครั้งเพื่อตั้งค่าใหม่");
  }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  // Worker รุ่นเก่าไม่รู้จักช่อง image: ตอบได้แต่ไม่เห็นรูป (Worker รุ่นใหม่ส่ง vision: true กลับมา)
  if (payload.image && !data.vision) {
    return data.answer + "\n\n⚠️ Worker ของ Gemini ยังเป็นรุ่นเก่าที่ไม่ส่งรูปต่อ — deploy tools/cloudflare_worker_ai.js ใหม่ หรือกด ⚙️ แล้วเลือก DeepSeek/Qwen";
  }
  // Worker ส่ง truncated/finishReason มา: หยุดเพราะชน maxOutputTokens หรือเหตุอื่นที่ไม่ใช่จบปกติ
  // (SAFETY, RECITATION…) — ไม่แคช จะได้ถามใหม่ได้
  if (data.truncated || data.finishReason === "MAX_TOKENS") {
    return data.answer + "…\n\n✂️ คำตอบถูกตัด (เกินความยาวที่ตั้งไว้ใน Worker)";
  }
  if (data.finishReason && data.finishReason !== "STOP") {
    return data.answer + `\n\n⚠️ AI หยุดตอบก่อนจบ (${data.finishReason})`;
  }
  if (key) aiCacheSet(key, data.answer);
  return data.answer;
}

// ประโยคที่คำนั้นอยู่: คำแต่ละคำเป็นปุ่มแยกในกล่องเดียวกัน — เก็บเฉพาะอักษรจีน/วรรคตอนจีน
// (บางโหมดมี pinyin อยู่ในปุ่มคำด้วย)
function cpPopupSentence() {
  const box = cpPopupChip && cpPopupChip.parentElement;
  if (!box) return "";
  const zh = box.textContent.replace(/[^㐀-鿿　-〿＀-￯]/g, "").slice(0, 150);
  // เกมเติมคำก่อนตอบ: ประโยคยังมีช่อง ＿＿ — บอก AI ไม่ให้เดา/เฉลยคำในช่อง
  return /＿/.test(zh) ? zh.replace(/＿+/g, "＿＿") + " (＿＿ คือช่องว่างของแบบฝึกหัดที่ผู้เรียนยังไม่ได้ตอบ ห้ามเดาหรือบอกคำที่หายไป)" : zh;
}

function cpPopupLevel() {
  if (typeof currentCategory !== "undefined" && currentCategory !== "hsk") return "";
  const first = String(typeof selectedLevel !== "undefined" ? selectedLevel : "").split(LEVEL_SEP)[0];
  return /^\d$/.test(first) ? first : "";
}

// Gemini ใส่ markdown มาแม้ prompt จะห้าม: **ตัวหนา** → <b>, หัวข้อ # และบูลเล็ต * → ข้อความธรรมดา
// สร้างด้วย text node ทั้งหมด (ไม่ใช้ innerHTML) เพื่อไม่ให้ข้อความจาก AI กลายเป็น HTML
function aiRenderAnswer(el, text) {
  el.replaceChildren();
  const clean = String(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^(\s*)[*•]\s+/gm, "$1• ")
    .replace(/^(\s*)-\s+/gm, "$1• ");
  for (const part of clean.split(/(\*\*[^*\n]+\*\*)/)) {
    if (!part) continue;
    if (/^\*\*[^*\n]+\*\*$/.test(part)) {
      const b = document.createElement("b");
      b.textContent = part.slice(2, -2);
      el.appendChild(b);
    } else {
      el.appendChild(document.createTextNode(part.replace(/\*\*/g, "")));
    }
  }
}

// ----- หน้าต่าง AI เกือบเต็มจอ (#aiPanel, อยู่นอกทุก .screen) -----
// ปุ่ม 🤖/📖 ในฟองคำศัพท์จับบริบท (คำ/ประโยค/ระดับ) เก็บไว้ใน aiCtx แล้วปิดฟองคำ — ฟองเล็กเกินไป
// สำหรับคำตอบยาว ๆ; คำถามต่อในช่องพิมพ์ใช้บริบทเดิมและโหมดเดิม ต่อท้ายเป็นบทสนทนา
let aiCtx = null; // { mode: "word"|"sentence", word, py, th, sentence, shown, level, pendingQ }

// เปิดจากฟองคำศัพท์: ดึงคำ/ประโยค/ระดับจากคำที่แตะ แล้วปิดฟองคำ
function aiPanelOpen(mode) {
  const word = cpPopupWord;
  if (!word) return;
  const info = cpLookupWord(word);
  const sentence = cpPopupSentence();
  cpHideWordPopup();
  aiOpenWith({
    mode,
    word,
    py: info.py || "",
    th: info.th || "",
    sentence,
    shown: sentence.replace(/ \(＿＿.*$/, ""), // ตัดหมายเหตุสำหรับ AI ออกตอนแสดงหัวหน้าต่าง
    level: cpPopupLevel(),
  });
}

// เปิดหน้าต่าง AI ด้วยบริบทที่ส่งมาเอง (ใช้จากที่อื่นได้ เช่น ปุ่ม 🤖/📖 ในเกมรวมคำศัพท์)
// ctx: { mode: "word"|"sentence", word, py?, th?, sentence?, shown?, level?, sub?, kind?, firstQ? }
// kind = ป้ายบนหัวหน้าต่าง, firstQ = คำถามแรกแทนคำถามตามโหมด
// sub = บรรทัดรองใต้หัวหน้าต่าง (ไม่ใส่: โหมดคำ = pinyin · คำแปล, โหมดประโยค = ว่าง)
function aiOpenWith(ctx) {
  if (!AI_ON) return; // ปุ่ม AI มีเฉพาะ APK (ดู AI_ON ใน js/01-state.js)
  const whole = ctx.mode === "sentence";
  aiCtx = {
    mode: ctx.mode,
    word: ctx.word || "",
    py: ctx.py || "",
    th: ctx.th || "",
    sentence: ctx.sentence || "",
    shown: ctx.shown || ctx.sentence || "",
    level: ctx.level || "",
    firstQ: ctx.firstQ || "",
    pendingQ: null,
    history: [], // โหมด chat: [{q, a}] ที่ตอบสำเร็จแล้ว
  };
  const chat = ctx.mode === "chat";
  $("aiPanelKind").textContent = ctx.kind || (whole ? "📖 อธิบายทั้งประโยค" : "🤖 อธิบายคำนี้");
  $("aiPanelTitle").textContent = ctx.title || (whole ? aiCtx.shown : aiCtx.word);
  $("aiPanelSub").textContent = ctx.sub != null ? ctx.sub
    : whole ? "" : [aiCtx.py, aiCtx.th].filter(Boolean).join(" · ");
  $("aiPanelTitle").classList.toggle("is-sentence", whole || chat);
  $("aiThread").replaceChildren();
  $("aiChatIntro").hidden = !chat;
  $("aiAskInput").placeholder = chat ? AI_CHAT_PLACEHOLDER : AI_ASK_PLACEHOLDER;
  $("aiCameraBtn").hidden = !chat;
  $("aiGalleryBtn").hidden = !chat;
  $("aiHistoryBtn").hidden = !chat;
  $("aiHistoryBtn").classList.remove("on");
  $("aiHistoryBtn").setAttribute("aria-expanded", "false");
  $("aiHistory").hidden = true;
  $("aiThread").hidden = false;
  aiPhotoSet(null);
  $("aiPanelBody").scrollTop = 0;
  $("aiPanel").hidden = false;
  if (!chat) { aiAsk(aiFirstQuestion()); return; }
  // โหมดถามอาจารย์ไม่มีคำถามแรก: รอผู้ใช้พิมพ์หรือแตะคำถามตัวอย่าง
  if (!aiConfig()) { aiShowSetup(null); return; }
  $("aiSetup").hidden = true;
  $("aiAskForm").hidden = false;
}

const AI_ASK_PLACEHOLDER = $("aiAskInput").placeholder;
const AI_CHAT_PLACEHOLDER = "พิมพ์คำถามเกี่ยวกับภาษาจีน…";

// การ์ด "ถามอาจารย์ AI" บนหน้าแรก (APK เท่านั้น)
function aiChatOpen() {
  aiOpenWith({
    mode: "chat",
    kind: "🧑‍🏫 ถามอาจารย์ AI",
    title: "อาจารย์ภาษาจีน AI",
    sub: "ทุกคำจีนมีพินอิน · อธิบายวิธีใช้ · ข้อควรระวัง",
  });
}

AI_CHAT_SUGGEST.forEach((s) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ai-chat-chip";
  b.textContent = s;
  b.addEventListener("click", () => { sfx.click(); aiAsk(s); });
  $("aiChatSuggest").appendChild(b);
});
{
  const card = document.querySelector('.card[data-mode="aichat"]');
  if (card) card.hidden = !AI_ON;
}

// คำถามแรกตามโหมด: ทั้งประโยค / คำในประโยค / คำเดี่ยว
function aiFirstQuestion() {
  if (aiCtx.firstQ) return aiCtx.firstQ;
  if (aiCtx.mode === "sentence") return AI_SENTENCE_Q;
  return aiCtx.sentence ? AI_DEFAULT_Q : AI_WORD_ONLY_Q;
}

// คืน true เมื่อปิดหน้าต่างไปจริง (ใช้กับปุ่ม Back ของ Android)
function aiPanelClose() {
  const panel = $("aiPanel");
  if (!panel || panel.hidden) return false;
  panel.hidden = true;
  aiCtx = null;
  $("aiThread").replaceChildren();
  $("aiChatIntro").hidden = true;
  $("aiSetup").hidden = true;
  $("aiHistory").hidden = true;
  $("aiThread").hidden = false;
  aiPhotoSet(null);
  $("aiAskInput").blur();
  return true;
}

// ----- รูปในโหมดถามอาจารย์ AI: ถ่าย/เลือก → ย่อในเครื่อง → แนบรอส่ง -----
let aiPhoto = null; // data URL (JPEG) ของรูปที่แนบไว้ รอกด ส่ง

function aiPhotoSet(url) {
  aiPhoto = url;
  $("aiPhotoBar").hidden = !url;
  if (url) $("aiPhotoThumb").src = url;
  else $("aiPhotoThumb").removeAttribute("src");
  if (aiCtx && aiCtx.mode === "chat") {
    $("aiAskInput").placeholder = url ? "ถามเกี่ยวกับรูปนี้ (เว้นว่างได้)" : AI_CHAT_PLACEHOLDER;
  }
}

// ย่อด้านยาวเหลือ AI_PHOTO_MAX แล้วเข้ารหัส JPEG — รูปจากกล้องมือถือ 4–12 MB จะเหลือราว 150–400 KB
// (createImageBitmap หมุนรูปตาม EXIF ให้ด้วย: รูปถ่ายแนวตั้งไม่กลายเป็นแนวนอน)
async function aiLoadPhoto(file) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("เปิดรูปนี้ไม่ได้"));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const k = Math.min(1, AI_PHOTO_MAX / Math.max(w, h));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; // PNG โปร่งใส → พื้นขาว (JPEG ไม่มีช่องโปร่งใส)
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(src, 0, 0, cv.width, cv.height);
  if (src.close) src.close();
  else if (src.src && src.src.startsWith("blob:")) URL.revokeObjectURL(src.src);
  return cv.toDataURL("image/jpeg", 0.85);
}

async function aiPhotoPicked(input) {
  const file = input.files && input.files[0];
  input.value = ""; // เลือกรูปเดิมซ้ำได้
  if (!file || !aiCtx) return;
  const btns = [$("aiCameraBtn"), $("aiGalleryBtn")];
  btns.forEach((b) => { b.disabled = true; });
  try {
    aiPhotoSet(await aiLoadPhoto(file));
  } catch (e) {
    aiPhotoSet(null);
    $("aiAskInput").placeholder = "⚠️ " + (e.message || "เปิดรูปไม่ได้");
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

let aiSetupProv = "deepseek"; // ตัวที่เลือกอยู่ในฟอร์มตั้งค่า (บันทึกจริงตอนกด 💾)

function aiSetupPick(prov) {
  aiSetupProv = prov;
  document.querySelectorAll("#aiSetup .ai-prov-btn").forEach((b) => {
    const on = b.dataset.prov === prov;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  $("aiSetupGemini").hidden = prov !== "gemini";
  $("aiSetupDeepseek").hidden = prov !== "deepseek";
  $("aiSetupQwen").hidden = prov !== "qwen";
  $("aiSetupMsg").textContent = "";
}

// question = คำถามที่จะถามต่อหลังบันทึก (null = เปิดจากปุ่ม ⚙️ ไม่ถามอะไรใหม่)
function aiShowSetup(question) {
  aiCtx.pendingQ = question;
  $("aiSetup").hidden = false;
  $("aiAskForm").hidden = true;
  $("aiPhotoBar").hidden = true;
  $("aiHistory").hidden = true;
  $("aiThread").hidden = false;
  $("aiHistoryBtn").classList.remove("on");
  $("aiSetupUrl").value = aiLs("cr_ai_url");
  $("aiSetupToken").value = "";
  $("aiSetupDsKey").value = "";
  $("aiSetupQwenKey").value = "";
  aiSetupPick(aiProvider());
  $("aiPanelBody").scrollTop = 0;
}

// image = data URL ของรูปที่แนบ (โหมดถามอาจารย์เท่านั้น)
async function aiAsk(question, image) {
  const ctx = aiCtx;
  if (!ctx) return;
  if (!aiConfig()) { aiShowSetup(question); return; } // รูปที่แนบยังค้างอยู่ใน aiPhoto ส่งใหม่หลังตั้งค่าได้
  $("aiSetup").hidden = true;
  $("aiAskForm").hidden = false;
  const whole = ctx.mode === "sentence";
  const chat = ctx.mode === "chat";
  if (chat) $("aiChatIntro").hidden = true;
  const { entry, ans } = aiMakeEntry(question, image);
  ans.classList.add("thinking");
  ans.textContent = AI_PROVIDER_LABEL[aiProvider()] + " กำลังคิด…";
  $("aiPanelBody").scrollTop = entry.offsetTop - 8; // เลื่อนให้คำถามใหม่อยู่บนสุด อ่านคำตอบจากต้นได้เลย
  let text;
  let ok = false;
  try {
    text = await askAi(chat
      ? { q: question, chat: true, image: image || "", history: aiChatHistory(ctx) }
      : {
        q: question,
        word: whole ? "" : ctx.word,
        pinyin: whole ? "" : ctx.py,
        thai: whole ? "" : ctx.th,
        sentence: ctx.sentence,
        level: ctx.level,
      });
    ok = true;
  } catch (e) {
    text = "⚠️ " + e.message;
    ans.classList.add("err");
  }
  if (chat && ok) {
    ctx.history.push({ q: question, a: text, img: image || "" });
    aiChatSave(ctx); // บันทึกลงประวัติทุกครั้งที่ตอบสำเร็จ (คำตอบที่ error ไม่บันทึก)
  }
  if (ctx !== aiCtx) return; // ปิดหน้าต่างหรือเปิดคำอื่นไปแล้ว (คำถามหลายข้อพร้อมกันได้ แต่ละข้อมีช่องคำตอบของตัวเอง)
  ans.classList.remove("thinking");
  aiRenderAnswer(ans, text);
}

// กล่องคำถาม (+รูป) และช่องคำตอบหนึ่งชุดต่อท้าย #aiThread — ใช้ทั้งตอนถามใหม่และตอนเปิดแชทเก่า
function aiMakeEntry(question, image) {
  const entry = document.createElement("div");
  entry.className = "ai-entry";
  if (image || !AI_CANNED_Q.has(question)) {
    const q = document.createElement("div");
    q.className = "ai-q";
    q.textContent = question === AI_PHOTO_Q ? "📷 อ่านและอธิบายรูปนี้" : "❓ " + question;
    if (image) {
      const img = document.createElement("img");
      img.className = "ai-q-photo";
      img.src = image;
      img.alt = "รูปที่ส่ง";
      img.addEventListener("click", () => crOpenImageLightbox(image, "รูปที่ส่ง"));
      q.appendChild(img);
    }
    entry.appendChild(q);
  }
  const ans = document.createElement("div");
  ans.className = "ai-answer";
  entry.appendChild(ans);
  $("aiThread").appendChild(entry);
  return { entry, ans };
}

// ----- ประวัติแชทของโหมดถามอาจารย์ AI (IndexedDB: AI_CHAT_META + AI_CHAT_MSGS) -----
function aiChatTitle(msgs) {
  const first = msgs.find((m) => m.q !== AI_PHOTO_Q);
  const t = first ? first.q : "📷 อ่านและอธิบายรูป";
  return t.length > 120 ? t.slice(0, 120) + "…" : t;
}

// รูปย่อสี่เหลี่ยม 120 px สำหรับรายการประวัติ (รูปเต็มอยู่ใน AI_CHAT_MSGS)
async function aiThumb(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const cv = document.createElement("canvas");
  cv.width = cv.height = 120;
  cv.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 120, 120);
  return cv.toDataURL("image/jpeg", 0.7);
}

function aiTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function aiChatSave(ctx) {
  const db = await aiDb();
  if (!db || !db.objectStoreNames.contains(AI_CHAT_META) || !ctx.history.length) return;
  if (!ctx.chatId) {
    ctx.chatId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    ctx.chatCreated = Date.now();
  }
  if (!ctx.chatThumb) {
    const withImg = ctx.history.find((m) => m.img);
    if (withImg) { try { ctx.chatThumb = await aiThumb(withImg.img); } catch {} }
  }
  const msgs = ctx.history.slice();
  const meta = {
    id: ctx.chatId,
    t: Date.now(),
    c: ctx.chatCreated || Date.now(),
    title: aiChatTitle(msgs),
    n: msgs.length,
    thumb: ctx.chatThumb || "",
    text: msgs.map((m) => (m.q === AI_PHOTO_Q ? "" : m.q) + "\n" + m.a).join("\n").slice(0, 8000), // ไว้ค้นหา
  };
  try {
    const tx = db.transaction([AI_CHAT_META, AI_CHAT_MSGS], "readwrite");
    tx.objectStore(AI_CHAT_META).put(meta);
    tx.objectStore(AI_CHAT_MSGS).put({ id: ctx.chatId, msgs });
    await aiTxDone(tx);
    await aiChatPrune(db);
  } catch {}
  if (!$("aiHistory").hidden) aiHistoryRender(); // รายการเปิดอยู่: อัปเดตทันที
}

// เกิน AI_CHAT_MAX: ลบแชทที่ไม่ได้คุยนานที่สุด
async function aiChatPrune(db) {
  const tx = db.transaction([AI_CHAT_META, AI_CHAT_MSGS], "readwrite");
  const meta = tx.objectStore(AI_CHAT_META);
  let extra = (await aiReq(meta.count())) - AI_CHAT_MAX;
  if (extra <= 0) return;
  const req = meta.index("t").openCursor();
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur || extra <= 0) return;
    tx.objectStore(AI_CHAT_MSGS).delete(cur.value.id);
    cur.delete();
    extra--;
    cur.continue();
  };
  await aiTxDone(tx);
}

async function aiChatList() {
  const db = await aiDb();
  if (!db || !db.objectStoreNames.contains(AI_CHAT_META)) return null;
  try {
    const all = await aiReq(db.transaction(AI_CHAT_META).objectStore(AI_CHAT_META).getAll());
    return all.sort((a, b) => b.t - a.t);
  } catch { return []; }
}

async function aiChatDelete(id) {
  const db = await aiDb();
  if (!db) return;
  const tx = db.transaction([AI_CHAT_META, AI_CHAT_MSGS], "readwrite");
  if (id) {
    tx.objectStore(AI_CHAT_META).delete(id);
    tx.objectStore(AI_CHAT_MSGS).delete(id);
  } else {
    tx.objectStore(AI_CHAT_META).clear();
    tx.objectStore(AI_CHAT_MSGS).clear();
  }
  await aiTxDone(tx).catch(() => {});
}

let aiHistoryItems = [];

// เปิด/ปิดหน้ารายการประวัติ (แทนที่บทสนทนาในหน้าต่างเดิม ไม่ใช่หน้าต่างใหม่)
async function aiHistoryShow(on) {
  if (!aiCtx || aiCtx.mode !== "chat") return;
  $("aiHistory").hidden = !on;
  $("aiThread").hidden = on;
  $("aiHistoryBtn").setAttribute("aria-expanded", on ? "true" : "false");
  $("aiHistoryBtn").classList.toggle("on", on);
  if (on) {
    $("aiSetup").hidden = true;
    $("aiChatIntro").hidden = true;
    $("aiAskForm").hidden = true;
    $("aiPhotoBar").hidden = true;
    $("aiHistorySearch").value = "";
    $("aiPanelBody").scrollTop = 0;
    $("aiHistoryList").replaceChildren();
    const list = await aiChatList();
    if (!aiCtx || $("aiHistory").hidden) return;
    aiHistoryItems = list || [];
    aiHistoryRender(list === null ? "บันทึกประวัติไม่ได้ในเบราว์เซอร์นี้" : "");
  } else {
    const empty = !$("aiThread").children.length;
    $("aiChatIntro").hidden = !empty;
    if (aiConfig()) {
      $("aiAskForm").hidden = false;
      $("aiPhotoBar").hidden = !aiPhoto;
    } else {
      aiShowSetup(null);
    }
  }
}

async function aiHistoryRender(note) {
  if (note == null) aiHistoryItems = (await aiChatList()) || [];
  const box = $("aiHistoryList");
  const q = $("aiHistorySearch").value.trim().toLowerCase();
  const items = q ? aiHistoryItems.filter((m) => (m.title + "\n" + m.text).toLowerCase().includes(q)) : aiHistoryItems;
  box.replaceChildren();
  $("aiClearChatsBtn").disabled = !aiHistoryItems.length;
  if (!items.length) {
    const p = document.createElement("div");
    p.className = "ai-hist-empty";
    p.textContent = note || (q ? "ไม่พบแชทที่มีคำนี้" : "ยังไม่มีประวัติการแชท — ถามอาจารย์ได้เลย แชทจะถูกบันทึกให้อัตโนมัติ");
    box.appendChild(p);
    return;
  }
  const fmt = { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" };
  for (const m of items) {
    const row = document.createElement("div");
    row.className = "ai-hist-item" + (aiCtx && aiCtx.chatId === m.id ? " current" : "");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ai-hist-open";
    let pic;
    if (m.thumb) {
      pic = document.createElement("img");
      pic.className = "ai-hist-thumb";
      pic.src = m.thumb;
      pic.alt = "";
    } else {
      pic = document.createElement("span");
      pic.className = "ai-hist-icon";
      pic.textContent = "💬";
    }
    const txt = document.createElement("span");
    txt.className = "ai-hist-text";
    const title = document.createElement("span");
    title.className = "ai-hist-title";
    title.textContent = m.title;
    const meta = document.createElement("span");
    meta.className = "ai-hist-meta";
    meta.textContent = new Date(m.t).toLocaleString("th-TH", fmt) + " · " + m.n + " คำถาม";
    txt.append(title, meta);
    open.append(pic, txt);
    open.addEventListener("click", () => { sfx.click(); aiChatResume(m); });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ai-close ai-hist-del";
    del.textContent = "🗑";
    del.title = "ลบแชทนี้";
    del.setAttribute("aria-label", "ลบแชทนี้");
    del.addEventListener("click", async () => {
      sfx.click();
      if (!confirm(`ลบแชท "${m.title.slice(0, 40)}" ?`)) return;
      await aiChatDelete(m.id);
      if (aiCtx && aiCtx.chatId === m.id) aiChatResetCurrent();
      aiHistoryRender();
    });
    row.append(open, del);
    box.appendChild(row);
  }
}

// Back / Escape ระหว่างดูรายการประวัติ: กลับไปที่แชท (ไม่ปิดหน้าต่าง AI)
function aiHistoryBack() {
  if ($("aiPanel").hidden || $("aiHistory").hidden) return false;
  aiHistoryShow(false);
  return true;
}

// แชทที่เปิดอยู่ถูกลบ: เริ่มบทสนทนาใหม่ในหน้าต่างเดิม
function aiChatResetCurrent() {
  aiCtx.chatId = null;
  aiCtx.chatCreated = 0;
  aiCtx.chatThumb = "";
  aiCtx.history = [];
  $("aiThread").replaceChildren();
}

// เปิดแชทเก่า: แสดงคำถาม/คำตอบเดิมทั้งหมด แล้วถามต่อได้โดย AI ยังเห็นบริบทเดิม (aiCtx.history)
async function aiChatResume(meta) {
  const db = await aiDb();
  if (!db) return;
  let rec;
  try { rec = await aiReq(db.transaction(AI_CHAT_MSGS).objectStore(AI_CHAT_MSGS).get(meta.id)); } catch {}
  if (!rec || !rec.msgs || !aiCtx) return;
  aiChatOpen();
  Object.assign(aiCtx, { chatId: meta.id, chatCreated: meta.c, chatThumb: meta.thumb, history: rec.msgs.slice() });
  $("aiChatIntro").hidden = true;
  let last = null;
  for (const m of rec.msgs) {
    const { entry, ans } = aiMakeEntry(m.q, m.img);
    aiRenderAnswer(ans, m.a);
    last = entry;
  }
  // เลื่อนไปคำถามล่าสุด (อ่านต่อจากที่คุยค้างไว้)
  requestAnimationFrame(() => { if (last) $("aiPanelBody").scrollTop = last.offsetTop - 8; });
}

// บทสนทนาที่ส่งไปกับคำถามต่อ: แนบรูปเฉพาะรูปล่าสุด (ถามต่อเรื่องรูปเดิมได้ แต่ไม่ส่งรูปเก่าทุกรูปซ้ำทุกครั้ง)
function aiChatHistory(ctx) {
  const hist = ctx.history.slice(-AI_CHAT_HISTORY);
  let lastImg = -1;
  hist.forEach((h, i) => { if (h.img) lastImg = i; });
  return hist.map((h, i) => (i === lastImg ? h : { q: h.q, a: h.a }));
}

$("cpWordAiBtn").hidden = !AI_ON;
$("cpWordAiBtn").addEventListener("click", () => {
  sfx.click();
  aiPanelOpen("word");
});
$("cpWordAiSentBtn").addEventListener("click", () => {
  sfx.click();
  aiPanelOpen("sentence");
});
$("aiPanelClose").addEventListener("click", () => { sfx.click(); aiPanelClose(); });
// แตะพื้นหลัง = ปิด — แต่ต้องเริ่มกดที่พื้นหลังด้วย: ลากเลือกข้อความจากในการ์ดแล้วไปปล่อยนอกการ์ด
// click จะเกิดที่ #aiPanel (บรรพบุรุษร่วม) ซึ่งเคยทำให้หน้าต่างปิดระหว่างเลือกข้อความเพื่อก็อปปี้
let aiDownOnBackdrop = false;
$("aiPanel").addEventListener("pointerdown", (e) => { aiDownOnBackdrop = e.target === e.currentTarget; });
$("aiPanel").addEventListener("click", (e) => {
  if (e.target !== e.currentTarget || !aiDownOnBackdrop) return;
  const sel = window.getSelection && window.getSelection();
  if (sel && !sel.isCollapsed) return; // กำลังเลือกข้อความอยู่
  aiPanelClose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented && (aiHistoryBack() || aiPanelClose())) e.preventDefault();
});
document.querySelectorAll("#aiSetup .ai-prov-btn").forEach((b) => {
  b.addEventListener("click", () => { sfx.click(); aiSetupPick(b.dataset.prov); });
});
$("aiPanelSettings").addEventListener("click", () => {
  sfx.click();
  if (!aiCtx) return;
  if ($("aiSetup").hidden) aiShowSetup(null);
  else { $("aiSetup").hidden = true; $("aiAskForm").hidden = false; $("aiPhotoBar").hidden = !aiPhoto; }
});
$("aiSetup").addEventListener("submit", (e) => {
  e.preventDefault();
  // ช่อง key/token เว้นว่างได้เมื่อเคยบันทึกไว้แล้ว (สลับผู้ให้บริการไปมาโดยไม่ต้องพิมพ์ใหม่)
  if (AI_COMPAT[aiSetupProv]) {
    const p = AI_COMPAT[aiSetupProv];
    const typed = $(aiSetupProv === "qwen" ? "aiSetupQwenKey" : "aiSetupDsKey").value.trim();
    const key = typed || aiLs(p.keyLs);
    if (!/^sk-\S{8,}$/.test(key)) {
      $("aiSetupMsg").textContent = `⚠️ ใส่ API key ของ ${p.name} (ขึ้นต้นด้วย sk-)`;
      return;
    }
    try {
      localStorage.setItem(p.keyLs, key);
      if (typed && p.regionLs) localStorage.removeItem(p.regionLs); // key ใหม่ อาจเป็นบัญชีคนละภูมิภาค
    } catch {}
  } else {
    const url = $("aiSetupUrl").value.trim();
    const token = $("aiSetupToken").value.trim() || aiLs("cr_ai_token");
    if (!/^https:\/\//i.test(url) || !token) {
      $("aiSetupMsg").textContent = "⚠️ ใส่ URL ที่ขึ้นต้นด้วย https:// และ APP_TOKEN ให้ครบ";
      return;
    }
    try {
      localStorage.setItem("cr_ai_url", url);
      localStorage.setItem("cr_ai_token", token);
    } catch {}
  }
  try { localStorage.setItem("cr_ai_provider", aiSetupProv); } catch {}
  if (!aiCtx) return;
  const q = aiCtx.pendingQ;
  $("aiSetup").hidden = true;
  $("aiAskForm").hidden = false;
  $("aiPhotoBar").hidden = !aiPhoto;
  // ส่งรูปไปตอนยังไม่ได้ตั้งค่า: รูปยังแนบรออยู่ ส่งพร้อมคำถามเดิมเลย
  if (q && aiPhoto && aiCtx.mode === "chat") {
    const image = aiPhoto;
    aiPhotoSet(null);
    aiAsk(q, image);
    return;
  }
  // เปิดจาก ⚙️ ระหว่างมีคำตอบอยู่แล้ว: ไม่ถามซ้ำ / ยังไม่มีคำตอบเลย: ถามคำถามแรก
  // (โหมดถามอาจารย์ไม่มีคำถามแรก — รอผู้ใช้พิมพ์)
  if (q) aiAsk(q);
  else if (aiCtx.mode !== "chat" && !$("aiThread").children.length) aiAsk(aiFirstQuestion());
});
$("aiAskForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = $("aiAskInput");
  const q = inp.value.trim();
  const image = aiPhoto;
  if (!q && !image) return;
  inp.value = "";
  inp.blur(); // หุบคีย์บอร์ดมือถือ ให้เห็นคำตอบเต็มจอ
  if (image && aiConfig()) aiPhotoSet(null); // ยังไม่ได้ตั้งค่า AI: เก็บรูปไว้ส่งหลังบันทึก
  aiAsk(q || AI_PHOTO_Q, image);
});
$("aiHistoryBtn").addEventListener("click", () => { sfx.click(); aiHistoryShow($("aiHistory").hidden); });
$("aiNewChatBtn").addEventListener("click", () => { sfx.click(); aiChatOpen(); });
$("aiClearChatsBtn").addEventListener("click", async () => {
  sfx.click();
  if (!aiHistoryItems.length || !confirm(`ลบประวัติแชททั้งหมด ${aiHistoryItems.length} รายการ? ลบแล้วกู้คืนไม่ได้`)) return;
  await aiChatDelete(null);
  if (aiCtx && aiCtx.chatId) aiChatResetCurrent();
  aiHistoryRender();
});
let aiHistorySearchTimer = 0;
$("aiHistorySearch").addEventListener("input", () => {
  clearTimeout(aiHistorySearchTimer);
  aiHistorySearchTimer = setTimeout(() => aiHistoryRender(""), 200); // กรองจากรายการที่โหลดไว้แล้ว
});
$("aiCameraBtn").addEventListener("click", () => { sfx.click(); $("aiCameraInput").click(); });
$("aiGalleryBtn").addEventListener("click", () => { sfx.click(); $("aiGalleryInput").click(); });
$("aiCameraInput").addEventListener("change", (e) => aiPhotoPicked(e.target));
$("aiGalleryInput").addEventListener("change", (e) => aiPhotoPicked(e.target));
$("aiPhotoRemove").addEventListener("click", () => { sfx.click(); aiPhotoSet(null); });
$("aiPhotoThumb").addEventListener("click", () => { if (aiPhoto) crOpenImageLightbox(aiPhoto, "รูปที่แนบ"); });
// ปิดป๊อปอัปเมื่อแตะที่อื่น เลื่อนจอ หรือกลับไปโหมดอื่น (ป๊อปอัปเป็น position:fixed จึงไม่ตามจอ)
document.addEventListener("pointerdown", (e) => {
  const pop = $("cpWordPopup");
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target) || (e.target.closest && e.target.closest(".cp-zh-tok"))) return;
  cpHideWordPopup();
});
// ...ยกเว้นการเลื่อนภายในป๊อปอัปเอง (คำตอบ AI ยาว ๆ เลื่อนอ่านได้)
window.addEventListener("scroll", (e) => {
  if (performance.now() < crPopupScrollGuard) return;
  const pop = $("cpWordPopup");
  if (pop && e.target instanceof Node && pop.contains(e.target)) return;
  // คีย์บอร์ดมือถือเด้งขึ้นตอนพิมพ์คำถาม → เบราว์เซอร์เลื่อนจอเอง ห้ามปิดป๊อปอัป
  if (pop && pop.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  cpHideWordPopup();
}, true);
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
      hwEnhanceWriter(cpWriteWriter); // ขีดสั้น (จุด/ตะขอ) ติดง่ายขึ้นในช่องเขียนเล็ก — ดู js/03-helpers.js
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
  exitToSetup("copy");
  updateBestLine();
});
