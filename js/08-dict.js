"use strict";
/* ================= Dictionary mode ================= */
const dictEl = $("dict");
const dictInput = $("dictInput");
const dictResults = $("dictResults");
const dictWritePanel = $("dictWritePanel");
let dictWriter = null; // unused — dict mode uses canvas + HanziLookup, not HanziWriter
let dictRecognition = null;
// mic input language: "zh" = ภาษาจีน, "th" = ภาษาไทย (persisted across sessions)
let dictMicLang = localStorage.getItem("cr_dict_mic_lang") || "zh";
const dictLangName = () => (dictMicLang === "th" ? "ภาษาไทย" : "ภาษาจีน");
// เครื่องยนต์จดจำเสียง: auto = ลอง Google ก่อนแล้วตกไป Whisper / google = Web Speech เท่านั้น /
// whisper = ข้าม Google เข้าโมเดลออฟไลน์ทันที (ใช้ในที่ที่บล็อก Google เช่นจีน ไม่ต้องรอ timeout)
let dictMicEngine = window.CR_OFFLINE_APP ? "whisper" : (localStorage.getItem("cr_dict_mic_engine") || "auto");
const MIC_ENGINES = {
  auto:    { icon: "🔀", label: "อัตโนมัติ (Google → Whisper ออฟไลน์)" },
  google:  { icon: "🌐", label: "Google Speech (ต้องเข้าถึง Google ได้)" },
  whisper: { icon: "🤖", label: "Whisper AI ออฟไลน์ในเครื่อง" },
};
function dictMicLangUi() {
  const langBtn = $("dictMicLangBtn");
  langBtn.textContent = dictMicLang === "th" ? "ไทย" : "中";
  langBtn.title = "ไมค์ฟัง" + dictLangName() + " — แตะเพื่อสลับภาษา";
  $("dictMicBtn").title = "ค้นหาด้วยเสียงพูด" + dictLangName();
}
function dictMicEngUi() {
  const engBtn = $("dictMicEngBtn");
  engBtn.textContent = MIC_ENGINES[dictMicEngine].icon;
  engBtn.title = "ตัวจดจำเสียง: " + MIC_ENGINES[dictMicEngine].label + " — แตะเพื่อสลับ (ใช้ร่วมกับโหมดฝึกพูด)";
}

// pinyin normalize: strip tone marks + lowercase for fuzzy match
function normPinyin(s) {
  return s.toLowerCase()
    .replace(/[āáǎà]/g, "a").replace(/[ēéěè]/g, "e")
    .replace(/[īíǐì]/g, "i").replace(/[ōóǒò]/g, "o")
    .replace(/[ūúǔù]/g, "u").replace(/[ǖǘǚǜü]/g, "v")
    .replace(/\d/g, "").replace(/\s+/g, " ").trim();
}

// normalize pinyin for single-syllable matching (no spaces)
function normSyl(s) {
  return normPinyin(s).replace(/\s+/g, "");
}

function dictUpdateClearBtn() {
  $("dictClearBtn").hidden = !dictInput.value;
}

function startDict() {
  switchScreen(dictEl);
  stopSpeech();
  dictInput.value = "";
  dictUpdateClearBtn();
  dictResults.innerHTML = '<p class="dict-placeholder">พิมพ์พินอิน ตัวจีน หรือภาษาไทยเพื่อค้นหา — กด 🎤 เพื่อพูด (เลือกภาษาได้ที่ปุ่มข้างๆ) หรือ ✍️ เพื่อเขียน</p>';
  dictWritePanel.hidden = true;
  // show mic button if speech recognition is available
  const SR = window.CR_OFFLINE_APP ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
  // show mic when Web Speech exists, or when mic capture is possible (Whisper fallback)
  $("dictMicBtn").hidden = !SR && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  $("dictMicLangBtn").hidden = $("dictMicBtn").hidden;
  $("dictMicEngBtn").hidden = window.CR_OFFLINE_APP || $("dictMicBtn").hidden;
  dictMicLangUi();
  dictMicEngUi();
  setTimeout(() => { dictInput.focus(); }, 100);
}

function dictSearch(query) {
  const q = (query || dictInput.value).trim();
  if (!q) {
    dictResults.innerHTML = '<p class="dict-placeholder">พิมพ์พินอิน ตัวจีน หรือภาษาไทยเพื่อค้นหา — กด 🎤 เพื่อพูด (เลือกภาษาได้ที่ปุ่มข้างๆ) หรือ ✍️ เพื่อเขียน</p>';
    return;
  }
  const isChinese = /[\u4e00-\u9fff]/.test(q);
  const isThai = /[\u0e00-\u0e7f]/.test(q);
  const qLower = q.toLowerCase();
  const results = [];
  // For pinyin search: split query into syllables by space, normalize each
  // e.g. "ni hao" -> ["ni","hao"] ; "nihao" -> ["nihao"]
  const qSyls = isChinese || isThai ? [] : normPinyin(q).split(/\s+/).filter(Boolean);
  const vocabSources = [];
  for (const src of categoryVocabSources()) {
    if (src.id === currentCategory) vocabSources.push(src);
  }
  for (const lvl of ["1", "2", "3", "4", "5", "6", "7-9"]) {
    vocabSources.push({ lvl, badge: `HSK ${lvl}`, words: (typeof VOCAB !== "undefined" && VOCAB[lvl]) || [] });
  }
  for (const src of categoryVocabSources()) {
    if (src.id !== currentCategory) vocabSources.push(src);
  }

  for (const src of vocabSources) {
    for (const w of src.words) {
      const zh = w[0], py = w[1], th = w[2];
      let match = false;
      if (isChinese) {
        match = zh.includes(q);
      } else if (isThai) {
        if (th && th.toLowerCase().includes(qLower)) match = true;
      } else if (qSyls.length) {
        // Pinyin search: split word pinyin into syllables, match each query syllable
        // against the corresponding word syllable (prefix match, no tone needed)
        const wSyls = normPinyin(py).split(/\s+/).filter(Boolean);
        if (qSyls.length === 1) {
          // single syllable query: match if any word syllable starts with it
          if (wSyls.some((s) => s.startsWith(qSyls[0]))) match = true;
          // also allow substring match for multi-syllable words typed as one block
          else if (normSyl(py).includes(qSyls[0])) match = true;
        } else {
          // multi-syllable query: each query syllable must match a word syllable in order
          if (wSyls.length >= qSyls.length) {
            let ok = true;
            for (let i = 0; i < qSyls.length; i++) {
              if (!wSyls[i].startsWith(qSyls[i])) { ok = false; break; }
            }
            if (ok) match = true;
          }
        }
        // also search Thai meaning as fallback
        if (!match && th && th.toLowerCase().includes(qLower)) match = true;
      }
      if (match) results.push({ zh, py, th, lvl: src.lvl, badge: src.badge });
    }
  }
  // sort: exact match first, then shorter chinese, then category preference
  const catLvl = {};
  for (const src of categoryVocabSources()) catLvl[src.lvl] = src.id;
  const scoreLvl = (lvl) => {
    if (catLvl[lvl]) return catLvl[lvl] === currentCategory ? 0 : 99;
    return Number(lvl === "7-9" ? 9 : lvl);
  };
  results.sort((a, b) => (a.zh === q ? -1 : b.zh === q ? 1 : 0) || a.zh.length - b.zh.length || scoreLvl(a.lvl) - scoreLvl(b.lvl));
  // spoken-phrase fallback: a long Chinese query (e.g. a dictated sentence)
  // with no direct hit -> list vocab words contained inside it, longest first
  if (isChinese && !results.length && q.length >= 2) {
    for (const src of vocabSources) {
      for (const w of src.words) {
        if (w[0] && q.includes(w[0])) results.push({ zh: w[0], py: w[1], th: w[2], lvl: src.lvl, badge: src.badge });
      }
    }
    results.sort((a, b) => b.zh.length - a.zh.length || scoreLvl(a.lvl) - scoreLvl(b.lvl));
  }
  dictRenderResults(results.slice(0, 20), q);
  // multi-char Chinese query (word/sentence): also translate the whole thing
  if (isChinese && q.length >= 2) dictAddTranslation(q);
  // Thai query: also show a th->zh translation card with pinyin
  else if (isThai && q.length >= 2) dictAddTranslationTh(q);
  else dictTransSeq++; // cancel any pending translation from a previous query
}

