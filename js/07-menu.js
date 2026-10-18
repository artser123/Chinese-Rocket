"use strict";
/* ================= Menu & controls ================= */
let matching = null;
const MATCH_DIFF = {
  easy: { cards: 6, columns: 3, label: "ง่าย · 6 ใบ" },
  medium: { cards: 8, columns: 4, label: "ปานกลาง · 8 ใบ" },
  hard: { cards: 10, columns: 5, label: "ยาก · 10 ใบ" },
};
const originalDiffLabels = Array.from(document.querySelectorAll(".diff-btn"), (b) => b.textContent);
const matchingBestKey = (level, diff, mode, duration) => `cr_best_${catPrefix()}${level}_matching_${diff}_${mode}_${duration}`;
const matchTimeLabel = (duration) => duration ? `${duration} วินาที` : "ไม่จำกัดเวลา";
const matchModeLabel = (mode) => mode === "pinyin" ? "พินอิน" : "ภาษาไทย";
const matchTextKey = (text) => text.split(/[｜|]/)[0].normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

function formatPinyinForCard(py) {
  if (!py) return "";
  let clean = py.split(/[｜|]/)[0].trim().replace(/\s+/g, " ");
  clean = clean.replace(/'/g, "'\u200B").replace(/([)）])/g, "$1\u200B");
  const re = /([aāáǎàeēéěèiīíǐìoōóǒòuūúǔùüǖǘǚǜv](?:ng|n|r)?)(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])([aāáǎàeēéěèiīíǐìoōóǒòuūúǔùüǖǘǚǜv])/gi;
  let prev;
  while (prev !== clean) {
    prev = clean;
    clean = clean.replace(re, function(match, p1, p2, p3) {
      return p1 + "\u200B" + p2 + p3;
    });
  }
  return clean;
}

function makeMatchingDeck(words, count, mode, previous = []) {
  const attr = mode === "pinyin" ? 1 : 2;
  const oldWords = new Set(previous.map((c) => c.word[0]));
  const candidates = shuffle([...words]).sort((a, b) => Number(oldWords.has(a[0])) - Number(oldWords.has(b[0])));
  const usedChinese = new Set(), usedAnswers = new Set(), chosen = [];
  for (const word of candidates) {
    if (!word[0] || !word[attr]) continue;
    const zh = matchTextKey(word[0]), answer = matchTextKey(word[attr]);
    if (usedChinese.has(zh) || usedAnswers.has(answer)) continue;
    usedChinese.add(zh); usedAnswers.add(answer);
    chosen.push(word);
    if (chosen.length === count / 2) break;
  }
  return shuffle(chosen.flatMap((word, pair) => [
    { pair, word, side: "chinese", text: word[0].split(/[｜|]/)[0].trim(), matched: false },
    { pair, word, side: mode, text: word[attr].split(/[｜|]/)[0].trim(), matched: false },
  ]));
}

function startMatchingGame(level, mode = quizMode, diff = difficulty, duration = zDuration) {
  stopMatchingGame();
  currentLevel = level;
  lastStarter = () => startMatchingGame(level, mode, diff, duration);
  matching = {
    level, mode, diff, duration, words: getVocabPool(level),
    score: 0, pairs: 0, attempts: 0, rounds: 0, elapsed: 0, done: new Set(),
    deck: [], open: [], waitUntil: 0, paused: false,
    lastTime: performance.now(), frame: null,
  };
  $("matching").classList.remove("match-paused");
  $("matchPauseOverlay").classList.remove("show");
  const mark = $("matchProg");
  if (mark) mark.textContent = `${levelDisplayName(level)} • ${MATCH_DIFF[diff].label} • จีน–${matchModeLabel(mode)} • ${matchTimeLabel(duration)}`;
  $("matchMuteBtn").textContent = muted ? "เปิดเสียง" : "ปิดเสียง";
  $("matchMuteBtn").setAttribute("aria-pressed", String(muted));
  switchScreen($("matching"));
  nextMatchingRound();
  updateMatchingHUD();
  stopSpeech();
  music.start("matching");
  const session = matching;
  session.frame = requestAnimationFrame((t) => matchingLoop(t, session));
}

// คำนวณจำนวนคอลัมน์ที่เหมาะกับขนาดหน้าจอและจำนวนการ์ด
// เป้าหมาย: การ์ดใกล้สี่เหลี่ยมจัตุรัส และเต็มจอโดยไม่มีช่องว่างมากเกินไป
function matchColumns(n) {
  const W = window.innerWidth, H = window.innerHeight;
  const aspect = W / H;
  let cols = Math.max(2, Math.round(Math.sqrt(n * aspect)));
  cols = Math.min(cols, n);
  // ลดช่องว่าง: ถ้า cols ทำให้มีช่องว่างเยอะเกินไป ให้ลดลง
  const rows = Math.ceil(n / cols);
  const empty = cols * rows - n;
  if (empty > cols / 2 && cols > 2) cols--;
  return Math.max(2, Math.min(cols, n));
}

function applyMatchLayout() {
  if (!matching) return;
  const s = matching, config = MATCH_DIFF[s.diff];
  const cols = matchColumns(config.cards);
  const board = $("matchBoard");
  board.style.setProperty("--match-columns", cols);
  board.style.setProperty("--match-rows", Math.ceil(config.cards / cols));
  requestAnimationFrame(() => fitMatchCardText());
}

function nextMatchingRound() {
  const s = matching, config = MATCH_DIFF[s.diff];
  s.deck = makeMatchingDeck(s.words, config.cards, s.mode, s.deck);
  s.open = []; s.waitUntil = 0; s.combo = 0;
  const board = $("matchBoard");
  board.replaceChildren();
  s.deck.forEach((card, i) => {
    const button = document.createElement("button");
    button.className = "match-card " + (card.side === "chinese" ? "chinese" : "answer");
    const text = document.createElement("span");
    text.className = "match-text";
    button.append(text);
    button.addEventListener("click", () => flipMatchingCard(i));
    board.appendChild(button);
  });
  applyMatchLayout();
  matchFeedbackPulse(null);
  $("matchFeedback").textContent = "แตะคำจีน แล้วแตะคำตอบที่ตรงกัน";
  const doneEl = document.createElement("div");
  doneEl.className = "match-round-done";
  doneEl.textContent = "ครบชุดแล้ว! กำลังสุ่มชุดใหม่";
  board.appendChild(doneEl);
  s.doneEl = doneEl;
  $("matchFeedback").style.setProperty("--fb-scale", "1");
  renderMatchingCards();
}

function renderMatchingCards() {
  const s = matching;
  // อ้างการ์ดจากคลาส ไม่ใช่ children ตรง ๆ — บนกระดานมี element เอฟเฟกต์ (วงแหวน/คะแนนลอย) ปนอยู่ได้
  Array.from($("matchBoard").querySelectorAll(".match-card")).forEach((button, i) => {
    const card = s.deck[i];
    if (!card) return;
    const selected = s.open.includes(i);
    const mismatch = s.open.length === 2 && s.deck[s.open[0]].pair !== s.deck[s.open[1]].pair && s.open.includes(i);
    // การ์ดเปิดเสมอ — แสดงข้อความตลอดเวลา (ไม่มีป้ายภาษา) แต่แยกสีฝั่งจีน/ฝั่งคำตอบ
    button.className = "match-card open" + (card.matched ? " matched" : "") +
      (selected && !card.matched ? " selected" : "") +
      (mismatch ? " mismatch" : "") + (card.side === "chinese" ? " chinese" : " answer");
    button.disabled = s.paused || card.matched || s.waitUntil > 0;
    button.setAttribute("aria-pressed", String(card.matched || selected));
    const isPinyin = card.side === "pinyin";
    button.children[0].textContent = isPinyin ? formatPinyinForCard(card.text) : card.text;
    button.children[0].lang = card.side === "chinese" ? "zh-CN" : isPinyin ? "zh-Latn" : "th";
    button.setAttribute("aria-label", `${card.text}${card.matched ? " จับคู่แล้ว" : selected ? " (เลือกอยู่)" : ""}`);
    button.setAttribute("aria-hidden", String(card.matched)); // การ์ดที่จับคู่แล้วหายไปจากจอ → ซ่อนจาก screen reader ด้วย
  });
  // ปรับขนาดตัวอักษรให้เต็มการ์ด โดยคำนวณจากขนาดการ์ดและความยาวข้อความ
  requestAnimationFrame(() => fitMatchCardText());
  if (s.doneEl) s.doneEl.classList.toggle("show", s.deck.length > 0 && s.deck.every((c) => c.matched));
}