let dictTransSeq = 0; // stale-guard for the sentence translation card

// เล่นเสียงจีนจากไฟล์สำเร็จรูปในแอปก่อน (audio/zh/<คำหรือประโยค>.mp3 — มีครบ
// ทั้งคำศัพท์ HSK 1–9/หมวดต่างๆ และประโยคทุกประโยคใน SENTENCES) แล้วค่อยตกไป
// TTS เมื่อไม่มีไฟล์ — เดิมปุ่ม 🔊 ทุกตัวเรียก speak() ซึ่งเป็น TTS ล้วน
// และ TTS ของเครื่องจะเงียบสนิทใน APK ถ้าไม่ได้ติดตั้งชุดเสียงอ่านภาษาจีน
function dictSpeakZh(zh, pinyin) {
  const base = String(zh || "").split(/[｜|]/)[0].trim();
  if (!base) return;
  const key = wordAudioKey(base, pinyin);
  const spoken = key === "了-le" ? "le" : base;
  wordAudio.play([{ url: `audio/zh/${key}.mp3`, tts: [spoken, "zh-CN"] }], null);
}

// free MyMemory translation API (no key needed; falls back to Bing link on failure)
async function dictTranslate(text, langpair) {
  const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=" + langpair;
  const res = await fetch(url);
  if (!res.ok) throw new Error("translate " + res.status);
  const data = await res.json();
  const t = data && data.responseData && data.responseData.translatedText;
  if (data.responseStatus !== 200 || !t) throw new Error("no translation");
  return t;
}
const dictTranslateZh = (t) => dictTranslate(t, "zh-CN|th");
const dictTranslateTh = (t) => dictTranslate(t, "th|zh-CN");

// hidden stroke-order viewer panel (populated lazily by dictToggleStrokes)
const DICT_STROKES_HTML = `<div class="dict-strokes" hidden>
  <div class="dict-stroke-head"><span class="dict-stroke-label">ลำดับเส้นขีด</span></div>
  <div class="dict-stroke-stage"><div class="dict-stroke-writer"></div>
    <div class="dict-stroke-status"></div></div>
  <div class="dict-stroke-chars" hidden></div>
</div>`;

// local pinyin for arbitrary Chinese text: greedy longest-match word
// segmentation over VOCAB (keeps word-context readings for polyphonic
// chars), falling back to a per-char map for unknown characters
let dictPinyinIdx = null;
function dictPinyinIndex() {
  if (dictPinyinIdx) return dictPinyinIdx;
  const wordPy = new Map(); // exact word -> its pinyin
  const charPy = new Map(); // char -> first seen syllable
  for (const lvl of ["1", "2", "3", "4", "5", "6", "7-9"]) {
    for (const w of VOCAB[lvl] || []) {
      const zh = w[0], py = w[1];
      if (!zh || !py) continue;
      if (!wordPy.has(zh)) wordPy.set(zh, py);
      const syls = py.trim().split(/\s+/);
      if (syls.length === zh.length) {
        for (let i = 0; i < zh.length; i++) if (!charPy.has(zh[i])) charPy.set(zh[i], syls[i]);
      }
    }
  }
  for (const src of categoryVocabSources()) {
    for (const w of src.words) {
      const zh = w[0], py = w[1];
      if (!zh || !py) continue;
      if (!wordPy.has(zh)) wordPy.set(zh, py);
      const syls = py.trim().split(/\s+/);
      if (syls.length === zh.length) {
        for (let i = 0; i < zh.length; i++) if (!charPy.has(zh[i])) charPy.set(zh[i], syls[i]);
      }
    }
  }
  dictPinyinIdx = { wordPy, charPy };
  return dictPinyinIdx;
}

function dictSentencePinyin(text) {
  const { wordPy, charPy } = dictPinyinIndex();
  const chars = [...text];
  const parts = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (!/[一-鿿]/.test(ch)) { parts.push(ch); i++; continue; }
    // VOCAB เป็นตัวย่อทั้งหมด — แปลงตัวเต็มเป็นตัวย่อผ่าน TRAD2SIMP ก่อนค้น
    let py = null, len = 0;
    for (let l = Math.min(6, chars.length - i); l >= 2; l--) {
      const w = chars.slice(i, i + l).map((c) => TRAD2SIMP[c] || c).join("");
      if (wordPy.has(w)) { py = wordPy.get(w); len = l; break; }
    }
    if (py) { parts.push(py); i += len; }
    else { parts.push(charPy.get(TRAD2SIMP[ch] || ch) || ch); i++; }
  }
  return parts.join(" ");
}

// sentence translation card shown above results for multi-char Chinese queries
async function dictAddTranslation(q) {
  const seq = ++dictTransSeq;
  const box = document.createElement("div");
  box.className = "dict-entry dict-translate";
  const hasCjk = /[一-鿿]/.test(q);
  box.innerHTML = `<div class="dict-translate-label">🌐 แปลประโยค (จีน → ไทย)</div>
    <div class="dict-translate-zh" lang="zh"></div>
    <div class="dict-translate-pinyin"></div>
    <div class="dict-translate-th">กำลังแปล...</div>
    <div class="dict-entry-actions"><button class="dict-speak-btn">🔊 ฟังเสียงจีน</button>
    <button class="dict-copy-btn">📋 คัดลอก</button>
    ${hasCjk ? `<button type="button" class="dict-stroke-btn">✍️ ดูเส้นขีด</button>` : ""}</div>
    ${hasCjk ? DICT_STROKES_HTML : ""}`;
  box.querySelector(".dict-translate-zh").textContent = q;
  box.querySelector(".dict-translate-pinyin").textContent = dictSentencePinyin(q);
  box.querySelector(".dict-speak-btn").addEventListener("click", () => dictSpeakZh(q));
  const copyBtn = box.querySelector(".dict-copy-btn");
  copyBtn.addEventListener("click", () => { sfx.click(); dictCopyText(copyBtn, q); });
  const strokeBtn = box.querySelector(".dict-stroke-btn");
  if (strokeBtn) strokeBtn.addEventListener("click", () => { sfx.click(); dictToggleStrokes(box, strokeBtn, q); });
  dictResults.prepend(box);
  const thBox = box.querySelector(".dict-translate-th");
  try {
    const th = await dictTranslateZh(q);
    if (seq !== dictTransSeq) return;
    thBox.textContent = th || "(แปลไม่ได้)";
  } catch (e) {
    if (seq !== dictTransSeq) return;
    thBox.innerHTML = `แปลอัตโนมัติไม่สำเร็จ — <a href="${dictBingUrl(q)}" target="_blank" rel="noopener" data-cr-web>🌐 เปิด Bing Translator</a>`;
  }
}

// Thai -> Chinese translation card with pinyin (for spoken/typed Thai queries)
async function dictAddTranslationTh(q) {
  const seq = ++dictTransSeq;
  const box = document.createElement("div");
  box.className = "dict-entry dict-translate";
  box.innerHTML = `<div class="dict-translate-label">🌐 แปลประโยค (ไทย → จีน)</div>
    <div class="dict-translate-zh" lang="zh">กำลังแปล...</div>
    <div class="dict-translate-pinyin"></div>
    <div class="dict-translate-th"></div>
    <div class="dict-entry-actions"><button class="dict-speak-btn" hidden>🔊 ฟังเสียงจีน</button>
    <button class="dict-copy-btn" hidden>📋 คัดลอก</button>
    <button type="button" class="dict-stroke-btn" hidden>✍️ ดูเส้นขีด</button></div>
    ${DICT_STROKES_HTML}`;
  box.querySelector(".dict-translate-th").textContent = q;
  dictResults.prepend(box);
  const zhBox = box.querySelector(".dict-translate-zh");
  const strokeBtn = box.querySelector(".dict-stroke-btn");
  strokeBtn.addEventListener("click", () => { sfx.click(); dictToggleStrokes(box, strokeBtn, strokeBtn.dataset.zh || ""); });
  try {
    const zh = await dictTranslateTh(q);
    if (seq !== dictTransSeq) return;
    zhBox.textContent = zh || "(แปลไม่ได้)";
    box.querySelector(".dict-translate-pinyin").textContent = dictSentencePinyin(zh);
    const spkBtn = box.querySelector(".dict-speak-btn");
    spkBtn.hidden = false;
    spkBtn.addEventListener("click", () => dictSpeakZh(zh));
    strokeBtn.dataset.zh = zh;
    strokeBtn.hidden = !/[一-鿿]/.test(zh);
    const copyBtn = box.querySelector(".dict-copy-btn");
    copyBtn.hidden = false;
    copyBtn.addEventListener("click", () => { sfx.click(); dictCopyText(copyBtn, zh); });
  } catch (e) {
    if (seq !== dictTransSeq) return;
    zhBox.textContent = "(แปลไม่ได้)";
    box.querySelector(".dict-translate-pinyin").innerHTML =
      `<a href="${dictBingUrl(q)}" target="_blank" rel="noopener" data-cr-web>🌐 แปลด้วย Bing Translator</a>`;
  }
}

// Bing Translator deep link: Thai query -> th->zh ; Chinese query -> zh->th ; else auto->th
function dictBingUrl(q) {
  const isChinese = /[一-鿿]/.test(q);
  const isThai = /[฀-๿]/.test(q);
  const from = isThai ? "th" : isChinese ? "zh-Hans" : "auto";
  const to = isThai ? "zh-Hans" : "th";
  return `https://www.bing.com/translator?from=${from}&to=${to}&text=` + encodeURIComponent(q);
}

function dictRenderResults(results, query) {
  if (!results.length) {
    const isChinese = /[\u4e00-\u9fff]/.test(query);
    const isThai = /[\u0e00-\u0e7f]/.test(query);
    // Thai query -> translate th->zh ; Chinese query -> translate zh->th : else auto
    const from = isThai ? "th" : isChinese ? "zh-Hans" : "auto";
    const to = isThai ? "zh-Hans" : "th";
    const bingUrl = `https://www.bing.com/translator?from=${from}&to=${to}&text=` + encodeURIComponent(query);
    dictResults.innerHTML = `<div class="dict-not-found"><p>🔍 ไม่พบคำ "${query}" ในฐานข้อมูล HSK 1–9</p><p>ลองค้นหาผ่าน Bing Translator:</p><a href="${bingUrl}" target="_blank" rel="noopener" data-cr-web>🌐 Bing Translator</a></div>`;
    return;
  }
  dictResults.innerHTML = "";
  for (const r of results) {
    const entry = document.createElement("div");
    entry.className = "dict-entry";
    const hasThai = r.th && !/^[A-Za-z\s;,.\-()\/]+$/.test(r.th) && r.th.length > 0;
    const thClass = hasThai ? "" : "english-only";
    const thText = r.th || "(ไม่มีคำแปล)";
    const bingUrl = "https://www.bing.com/translator?from=zh-Hans&to=th&text=" + encodeURIComponent(r.zh);

    // find example sentences (SENTENCES HSK 1-5 + VOCAB_EXTRA Bing examples for HSK 6-9)
    const examples = dictFindExamples(r.zh, r.lvl);
    const extra = (typeof VOCAB_EXTRA !== "undefined" && VOCAB_EXTRA[r.zh]) || null;
    const posText = extra && extra.pos ? `<span class="dict-entry-pos">${extra.pos}</span>` : "";
    const pyText = r.py || (extra && extra.py) || "";
    const altHtml = (extra && extra.alt && extra.alt.length > 1)
      ? `<div class="dict-entry-alt">≈ ${extra.alt.slice(1).join(", ")}</div>` : "";

    const hasCjk = /[㐀-鿿豈-﫿]/.test(r.zh);
    let html = `<div class="dict-entry-top">
      <div class="dict-entry-zh" lang="zh">${r.zh}</div>
      <div class="dict-entry-pinyin">${pyText}</div>
      ${posText}
      <span class="dict-entry-hsk" data-hsk="${r.lvl}">${r.badge || `HSK ${r.lvl}`}</span>
    </div>
    <div class="dict-entry-th ${thClass}">${thText}</div>
    ${altHtml}
    <div class="dict-entry-actions">
      <button class="dict-speak-btn" data-zh="${r.zh}" data-py="${r.py || ""}">🔊 ฟังเสียง</button>
      <button class="dict-copy-btn" data-zh="${r.zh}">📋 คัดลอก</button>
      ${hasCjk ? `<button class="dict-stroke-btn" data-zh="${r.zh}">✍️ ดูเส้นขีด</button>` : ""}
      <a class="bing-link" href="${bingUrl}" target="_blank" rel="noopener" data-cr-web>🌐 แปลด้วย Bing</a>`;
    html += `</div>`;
    if (hasCjk) html += DICT_STROKES_HTML;
    if (examples.length) {
      html += `<div class="dict-examples"><div class="dict-examples-label">📝 ประโยคตัวอย่าง (${examples.length})</div>`;
      for (const ex of examples) {
        html += `<div class="dict-example">
          <div class="dict-example-zh" lang="zh">${dictEsc(ex[0])}</div>
          <div class="dict-example-pinyin">${dictEsc(ex[1])}</div>
          <div class="dict-example-th">${dictEsc(ex[2])}</div>
          <div class="dict-example-actions"><button class="dict-ex-speak-btn" data-zh="${dictEsc(ex[0])}">🔊 ฟัง</button></div>
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="dict-examples"><div class="dict-no-examples">ยังไม่มีประโยคตัวอย่างสำหรับคำนี้</div></div>`;
    }
    entry.innerHTML = html;
    dictResults.appendChild(entry);
  }
  // wire up speak buttons
  dictResults.querySelectorAll(".dict-speak-btn, .dict-ex-speak-btn").forEach((btn) => {
    btn.addEventListener("click", () => dictSpeakZh(btn.dataset.zh, btn.dataset.py));
  });
  // wire up copy buttons
  dictResults.querySelectorAll(".dict-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => { sfx.click(); dictCopyText(btn, btn.dataset.zh); });
  });
  // wire up stroke-order buttons
  dictResults.querySelectorAll(".dict-stroke-btn").forEach((btn) => {
    btn.addEventListener("click", () => { sfx.click(); dictToggleStrokes(btn.closest(".dict-entry"), btn, btn.dataset.zh); });
  });
}

// clipboard copy with fallback for older browsers / non-secure contexts
async function dictCopyText(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e2) {}
    document.body.removeChild(ta);
  }
  const orig = btn.textContent;
  btn.textContent = "✅ คัดลอกแล้ว";
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