// ย่อ/ขยายฟอนต์ในกล่องฟีดแบ็กให้พอดีหนึ่งบรรทัด (สูงคงที่ → การ์ดใบอื่นไม่ขยับ)
function fitMatchFeedback() {
  const el = $("matchFeedback");
  if (!el) return;
  el.style.setProperty("--fb-scale", "1");
  let scale = 1;
  while (el.scrollWidth > el.clientWidth + 1 && scale > 0.5) {
    scale = Math.round((scale - 0.05) * 100) / 100;
    el.style.setProperty("--fb-scale", String(scale));
  }
}

// เอฟเฟกต์ตอนจับคู่ถูก: วงแหวนขยายจากกลางการ์ด + ข้อความคะแนนลอยขึ้น (ระดับ 2)
// วางบน "กระดาน" ไม่ใช่บนการ์ด เพราะการ์ดที่จับคู่แล้วจะจางหายไปทั้งใบ (เอฟเฟกต์จะหายไปด้วย)
function matchFx(cardEls, label) {
  const board = $("matchBoard");
  if (!board) return;
  (cardEls || []).filter(Boolean).forEach((el, i) => {
    const cx = el.offsetLeft + el.offsetWidth / 2;
    const cy = el.offsetTop + el.offsetHeight / 2;
    const ring = document.createElement("span");
    ring.className = "match-ring";
    ring.style.left = `${cx}px`;
    ring.style.top = `${cy}px`;
    board.appendChild(ring);
    setTimeout(() => ring.remove(), 800);
    if (i === 0 && label) {
      const fl = document.createElement("span");
      fl.className = "match-float";
      fl.textContent = label;
      fl.style.left = `${cx}px`;
      fl.style.top = `${el.offsetTop + 6}px`;
      board.appendChild(fl);
      setTimeout(() => fl.remove(), 1100);
    }
  });
}

// กระตุ้นอนิเมชันของกล่องฟีดแบ็ก (ต้องลบคลาสเดิมก่อน ไม่งั้นแอนิเมชันรอบใหม่ไม่เล่น)
function matchFeedbackPulse(cls) {
  const el = $("matchFeedback");
  if (!el) return;
  el.classList.remove("fb-pop", "fb-bad");
  void el.offsetWidth; // บังคับ reflow
  if (cls) el.classList.add(cls);
}

function fitMatchCardText() {
  const cards = document.querySelectorAll(".match-card");
  cards.forEach((card) => {
    const text = card.querySelector(".match-text");
    if (!text) return;
    // พื้นที่ว่างภายในการ์ด (หัก padding ของการ์ด)
    const padX = 16, padY = 12;
    const cw = card.clientWidth - padX, ch = card.clientHeight - padY;
    if (cw <= 0 || ch <= 0) return;
    const isChinese = card.classList.contains("chinese");
    const isPinyin = text.getAttribute("lang") === "zh-Latn";
    const maxFont = isChinese ? 72 : isPinyin ? 28 : 40; // พินอินจำกัด 28px ให้อ่านง่ายไม่ล้นการ์ด / ไทย 40px / จีน 72px
    const minFont = 10;
    // binary search หาขนาดตัวอักษรที่ใหญ่ที่สุดที่ไม่ overflow
    let lo = minFont, hi = maxFont, best = minFont;
    while (lo <= hi) {
      const mid = Math.round((lo + hi) / 2);
      text.style.fontSize = mid + "px";
      // วัดจากตัวอักษรจริง: scrollWidth/scrollHeight เทียบกับพื้นที่ว่าง
      if (text.scrollWidth <= cw && text.scrollHeight <= ch) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    text.style.fontSize = best + "px";
  });
}

// ฟอนต์จีน/ไทยโหลดช้า → วัดขนาดตัวอักษรใหม่อีกครั้งหลังฟอนต์พร้อม (กันตัวอักษรล้นหรือเล็กเกินไป)
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { if (matching) requestAnimationFrame(() => fitMatchCardText()); });
}