/* ---- stroke-order viewer inside a dict entry ---- */
// Reuses the bomb game's HanziWriter loader (loadBombLibrary) and shared
// stroke-data cache (bombCharData). One writer instance per expanded entry,
// reused across all of its characters — animation only, no quiz listeners.
async function dictToggleStrokes(entry, btn, zh) {
  const panel = entry.querySelector(".dict-strokes");
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    btn.classList.remove("on");
    return;
  }
  panel.hidden = false;
  btn.classList.add("on");
  const st = entry._stroke || (entry._stroke = {
    chars: [...zh].filter((c) => /[㐀-鿿豈-﫿]/.test(c)),
    writer: null, charIndex: 0, seq: 0,
  });
  if (st.writer) { // reopening: refit in case the viewport resized, then replay
    dictStrokeFit(entry, st);
    dictStrokePlay(entry);
    return;
  }
  const status = panel.querySelector(".dict-stroke-status");
  const seq = ++st.seq;
  status.textContent = "กำลังโหลดระบบเส้นอักษร…";
  try {
    await loadBombLibrary();
    await Promise.all([...new Set(st.chars)].map(async (char) => {
      if (bombCharData.has(char)) return;
      try {
        const dataUrl = window.CR_OFFLINE_APP
          ? `vendor3/hanzi-writer-data/${encodeURIComponent(char)}.json`
          : `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`;
        const res = await fetch(dataUrl);
        const data = res.ok ? await res.json() : null;
        bombCharData.set(char, data && data.strokes && data.strokes.length ? data : null);
      } catch (e) { /* network error — leave uncached so the next open retries */ }
    }));
    if (!entry.isConnected || st.seq !== seq) return;
    if (!st.chars.length) { status.textContent = "คำนี้ไม่มีตัวอักษรจีนให้ดูเส้นขีด"; return; }
    if (!st.chars.some((c) => bombCharData.has(c))) throw new Error("no stroke data");
    const box = panel.querySelector(".dict-stroke-writer");
    const size = dictStrokeSize(box);
    st.writer = new window.HanziWriter(box, {
      width: size, height: size, padding: 10,
      showCharacter: false, showOutline: true,
      strokeColor: "#203954", outlineColor: "#b8c4d0",
      charDataLoader: (char) => bombCharData.get(char),
    });
    const chips = panel.querySelector(".dict-stroke-chars");
    chips.replaceChildren();
    st.chars.forEach((char, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dict-stroke-chip";
      chip.textContent = char;
      chip.lang = "zh";
      chip.addEventListener("click", () => { sfx.click(); dictStrokePlay(entry, i); });
      chips.appendChild(chip);
    });
    chips.hidden = st.chars.length < 2;
    status.textContent = "";
    dictStrokePlay(entry);
  } catch (e) {
    if (!entry.isConnected || st.seq !== seq) return;
    status.textContent = "โหลดข้อมูลเส้นขีดไม่สำเร็จ — ต้องใช้อินเทอร์เน็ตครั้งแรก ซ่อนแล้วแตะปุ่มอีกครั้งเพื่อลองใหม่";
  }
}

function dictStrokeSize(box) {
  return Math.min(200, Math.max(120, box.clientWidth || 200));
}

function dictStrokeFit(entry, st) {
  const box = entry.querySelector(".dict-stroke-writer");
  const size = dictStrokeSize(box);
  if (size && st.writer) st.writer.updateDimensions({ width: size, height: size, padding: 10 });
}

async function dictStrokePlay(entry, index = null) {
  const st = entry._stroke;
  if (!st || !st.writer) return;
  if (index !== null) st.charIndex = index;
  const char = st.chars[st.charIndex];
  const seq = ++st.seq;
  const status = entry.querySelector(".dict-stroke-status");
  entry.querySelectorAll(".dict-stroke-chip").forEach((c, i) => {
    c.classList.toggle("current", i === st.charIndex);
  });
  if (!bombCharData.get(char)) {
    status.textContent = `ไม่มีข้อมูลเส้นขีดของ "${char}"`;
    return;
  }
  status.textContent = "";
  try {
    await st.writer.setCharacter(char);
    if (!entry.isConnected || st.seq !== seq) return;
    st.writer.loopCharacterAnimation();
  } catch (e) {
    if (entry.isConnected && st.seq === seq) status.textContent = `โหลดเส้นขีดของ "${char}" ไม่สำเร็จ`;
  }
}

// ประโยคตัวอย่างจาก Bing (VOCAB_EXTRA) บางประโยคมีเครื่องหมาย " < & — ต้อง escape
// ไม่งั้น data-zh="..." ถูกตัดกลางประโยค ปุ่ม 🔊 จะอ่านแค่ท่อนแรก
function dictEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dictFindExamples(zh, lvl) {
  const examples = [];
  // 1) SENTENCES data (HSK 1-9): [zh, pinyin, th, grammar, tokens]
  if (SENT_OK) {
    for (const sl of ["1", "2", "3", "4", "5", "6", "7-9"]) {
      const sents = SENTENCES[sl] || [];
      for (const s of sents) {
        const tokens = s[4] || [];
        if (tokens.includes(zh)) {
          examples.push(s);
          if (examples.length >= 3) return examples;
        }
      }
    }
  }
  // 1.5) sentence packs of every non-HSK category (IT, hotel, factory, trade,
  //      office, food, media, business, phone, gym, car)
  for (const cat of Object.values(CATEGORIES)) {
    if (cat.id === "hsk" || typeof cat.getSentencePool !== "function") continue;
    for (const s of cat.getSentencePool("all") || []) {
      const tokens = s[4] || [];
      if (tokens.includes(zh) || s[0].includes(zh)) {
        examples.push(s);
        if (examples.length >= 3) return examples;
      }
    }
  }
  // 2) VOCAB_EXTRA Bing examples (HSK 6-9): [zh, pinyin, en, th] -> normalize to [zh, py, th||en]
  const extra = (typeof VOCAB_EXTRA !== "undefined" && VOCAB_EXTRA[zh]);
  if (extra && extra.ex) {
    for (const e of extra.ex) {
      examples.push([e[0], e[1] || "", e[3] || e[2] || ""]);
      if (examples.length >= 3) return examples;
    }
  }
  return examples;
}