function updateMatchingHUD() {
  const s = matching;
  $("matchScore").textContent = `${s.score} คะแนน`;
  const seconds = s.duration ? Math.max(0, Math.ceil(s.duration - s.elapsed)) : Math.floor(s.elapsed);
  $("matchTimer").textContent = `${s.duration ? "เหลือ" : "เล่นไป"} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const urgent = s.duration > 0 && seconds <= 10;
  $("matchTimer").classList.toggle("urgent", urgent);
  $("matchProg").textContent = progPct(s.done.size, s.words.length);
  // แถบความคืบหน้าของรอบนี้ (จับคู่แล้วกี่คู่จากทั้งหมดในชุด)
  const track = $("matchProgTrack");
  if (track) {
    const totalPairs = Math.max(1, s.deck.length / 2);
    const donePairs = s.deck.reduce((n, c) => n + (c.matched ? 1 : 0), 0) / 2;
    const pct = Math.round(donePairs / totalPairs * 100);
    track.firstElementChild.style.width = `${pct}%`;
    track.classList.toggle("urgent", urgent);
    track.setAttribute("aria-valuenow", String(pct));
    track.setAttribute("aria-valuetext", `จับคู่แล้ว ${donePairs} จาก ${totalPairs} คู่`);
  }
}

function advanceMatching(now) {
  const s = matching;
  if (!s || s.paused) return;
  s.elapsed += Math.max(0, (now - s.lastTime) / 1000);
  s.lastTime = Math.max(s.lastTime, now);
  if (s.duration && s.elapsed >= s.duration) {
    s.elapsed = s.duration;
    endMatchingGame(true);
    return;
  }
  if (s.waitUntil && s.elapsed >= s.waitUntil) {
    if (s.deck.every((c) => c.matched)) {
      s.rounds++;
      nextMatchingRound();
    } else {
      s.open = []; s.waitUntil = 0;
      renderMatchingCards();
      $("matchFeedback").textContent = "ยังไม่ใช่คู่กัน ลองใหม่อีกครั้ง";
      fitMatchFeedback();
    }
  }
  updateMatchingHUD();
}

function flipMatchingCard(i) {
  if (!matching || matching.paused) return;
  const deck = matching.deck;
  advanceMatching(performance.now());
  const s = matching;
  if (!s || s.deck !== deck || s.waitUntil || !s.deck[i] || s.deck[i].matched) return;
  // คลิกการ์ดใบที่เลือกอยู่ซ้ำ = ยกเลิกการเลือก เพื่อเลือกคู่ตัวใหม่
  if (s.open.includes(i)) {
    s.open = s.open.filter((idx) => idx !== i);
    sfx.click();
    renderMatchingCards();
    updateMatchingHUD();
    return;
  }
  s.open.push(i);
  sfx.click();
  if (s.open.length === 2) {
    s.attempts++;
    const [a, b] = s.open.map((index) => s.deck[index]);
    if (a.pair === b.pair && a.side !== b.side) {
      a.matched = b.matched = true;
      s.pairs++;
      // คอมโบ: จับคู่ถูกติดกันได้คะแนนเพิ่มขึ้น (10 → 15 → 20 → 25 → 30 สูงสุด)
      const combo = (s.combo = (s.combo || 0) + 1);
      const gain = 10 + Math.min(4, combo - 1) * 5;
      s.score += gain;
      s.done.add(a.word[0]);
      sfx.hit();
      music.nudge(0.05); // จับคู่ถูก = เพลงเข้มข้นขึ้น (ค่อยๆ กลับลงเอง)
      matchFx(s.open.map((idx) => $("matchBoard").querySelectorAll(".match-card")[idx]), combo > 1 ? `+${gain} • คอมโบ x${combo}` : `+${gain}`);
      matchFeedbackPulse("fb-pop");
      setTimeout(() => { if (matching === s) speakWordHit(a.word); }, 150);
      const done = s.deck.every((c) => c.matched);
      $("matchFeedback").innerHTML =
        `<span class="fb-zh">${a.word[0]}</span>` +
        `<span class="fb-py">${a.word[1]}</span>` +
        `<span class="fb-th">${a.word[2]}</span>`;
      fitMatchFeedback();
      s.open = [];
      if (done) s.waitUntil = s.elapsed + 1.2;
    } else {
      s.waitUntil = s.elapsed + 0.6;
      s.combo = 0;
      sfx.wrong();
      matchFeedbackPulse("fb-bad");
      $("matchFeedback").textContent = "ยังไม่ใช่คู่กัน ลองใหม่อีกครั้ง";
      fitMatchFeedback();
    }
  }
  renderMatchingCards();
  updateMatchingHUD();
}

function matchingLoop(t, session) {
  if (matching !== session) return;
  advanceMatching(t);
  if (matching === session) session.frame = requestAnimationFrame((now) => matchingLoop(now, session));
}

function stopMatchingGame() {
  if (matching) cancelAnimationFrame(matching.frame);
  matching = null;
  music.stop();
  stopSpeech();
}

function endMatchingGame(expired = false) {
  if (!matching) return;
  const s = matching;
  stopMatchingGame();
  sfx.hit();
  const rounds = s.rounds + Number(s.deck.every((c) => c.matched));
  const accuracy = s.attempts ? Math.round(s.pairs / s.attempts * 100) : 0;
  showGameOver(expired ? "หมดเวลา!" : "จบเกมจับคู่", s.score,
    `${levelDisplayName(s.level)} • ${MATCH_DIFF[s.diff].label} • ${matchModeLabel(s.mode)} • ${matchTimeLabel(s.duration)} • ` +
    `จับคู่ ${s.pairs} คู่ • ครบ ${rounds} ชุด • แม่นยำ ${accuracy}% • เล่น ${Math.floor(s.elapsed)} วินาที`,
    matchingBestKey(s.level, s.diff, s.mode, s.duration));
}

function pauseMatchingGame() {
  if (!matching || matching.paused) return;
  advanceMatching(performance.now());
  if (!matching) return;
  matching.paused = true;
  $("matching").classList.add("match-paused");
  $("matchPauseOverlay").classList.add("show");
  renderMatchingCards();
  stopSpeech();
  $("matchResumeBtn").focus();
}

$("matchPauseBtn").addEventListener("click", pauseMatchingGame);
$("matchResumeBtn").addEventListener("click", () => {
  if (!matching) return;
  matching.paused = false;
  matching.lastTime = performance.now();
  $("matching").classList.remove("match-paused");
  $("matchPauseOverlay").classList.remove("show");
  renderMatchingCards();
  $("matchPauseBtn").focus();
});
$("matchEndBtn").addEventListener("click", () => {
  advanceMatching(performance.now());
  endMatchingGame();
});
$("matchQuitBtn").addEventListener("click", () => {
  if (!matching) return;
  const s = matching;
  saveBest(matchingBestKey(s.level, s.diff, s.mode, s.duration), s.score);
  stopMatchingGame();
  switchScreen(menuEl);
  updateBestLine();
});
$("matchMuteBtn").addEventListener("click", toggleMute);

let bombGame = null, bombWriter = null, bombLibraryPromise = null;
const bombCharData = new Map();
// เสียงดินสอขีดเขียน ใช้ร่วมกันทั้งเกมเขียนปลดระเบิดและโหมดเขียนในเกมของเกมเขียนเป็นประโยค
function pencilAllowed() {
  if (bombGame && !bombGame.paused && bombGame.phase === "writing") return true;
  if (cpWriteMode === "on" && cp && !$("cpWrite").hidden) return true;
  if (cpWriteMode === "free" && cp && !$("cpFree").hidden) return true;
  if (tc && tc.phase === "write") return true;
  return false;
}
const pencilSound = {
  source: null, gain: null, pointerId: null, buffer: null,
  start(e) {
    if (!e.isPrimary || e.button !== 0 || !pencilAllowed()) return;
    this.stop();
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === "suspended") AC.resume();
      if (!this.buffer) {
        this.buffer = AC.createBuffer(1, Math.ceil(AC.sampleRate * 0.5), AC.sampleRate);
        const data = this.buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const source = AC.createBufferSource(), filter = AC.createBiquadFilter(), gain = AC.createGain();
      source.buffer = this.buffer;
      source.loop = true;
      filter.type = "bandpass";
      filter.frequency.value = 2400;
      filter.Q.value = 0.7;
      gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(AC.destination);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start();
      this.source = source;
      this.gain = gain;
      this.pointerId = e.pointerId;
      this.x = e.clientX; this.y = e.clientY; this.time = e.timeStamp;
    } catch (error) { this.stop(); }
  },
  move(e) {
    if (e.pointerId !== this.pointerId || !this.source) return;
    if (!pencilAllowed() || !e.buttons) { this.stop(); return; }
    const distance = Math.hypot(e.clientX - this.x, e.clientY - this.y);
    const speed = Math.min(2, distance / Math.max(8, e.timeStamp - this.time));
    this.x = e.clientX; this.y = e.clientY; this.time = e.timeStamp;
    if (distance < 0.5) return;
    const now = AC.currentTime;
    this.source.playbackRate.setTargetAtTime(0.8 + speed * 0.25, now, 0.02);
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(0.055 + speed * 0.04, now, 0.008);
    this.gain.gain.setTargetAtTime(0, now + 0.055, 0.015);
  },
  stop() {
    if (this.source) {
      const now = AC.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setTargetAtTime(0, now, 0.005);
      this.source.stop(now + 0.03);
    }
    this.source = null;
    this.gain = null;
    this.pointerId = null;
  }
};
const BOMB_HINT_AFTER_MISSES = 2;
const BOMB_DIFF = {
  easy:   { label: "ง่าย",     fallMul: 1.4, writeMul: 1.35, tierMul: 0.7 },
  medium: { label: "ปานกลาง", fallMul: 1.0, writeMul: 1.0,  tierMul: 1.0 },
  hard:   { label: "ยากมาก",  fallMul: 0.7, writeMul: 0.7,  tierMul: 1.3 },
};
const bombBestKey = (level, diff) => `cr_best_${catPrefix()}${level}_bomb_${diff}`;
const bombPinyinKey = (text) => text.normalize("NFC").replace(/\s+/g, "").toLowerCase();
const bombTier = (s) => Math.floor((Math.floor(s.elapsed / 45) + Math.floor(s.defused / 4)) * (BOMB_DIFF[s.difficulty]?.tierMul ?? 1));
const bombFallSeconds = (s) => Math.max(3, (12 - bombTier(s) * 0.65) * (BOMB_DIFF[s.difficulty]?.fallMul ?? 1));
const bombWriteSeconds = (s, strokes) => Math.max(8, (8 + strokes * 2) * Math.max(0.4, 1 - bombTier(s) * 0.04) * (BOMB_DIFF[s.difficulty]?.writeMul ?? 1));

/* ---- ธีมท้องฟ้าตามระดับความเร็ว (bombTier): กลางวัน → พลบค่ำ → พระอาทิตย์ตก → กลางคืน ---- */
const BOMB_SKY = [
  { sky1: "#2f6d9e", sky2: "#79aecb", sky3: "#d8c8a0", far: "#3f6485", near: "#2d4a5d", night: false },
  { sky1: "#2a4f78", sky2: "#5684a2", sky3: "#bbac86", far: "#375673", near: "#28404f", night: false },
  { sky1: "#6b3f63", sky2: "#b9705f", sky3: "#edb069", far: "#4e3459", near: "#332338", night: false },
  { sky1: "#3b2a56", sky2: "#7b3f63", sky3: "#c96a4a", far: "#332a4d", near: "#221b34", night: true },
  { sky1: "#131a3a", sky2: "#242f5a", sky3: "#463a58", far: "#1b2240", near: "#11162a", night: true },
];
const BOMB_FRAME_PERIMETER = 100;   // pathLength ของ #bombFrameFill (เส้นรอบกรอบเขียน)
const bombMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const bombQuiet = () => !!(bombMotionQuery && bombMotionQuery.matches);

/* ================= FX เต็มจอ (particle + แฟลช + สั่นจอ) =================
   canvas ใบเดียวลอยเต็มจอ (position: fixed) เพื่อให้เอฟเฟกต์ระเบิดเล่นต่อได้
   แม้ฉากหลังจะถูกซ่อนตอนสลับไปหน้าผลลัพธ์ — วาดเฉพาะเมื่อมีอนุภาคจริง */
const bombFx = { canvas: null, ctx: null, parts: [], w: 0, h: 0, fuseAcc: 0 };
function bombFxInit() {
  if (bombFx.canvas) return;
  bombFx.canvas = $("bombFx");
  bombFx.ctx = bombFx.canvas.getContext("2d");
}
function bombFxResize() {
  bombFxInit();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  bombFx.w = w; bombFx.h = h;
  bombFx.canvas.width = Math.floor(w * dpr);
  bombFx.canvas.height = Math.floor(h * dpr);
  bombFx.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bombFx.ctx.clearRect(0, 0, w, h);
}
function bombFxClear() {
  bombFx.parts.length = 0;
  bombFx.fuseAcc = 0;
  if (bombFx.ctx) bombFx.ctx.clearRect(0, 0, bombFx.w, bombFx.h);
}
const bombFxAdd = (p) => { if (bombFx.parts.length < 260) bombFx.parts.push(p); };
function bombFxUpdate(dt) {
  if (!bombFx.ctx) return;
  const c = bombFx.ctx;
  c.clearRect(0, 0, bombFx.w, bombFx.h);
  const ps = bombFx.parts;
  if (!ps.length) return;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.age += dt;
    if (p.age >= p.life) { ps.splice(i, 1); continue; }
    const drag = p.drag ?? 0.99;
    p.vx *= drag;
    p.vy = p.vy * drag + (p.grav || 0) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const t = 1 - p.age / p.life;
    if (p.kind === "ring") {
      c.save(); c.globalCompositeOperation = "lighter"; c.globalAlpha = t * 0.8;
      c.strokeStyle = p.color; c.lineWidth = 2 + 9 * t;
      c.beginPath(); c.arc(p.x, p.y, p.r * (1 + p.age * 7), 0, Math.PI * 2); c.stroke();
      c.restore(); continue;
    }
    if (p.kind === "smoke") {
      const rr = p.r * (1 + p.age * 1.8);
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      g.addColorStop(0, p.color); g.addColorStop(1, "rgba(0,0,0,0)");
      c.save(); c.globalAlpha = t * 0.4; c.fillStyle = g;
      c.beginPath(); c.arc(p.x, p.y, rr, 0, Math.PI * 2); c.fill();
      c.restore(); continue;
    }
    c.save(); c.globalCompositeOperation = "lighter"; c.globalAlpha = Math.min(1, t * 1.5);
    c.fillStyle = p.color;
    if (p.kind === "confetti") {
      c.translate(p.x, p.y); c.rotate(p.age * p.spin);
      c.fillRect(-p.r, -p.r * 0.55, p.r * 2, p.r * 1.1);
    } else {
      c.beginPath(); c.arc(p.x, p.y, p.r * (0.4 + t * 0.9), 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
const BOMB_SFX_COLORS = ["#fff3c8", "#ffc46b", "#ff9d3c", "#ff5722"];
const BOMB_OK_COLORS = ["#9dffbc", "#3ce07f", "#8fd3ff", "#ffd76a", "#ffffff"];
function bombExplode(x, y) {
  if (bombQuiet()) return;
  bombFxResize();
  bombFxAdd({ kind: "ring", x, y, vx: 0, vy: 0, r: 18, life: 0.5, age: 0, color: "#ffd08a" });
  for (let i = 0; i < 46; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(90, 420);
    bombFxAdd({ kind: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, r: rand(2, 5), life: rand(0.35, 0.8), age: 0, color: pick(BOMB_SFX_COLORS), grav: 520, drag: 0.965 });
  }
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(20, 90);
    bombFxAdd({ kind: "smoke", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, r: rand(18, 40), life: rand(0.7, 1.3), age: 0, color: "rgba(72,84,104,.85)", drag: 0.95 });
  }
  bombShakeScreen();
  bombFlash("rgba(255,236,200,.9)");
}
function bombCelebrate(x, y) {
  if (bombQuiet()) return;
  bombFxResize();
  for (let i = 0; i < 26; i++) {
    const a = rand(Math.PI * 0.75, Math.PI * 1.25), sp = rand(140, 340);
    bombFxAdd({ kind: "confetti", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(3, 6), life: rand(0.7, 1.1), age: 0, color: pick(BOMB_OK_COLORS), grav: 620, drag: 0.99, spin: rand(-8, 8) });
  }
}
function bombFuseTrail(x, y, dt) {
  bombFx.fuseAcc += dt;
  const every = 0.055;
  const n = Math.min(3, Math.floor(bombFx.fuseAcc / every));
  bombFx.fuseAcc -= n * every;
  for (let i = 0; i < n; i++) {
    bombFxAdd({ kind: "spark", x: x + rand(-4, 4), y: y + rand(-3, 2), vx: rand(-26, 26), vy: rand(-42, -8), r: rand(1.4, 2.6), life: rand(0.25, 0.5), age: 0, color: pick(BOMB_SFX_COLORS), grav: 90, drag: 0.94 });
  }
}
let bombShakeTimer = 0, bombFlashTimer = 0;
function bombShakeScreen() {
  const el = $("bomb");
  el.classList.remove("bomb-shake");
  void el.offsetWidth;
  el.classList.add("bomb-shake");
  clearTimeout(bombShakeTimer);
  bombShakeTimer = setTimeout(() => el.classList.remove("bomb-shake"), 560);
}
function bombFlash(color) {
  const el = $("bombFlash");
  el.style.setProperty("--flash-color", color);
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(bombFlashTimer);
  bombFlashTimer = setTimeout(() => el.classList.remove("show"), 640);
}
// ตำแหน่งปะทุ (พิกัด viewport) — ใช้ตัวระเบิดจริงถ้ายังมองเห็น ไม่งั้นใช้ตำแหน่งที่จำไว้
function bombBlastPoint() {
  const r = $("bombBody").getBoundingClientRect();
  if (bombGame?.phase === "falling" && r.width) return { x: r.left + r.width / 2, y: r.top + Math.min(24, r.height * 0.25) };
  const s = bombGame;
  if (s && s.lastBombPos) return s.lastBombPos;
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
// ธีมท้องฟ้า + ป้าย "ระดับใหม่"
function applyBombSky(tier) {
  const s = bombGame;
  const t = Math.max(0, Math.min(BOMB_SKY.length - 1, tier));
  if (s && s.skyTier === t) return;
  const sky = BOMB_SKY[t], arena = $("bombArena");
  arena.style.setProperty("--sky-1", sky.sky1);
  arena.style.setProperty("--sky-2", sky.sky2);
  arena.style.setProperty("--sky-3", sky.sky3);
  arena.style.setProperty("--hills-far", sky.far);
  arena.style.setProperty("--hills-near", sky.near);
  arena.classList.toggle("bomb-night", sky.night);
  if (s) {
    const prev = s.skyTier;
    s.skyTier = t;
    if (prev !== undefined && prev >= 0 && t > prev) showBombTierBanner(t);
  }
}
function showBombTierBanner(tier) {
  const el = $("bombTierBanner");
  el.textContent = `⚡ ระดับ ${tier + 1} • ระเบิดเร็วขึ้น!`;
  el.hidden = false;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(showBombTierBanner.t);
  showBombTierBanner.t = setTimeout(() => { el.classList.remove("show"); el.hidden = true; }, 1900);
}

function bombVocabulary(level) {
  const unique = new Map();
  for (const entry of getVocabPool(level) || []) {
    const chinese = entry[0].split(/[｜|]/)[0].replace(/[^\p{Script=Han}]/gu, "");
    const pinyin = entry[1].split(/[｜|]/)[0].replace(/[()（）…]/g, "").replace(/\s+/g, " ").trim();
    if (chinese && pinyin && !unique.has(chinese)) unique.set(chinese, [chinese, pinyin, entry[2]]);
  }
  return [...unique.values()];
}

function loadBombLibrary() {
  if (window.HanziWriter) return Promise.resolve();
  if (bombLibraryPromise) return bombLibraryPromise;
  bombLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      bombLibraryPromise = null;
      reject(new Error("โหลดระบบตรวจลายมือไม่สำเร็จ"));
    };
    const timer = setTimeout(fail, 15000);
    script.src = window.CR_OFFLINE_APP
      ? "vendor3/hanzi-writer.min.js"
      : "https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js";
    if (!window.CR_OFFLINE_APP) {
      script.integrity = "sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2";
      script.crossOrigin = "anonymous";
    }
    script.onload = () => { clearTimeout(timer); window.HanziWriter ? resolve() : fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return bombLibraryPromise;
}

function showBombView(view) {
  for (const id of ["bombArena", "bombWriting", "bombLoading", "bombFeedback"]) $(id).hidden = id !== view;
}

function updateBombHUD() {
  const s = bombGame;
  if (!s) return;
  const scoreEl = $("bombScore");
  scoreEl.textContent = `${s.score} คะแนน`;
  if (s.hudScore !== undefined && s.score > s.hudScore) {
    scoreEl.classList.remove("pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("pop");
  }
  s.hudScore = s.score;
  const livesEl = $("bombLives");
  livesEl.textContent = `ชีวิต ${s.lives} / 3 ${"💣".repeat(Math.max(0, s.lives))}`;
  if (s.hudLives !== undefined && s.lives < s.hudLives) {
    livesEl.classList.remove("lost");
    void livesEl.offsetWidth;
    livesEl.classList.add("lost");
  }
  s.hudLives = s.lives;
  $("bombPace").textContent = `${BOMB_DIFF[s.difficulty]?.label ?? "ปานกลาง"} • ความเร็ว ${bombTier(s) + 1} • ปลดแล้ว ${s.defused} ลูก`;
  $("bombProg").textContent = progPct(s.done.size, s.words.length);
  $("bombCombo").textContent = s.perfectStreak >= 2 ? `🔥 เขียนไม่ผิดติดกัน ${s.perfectStreak} ตัว` : "";
  applyBombSky(bombTier(s));
}

function startBombGame(level, diff = difficulty) {
  stopBombGame();
  currentLevel = level;
  lastStarter = () => startBombGame(level, diff);
  const words = bombVocabulary(level);
  $("bombFx").style.display = "";
  bombGame = { level, difficulty: diff, words, deck: [], lastWord: null, word: null, phase: "loading", score: 0,
    lives: 3, defused: 0, bonuses: 0, elapsed: 0, charIndex: 0, paused: false,
    frame: 0, lastTime: performance.now(), request: 0, controller: null,
    perfectStreak: 0, charHadMistake: false, lastBombPos: null, fuseWorld: null, skyTier: -1, hudScore: 0, hudLives: 3,
    done: new Set() };
  $("bomb").classList.remove("bomb-paused", "bomb-shake");
  $("bombPauseOverlay").classList.remove("show");
  $("bombArena").classList.remove("bomb-alarm");
  $("bombArena").style.setProperty("--bomb-danger", "0");
  $("bombTierBanner").hidden = true;
  $("bombTierBanner").classList.remove("show");
  $("bombCombo").textContent = "";
  bombFxResize();
  bombFxClear();
  $("bombFlash").classList.remove("show");
  $("bombOutlinePlay").checked = $("bombOutlineSetup").checked;
  $("bombLevel").textContent = `${levelDisplayName(level)} • ${BOMB_DIFF[diff].label} • ${words.length} คำ • ไม่ซ้ำจนกว่าจะครบชุด`;
  $("bombMuteBtn").textContent = muted ? "เปิดเสียง" : "ปิดเสียง";
  $("bombMuteBtn").setAttribute("aria-pressed", String(muted));
  switchScreen($("bomb"));
  music.start("bomb");
  updateBombHUD();
  nextBombWord();
  const s = bombGame;
  s.frame = requestAnimationFrame((now) => bombLoop(now, s));
}

function nextBombWord() {
  const s = bombGame;
  if (!s || s.paused) return;
  $("bombFlash").classList.remove("show");
  if (!s.deck.length) {
    s.deck = shuffle(s.words.slice());
    if (s.deck.length > 1 && s.deck[s.deck.length - 1][0] === s.lastWord) {
      [s.deck[0], s.deck[s.deck.length - 1]] = [s.deck[s.deck.length - 1], s.deck[0]];
    }
  }
  s.word = s.deck.pop();
  if (!s.word) { quitBombGame(); return; }
  s.lastWord = s.word[0];
  s.chars = [...s.word[0]];
  s.charIndex = 0;
  s.bonus = false;
  s.pendingComplete = false;
  $("bombArena").classList.remove("bomb-alarm");
  $("bombArena").style.setProperty("--bomb-danger", "0");
  prepareBombWord();
}

async function prepareBombWord() {
  const s = bombGame;
  if (!s || s.paused) return;
  const request = ++s.request;
  s.controller?.abort();
  const controller = new AbortController();
  s.controller = controller;
  s.phase = "loading";
  showBombView("bombLoading");
  $("bombLoadTitle").textContent = "เตรียมระเบิด...";
  $("bombLoadText").textContent = "กำลังโหลดข้อมูลเส้นอักษร ไม่หักเวลาและชีวิต";
  $("bombLoadActions").hidden = true;
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    await Promise.all([loadBombLibrary(), ...[...new Set(s.chars)].map(async (char) => {
      if (bombCharData.has(char)) return;
      const dataUrl = window.CR_OFFLINE_APP
        ? `vendor3/hanzi-writer-data/${encodeURIComponent(char)}.json`
        : `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`;
      const response = await fetch(dataUrl, { signal: controller.signal });
      if (!response.ok) throw new Error("ไม่พบข้อมูลเส้นอักษร");
      const data = await response.json();
      if (!data.strokes?.length || data.strokes.length !== data.medians?.length) throw new Error("ข้อมูลเส้นอักษรไม่สมบูรณ์");
      bombCharData.set(char, data);
    })]);
    if (bombGame !== s || s.request !== request) return;
    const seen = new Set([bombPinyinKey(s.word[1])]);
    const choices = [s.word[1]];
    for (const w of shuffle(s.words.slice())) {
      const key = bombPinyinKey(w[1]);
      if (!seen.has(key)) { choices.push(w[1]); seen.add(key); }
      if (choices.length === 3) break;
    }
    if (choices.length !== 3) throw new Error("ตัวเลือกพินอินไม่เพียงพอ");
    $("bombWord").textContent = s.word[0];
    $("bombOptions").replaceChildren();
    for (const text of shuffle(choices)) {
      const button = document.createElement("button");
      button.className = "bomb-option";
      button.textContent = text;
      button.addEventListener("click", () => answerBomb(text));
      $("bombOptions").appendChild(button);
    }
    s.fallDuration = bombFallSeconds(s);
    s.remaining = s.fallDuration;
    s.phase = "falling";
    s.lastTime = performance.now();
    $("bombDrop").hidden = false;
    showBombView("bombArena");
    renderBombFall();
    updateBombHUD();
  } catch (error) {
    if (bombGame !== s || s.request !== request) return;
    controller.abort();
    s.phase = "error";
    $("bombLoadTitle").textContent = "โหลดข้อมูลฝึกเขียนไม่สำเร็จ";
    $("bombLoadText").textContent = "ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง หรือข้ามคำนี้หากไม่มีข้อมูลเส้นอักษร โดยไม่เสียชีวิต";
    $("bombLoadActions").hidden = false;
  } finally {
    clearTimeout(timer);
  }
}

function renderBombFall() {
  const s = bombGame;
  if (!s || s.phase !== "falling") return;
  const arena = $("bombArena");
  const distance = Math.max(0, arena.clientHeight - 48 - 78 - $("bombDrop").offsetHeight);
  const prog = 1 - Math.max(0, s.remaining) / s.fallDuration;
  const y = distance * prog;
  $("bombDrop").style.transform = `translate(-50%, ${y}px)`;
  // โซนอันตราย + สัญญาณเตือน: ยิ่งใกล้พื้นยิ่งแดง/สั่น
  const danger = Math.min(1, Math.max(0, (prog - 0.7) / 0.3));
  arena.style.setProperty("--bomb-danger", danger.toFixed(2));
  arena.classList.toggle("bomb-alarm", danger > 0.3);
  const r = $("bombDrop").getBoundingClientRect();
  const fp = { x: r.left + r.width / 2, y: r.top + Math.min(24, r.height * 0.25) };
  s.lastBombPos = fp;
  const tube = bombFx.canvas.getBoundingClientRect();
  s.fuseWorld = { x: fp.x - tube.left, y: fp.y - tube.top };
}

function answerBomb(pinyin = null) {
  const s = bombGame;
  if (!s || s.paused || s.phase !== "falling") return;
  advanceBomb(performance.now());
  if (s.phase !== "falling") return;
  if (pinyin !== null && bombPinyinKey(pinyin) !== bombPinyinKey(s.word[1])) {
    resolveBomb(false, "เลือกพินอินผิด");
    return;
  }
  s.bonus = pinyin !== null;
  sfx.click();
  beginBombCharacter();
}

function resizeBombWriter() {
  if (!bombWriter || $("bombWriting").hidden) return;
  const size = $("bombWriter").clientWidth;
  if (size) bombWriter.updateDimensions({ width: size, height: size, padding: 16 });
}

async function beginBombCharacter() {
  const s = bombGame;
  if (!s) return;
  const index = s.charIndex;
  pencilSound.stop();
  s.phase = "preparing";
  showBombView("bombWriting");
  $("bombWritingWord").textContent = s.word[0];
  $("bombCharProgress").textContent = `เขียนตัวที่ ${index + 1} / ${s.chars.length} : ${s.chars[index]}`;
  $("bombBonusLabel").textContent = s.bonus ? "รอรับโบนัสพินอิน +50" : "แตะระเบิด: ไม่มีโบนัสพินอิน";
  $("bombCharList").replaceChildren();
  s.chars.forEach((char, i) => {
    const chip = document.createElement("span");
    chip.className = `bomb-char${i < index ? " done" : i === index ? " current" : ""}`;
    chip.textContent = char;
    if (i === index) chip.setAttribute("aria-current", "step");
    chip.addEventListener("click", () => {
      if (i === index) bombWriter?.animateCharacter?.();
    });
    $("bombCharList").appendChild(chip);
  });
  s.charHadMistake = false;
  $("bombFrameFill").style.strokeDashoffset = BOMB_FRAME_PERIMETER;
  $("bombFrameFill").classList.remove("urgent");
  if (!bombWriter) {
    bombWriter = new window.HanziWriter("bombWriter", {
      width: 300, height: 300, padding: 16, showCharacter: false, showOutline: false,
      strokeColor: "#203954", outlineColor: "#cbd2db", drawingColor: "#235a86", drawingWidth: 64,
      highlightColor: "#26a477", highlightOnComplete: false, showHintAfterMisses: BOMB_HINT_AFTER_MISSES,
      strokeHighlightSpeed: 0.7, strokeFadeDuration: 120, charDataLoader: (char) => bombCharData.get(char)
    });
  }
  await bombWriter.setCharacter(s.chars[index]);
  if (bombGame !== s || s.phase !== "preparing" || s.charIndex !== index) return;
  resizeBombWriter();
  syncBombOutline();
  s.writeDuration = bombWriteSeconds(s, bombCharData.get(s.chars[index]).strokes.length);
  s.remaining = s.writeDuration;
  s.lastTime = performance.now();
  s.phase = "writing";
  $("bombStrokeHint").textContent = `เริ่มขีดที่ 1 • ผิดขีดเดิม ${BOMB_HINT_AFTER_MISSES} ครั้ง จะมีเส้นสีเขียวสาธิตวิธีเขียน`;
  renderBombTimer();
  bombWriter.quiz({
    leniency: 1.4,
    markStrokeCorrectAfterMisses: 4,
    onMistake: (data) => {
      s.charHadMistake = true;
      if (bombGame === s && !s.paused && s.phase === "writing" && s.charIndex === index) {
        $("bombStrokeHint").textContent = data.mistakesOnStroke >= BOMB_HINT_AFTER_MISSES
          ? `ดูเส้นสีเขียวสาธิตขีดที่ ${data.strokeNum + 1} แล้วลองเขียนตามทิศทางนั้น • ไม่เสียชีวิต`
          : `ขีดที่ ${data.strokeNum + 1} ยังไม่ถูก ลองใหม่ได้ • ผิดซ้ำจะมีเส้นสีเขียวช่วยบอก • ไม่เสียชีวิต`;
      }
    },
    onCorrectStroke: (data) => {
      if (bombGame === s && !s.paused && s.phase === "writing" && s.charIndex === index) {
        $("bombStrokeHint").textContent = data.strokesRemaining
          ? `ถูกต้อง! ต่อไปเขียนขีดที่ ${data.strokeNum + 2} • เหลือ ${data.strokesRemaining} ขีด`
          : "ถูกต้อง! เขียนครบทุกขีดแล้ว";
      }
    },
    onComplete: () => {
      if (bombGame !== s || s.phase !== "writing" || s.charIndex !== index) return;
      if (s.paused) { s.pendingComplete = true; return; }
      completeBombCharacter();
    }
  });
}

function completeBombCharacter() {
  const s = bombGame;
  if (!s || s.paused || s.phase !== "writing") return;
  advanceBomb(performance.now());
  if (s.phase !== "writing") return;
  s.pendingComplete = false;
  if (s.charHadMistake) s.perfectStreak = 0;
  else s.perfectStreak++;
  if (s.charIndex + 1 === s.chars.length) {
    speakWordHit(s.word);
  } else {
    speak(s.chars[s.charIndex]);
  }
  s.charIndex++;
  if (s.charIndex === s.chars.length) resolveBomb(true);
  else { sfx.hit(); beginBombCharacter(); }
}

function syncBombOutline() {
  if (!bombWriter) return;
  if ($("bombOutlinePlay").checked) bombWriter.showOutline({ duration: 0 });
  else bombWriter.hideOutline({ duration: 0 });
}

function renderBombTimer() {
  const s = bombGame;
  $("bombWriteTimer").textContent = `${Math.max(0, s.remaining).toFixed(1)} วิ`;
  const urgent = s.remaining <= 5;
  $("bombWriteTimer").classList.toggle("urgent", urgent);
  $("bombTimeBar").value = Math.max(0, s.remaining) / s.writeDuration;
  const frac = Math.max(0, Math.min(1, s.remaining / s.writeDuration));
  const frame = $("bombFrameFill");
  frame.style.strokeDashoffset = BOMB_FRAME_PERIMETER * (1 - frac);
  frame.classList.toggle("urgent", urgent);
  music.setIntensity(1 - frac); // ยิ่งใกล้หมดเวลา ดนตรียิ่งเข้มข้น (adaptive)
}

function resolveBomb(success, reason = "") {
  const s = bombGame;
  if (!s || s.paused || !["falling", "writing"].includes(s.phase)) return;
  s.phase = "feedback";
  s.remaining = 3.5;
  pencilSound.stop();
  bombWriter?.cancelQuiz();
  if (success) {
    s.score += 100 + (s.bonus ? 50 : 0);
    s.defused++;
    s.done.add(s.word[0]);
    if (s.bonus) s.bonuses++;
    sfx.hit();
    const fr = $("bombFeedback").getBoundingClientRect();
    bombCelebrate(fr.width ? fr.left + fr.width / 2 : window.innerWidth / 2, fr.height ? fr.top + 42 : window.innerHeight * 0.3);
  } else {
    s.lives--;
    sfx.bombBlast();
    const p = bombBlastPoint();
    bombExplode(p.x, p.y);
  }
  $("bombFeedback").className = `bomb-message ${success ? "success" : "failure"}`;
  $("bombResultTitle").textContent = success ? "ปลดระเบิดสำเร็จ!" : `ระเบิดแล้ว! ${reason}`;
  $("bombRevealWord").textContent = s.word[0];
  $("bombRevealPinyin").textContent = s.word[1];
  $("bombRevealThai").textContent = s.word[2];
  $("bombResultDetail").textContent = success
    ? `+100 คะแนน${s.bonus ? " +50 โบนัสพินอิน" : " • ไม่มีโบนัสพินอิน"} • เตรียมรับลูกถัดไป`
    : `เสีย 1 ชีวิต • เหลือ ${s.lives} / 3${s.lives ? " • ลองคำใหม่กัน" : " • เกมจบ"}`;
  $("bombNextBtn").textContent = s.lives ? "ลูกถัดไป" : "ดูผลคะแนน";
  showBombView("bombFeedback");
  $("bombNextBtn").focus({ preventScroll: true });
  updateBombHUD();
}

function advanceBomb(now) {
  const s = bombGame;
  if (!s) return;
  const dt = Math.max(0, (now - s.lastTime) / 1000);
  s.lastTime = now;
  if (s.paused || !["falling", "writing", "feedback"].includes(s.phase)) return;
  if (s.phase !== "feedback") s.elapsed += dt;
  s.remaining -= dt;
  if (s.phase === "falling") {
    renderBombFall();
    if (!bombQuiet() && s.fuseWorld) bombFuseTrail(s.fuseWorld.x, s.fuseWorld.y, dt);
  }
  if (s.phase === "writing") renderBombTimer();
  bombFxUpdate(dt);
  if (s.remaining > 0) return;
  if (s.phase === "feedback") continueBombGame();
  else resolveBomb(false, s.phase === "falling" ? "ตกถึงพื้น" : "เขียนไม่ทันเวลา");
}

function bombLoop(now, session) {
  if (bombGame !== session) return;
  advanceBomb(now);
  if (bombGame === session) session.frame = requestAnimationFrame((t) => bombLoop(t, session));
}

function continueBombGame() {
  const s = bombGame;
  if (!s || s.paused || s.phase !== "feedback") return;
  if (s.lives > 0) { nextBombWord(); return; }
  stopBombGame();
  sfx.over();
  showGameOver("จบเกมเขียนปลดระเบิด", s.score,
    `${levelDisplayName(s.level)} • ปลดระเบิด ${s.defused} ลูก • โบนัสพินอิน ${s.bonuses} ครั้ง`, bombBestKey(s.level, s.difficulty));
}

function pauseBombGame() {
  const s = bombGame;
  if (!s || s.paused) return;
  advanceBomb(performance.now());
  if (bombGame !== s) return;
  s.paused = true;
  pencilSound.stop();
  music.stop();
  $("bomb").classList.add("bomb-paused");
  $("bombPauseOverlay").classList.add("show");
  stopSpeech();
  $("bombResumeBtn").focus();
}

function resumeBombGame() {
  const s = bombGame;
  if (!s || !s.paused) return;
  s.paused = false;
  s.lastTime = performance.now();
  $("bomb").classList.remove("bomb-paused");
  $("bombPauseOverlay").classList.remove("show");
  music.start("bomb");
  $("bombPauseBtn").focus();
  if (s.pendingComplete) completeBombCharacter();
}

function stopBombGame() {
  if (bombGame) {
    cancelAnimationFrame(bombGame.frame);
    bombGame.controller?.abort();
  }
  pencilSound.stop();
  bombWriter?.cancelQuiz();
  bombGame = null;
  bombFxClear();
  $("bombFlash").classList.remove("show");
  $("bomb").classList.remove("bomb-shake");
  $("bombArena").classList.remove("bomb-alarm");
  $("bombArena").style.setProperty("--bomb-danger", "0");
  $("bombTierBanner").hidden = true;
  clearTimeout(showBombTierBanner.t);
  music.stop();
  stopSpeech();
}

function quitBombGame() {
  if (!bombGame) return;
  saveBest(bombBestKey(bombGame.level, bombGame.difficulty), bombGame.score);
  stopBombGame();
  switchScreen(menuEl);
  updateBestLine();
}

$("bombBody").addEventListener("click", () => answerBomb());
$("bombRetryBtn").addEventListener("click", () => { if (bombGame?.phase === "error") prepareBombWord(); });
$("bombSkipBtn").addEventListener("click", () => { if (bombGame?.phase === "error") nextBombWord(); });
$("bombNextBtn").addEventListener("click", continueBombGame);
$("bombPauseBtn").addEventListener("click", pauseBombGame);
$("bombResumeBtn").addEventListener("click", resumeBombGame);
$("bombQuitBtn").addEventListener("click", quitBombGame);
$("bombPauseQuitBtn").addEventListener("click", quitBombGame);
$("bombMuteBtn").addEventListener("click", toggleMute);
$("bombOutlineSetup").addEventListener("change", () => {
  $("bombOutlinePlay").checked = $("bombOutlineSetup").checked;
  syncBombOutline();
});
$("bombOutlinePlay").addEventListener("change", () => {
  $("bombOutlineSetup").checked = $("bombOutlinePlay").checked;
  syncBombOutline();
});
$("bombWriter").addEventListener("pointerdown", (e) => pencilSound.start(e));
$("bombWriter").addEventListener("pointermove", (e) => pencilSound.move(e));
const stopPencilPointer = (e) => { if (e.pointerId === pencilSound.pointerId) pencilSound.stop(); };
$("bombWriter").addEventListener("pointerleave", stopPencilPointer);
$("cpWriteWriter").addEventListener("pointerdown", (e) => pencilSound.start(e));
$("cpWriteWriter").addEventListener("pointermove", (e) => pencilSound.move(e));
$("cpWriteWriter").addEventListener("pointerleave", stopPencilPointer);
document.addEventListener("pointerup", stopPencilPointer, true);
document.addEventListener("pointercancel", stopPencilPointer, true);
window.addEventListener("blur", () => pencilSound.stop());
new ResizeObserver(resizeBombWriter).observe($("bombWriter"));
window.addEventListener("resize", renderBombFall);
window.addEventListener("resize", bombFxResize);

let selectedLevel = null;
const MODE_TITLES = { meteor: "☄️ เกมยิงอุกกาบาต", vocab: "📖 เกมคำศัพท์", sentence: "🧩 เกมเรียงประโยค", sentencequiz: "💬 เกมทายประโยค", zombie: "🧟 เกมยิงซอมบี้", fillblank: "✏️ เกมเติมคำในประโยค" };
MODE_TITLES.matching = "เกมแฟลชการ์ดจับคู่";
MODE_TITLES.bomb = "เกมเขียนปลดระเบิด";
MODE_TITLES.dict = "📚 พจนานุกรมจีน";
MODE_TITLES.speak = "🎤 เกมฝึกพูด";
MODE_TITLES.listen = "🎧 เกมฝึกฟัง";
MODE_TITLES.copy = "✍️ เกมเขียนเป็นประโยค";
MODE_TITLES.trace = "✍️ เกมคัดลายมือ";
MODE_TITLES.podcast = "🎙️ ฟังพอดแคสต์จีน";
const bestKey = () => gameMode === "bomb"
  ? bombBestKey(selectedLevel, difficulty)
  : gameMode === "matching"
  ? matchingBestKey(selectedLevel, difficulty, quizMode, zDuration)
  : gameMode === "vocab"
  ? `cr_best_${catPrefix()}${selectedLevel}_quiz_${quizMode}`
  : gameMode === "sentence"
    ? `cr_best_${catPrefix()}${selectedLevel}_sent`
    : gameMode === "sentencequiz"
      ? `cr_best_${catPrefix()}${selectedLevel}_sentencequiz_${sentQuizDirection}`
    : gameMode === "fillblank"
      ? `cr_best_${catPrefix()}${selectedLevel}_fill`
      : gameMode === "zombie"
      ? `cr_best_${catPrefix()}${selectedLevel}_zombie_${difficulty}_${zDuration}`
      : gameMode === "speak"
        ? `cr_best_${catPrefix()}${selectedLevel}_speak`
        : gameMode === "trace"
          ? `cr_best_${catPrefix()}${selectedLevel}_trace`
          : `cr_best_${catPrefix()}${selectedLevel}_${difficulty}`;

const startLabel = () => {
  const lvl = levelDisplayName(selectedLevel);
  if (gameMode === "bomb") return `เริ่มเขียนปลดระเบิด ${lvl} (${BOMB_DIFF[difficulty].label})`;
  if (gameMode === "matching") return `เริ่ม ${lvl} (${MATCH_DIFF[difficulty].label}, ${matchModeLabel(quizMode)}, ${matchTimeLabel(zDuration)})`;
  if (gameMode === "vocab") return `🚀 เริ่ม ${lvl} (${quizMode === "pinyin" ? "เลือกพินอิน" : "เลือกคำแปลไทย"}, Endless)`;
  if (gameMode === "sentence") return `🚀 เริ่ม ${lvl} (เกมเรียงประโยค, Endless)`;
  if (gameMode === "sentencequiz") return `💬 เริ่ม ${lvl} (${sentQuizDirection === "zh" ? "จีน → ไทย" : "ไทย → จีน"}, ${sentQuizShowPinyin ? "มีพินอิน" : "ไม่มีพินอิน"}, ${quizLivesOn ? "3 ชีวิต" : "ไม่จำกัดชีวิต"})`;
  if (gameMode === "fillblank") return `🚀 เริ่ม ${lvl} (เกมเติมคำในประโยค, ${quizLivesOn ? "3 ชีวิต" : "ไม่จำกัดชีวิต"})`;
  if (gameMode === "zombie") return `🔫 เริ่ม ${lvl} (${DIFF[difficulty].label}, ${zDurLabel()})`;
  if (gameMode === "speak") return `🎤 เริ่มฝึกพูด ${lvl} (${quizLivesOn ? "3 ชีวิต" : "ไม่จำกัดชีวิต"})`;
  if (gameMode === "listen") return `🎧 เริ่มฝึกฟัง ${lvl} (${lisType === "sent" ? "ประโยค" : "คำศัพท์"}, ห่าง ${lisGap} วิ)`;
  if (gameMode === "copy") return `✍️ เริ่มฝึกเขียนประโยค ${lvl}`;
  if (gameMode === "trace") return `✍️ เริ่มคัดลายมือ ${lvl} (${tcSlots} ช่อง ไม่ซ้ำจนครบกอง)`;
  return `🚀 เริ่มเกม ${lvl} (${DIFF[difficulty].label})`;
};

function updateStartBtn() {
  if (!gameMode) return;
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
  const noSent = (gameMode === "copy" || (gameMode === "listen" && lisType === "sent") || gameMode === "sentence" || gameMode === "sentencequiz" || gameMode === "fillblank" || gameMode === "speak")
    && !hasSentenceData;
  $("startBtn").disabled = !selectedLevel || noSent;
  $("startBtn").textContent = noSent
    ? "⚠️ ยังไม่มีข้อมูลประโยค"
    : selectedLevel ? startLabel() : (currentCategory === "hsk" ? "เลือกระดับ HSK เพื่อเริ่ม" : "เลือกหมวดย่อยเพื่อเริ่ม");
  updateBestLine();
}
function updateBestLine() {
  if (!gameMode) { $("bestScoreLine").textContent = ""; return; }
  if (gameMode === "listen") { $("bestScoreLine").textContent = "🔁 เล่นวนไม่จำกัด สุ่มไม่ซ้ำจนครบกอง — ไม่มีคะแนน"; return; }
  if (gameMode === "copy") { $("bestScoreLine").textContent = "✍️ คัดลงประโยคลงสมุด สุ่มไม่ซ้ำจนครบกอง — ไม่มีคะแนน"; return; }
  if (!selectedLevel) { $("bestScoreLine").textContent = ""; return; }
  const best = +localStorage.getItem(bestKey()) || 0;
  $("bestScoreLine").textContent = best ? `สถิติ ${levelDisplayName(selectedLevel)}: ${best} คะแนน` : "";
}