function dictStartMic() {
  const SR = window.CR_OFFLINE_APP ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
  const micBtn = $("dictMicBtn");
  if (dictRecognition) { dictRecognition.stop(); return; }
  if (dictWRecord) { dictStopMicWhisper(); return; }
  // APK: ใช้ระบบจดจำเสียงของ Android (Google) ผ่าน NativeSpeech เป็นตัวหลัก
  // (Whisper เดิมต้องผ่าน getUserMedia ซึ่ง WebView จะบล็อกจนกว่าแอปจะได้สิทธิ์
  // RECORD_AUDIO — สิทธิ์นั้นถูกขอเฉพาะใน NativeSpeech) — กด 🎤 ซ้ำเพื่อหยุดฟัง
  if (window.CR_OFFLINE_APP) {
    if (dictNativeActive) {
      dictResults.innerHTML = '<p class="dict-placeholder">⏳ กำลังประมวลผลเสียง…</p>';
      dictNativeStopListening();
      return;
    }
    dictStartMicNative();
    return;
  }
  if (!SR) {
    if (dictMicEngine === "google") {
      dictResults.innerHTML = '<p class="dict-placeholder">🌐 เบราว์เซอร์นี้ไม่มี Google Speech — แตะปุ่มข้างไมค์สลับเป็น 🤖 Whisper หรือ 🔀 Auto</p>';
      return;
    }
    dictStartMicWhisper();
    return;
  }
  // เลือก Whisper ไว้ = ข้าม Google ไปใช้โมเดลออฟไลน์ทันที
  if (dictMicEngine === "whisper") { dictStartMicWhisper(); return; }

  const rec = new SR();
  dictRecognition = rec;
  rec.lang = dictMicLang === "th" ? "th-TH" : "zh-CN";
  rec.continuous = false;
  rec.interimResults = true; // live-typing: show words in the box as they are spoken

  let finalText = "";
  // if the service stalls silently (blocked network), switch to on-device Whisper
  const stallTimer = setTimeout(() => {
    if (dictRecognition === rec && !finalText && !dictInput.value.trim()) {
      try { rec.abort(); } catch (e) {}
      dictRecognition = null;
      if (dictMicEngine === "google") {
        micBtn.classList.remove("listening");
        dictResults.innerHTML = '<p class="dict-placeholder">🌐 Google Speech ไม่ตอบสนอง — อาจถูกบล็อก ลองสลับเป็น 🤖 Whisper ที่ปุ่มข้างไมค์</p>';
      } else dictStartMicWhisper();
    }
  }, 7000);
  const stopUi = () => {
    clearTimeout(stallTimer);
    dictRecognition = null;
    micBtn.classList.remove("listening");
  };

  rec.onresult = (e) => {
    clearTimeout(stallTimer);
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    dictInput.value = (finalText + interim).trim();
    dictUpdateClearBtn();
    if (finalText.trim()) dictSearch(finalText.trim());
  };
  rec.onend = () => {
    stopUi();
    if (!dictInput.value.trim()) {
      dictResults.innerHTML = `<p class="dict-placeholder">🤔 ไม่ได้ยินเสียงพูด ลองกด 🎤 แล้วพูด${dictLangName()}อีกครั้ง</p>`;
    }
  };
  rec.onerror = (e) => {
    stopUi();
    // Google speech service unreachable (e.g. blocked network) -> on-device Whisper
    if (e.error === "network") {
      if (dictMicEngine === "google") {
        dictResults.innerHTML = '<p class="dict-placeholder">🌐 เชื่อม Google Speech ไม่ได้ — แตะปุ่มข้างไมค์สลับเป็น 🤖 Whisper ออฟไลน์</p>';
      } else dictStartMicWhisper();
      return;
    }
    const msgs = {
      "not-allowed": "🚫 เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน — กดอนุญาตไมค์ที่แถบที่อยู่แล้วลองใหม่",
      "service-not-allowed": "🚫 เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน",
      "no-speech": `🤔 ไม่ได้ยินเสียงพูด ลองกด 🎤 แล้วพูด${dictLangName()}อีกครั้ง`,
      "audio-capture": "🎙️ ไม่พบไมโครโฟนในเครื่องนี้",
    };
    if (e.error !== "aborted") {
      dictResults.innerHTML = `<p class="dict-placeholder">${msgs[e.error] || "⚠️ จดจำเสียงผิดพลาด ลองใหม่อีกครั้ง"}</p>`;
    }
  };

  micBtn.classList.add("listening");
  dictResults.innerHTML = `<p class="dict-placeholder">🎤 กำลังฟัง… พูด${dictLangName()}ได้เลย ข้อความจะขึ้นในช่องค้นหา</p>`;
  try { rec.start(); } catch (err) { stopUi(); }
}

/* ---------- Native ASR (APK): ระบบจดจำเสียงของ Android/Google ผ่าน NativeSpeech ---------- */
// WebView ไม่มี Web Speech API และ getUserMedia จะโดนบล็อกจนกว่าแอปจะได้สิทธิ์ไมค์
// (สิทธิ์ถูกขอภายใน NativeSpeech.startListening เท่านั้น) — จึงให้ Google recognition
// ของเครื่องเป็นตัวหลัก แล้วค่อย fallback เป็น Whisper เมื่อระบบเสียงใช้ไม่ได้
let dictNativeActive = false;
let dictNativeRequestId = null;
let dictNativeSeq = 0;
let dictNativeListenersReady = null;

function dictNativePlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeSpeech;
}

function dictNativeLang() { return dictMicLang === "th" ? "th-TH" : "zh-CN"; }

// กด 🎤 ซ้ำ = หยุดฟังแล้วรอผลจดจำ (onResults จะยิง event "result" ตามมา)
function dictNativeStopListening() {
  const native = dictNativePlugin();
  dictNativeActive = false;
  dictNativeRequestId = null;
  $("dictMicBtn").classList.remove("listening");
  if (native) native.stopListening().catch(() => {});
}

// ยกเลิกโดยไม่ต้องผล (ตอนออกจากโหมด / เปิดแผงเขียน)
function dictNativeCancel() {
  const native = dictNativePlugin();
  dictNativeActive = false;
  dictNativeRequestId = null;
  $("dictMicBtn").classList.remove("listening");
  if (native) native.cancelListening().catch(() => {});
}

function dictEnsureNativeListeners() {
  const native = dictNativePlugin();
  if (!native) return Promise.resolve(false);
  if (!dictNativeListenersReady) {
    dictNativeListenersReady = Promise.all([
      native.addListener("partial", ({ requestId, text }) => {
        if (!dictNativeActive || requestId !== dictNativeRequestId || !text) return;
        dictInput.value = text;
        dictUpdateClearBtn();
      }),
      native.addListener("result", ({ requestId, text }) => {
        if (!dictNativeActive || requestId !== dictNativeRequestId) return;
        dictNativeActive = false;
        dictNativeRequestId = null;
        $("dictMicBtn").classList.remove("listening");
        const heard = (text || "").trim();
        if (heard) {
          dictInput.value = heard;
          dictUpdateClearBtn();
          dictSearch(heard);
        } else {
          dictResults.innerHTML = `<p class="dict-placeholder">🤔 ไม่ได้ยินเสียงพูด ลองกด 🎤 แล้วพูด${dictLangName()}อีกครั้ง</p>`;
        }
      }),
      native.addListener("error", ({ requestId, code }) => {
        if (!dictNativeActive || requestId !== dictNativeRequestId) return;
        dictNativeActive = false;
        dictNativeRequestId = null;
        $("dictMicBtn").classList.remove("listening");
        if (code === "NO_MATCH" || code === "NO_SPEECH") {
          dictResults.innerHTML = `<p class="dict-placeholder">🤔 ไม่ได้ยินเสียงพูด ลองกด 🎤 แล้วพูด${dictLangName()}อีกครั้ง</p>`;
        } else if (code === "CANCELLED") {
          // ถูกยกเลิก (เช่นออกจากโหมด) — ไม่ต้องแจ้ง
        } else if (code === "PERMISSION_DENIED") {
          dictResults.innerHTML = '<p class="dict-placeholder">🚫 ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน</p>';
        } else {
          // ไม่มีบริการจดจำ / ไม่รองรับภาษา -> โมเดล Whisper ที่แถบมากับ APK
          dictStartMicWhisper();
        }
      }),
    ]).then(() => true).catch(() => false);
  }
  return dictNativeListenersReady;
}

async function dictStartMicNative() {
  const native = dictNativePlugin();
  if (!native) { dictStartMicWhisper(); return; }
  const micBtn = $("dictMicBtn");
  const requestId = String(++dictNativeSeq);
  dictNativeRequestId = requestId;
  dictNativeActive = true;
  micBtn.classList.add("listening");
  dictResults.innerHTML = `<p class="dict-placeholder">🎤 กำลังฟังด้วยระบบเสียงของ Android… พูด${dictLangName()}ได้เลย ข้อความจะขึ้นในช่องค้นหา</p>`;
  try {
    if (!await dictEnsureNativeListeners()) throw new Error("native speech listener unavailable");
    if (dictNativeRequestId !== requestId) return;
    const availability = await native.isAvailable();
    if (dictNativeRequestId !== requestId) return;
    if (!availability || !availability.available) throw new Error("recognition unavailable");
    await native.startListening({ language: dictNativeLang(), requestId, online: true });
  } catch (error) {
    if (dictNativeRequestId !== requestId) return;
    dictNativeRequestId = null;
    dictNativeActive = false;
    micBtn.classList.remove("listening");
    if (error && error.code === "PERMISSION_DENIED") {
      dictResults.innerHTML = '<p class="dict-placeholder">🚫 ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน</p>';
      return;
    }
    dictStartMicWhisper();
  }
}

/* ---------- Whisper on-device ASR fallback (works where Google speech is blocked) ---------- */
let dictWhisperPromise = null;
let dictWRecord = null; // {stream, src, proc, gain, chunks, asr, rate, timer}

// lazy-load transformers.js + the local whisper-tiny model committed in models/
// everything is self-hosted (vendor3/, models/) so it works where CDNs are blocked
function loadDictWhisper(onProgress) {
  if (dictWhisperPromise) return dictWhisperPromise;
  dictWhisperPromise = (async () => {
    const mod = await import("./vendor3/transformers.web.min.js");
    const { env, pipeline } = mod;
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = "models/";
    // onnxruntime-web wasm/jsep files are self-hosted too (default = jsDelivr CDN)
    // wasmPaths ต้องเป็น URL เต็ม — ort เอาไปต่อชื่อไฟล์แล้ว import() ตรงๆ
    // ส่ง "vendor3/" เปล่าๆ จะกลายเป็น bare specifier แล้ว resolve ไม่ได้
    if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
      env.backends.onnx.wasm.wasmPaths = new URL("vendor3/", document.baseURI).href;
      // เซิร์ฟเวอร์ธรรมดา/GitHub Pages ไม่ส่ง COOP+COEP -> ไม่มี SharedArrayBuffer
      // บังคับเธรดเดียวไม่ให้ ort สร้าง pthread worker แล้วล้มตอนโหลด wasm
      env.backends.onnx.wasm.numThreads =
        (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated)
          ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;
    }
    const mk = (device) => pipeline("automatic-speech-recognition", "whisper-tiny", {
      device,
      dtype: "q8", // maps to the *_quantized.onnx files in models/whisper-tiny/
      progress_callback: (p) => { if (onProgress) onProgress(p); },
    });
    // WebGPU เร็วกว่าแต่ให้ผลถอดเสียงเพี้ยน (สุ่มหลายภาษา) กับโมเดล q8 ตัวนี้
    // -> ใช้ wasm เป็นหลัก ค่อย fallback เป็น webgpu ถ้า wasm โหลดไม่ได้
    try { return await mk("wasm"); }
    catch (e) {
      if (navigator.gpu) return mk("webgpu");
      throw e;
    }
  })();
  dictWhisperPromise.catch(() => { dictWhisperPromise = null; }); // allow retry after a failed load
  return dictWhisperPromise;
}

async function dictStartMicWhisper() {
  const micBtn = $("dictMicBtn");
  if (dictWRecord) { dictStopMicWhisper(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    dictResults.innerHTML = '<p class="dict-placeholder">🚫 เบราว์เซอร์นี้ไม่รองรับการค้นหาด้วยเสียง</p>';
    return;
  }
  micBtn.classList.add("listening");
  const setStatus = (h) => { dictResults.innerHTML = `<p class="dict-placeholder">${h}</p>`; };
  setStatus("⏳ กำลังโหลดโมเดลจดจำเสียงในเครื่อง (ครั้งแรก ~40MB)...");
  let lastShown = 0;
  let asr;
  try {
    asr = await Promise.race([
      loadDictWhisper((p) => {
        if (p.status === "progress" && p.total && Date.now() - lastShown > 150) {
          lastShown = Date.now();
          const mb = (p.loaded / 1048576).toFixed(1) + "/" + (p.total / 1048576).toFixed(1) + "MB";
          setStatus(`⏳ กำลังโหลดโมเดลเสียง ${Math.round(p.loaded / p.total * 100)}% (${mb})`);
        } else if (p.status === "initiate") {
          setStatus("⏳ เริ่มโหลดโมเดลเสียง...");
        }
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 120000)),
    ]);
  } catch (e) {
    micBtn.classList.remove("listening");
    setStatus("โหลดโมเดลเสียงไม่สำเร็จ (ช้าหรือขาดกลางคัน) ตรวจสอบอินเทอร์เน็ตแล้วกด 🎤 ลองใหม่");
    return;
  }
  setStatus("✅ โมเดลพร้อมแล้ว กำลังเปิดไมโครโฟน...");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) {
    micBtn.classList.remove("listening");
    dictResults.innerHTML = '<p class="dict-placeholder">🚫 เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน</p>';
    return;
  }
  const ac = AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
  if (ac.state === "suspended") ac.resume();
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const gain = ac.createGain(); // silence tap: ScriptProcessor must reach destination to run
  gain.gain.value = 0;
  const chunks = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc); proc.connect(gain); gain.connect(ac.destination);
  dictWRecord = { stream, src, proc, gain, chunks, asr, rate: ac.sampleRate,
    timer: setTimeout(() => dictStopMicWhisper(), 12000) };
  dictResults.innerHTML = `<p class="dict-placeholder">🎤 กำลังฟัง… พูด${dictLangName()}แล้วกด 🎤 อีกครั้งเพื่อถอดเสียง (หยุดเองใน 12 วิ)</p>`;
}

// linear resample Float32 -> 16 kHz for whisper
function dictResample16k(data, from) {
  if (from === 16000) return data;
  const ratio = from / 16000;
  const len = Math.round(data.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio, j = Math.floor(pos), f = pos - j;
    const a = data[j] || 0, b = data[j + 1] !== undefined ? data[j + 1] : a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

async function dictStopMicWhisper(cancel) {
  const r = dictWRecord; dictWRecord = null;
  if (!r) return;
  clearTimeout(r.timer);
  try { r.proc.disconnect(); r.src.disconnect(); r.gain.disconnect(); } catch (e) {}
  r.stream.getTracks().forEach((t) => t.stop());
  $("dictMicBtn").classList.remove("listening");
  if (cancel) return;
  const total = r.chunks.reduce((n, c) => n + c.length, 0);
  if (total < r.rate * 0.3) {
    dictResults.innerHTML = `<p class="dict-placeholder">🤔 เสียงสั้นเกินไป กด 🎤 แล้วพูด${dictLangName()}อีกครั้ง</p>`;
    return;
  }
  const audio = new Float32Array(total);
  let o = 0;
  for (const c of r.chunks) { audio.set(c, o); o += c.length; }
  dictResults.innerHTML = '<p class="dict-placeholder">⏳ กำลังถอดเสียงเป็นข้อความ...</p>';
  try {
    const out = await r.asr(dictResample16k(audio, r.rate), { language: dictMicLang === "th" ? "thai" : "chinese", task: "transcribe" });
    const text = (out && out.text ? out.text : "").trim();
    if (text) {
      dictInput.value = text;
      dictUpdateClearBtn();
      dictSearch(text);
    } else {
      dictResults.innerHTML = '<p class="dict-placeholder">🤔 ไม่ได้ยินชัด กด 🎤 แล้วพูดอีกครั้ง</p>';
    }
  } catch (e) {
    dictResults.innerHTML = '<p class="dict-placeholder">ถอดเสียงไม่สำเร็จ ลองใหม่อีกครั้ง</p>';
  }
}

/* ---------- Dictionary free-handwriting mode (Google Input Tools API + HanziLookupJS fallback) ---------- */
let dictCanvas = null;
let dictCtx = null;
let dictStrokes = [];       // array of strokes, each stroke = array of [x,y,t]
let dictCurrentStroke = []; // points of the stroke currently being drawn
let dictDrawing = false;
let dictStrokeT0 = 0;       // timestamp (ms) when the current stroke started
let dictW = 0, dictH = 0;   // drawing area size in CSS px (canvas attrs are × devicePixelRatio)
let dictLookupReady = false;
let dictLookupPromise = null;

// load hanzilookup.min.js + mmah.json once
function loadDictLookup() {
  if (dictLookupReady) return Promise.resolve();
  if (dictLookupPromise) return dictLookupPromise;
  dictLookupPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = window.CR_OFFLINE_APP
      ? "vendor3/hanzilookup.min.js"
      : "https://cdn.jsdelivr.net/gh/gugray/HanziLookupJS@master/dist/hanzilookup.min.js";
    script.onload = () => {
      if (!window.HanziLookup) { reject(new Error("HanziLookup not loaded")); return; }
      window.HanziLookup.init("mmah",
        window.CR_OFFLINE_APP ? "vendor3/mmah.json" : "https://cdn.jsdelivr.net/gh/gugray/HanziLookupJS@master/dist/mmah.json",
        (ok) => { ok ? (dictLookupReady = true, resolve()) : reject(new Error("mmah data failed")) });
    };
    script.onerror = () => reject(new Error("hanzilookup.min.js failed to load"));
    document.head.appendChild(script);
  });
  return dictLookupPromise;
}

function dictStartWrite() {
  if (dictRecognition) dictRecognition.stop();
  if (dictWRecord) dictStopMicWhisper(true);
  if (dictNativeActive) dictNativeCancel();
  if (!dictWritePanel.hidden) { dictWritePanel.hidden = true; return; }
  dictWritePanel.hidden = false;
  dictInitCanvas();
}

// วัดขนาดกล่องจริงแล้ว set backing store (× dpr) + transform ให้ตรง — เรียกซ้ำได้ตอน resize
// (บนแท็บเล็ต CSS `aspect-ratio: 1; max-height: 55vh` ทำให้กล่องเปลี่ยนขนาดตอนหมุนจอ/
// คีย์บอร์ดเด้ง ถ้าไม่วัดใหม่เส้นจะคมน้อยลงและพิกัดอ้างอิงเก่า)
function dictRefitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  dictW = dictCanvas.clientWidth;
  dictH = dictCanvas.clientHeight;
  dictCanvas.width = Math.round(dictW * dpr);
  dictCanvas.height = Math.round(dictH * dpr);
  dictCtx = dictCanvas.getContext("2d");
  dictCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dictCtx.lineCap = "round"; dictCtx.lineJoin = "round";
  dictCtx.strokeStyle = "#ff5722"; dictCtx.lineWidth = 10;
  dictCtx.fillStyle = "#fff"; dictCtx.fillRect(0, 0, dictW, dictH);
}

function dictInitCanvas() {
  dictCanvas = $("dictWriter");
  dictStrokes = []; dictCurrentStroke = []; dictDrawing = false;
  dictRecogSeq++; // cancel any recognition still in flight
  dictRefitCanvas();
  dictUpdateUndoBtn();
  $("dictCharPicker").innerHTML = '<p style="color:#8b95c9;">วาดตัวอักษรจีนได้เลย</p>';
  // wire pointer events
  dictCanvas.onpointerdown = dictPointerDown;
  dictCanvas.onpointermove = dictPointerMove;
  dictCanvas.onpointerup = dictPointerUp;
  dictCanvas.onpointerleave = dictPointerUp;
}

function dictCanvasPos(e) {
  // แมพผ่านขนาดกล่องจริงเสมอ: ถ้า canvas ถูกย่อ/ยืดต่างจากตอนเปิดแผง (หมุนจอ,
  // คีย์บอร์ด, max-height บนแท็บเล็ต) สัดส่วน rect จะพาเส้นกลับมาใต้นิ้ว และเวลา
  // หน้าถูก pinch-zoom clientX/Y เป็นพิกัด visual viewport แต่ rect เป็น layout
  // viewport — บวก visualViewport.offset คืนก่อน (เฉพาะตอนซูมเกิน 1 จึงจำเป็น)
  const r = dictCanvas.getBoundingClientRect();
  const vv = window.visualViewport;
  const zoomed = !!(vv && vv.scale > 1.01);
  const vx = e.clientX + (zoomed ? vv.offsetLeft : 0);
  const vy = e.clientY + (zoomed ? vv.offsetTop : 0);
  const sx = r.width > 0 ? dictW / r.width : 1;
  const sy = r.height > 0 ? dictH / r.height : 1;
  return [Math.round((vx - r.left) * sx), Math.round((vy - r.top) * sy)];
}

function dictPointerDown(e) {
  e.preventDefault();
  dictDrawing = true;
  dictUpdateUndoBtn(); // ระหว่างเขียนเส้นใหม่ ปุ่มย้อนกลับถูกปิดไว้ก่อน
  dictStrokeT0 = performance.now();
  const [x, y] = dictCanvasPos(e);
  dictCurrentStroke = [[x, y, 0]];
  dictCtx.beginPath();
  dictCtx.moveTo(x, y);
}

function dictPointerMove(e) {
  if (!dictDrawing) return;
  const [x, y] = dictCanvasPos(e);
  dictCurrentStroke.push([x, y, performance.now() - dictStrokeT0]);
  dictCtx.lineTo(x, y);
  dictCtx.stroke();
}

function dictPointerUp(e) {
  if (!dictDrawing) return;
  dictDrawing = false;
  // keep single-point strokes (dot taps like 丶) by duplicating the point
  if (dictCurrentStroke.length === 1) {
    const [x, y, t] = dictCurrentStroke[0];
    dictCurrentStroke.push([x + 0.5, y + 0.5, t + 1]);
    dictCtx.lineTo(x + 0.5, y + 0.5);
    dictCtx.stroke();
  }
  if (dictCurrentStroke.length) dictStrokes.push(dictCurrentStroke);
  dictCurrentStroke = [];
  dictUpdateUndoBtn();
  dictRecognize();
}

function dictClearCanvas() {
  if (!dictCtx) return;
  dictCtx.fillStyle = "#fff"; dictCtx.fillRect(0, 0, dictW, dictH);
  dictStrokes = []; dictCurrentStroke = [];
  dictRecogSeq++; // cancel any recognition still in flight
  dictUpdateUndoBtn();
  $("dictCharPicker").innerHTML = '<p style="color:#8b95c9;">วาดตัวอักษรจีนได้เลย</p>';
}

// วาดเส้นทั้งหมดใน dictStrokes ลงพื้นขาวใหม่ — ปกติ canvas วาดสะสมทีละเส้น
// จึงต้องมี repaint ตอนลบเส้นด้วยปุ่มย้อนกลับ
function dictRepaintCanvas() {
  dictCtx.fillStyle = "#fff";
  dictCtx.fillRect(0, 0, dictW, dictH);
  dictCtx.strokeStyle = "#ff5722";
  dictCtx.lineWidth = 10;
  for (const s of dictStrokes) {
    if (!s.length) continue;
    dictCtx.beginPath();
    dictCtx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) dictCtx.lineTo(s[i][0], s[i][1]);
    dictCtx.stroke();
  }
}

function dictUpdateUndoBtn() {
  const btn = $("dictWriteUndoBtn");
  if (btn) btn.disabled = !dictStrokes.length || dictDrawing;
}

// ย้อนกลับเส้นที่เขียนก่อนหน้า: ลบเส้นสุดท้าย วาดเส้นที่เหลือใหม่ แล้วจำแนกลายมือใหม่
function dictUndoStroke() {
  if (!dictCtx || dictDrawing || !dictStrokes.length) return;
  dictStrokes.pop();
  dictRecogSeq++; // cancel any recognition still in flight
  dictRepaintCanvas();
  dictUpdateUndoBtn();
  if (dictStrokes.length) dictRecognize();
  else $("dictCharPicker").innerHTML = '<p style="color:#8b95c9;">วาดตัวอักษรจีนได้เลย</p>';
}

// Google Input Tools handwriting API — much more accurate than the offline
// matcher (same engine as Google's handwriting keyboard, tolerant of
// stroke-order slips). Requires internet; HanziLookup below is the fallback.
async function dictRecognizeGoogle() {
  if (window.CR_OFFLINE_APP) return [];
  const ink = dictStrokes.map((s) => [s.map((p) => p[0]), s.map((p) => p[1]), s.map((p) => Math.round(p[2]))]);
  const body = {
    input_type: 0,
    requests: [{
      language: "zh",
      writing_guide: { writing_area_width: dictW, writing_area_height: dictH },
      ink,
      max_num_results: 10,
      max_completions: 0,
      pre_context: "",
    }],
  };
  const res = await fetch("https://inputtools.google.com/request?itc=zh-t-i0-handwrit&num=10&cp=1&cs=1&ie=utf-8&oe=utf-8&app=zhhandwrit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("google handwriting " + res.status);
  const data = await res.json();
  if (data[0] !== "SUCCESS" || !data[1] || !data[1][0]) return [];
  return data[1][0][1] || [];
}

let dictRecogSeq = 0; // ignore stale results if new strokes arrive mid-request

async function dictRecognize() {
  if (!dictStrokes.length) return;
  const seq = ++dictRecogSeq;
  const picker = $("dictCharPicker");
  picker.innerHTML = '<p style="color:#8b95c9;">กำลังจดจำ...</p>';
  try {
    const chars = await dictRecognizeGoogle();
    if (seq !== dictRecogSeq) return;
    if (chars.length) { dictShowCandidates(chars); return; }
  } catch (e) { /* fall back to offline matcher below */ }
  try {
    await loadDictLookup();
    if (seq !== dictRecogSeq) return;
    const strokes2d = dictStrokes.map((s) => s.map((p) => [p[0], p[1]]));
    const analyzed = new window.HanziLookup.AnalyzedCharacter(strokes2d);
    new window.HanziLookup.Matcher("mmah").match(analyzed, 8, (matches) => {
      if (seq !== dictRecogSeq) return;
      dictShowCandidates(matches.map((m) => m.character));
    });
  } catch (e) {
    if (seq !== dictRecogSeq) return;
    picker.innerHTML = '<p style="color:#ff9c9c;">จดจำลายมือผิดพลาด ลองล้างแล้ววาดใหม่</p>';
  }
}

function dictShowCandidates(chars) {
  const picker = $("dictCharPicker");
  picker.innerHTML = "";
  if (!chars.length) { picker.innerHTML = '<p style="color:#8b95c9;">ไม่เจอตัวอักษรที่ตรงกัน</p>'; return; }
  for (const ch of chars) {
    const btn = document.createElement("button");
    btn.textContent = ch;
    btn.addEventListener("click", () => {
      // append the recognized char to the search box (don't replace)
      // so user can build up multi-char words/phrases like 你好
      dictInput.value += ch;
      dictUpdateClearBtn();
      dictSearch(dictInput.value.trim());
      // clear canvas so user can write the next char, keep panel open
      dictClearCanvas();
    });
    picker.appendChild(btn);
  }
}

$("dictQuitBtn").addEventListener("click", () => {
  sfx.click();
  if (dictRecognition) { dictRecognition.stop(); dictRecognition = null; }
  if (dictWRecord) dictStopMicWhisper(true);
  if (dictNativeActive) dictNativeCancel();
  switchScreen(menuEl);
});
$("dictMuteBtn").addEventListener("click", toggleMute);
$("dictSearchBtn").addEventListener("click", () => {
  sfx.click();
  dictWritePanel.hidden = true;
  dictSearch();
});
$("dictBingBtn").addEventListener("click", () => {
  sfx.click();
  crOpenWeb(dictBingUrl(dictInput.value.trim()));
});
dictInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); dictSearch(); } });
dictInput.addEventListener("input", () => {
  dictUpdateClearBtn();
  // auto-search if query is long enough or contains chinese
  const v = dictInput.value.trim();
  if (v.length >= 2 || /[\u4e00-\u9fff]/.test(v)) dictSearch(v);
});
$("dictClearBtn").addEventListener("click", () => {
  sfx.click();
  dictInput.value = "";
  dictUpdateClearBtn();
  dictInput.focus();
  dictResults.innerHTML = '<p class="dict-placeholder">พิมพ์พินอิน ตัวจีน หรือภาษาไทยเพื่อค้นหา — กด 🎤 เพื่อพูด (เลือกภาษาได้ที่ปุ่มข้างๆ) หรือ ✍️ เพื่อเขียน</p>';
});
$("dictMicBtn").addEventListener("click", () => { sfx.click(); dictStartMic(); });
$("dictMicLangBtn").addEventListener("click", () => {
  sfx.click();
  dictMicLang = dictMicLang === "th" ? "zh" : "th";
  localStorage.setItem("cr_dict_mic_lang", dictMicLang);
  dictMicLangUi();
});
$("dictMicEngBtn").addEventListener("click", () => {
  sfx.click();
  dictMicEngine = dictMicEngine === "auto" ? "google" : dictMicEngine === "google" ? "whisper" : "auto";
  localStorage.setItem("cr_dict_mic_engine", dictMicEngine);
  dictMicEngUi();
  dictResults.innerHTML = `<p class="dict-placeholder">ตัวจดจำเสียง: ${MIC_ENGINES[dictMicEngine].label}</p>`;
});
$("dictWriteBtn").addEventListener("click", () => { sfx.click(); dictStartWrite(); });
// ขนาดจอเปลี่ยนระหว่างเปิดแผงเขียน (หมุนจอ/คีย์บอร์ด) — วัด backing store ใหม่
// เฉพาะตอนยังไม่มีลายมือ (มีลายแล้วคงพิกัดเดิมไว้ — การแมพผ่าน rect ใน dictCanvasPos ยังจับใต้นิ้ว)
window.addEventListener("resize", () => {
  if (dictCtx && !dictStrokes.length && !dictCurrentStroke.length &&
      dictWritePanel && !dictWritePanel.hidden) dictRefitCanvas();
});
$("dictWriteCloseBtn").addEventListener("click", () => { sfx.click(); dictWritePanel.hidden = true; });
$("dictWriteClearBtn").addEventListener("click", () => { sfx.click(); dictClearCanvas(); });
$("dictWriteUndoBtn").addEventListener("click", () => { sfx.click(); dictUndoStroke(); });
$("dictWriteClearTextBtn").addEventListener("click", () => {
  sfx.click();
  dictInput.value = "";
  dictUpdateClearBtn();
  // ไม่ focus ช่องค้นหา — กันคีย์บอร์ดมือถือเด้งมาบังแผงเขียน
  dictResults.innerHTML = '<p class="dict-placeholder">พิมพ์พินอิน ตัวจีน หรือภาษาไทยเพื่อค้นหา — กด 🎤 เพื่อพูด (เลือกภาษาได้ที่ปุ่มข้างๆ) หรือ ✍️ เพื่อเขียน</p>';
});

