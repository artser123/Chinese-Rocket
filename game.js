"use strict";

/* ================= State & DOM ================= */
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const menuEl = $("menu"), gameEl = $("game"), overEl = $("gameover");
const rocketBar = $("rocketBar");
const optBtns = Array.from(rocketBar.querySelectorAll(".rocket-opt"));

let W = 0, H = 0, DPR = 1;
let running = false, paused = false;
let meteors = [], missiles = [], particles = [], stars = [], rings = [], floaters = [];
let shakeT = 0;
let options = [];              // 4 words on rocket buttons
let lives = 3, score = 0, destroyed = 0, combo = 0;
let spawnTimer = 0, nextSpawn = 2.2;
let pool = [];                 // vocab pool for selected level
let currentLevel = null;
let stunUntil = 0;
let lastTime = 0;
let difficulty = "medium";
let gameMode = null;        // 'meteor' | 'vocab'
let quizMode = "pinyin";    // 'pinyin' | 'thai'
let quizLivesOn = true;     // พลังชีวิต: 3 ชีวิต หรือไม่จำกัด
let autoNext = true;        // เปลี่ยนคำถัดไปอัตโนมัติเมื่อตอบถูก
let quiz = null;
let sent = null;            // sentence-ordering game state
let zb = null;              // zombie shooter game state
let zDuration = 120;        // เวลาเล่นเกมยิงซอมบี้ (วินาที), 0 = ไม่จำกัดเวลา
const zDurLabel = () => zDuration ? `${zDuration} วิ` : "ไม่จำกัดเวลา";
let lastStarter = null;
const SENT_OK = typeof SENTENCES !== "undefined";
const DIFF = {
  easy:   { label: "ง่าย",     base: 10, cap: 35, ramp: 0.8, spawn0: 2.8, spawnDecay: 0.012, spawnMin: 1.5  },
  medium: { label: "ปานกลาง", base: 28, cap: 55, ramp: 1.9, spawn0: 2.4, spawnDecay: 0.025, spawnMin: 0.95 },
  hard:   { label: "ยากมาก",  base: 42, cap: 90, ramp: 3.0, spawn0: 2.0, spawnDecay: 0.040, spawnMin: 0.6  },
};

/* ================= Audio (WebAudio, no assets) ================= */
let AC = null, muted = false;
function beep(freq, dur, type = "square", vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), AC.currentTime + dur);
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}
function noiseBurst(dur, vol, hp, lp) {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    const buf = AC.createBuffer(1, Math.ceil(AC.sampleRate * dur), AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(), g = AC.createGain();
    const f1 = AC.createBiquadFilter(), f2 = AC.createBiquadFilter();
    src.buffer = buf;
    f1.type = "highpass"; f1.frequency.value = hp;
    f2.type = "lowpass"; f2.frequency.value = lp;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    src.connect(f1); f1.connect(f2); f2.connect(g); g.connect(AC.destination);
    src.start(); src.stop(AC.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  shoot:   () => beep(600, 0.12, "square", 0.1, 500),
  gun:     () => { noiseBurst(0.28, 0.5, 300, 6000); beep(150, 0.18, "triangle", 0.35, -110); beep(60, 0.3, "sine", 0.3, -40); },
  misfire: () => { noiseBurst(0.03, 0.25, 2500, 9000); setTimeout(() => noiseBurst(0.025, 0.18, 3000, 9000), 70); },
  groan:   () => beep(110, 0.35, "sawtooth", 0.08, -30),
  boom:    () => { beep(120, 0.3, "sawtooth", 0.16, -80); beep(70, 0.35, "triangle", 0.14, -40); },
  wrong:   () => beep(160, 0.22, "sawtooth", 0.14, -60),
  hit:     () => beep(880, 0.1, "square", 0.1, 300),
  damage:  () => { beep(90, 0.4, "sawtooth", 0.2, -50); beep(55, 0.5, "triangle", 0.18, -30); },
  over:    () => { beep(220, 0.5, "sawtooth", 0.15, -180); setTimeout(() => beep(140, 0.7, "sawtooth", 0.15, -100), 250); },
  click:   () => beep(440, 0.05, "square", 0.06),
};

/* ================= Chinese speech (TTS) ================= */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.85;
    const v = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("zh"));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
if ("speechSynthesis" in window) speechSynthesis.getVoices(); // warm up voice list

/* ================= Background music (WebAudio chiptune) ================= */
const music = {
  playing: false, timer: null, step: 0, nextTime: 0,
  stepDur: 60 / 140 / 4, // 140 BPM, 16th notes
  melody: [0, 3, 7, 10, 12, 10, 7, 3, 7, 10, 12, 15, 12, 10, 7, 3,
           7, 10, 15, 12, 10, 7, 3, 7, 0, 3, 7, 10, 12, 15, 17, 19],
  roots: [0, -4, -2, 0, 0, -2, -4, -2],
  getAC() {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    if (!this.master) {
      this.master = AC.createGain();
      this.master.gain.value = muted ? 0 : 1;
      this.master.connect(AC.destination);
    }
    return AC;
  },
  tone(freq, t, dur, type, vol, slide) {
    if (!freq) return;
    const ac = this.getAC();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  },
  noise(t, dur, vol, hp) {
    const ac = this.getAC();
    if (!this._nbuf) {
      this._nbuf = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
      const d = this._nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
    src.buffer = this._nbuf;
    f.type = "highpass"; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  },
  setMuted(m) {
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.getAC().currentTime, 0.01);
  },
  scheduleStep(s, t) {
    // melody: 16th-note pentatonic lead
    this.tone(440 * Math.pow(2, this.melody[s] / 12), t, this.stepDur * 0.9, "triangle", 0.055);
    // bass on each beat (steps 0,4,8,12)
    if (s % 4 === 0) {
      const root = this.roots[Math.floor(s / 4)];
      this.tone(110 * Math.pow(2, root / 12), t, this.stepDur * 3.4, "sawtooth", 0.09);
    }
    // kick on beats
    if (s % 4 === 0) this.tone(150, t, 0.1, "sine", 0.22, 40);
    // snare on beats 2 & 4
    if (s % 8 === 4) this.noise(t, 0.12, 0.12, 1200);
    // hats on offbeats
    if (s % 4 === 2) this.noise(t, 0.05, 0.05, 6000);
  },
  start() {
    if (this.playing) return;
    this.playing = true;
    const ac = this.getAC();
    this.step = 0;
    this.nextTime = ac.currentTime + 0.1;
    this.timer = setInterval(() => {
      while (this.nextTime < ac.currentTime + 0.15) {
        this.scheduleStep(this.step, this.nextTime);
        this.nextTime += this.stepDur;
        this.step = (this.step + 1) % 32;
      }
    }, 30);
  },
  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
};

/* ================= Helpers ================= */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

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
  pool = VOCAB[String(level)] || VOCAB["1"];
  lastStarter = () => startGame(level);
  meteors = []; missiles = []; particles = []; rings = []; floaters = [];
  shakeT = 0;
  lives = 3; score = 0; destroyed = 0; combo = 0;
  spawnTimer = 0; nextSpawn = 0.5;
  options = [];
  updateHUD();
  refreshOptions();
  renderOptions();
  switchScreen(gameEl);
  running = true; paused = false;
  $("pauseOverlay").classList.remove("show");
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  music.start();
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function switchScreen(el) {
  [menuEl, gameEl, overEl, $("quiz"), $("sent"), $("zombie"), $("matching")].forEach((s) => s.classList.remove("active"));
  el.classList.add("active");
}

function endGame() {
  running = false;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  sfx.over();
  showGameOver("💥 เกมจบ!", score,
    `ทำลายอุกกาบาต ${destroyed} ลูก • HSK ${currentLevel} • ${DIFF[difficulty].label}`,
    `cr_best_hsk${currentLevel}_${difficulty}`);
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

/* ================= Vocab quiz mode ================= */
const quizEl = $("quiz");
const qoptBtns = Array.from(document.querySelectorAll(".qopt"));

function startQuizGame(level) {
  currentLevel = level;
  pool = VOCAB[String(level)] || VOCAB["1"];
  lastStarter = () => startQuizGame(level);
  quiz = { lives: 3, score: 0, answered: false, nextTimer: null,
           reviewQueue: [], sinceReview: 0, wrongThisQ: 0, isReview: false };
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  music.start();
  switchScreen(quizEl);
  updateQuizHUD();
  nextQuizQuestion();
}

function updateQuizHUD() {
  $("quizScore").textContent = quiz.score;
  $("quizLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, quiz.lives)) + "🖤".repeat(Math.max(0, 3 - quiz.lives))
    : "♾️ ไม่จำกัด";
}

function nextQuizQuestion() {
  quiz.answered = false;
  $("quizNextBtn").classList.remove("show");
  quiz.wrongThisQ = 0;
  // คำที่เคยตอบผิดวนกลับมาถามทุกๆ 5 คำ จนกว่าจะตอบถูกในครั้งเดียว
  if (quiz.reviewQueue.length && quiz.sinceReview >= 5) {
    quiz.word = quiz.reviewQueue.shift();
    quiz.sinceReview = 0;
    quiz.isReview = true;
  } else {
    quiz.word = pick(pool);
    quiz.sinceReview++;
    quiz.isReview = false;
    // ถ้าสุ่มเจอคำที่อยู่ในคิวทบทวนอยู่แล้ว ให้ถือว่าเป็นการทบทวนและดึงออกจากคิว
    const qi = quiz.reviewQueue.findIndex((w) => w[0] === quiz.word[0] && w[1] === quiz.word[1]);
    if (qi >= 0) { quiz.reviewQueue.splice(qi, 1); quiz.isReview = true; }
  }
  const attr = quizMode === "pinyin" ? 1 : 2;
  const usedText = new Set([quiz.word[attr]]);
  const opts = [quiz.word];
  let guard = 0;
  while (opts.length < 4 && guard++ < 800) {
    const w = pick(pool);
    if (!usedText.has(w[attr]) && w[0] !== quiz.word[0]) {
      usedText.add(w[attr]);
      opts.push(w);
    }
  }
  quiz.options = shuffle(opts);
  $("quizWord").textContent = quiz.word[0];
  $("quizHint").textContent = (quizMode === "pinyin" ? "เลือกพินอินที่ถูกต้อง" : "เลือกคำแปลภาษาไทยที่ถูกต้อง")
    + (quiz.isReview ? "  🔁 คำทบทวน" : "");
  qoptBtns.forEach((b, i) => {
    const w = quiz.options[i];
    b.className = "qopt";
    b.innerHTML = `<span>${w ? w[attr] : ""}</span><span class="sub"></span>`;
  });
}

function answerQuiz(i) {
  if (!quiz || quiz.answered) return;
  const w = quiz.options[i];
  const btn = qoptBtns[i];
  if (!w || btn.classList.contains("wrong")) return;

  if (w[0] === quiz.word[0] && w[1] === quiz.word[1]) {
    quiz.answered = true;
    quiz.score++;
    // ตอบผิดระหว่างทาง → คำนี้กลับเข้าคิวทบทวน (ถามซ้ำอีกหลังผ่านไป 5 คำ)
    if (quiz.wrongThisQ > 0) quiz.reviewQueue.push(quiz.word);
    btn.classList.add("correct");
    sfx.hit();
    confettiBurst(quizEl, 22);
    speak(w[0].split(/[｜|]/)[0]);
    // reveal the complementary attribute on all 4 boxes so distractors are learned too
    quiz.options.forEach((o, j) => {
      const b = qoptBtns[j];
      b.classList.add("reveal");
      const other = quizMode === "pinyin" ? o[2] : o[1];
      b.querySelector(".sub").textContent = `${o[0]} · ${other}`;
    });
    updateQuizHUD();
    if (autoNext) {
      quiz.nextTimer = setTimeout(() => { if (quiz) nextQuizQuestion(); }, 2000);
    } else {
      $("quizNextBtn").classList.add("show");
    }
  } else {
    btn.classList.add("wrong");
    sfx.wrong();
    quiz.wrongThisQ++;
    if (quizLivesOn) {
      quiz.lives--;
      updateQuizHUD();
      if (quiz.lives <= 0) quizGameOver();
    } else {
      // โหมดไม่จำกัดชีวิต: เปิดเผยคำที่เลือกผิดทันที (คำอื่นยังซ่อนจนกว่าจะตอบถูก)
      btn.querySelector(".sub").textContent = `${w[1]} · ${w[2]}`;
    }
  }
}

function quizGameOver() {
  clearTimeout(quiz && quiz.nextTimer);
  const finalScore = quiz ? quiz.score : 0;
  quiz = null;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  sfx.over();
  const modeLabel = quizMode === "pinyin" ? "เลือกพินอิน" : "เลือกคำแปลไทย";
  showGameOver("📖 จบเกม!", finalScore,
    `HSK ${currentLevel} • ${modeLabel}`,
    `cr_best_hsk${currentLevel}_quiz_${quizMode}`);
}

qoptBtns.forEach((b, i) => b.addEventListener("pointerdown", (e) => { e.preventDefault(); answerQuiz(i); }));

/* ================= Sentence ordering mode (เกมเรียงประโยค) ================= */
function startSentGame(level) {
  if (!SENT_OK || !SENTENCES[String(level)]) return;
  currentLevel = level;
  const list = SENTENCES[String(level)];
  lastStarter = () => startSentGame(level);
  sent = { lives: 3, score: 0, solved: false, nextTimer: null,
           reviewQueue: [], sinceReview: 0, wrongThisQ: 0, isReview: false,
           current: null, pool: [], placed: [] };
  pool = list;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  music.start();
  switchScreen($("sent"));
  updateSentHUD();
  nextSentQuestion();
}

function updateSentHUD() {
  $("sentScore").textContent = sent.score;
  $("sentLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, sent.lives)) + "🖤".repeat(Math.max(0, 3 - sent.lives))
    : "♾️ ไม่จำกัด";
}

function nextSentQuestion() {
  sent.solved = false;
  sent.wrongThisQ = 0;
  $("sentNextBtn").textContent = "ประโยคถัดไป ▶";
  $("sentNextBtn").classList.remove("show");
  $("sentReveal").classList.remove("show");
  // คิวทบทวน: ประโยคที่เคยเรียงผิดวนกลับมาทุกๆ 5 ข้อ จนกว่าจะถูกในครั้งเดียว
  if (sent.reviewQueue.length && sent.sinceReview >= 5) {
    sent.current = sent.reviewQueue.shift();
    sent.sinceReview = 0;
    sent.isReview = true;
  } else {
    sent.current = pick(pool);
    sent.sinceReview++;
    sent.isReview = false;
    const qi = sent.reviewQueue.findIndex((s) => s[0] === sent.current[0]);
    if (qi >= 0) { sent.reviewQueue.splice(qi, 1); sent.isReview = true; }
  }
  const tokens = sent.current[4];
  // unique ids per chip so duplicate tokens still work
  let shuffled;
  do {
    shuffled = shuffle(tokens.map((t, i) => ({ t, id: i })));
  } while (tokens.length > 1 && shuffled.every((c, i) => c.id === i));
  sent.pool = shuffled;
  sent.placed = [];
  $("sentTarget").textContent = (sent.isReview ? "🔁 ทบทวน: " : "") + sent.current[2];
  renderSent();
}

function renderSent() {
  const ans = $("sentAnswer"), poolEl = $("sentPool");
  ans.className = "";
  ans.innerHTML = "";
  poolEl.innerHTML = "";
  const want = sent.current[4];
  const full = sent.placed.length === want.length;
  if (full && sent.solved) ans.classList.add("correct-full");
  if (full && !sent.solved && sent.wrongThisQ > 0) ans.classList.add("wrong-full");
  sent.placed.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c.t;
    if (full) {
      b.classList.add(want[i] === c.t ? "ok" : "bad");
      b.disabled = sent.solved;
    }
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); sentRemove(i); });
    ans.appendChild(b);
  });
  sent.pool.forEach((c) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c.t;
    b.disabled = sent.solved;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); sentAdd(c.id); });
    poolEl.appendChild(b);
  });
}

function sentAdd(id) {
  if (sent.solved) return;
  const i = sent.pool.findIndex((c) => c.id === id);
  if (i < 0) return;
  const chip = sent.pool.splice(i, 1)[0];
  sent.placed.push(chip);
  speak(chip.t);
  renderSent();
  if (sent.placed.length === sent.current[4].length && !sent.solved) checkSentAnswer();
}

function sentRemove(i) {
  if (sent.solved) return;
  sent.pool.push(sent.placed.splice(i, 1)[0]);
  renderSent();
}

function showSentReveal() {
  const rv = $("sentReveal");
  rv.innerHTML = `<div class="r-zh">${sent.current[0]}</div><div class="r-py">${sent.current[1]}</div>` +
    (sent.current[3] ? `<div class="r-focus">📐 จุดไวยากรณ์: ${sent.current[3]}</div>` : "");
  rv.classList.add("show");
}

function checkSentAnswer() {
  const want = sent.current[4];
  const correct = sent.placed.every((c, i) => want[i] === c.t);
  const zh = sent.current[0];
  if (correct) {
    sent.solved = true;
    sent.score++;
    $("sentAnswer").classList.add("correct-full");
    sfx.hit();
    confettiBurst($("sent"), 30);
    speak(zh.trim().split(/[｜|]/)[0]);
    showSentReveal();
    if (sent.wrongThisQ > 0) sent.reviewQueue.push(sent.current);
    updateSentHUD();
    if (autoNext) {
      sent.nextTimer = setTimeout(() => { if (sent) nextSentQuestion(); }, 3000);
    } else {
      $("sentNextBtn").classList.add("show");
    }
  } else {
    sent.wrongThisQ++;
    sent.solved = true;
    sent.placed = want.map((t, id) => ({ t, id }));
    sent.pool = [];
    sent.reviewQueue.push(sent.current);
    sfx.wrong();
    speak(zh.trim().split(/[｜|]/)[0]);
    renderSent();
    showSentReveal();
    if (quizLivesOn) sent.lives--;
    updateSentHUD();
    if (autoNext) {
      sent.nextTimer = setTimeout(() => {
        if (!sent) return;
        if (quizLivesOn && sent.lives <= 0) sentGameOver();
        else nextSentQuestion();
      }, 3000);
    } else {
      $("sentNextBtn").textContent = quizLivesOn && sent.lives <= 0 ? "ดูผลคะแนน ▶" : "ประโยคถัดไป ▶";
      $("sentNextBtn").classList.add("show");
    }
  }
}

function sentGameOver() {
  clearTimeout(sent && sent.nextTimer);
  const finalScore = sent ? sent.score : 0;
  sent = null;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  sfx.over();
  showGameOver("🧩 จบเกม!", finalScore,
    `HSK ${currentLevel} • เกมเรียงประโยค`,
    `cr_best_hsk${currentLevel}_sent`);
}

$("sentNextBtn").addEventListener("click", () => {
  sfx.click();
  $("sentNextBtn").classList.remove("show");
  if (!sent) return;
  if (quizLivesOn && sent.lives <= 0) sentGameOver();
  else nextSentQuestion();
});
$("sentMuteBtn").addEventListener("click", toggleMute);
$("sentQuitBtn").addEventListener("click", () => {
  sfx.click();
  saveBest(`cr_best_hsk${currentLevel}_sent`, sent ? sent.score : 0);
  sent = null;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  switchScreen(menuEl);
  updateBestLine();
});

$("quizMuteBtn").addEventListener("click", toggleMute);
$("quizNextBtn").addEventListener("click", () => {
  sfx.click();
  $("quizNextBtn").classList.remove("show");
  if (quiz) nextQuizQuestion();
});
$("quizQuitBtn").addEventListener("click", () => {
  sfx.click();
  saveBest(`cr_best_hsk${currentLevel}_quiz_${quizMode}`, quiz ? quiz.score : 0);
  quiz = null;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  switchScreen(menuEl);
  updateBestLine();
});

/* ================= Meteors ================= */
function spawnMeteor() {
  if (meteors.length >= maxOnScreen()) return;
  const w = pick(pool);
  ctx.font = `700 16px sans-serif`;
  const tw = Math.max(ctx.measureText(w[1]).width, 28);
  const r = Math.max(26, tw / 2 + 12);
  meteors.push({
    word: w,
    x: rand(r + 6, W - r - 6),
    y: -r - 20,
    r: r,
    verts: Array.from({ length: 9 }, () => rand(0.72, 1.15)),
    speed: fallSpeed() * rand(0.85, 1.2),
    wobble: rand(0, 6.28),
    rot: rand(0, 6.28),
  });
}

function hitGround(m, idx) {
  meteors.splice(idx, 1);
  combo = 0;
  lives--;
  shakeT = 0.45;
  sfx.damage();
  explosion(m.x, groundY() - 6, "#ff5030", 30);
  updateHUD();
  ensurePlayable();
  if (lives <= 0) endGame();
}

/* ================= Options (rocket buttons) ================= */
function refreshOptions() {
  // candidates: words of meteors currently on screen (prefer lowest)
  const onScreen = [...meteors].sort((a, b) => b.y - a.y)
    .map((m) => m.word);
  const chosen = [], usedPinyin = new Set();
  for (const w of onScreen) {
    if (chosen.length >= 4) break;
    if (!usedPinyin.has(w[1])) { chosen.push(w); usedPinyin.add(w[1]); }
  }
  // distractors that do NOT match any active meteor
  const activePinyin = new Set(meteors.map((m) => m.word[1]));
  while (chosen.length < 4) {
    const w = pick(pool);
    if (!activePinyin.has(w[1]) && !usedPinyin.has(w[1])) {
      chosen.push(w); usedPinyin.add(w[1]);
    }
  }
  options = shuffle(chosen);
}

function ensurePlayable() {
  // if no button matches any meteor anymore, regenerate
  const activePinyin = new Set(meteors.map((m) => m.word[1]));
  if (!options.some((w) => activePinyin.has(w[1]))) {
    refreshOptions();
    renderOptions();
  }
}

function renderOptions() {
  optBtns.forEach((btn, i) => {
    const w = options[i];
    btn.textContent = w ? w[0] : "";
    btn.classList.remove("flash-wrong", "flash-right");
  });
}

function fireOption(i) {
  if (!running || paused) return;
  const now = performance.now();
  if (now < stunUntil) return;
  const w = options[i];
  if (!w) return;

  // find lowest meteor with matching pinyin
  let target = -1, ty = -Infinity;
  meteors.forEach((m, idx) => {
    if (m.word[1] === w[1] && m.y > ty) { ty = m.y; target = idx; }
  });

  if (target >= 0) {
    const m = meteors[target];
    meteors.splice(target, 1);
    combo++;
    const heightBonus = Math.round(Math.max(0, (groundY() - m.y) / groundY()) * 10);
    const pts = 10 + heightBonus + Math.min(combo - 1, 5) * 2;
    score += pts;
    sfx.shoot();
    setTimeout(() => sfx.boom(), 160);
    // จุดควบคุมสุ่ม → เส้นทางโค้ง Bézier (ไม่ใช่แนวตรง) แต่ยังพุ่งเข้าเป้าหมายเดิม
    const x1 = baseX(), y1 = baseY() - 40;
    const dx = m.x - x1, dy = m.y - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const off = Math.min(rand(0.3, 0.65) * dist, 220) * (Math.random() < 0.5 ? -1 : 1);
    missiles.push({
      x1, y1, x2: m.x, y2: m.y,
      cx: (x1 + m.x) / 2 + (-dy / dist) * off,
      cy: (y1 + m.y) / 2 + (dx / dist) * off - rand(10, 60),
      t: 0, trail: [], color: "#ffaa33",
    });
    explosion(baseX(), baseY() - 46, "#9fd0ff", 6);   // muzzle flash
    floaters.push({ x: m.x, y: m.y, text: "+" + pts, age: 0, life: 0.9, color: "#ffd76a" });
    showToast(`<span class="toast-zh">${w[0]}</span> <span class="toast-py">${w[1]}</span> = <span class="toast-th">${w[2]}</span>`);
    speak(w[0].split(/[｜|]/)[0]);
    optBtns[i].classList.add("flash-right");
    setTimeout(() => optBtns[i].classList.remove("flash-right"), 250);
    destroyed++;
    updateHUD();
    refreshOptions();
    renderOptions();
  } else {
    combo = 0;
    score = Math.max(0, score - 5);
    stunUntil = now + 450;
    sfx.wrong();
    optBtns[i].classList.add("flash-wrong");
    setTimeout(() => optBtns[i].classList.remove("flash-wrong"), 400);
    const wf = $("wrongFlash");
    wf.classList.remove("hide"); wf.classList.add("show");
    setTimeout(() => { wf.classList.remove("show"); wf.classList.add("hide"); }, 80);
    updateHUD();
  }
}

optBtns.forEach((btn, i) => {
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireOption(i); });
});

/* ================= Effects ================= */
function explosion(x, y, color, n) {
  rings.push({ x, y, r: 10, max: rand(70, 100), age: 0, life: 0.4, color });
  particles.push({ x, y, vx: 0, vy: 0, life: 0.12, age: 0, color: "#ffffff", r: 16 });
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28), sp = rand(40, 240);
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.4, 0.9), age: 0, color, r: rand(1.5, 4),
    });
  }
}

function confettiBurst(container, n = 28) {
  const colors = ["#ffd23c", "#58ff88", "#6a7af0", "#ff6a9d", "#8fd3ff"];
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "confetti";
    const dx = rand(-190, 190);
    p.style.setProperty("--mx", dx * 0.55 + "px");
    p.style.setProperty("--my", rand(-240, -110) + "px");
    p.style.setProperty("--dx", dx + "px");
    p.style.setProperty("--fy", rand(140, 300) + "px");
    p.style.setProperty("--rot", rand(-700, 700) + "deg");
    p.style.setProperty("--dur", rand(0.75, 1.25) + "s");
    p.style.background = pick(colors);
    container.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
}

function showToast(html, id = "toast") {
  const t = $(id);
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 1800);
}

function updateHUD() {
  $("score").textContent = score;
  $("lives").textContent = "❤️".repeat(Math.max(0, lives)) + "🖤".repeat(Math.max(0, 3 - lives));
}

/* ================= Draw ================= */
function drawBackground(dt) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#05081e");
  g.addColorStop(1, "#141b45");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  for (const s of stars) {
    s.tw += dt * 2;
    s.y += (s.spd * dt) / Math.max(H, 1);
    if (s.y > 1.02) { s.y = -0.02; s.x = Math.random(); }
    ctx.globalAlpha = 0.4 + 0.35 * Math.sin(s.tw);
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, s.r, 0, 6.28);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBase() {
  const x = baseX(), y = baseY();
  // ground
  ctx.fillStyle = "#1c2450";
  ctx.fillRect(0, groundY(), W, H - groundY());
  ctx.fillStyle = "#2a346b";
  ctx.fillRect(0, groundY(), W, 4);
  // launch pad
  ctx.fillStyle = "#39478f";
  ctx.beginPath();
  ctx.moveTo(x - 34, groundY()); ctx.lineTo(x + 34, groundY());
  ctx.lineTo(x + 20, y - 14); ctx.lineTo(x - 20, y - 14);
  ctx.closePath(); ctx.fill();
  // engine flame flicker
  const fl = 8 + Math.random() * 10;
  const fg = ctx.createLinearGradient(0, y - 14, 0, y + fl);
  fg.addColorStop(0, "rgba(255,235,150,.95)");
  fg.addColorStop(0.5, "rgba(255,140,40,.7)");
  fg.addColorStop(1, "rgba(255,60,10,0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 14); ctx.lineTo(x, y + fl); ctx.lineTo(x + 5, y - 14);
  ctx.closePath(); ctx.fill();

  // fins
  ctx.fillStyle = "#d84343";
  ctx.beginPath(); ctx.moveTo(x - 9, y - 32); ctx.lineTo(x - 17, y - 16); ctx.lineTo(x - 9, y - 16); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 9, y - 32); ctx.lineTo(x + 17, y - 16); ctx.lineTo(x + 9, y - 16); ctx.closePath(); ctx.fill();

  // body
  const bg = ctx.createLinearGradient(x - 9, 0, x + 9, 0);
  bg.addColorStop(0, "#eef2ff"); bg.addColorStop(1, "#b9c4e0");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x, y - 66);
  ctx.quadraticCurveTo(x + 10, y - 52, x + 9, y - 30);
  ctx.lineTo(x + 9, y - 16); ctx.lineTo(x - 9, y - 16);
  ctx.lineTo(x - 9, y - 30);
  ctx.quadraticCurveTo(x - 10, y - 52, x, y - 66);
  ctx.fill();

  // nose cone
  ctx.fillStyle = "#e04b3a";
  ctx.beginPath();
  ctx.moveTo(x, y - 66);
  ctx.quadraticCurveTo(x + 9, y - 55, x + 9, y - 46);
  ctx.lineTo(x - 9, y - 46);
  ctx.quadraticCurveTo(x - 9, y - 55, x, y - 66);
  ctx.fill();

  // window
  ctx.fillStyle = "#1a2246";
  ctx.beginPath(); ctx.arc(x, y - 36, 6, 0, 6.28); ctx.fill();
  ctx.fillStyle = "#8fd3ff";
  ctx.beginPath(); ctx.arc(x, y - 36, 4, 0, 6.28); ctx.fill();

  // stunned?
  if (performance.now() < stunUntil) {
    ctx.fillStyle = "rgba(255,60,60,.9)";
    ctx.font = "700 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚠", x, y - 78);
  }
}

function drawMeteor(m) {
  // flame trail
  const trail = ctx.createLinearGradient(m.x, m.y - m.r * 2.6, m.x, m.y);
  trail.addColorStop(0, "rgba(255,120,30,0)");
  trail.addColorStop(1, "rgba(255,160,40,.75)");
  ctx.fillStyle = trail;
  ctx.beginPath();
  ctx.moveTo(m.x - m.r * 0.7, m.y);
  ctx.quadraticCurveTo(m.x, m.y - m.r * 3, m.x + m.r * 0.7, m.y);
  ctx.closePath(); ctx.fill();

  // rock
  const rock = ctx.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.2, m.x, m.y, m.r);
  rock.addColorStop(0, "#8a5a3a");
  rock.addColorStop(1, "#4a2c1c");
  ctx.fillStyle = rock;
  ctx.beginPath();
  const n = m.verts.length;
  for (let i = 0; i < n; i++) {
    const a = m.rot + (i / n) * 6.28;
    const rr = m.r * m.verts[i];
    const px = m.x + Math.cos(a) * rr, py = m.y + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // craters
  ctx.fillStyle = "rgba(0,0,0,.25)";
  for (let i = 0; i < 3; i++) {
    const a = m.rot + i * 2.1;
    ctx.beginPath();
    ctx.arc(m.x + Math.cos(a) * m.r * 0.5, m.y + Math.sin(a) * m.r * 0.5, m.r * 0.16, 0, 6.28);
    ctx.fill();
  }
  // pinyin label
  ctx.font = `700 ${Math.max(15, m.r * 0.52)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  ctx.strokeText(m.word[1], m.x, m.y);
  ctx.fillStyle = "#ffe9b0";
  ctx.fillText(m.word[1], m.x, m.y);
}

function drawMissileBody() {
  // engine flame
  const fl = 6 + Math.random() * 5;
  const fg = ctx.createLinearGradient(0, 6, 0, 6 + fl + 4);
  fg.addColorStop(0, "rgba(255,220,120,.95)");
  fg.addColorStop(1, "rgba(255,90,20,0)");
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.moveTo(-2.5, 6); ctx.lineTo(0, 6 + fl); ctx.lineTo(2.5, 6); ctx.closePath(); ctx.fill();
  // body
  ctx.fillStyle = "#e8ecf5";
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.quadraticCurveTo(4, -4, 3, 6); ctx.lineTo(-3, 6);
  ctx.quadraticCurveTo(-4, -4, 0, -9);
  ctx.fill();
  // nose
  ctx.fillStyle = "#ff5040";
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.quadraticCurveTo(3.2, -5, 3.1, -2); ctx.lineTo(-3.1, -2);
  ctx.quadraticCurveTo(-3.2, -5, 0, -9);
  ctx.fill();
  // fins
  ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(-6, 7); ctx.lineTo(-3, 6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(6, 7); ctx.lineTo(3, 6); ctx.closePath(); ctx.fill();
}

function drawMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const ms = missiles[i];
    ms.t += dt * 4.2;
    const t = Math.min(ms.t, 1);
    const e = 1 - Math.pow(1 - t, 1.6);
    const it = 1 - e;
    const x = it * it * ms.x1 + 2 * it * e * ms.cx + e * e * ms.x2;
    const y = it * it * ms.y1 + 2 * it * e * ms.cy + e * e * ms.y2;

    ms.trail.push({ x, y, age: 0 });
    for (const p of ms.trail) p.age += dt;
    ms.trail = ms.trail.filter((p) => p.age < 0.4);

    // smoke trail (การส่วย)
    for (const p of ms.trail) {
      const a = (0.4 - p.age) / 0.4;
      ctx.fillStyle = `rgba(190,200,225,${a * 0.35})`;
      ctx.beginPath(); ctx.arc(p.x + Math.sin(p.age * 30 + x) * 2, p.y, 2.5 + p.age * 22, 0, 6.28); ctx.fill();
    }
    // hot glow near head
    for (const p of ms.trail.slice(-7)) {
      const a = (0.4 - p.age) / 0.4;
      ctx.fillStyle = `rgba(255,170,60,${a * 0.5})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2 + p.age * 6, 0, 6.28); ctx.fill();
    }

    if (ms.t >= 1) {
      explosion(ms.x2, ms.y2, ms.color || "#ffaa33", 42);
      shakeT = Math.max(shakeT, 0.18);
      missiles.splice(i, 1);
      continue;
    }

    // หันหัวจรวดตามทิศเส้นโค้ง (derivative ของ Bézier)
    const vx = 2 * it * (ms.cx - ms.x1) + 2 * e * (ms.x2 - ms.cx);
    const vy = 2 * it * (ms.cy - ms.y1) + 2 * e * (ms.y2 - ms.cy);
    const ang = Math.atan2(vy, vx) + Math.PI / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    drawMissileBody();
    ctx.restore();
  }
}

function drawRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    g.age += dt;
    const t = g.age / g.life;
    if (t >= 1) { rings.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = g.color;
    ctx.lineWidth = Math.max(1, 6 * (1 - t));
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r + (g.max - g.r) * t, 0, 6.28); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(dt) {
  ctx.font = "800 22px 'Noto Sans Thai', sans-serif";
  ctx.textAlign = "center";
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.age += dt;
    const t = f.age / f.life;
    if (t >= 1) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - t * 50);
  }
  ctx.globalAlpha = 1;
}

function drawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 200 * dt;
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ================= Loop ================= */
function loop(t) {
  if (!running) return;
  const dt = Math.min((t - lastTime) / 1000, 0.05);
  lastTime = t;

  if (!paused) {
    spawnTimer += dt;
    const interval = spawnInterval();
    if (spawnTimer >= interval) {
      spawnTimer = 0;
      spawnMeteor();
      ensurePlayable();
    }

    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.y += m.speed * dt;
      m.x += Math.sin((m.wobble += dt * 2)) * 12 * dt;
      m.rot += dt * 0.6;
      if (m.y + m.r * 0.4 >= groundY()) hitGround(m, i);
    }
  }

  drawBackground(dt);
  shakeT = Math.max(0, shakeT - dt);
  const shx = shakeT ? (Math.random() * 2 - 1) * 10 * (shakeT / 0.45) : 0;
  const shy = shakeT ? (Math.random() * 2 - 1) * 8 * (shakeT / 0.45) : 0;
  ctx.save();
  ctx.translate(shx, shy);
  drawBase();
  for (const m of meteors) drawMeteor(m);
  drawMissiles(paused ? 0 : dt);
  drawParticles(paused ? 0 : dt);
  drawRings(paused ? 0 : dt);
  drawFloaters(paused ? 0 : dt);
  ctx.restore();

  requestAnimationFrame(loop);
}

/* ================= Zombie shooter mode (เกมยิงซอมบี้) ================= */
const zcanvas = $("zcanvas");
const zctx = zcanvas.getContext("2d");
const zoptBtns = Array.from(document.querySelectorAll(".zopt"));
// base/ramp/cap = ความเร็วซอมบี้ (px/s) เพิ่มขึ้นตามเวลาที่ผ่านไป, spawn ลดลงตามจำนวนที่ยิงได้
const ZDIFF = {
  easy:   { base: 34, ramp: 0.55, cap: 130, spawn0: 3.2, spawnDecay: 0.045, spawnMin: 1.7 },
  medium: { base: 50, ramp: 1.1,  cap: 190, spawn0: 2.6, spawnDecay: 0.06,  spawnMin: 1.2 },
  hard:   { base: 70, ramp: 1.9,  cap: 270, spawn0: 2.1, spawnDecay: 0.08,  spawnMin: 0.8 },
};
let ZW = 0, ZH = 0;
const zGroundY = () => ($("zombieBar").offsetTop || ZH - 90) - 28;
const zPoliceX = () => Math.max(70, ZW * 0.14);
const zGunTip = () => ({ x: zPoliceX() + 56 - zb.recoil, y: zGroundY() - 75 });
// pre-generate twinkling stars + drifting fog puffs (regenerated on resize)
let zStars = [], zFog = [];
function zRegenAtmosphere() {
  const gy = zGroundY();
  zStars = Array.from({ length: 60 }, () => ({
    x: Math.random() * ZW, y: Math.random() * gy * 0.7,
    r: rand(0.4, 1.6), tw: rand(0, 6.28), sp: rand(1.5, 4),
  }));
  zFog = Array.from({ length: 6 }, () => ({
    x: Math.random() * ZW, y: gy * (0.45 + Math.random() * 0.4),
    r: rand(80, 180), sp: rand(6, 16), a: rand(0.04, 0.1),
  }));
}
function zresize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ZW = window.innerWidth; ZH = window.innerHeight;
  zcanvas.width = Math.floor(ZW * dpr);
  zcanvas.height = Math.floor(ZH * dpr);
  zcanvas.style.width = ZW + "px";
  zcanvas.style.height = ZH + "px";
  zctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  zRegenAtmosphere();
}
window.addEventListener("resize", zresize);
window.addEventListener("orientationchange", () => setTimeout(zresize, 200));
window.addEventListener("resize", () => { if (matching) applyMatchLayout(); });
window.addEventListener("orientationchange", () => { if (matching) setTimeout(applyMatchLayout, 200); });
zresize();

const zombieBestKey = () => `cr_best_hsk${currentLevel}_zombie_${difficulty}_${zDuration}`;
function zSpeed() {
  const d = ZDIFF[difficulty];
  return Math.min(d.base + zb.elapsed * d.ramp, d.cap) * Math.max(0.7, ZW / 800);
}
function zSpawnInterval() {
  const d = ZDIFF[difficulty];
  return Math.max(d.spawnMin, d.spawn0 - zb.kills * d.spawnDecay);
}
const zAlive = () => zb.zombies.filter((z) => !z.dead && !z.hit);
const zFirst = (s) => s.split(/[｜|]/)[0].trim();

function startZombieGame(level) {
  currentLevel = level;
  pool = VOCAB[String(level)] || VOCAB["1"];
  lastStarter = () => startZombieGame(level);
  zresize();
  zb = {
    score: 0, kills: 0, combo: 0, elapsed: 0, timeLeft: zDuration,
    spawnTimer: 0, nextSpawn: 1.0, stunUntil: 0,
    zombies: [], bullets: [], particles: [], floaters: [], options: [],
    walk: 0, scroll: 0, recoil: 0, flash: 0, shake: 0,
    paused: false, ending: false, endTimer: 0, lastTime: performance.now(),
  };
  switchScreen($("zombie"));
  $("zPauseOverlay").classList.remove("show");
  updateZombieHUD();
  refreshZOptions();
  renderZOptions();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  music.start();
  requestAnimationFrame(zloop);
}

function updateZombieHUD() {
  $("zScore").textContent = zb.score;
  $("zKills").textContent = "🧟 " + zb.kills;
  // ไม่จำกัดเวลา → แสดงเวลาที่เล่นไปแล้วแทนการนับถอยหลัง
  const t = zDuration ? Math.max(0, Math.ceil(zb.timeLeft)) : Math.floor(zb.elapsed);
  const el = $("zTimer");
  el.textContent = `${zDuration ? "⏱" : "♾️"} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  el.classList.toggle("urgent", !!zDuration && t <= 10);
}

function spawnZombie() {
  const alive = zAlive();
  if (alive.length >= 4) return;
  // เว้นระยะไม่ให้ซอมบี้ตัวใหม่ซ้อนกับตัวที่เพิ่งออกมา
  if (alive.some((z) => z.x > ZW - 90)) return;
  const usedPinyin = new Set(alive.map((z) => z.word[1]));
  let w = pick(pool), guard = 0;
  while (usedPinyin.has(w[1]) && guard++ < 200) w = pick(pool);
  zb.zombies.push({
    word: w, x: ZW + 40, speed: zSpeed() * rand(0.9, 1.1),
    phase: rand(0, 6.28), hit: false, dead: false, fall: 0,
    scale: rand(0.85, 1.2),
    skin: pick(["#7fc45a", "#6aa84a", "#8fd96b", "#9ec47a"]),
    skinDark: pick(["#4e8f2e", "#3a6a22", "#5a8033"]),
    shirtLight: pick(["#7a5a9a", "#5a3a7a", "#6a4a8a", "#8a6aaa", "#4a5a8a"]),
    shirtDark: pick(["#5a3a7a", "#3a2a5a", "#4a3a6a", "#6a4a8a", "#2a3a6a"]),
  });
}

function refreshZOptions() {
  // ปุ่มพินอิน: ใส่คำของซอมบี้ที่อยู่บนจอก่อน (ตัวที่ใกล้ตำรวจสุดมาก่อน) แล้วเติมตัวหลอก
  const onScreen = zAlive().sort((a, b) => a.x - b.x).map((z) => z.word);
  const chosen = [], used = new Set();
  for (const w of onScreen) {
    if (chosen.length >= 4) break;
    if (!used.has(w[1])) { chosen.push(w); used.add(w[1]); }
  }
  let guard = 0;
  while (chosen.length < 4 && guard++ < 800) {
    const w = pick(pool);
    if (!used.has(w[1])) { chosen.push(w); used.add(w[1]); }
  }
  zb.options = shuffle(chosen);
}

function ensureZPlayable() {
  const active = new Set(zAlive().map((z) => z.word[1]));
  if (active.size && !zb.options.some((w) => active.has(w[1]))) {
    refreshZOptions();
    renderZOptions();
  }
}

function renderZOptions() {
  zoptBtns.forEach((btn, i) => {
    const w = zb.options[i];
    btn.textContent = w ? zFirst(w[1]) : "";
    btn.classList.remove("flash-wrong", "flash-right");
  });
}

function fireZOption(i) {
  if (!zb || zb.paused || zb.ending) return;
  const now = performance.now();
  if (now < zb.stunUntil) return;
  const w = zb.options[i];
  if (!w) return;
  let target = null;
  for (const z of zAlive()) if (z.word[1] === w[1] && (!target || z.x < target.x)) target = z;

  if (target) {
    target.hit = true;
    zb.combo++;
    const distBonus = Math.round(Math.max(0, (target.x - zPoliceX()) / Math.max(ZW, 1)) * 10);
    const pts = 10 + distBonus + Math.min(zb.combo - 1, 5) * 2;
    zb.score += pts;
    zb.kills++;
    zb.recoil = 9; zb.flash = 0.07; zb.shake = 0.18;
    const tip = zGunTip();
    zb.bullets.push({ x: tip.x, y: tip.y, target });
    sfx.gun();
    // gun smoke puffs at muzzle
    for (let i = 0; i < 5; i++) {
      zb.particles.push({ x: tip.x + rand(-4, 4), y: tip.y + rand(-4, 4), vx: rand(40, 120), vy: rand(-30, -5),
                          life: rand(0.5, 1.0), age: 0, r: rand(6, 12), color: "rgba(180,180,180,0.5)", smoke: true, gravity: false });
    }
    // foot dust under zombie
    const gy = zGroundY();
    for (let i = 0; i < 4; i++) {
      zb.particles.push({ x: target.x + rand(-8, 8), y: gy + rand(-2, 2), vx: rand(-30, 30), vy: rand(-30, -10),
                          life: rand(0.3, 0.6), age: 0, r: rand(2, 4), color: "rgba(120,100,80,0.6)", gravity: true });
    }
    zb.floaters.push({ x: target.x, y: zGroundY() - 135, text: "+" + pts, age: 0, life: 0.9 });
    showToast(`<span class="toast-zh">${w[0]}</span> <span class="toast-py">${w[1]}</span> = <span class="toast-th">${w[2]}</span>`, "ztoast");
    speak(zFirst(w[0]));
    zoptBtns[i].classList.add("flash-right");
    setTimeout(() => zoptBtns[i].classList.remove("flash-right"), 250);
    updateZombieHUD();
    refreshZOptions();
    renderZOptions();
  } else {
    // ทายผิด → ปืนยิงไม่ออก (เสียงแช๊ะ) และโดนหักคะแนน
    zb.combo = 0;
    zb.score = Math.max(0, zb.score - 5);
    zb.stunUntil = now + 500;
    sfx.misfire();
    zoptBtns[i].classList.add("flash-wrong");
    setTimeout(() => zoptBtns[i].classList.remove("flash-wrong"), 400);
    const wf = $("zWrongFlash");
    wf.classList.remove("hide"); wf.classList.add("show");
    setTimeout(() => { wf.classList.remove("show"); wf.classList.add("hide"); }, 80);
    updateZombieHUD();
  }
}
zoptBtns.forEach((btn, i) => btn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireZOption(i); }));

function killZombie(z) {
  z.dead = true; z.fall = 0;
  sfx.groan();
  const gy = zGroundY();
  // green blood splatter (more, varied)
  for (let i = 0; i < 26; i++) {
    const a = rand(-2.6, 0.4), sp = rand(80, 280);
    zb.particles.push({ x: z.x, y: gy - 85, vx: Math.cos(a) * sp + 40, vy: Math.sin(a) * sp,
                        life: rand(0.4, 0.9), age: 0, r: rand(2, 5.5), color: pick(["#7fc45a", "#4e8f2e", "#a5ff6b", "#3a6a22"]), gravity: true });
  }
  // red blood splatter
  for (let i = 0; i < 10; i++) {
    const a = rand(-2.6, 0.4), sp = rand(60, 200);
    zb.particles.push({ x: z.x, y: gy - 85, vx: Math.cos(a) * sp + 40, vy: Math.sin(a) * sp,
                        life: rand(0.3, 0.7), age: 0, r: rand(1.5, 3.5), color: pick(["#a01010", "#c01818", "#7a0a0a"]), gravity: true });
  }
  // smoke puff at impact
  for (let i = 0; i < 6; i++) {
    zb.particles.push({ x: z.x + rand(-10, 10), y: gy - 85 + rand(-10, 10), vx: rand(-20, 20), vy: rand(-40, -10),
                        life: rand(0.6, 1.2), age: 0, r: rand(8, 16), color: "rgba(120,120,120,0.5)", smoke: true, gravity: false });
  }
}

function zUpdate(dt) {
  zb.recoil = Math.max(0, zb.recoil - dt * 70);
  zb.flash = Math.max(0, zb.flash - dt);
  zb.shake = Math.max(0, zb.shake - dt);
  if (zb.ending) {
    zb.endTimer -= dt;
    if (zb.endTimer <= 0) zombieGameOver(false);
    return;
  }
  zb.elapsed += dt;
  zb.timeLeft -= dt;
  zb.walk += dt * 7;
  zb.scroll += dt * 70;
  if (zDuration && zb.timeLeft <= 0) { zb.timeLeft = 0; updateZombieHUD(); zombieGameOver(true); return; }

  zb.spawnTimer += dt;
  if (zb.spawnTimer >= zb.nextSpawn) {
    zb.spawnTimer = 0;
    zb.nextSpawn = zSpawnInterval();
    spawnZombie();
    ensureZPlayable();
  }

  const px = zPoliceX();
  const moving = zAlive().sort((a, b) => a.x - b.x);
  moving.forEach((z, i) => {
    z.x -= z.speed * dt;
    z.phase += dt * 6;
    // ซอมบี้ตัวหลังวิ่งเร็วกว่า → ไม่ให้แซงซ้อนตัวหน้า
    if (i > 0) z.x = Math.max(z.x, moving[i - 1].x + 64);
    if (z.x - 30 <= px + 22) {
      zb.ending = true; zb.endTimer = 0.8; zb.shake = 0.5;
      sfx.damage();
      const wf = $("zWrongFlash");
      wf.classList.remove("hide"); wf.classList.add("show");
    }
  });
  for (let i = zb.zombies.length - 1; i >= 0; i--) {
    const z = zb.zombies[i];
    if (z.dead && (z.fall += dt) > 0.7) zb.zombies.splice(i, 1);
  }
  for (let i = zb.bullets.length - 1; i >= 0; i--) {
    const b = zb.bullets[i];
    b.x += 2400 * dt;
    if (b.x >= b.target.x - 10) { killZombie(b.target); zb.bullets.splice(i, 1); }
  }
  for (let i = zb.particles.length - 1; i >= 0; i--) {
    const p = zb.particles[i];
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.gravity) p.vy += 500 * dt;
    if (p.smoke) { p.vx *= 0.96; p.vy *= 0.96; p.r += 8 * dt; }
    if (p.age >= p.life) zb.particles.splice(i, 1);
  }
  for (let i = zb.floaters.length - 1; i >= 0; i--) {
    const f = zb.floaters[i];
    f.age += dt; f.y -= 45 * dt;
    if (f.age >= f.life) zb.floaters.splice(i, 1);
  }
  updateZombieHUD();
}

function zRoundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
  c.fill();
}

function zDrawBackground(c) {
  const gy = zGroundY();
  // sky gradient (deeper, duskier)
  const g = c.createLinearGradient(0, 0, 0, gy);
  g.addColorStop(0, "#05070f"); g.addColorStop(0.55, "#1a1130"); g.addColorStop(1, "#3a1626");
  c.fillStyle = g; c.fillRect(0, 0, ZW, ZH);

  // stars (twinkle)
  for (const s of zStars) {
    s.tw += 0.05;
    c.globalAlpha = 0.5 + Math.sin(s.tw) * 0.4;
    c.fillStyle = "#e8e6ff";
    c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.28); c.fill();
  }
  c.globalAlpha = 1;

  // moon with glow halo
  const mx = ZW * 0.8, my = gy * 0.22;
  const halo = c.createRadialGradient(mx, my, 8, mx, my, 70);
  halo.addColorStop(0, "rgba(243,233,184,0.45)"); halo.addColorStop(1, "rgba(243,233,184,0)");
  c.fillStyle = halo; c.beginPath(); c.arc(mx, my, 70, 0, 6.28); c.fill();
  c.fillStyle = "#f3e9b8"; c.beginPath(); c.arc(mx, my, 26, 0, 6.28); c.fill();
  c.fillStyle = "#e0d6a5"; c.beginPath(); c.arc(mx - 8, my - 6, 5, 0, 6.28); c.arc(mx + 9, my + 8, 4, 0, 6.28); c.fill();

  // far buildings (parallax) — two layers for depth
  const par = zb.scroll * 0.25, off = par % 160;
  for (let x = -off - 160; x < ZW + 160; x += 160) {
    const k = Math.round((x + par) / 160);
    const h = 50 + ((k * 37) % 7) * 16, bw = 110 + ((k * 11) % 3) * 12;
    c.fillStyle = "#11142a"; c.fillRect(x, gy - h, bw, h);
    c.fillStyle = "#c9b458";
    let wi = 0;
    for (let wy = gy - h + 10; wy < gy - 14; wy += 16)
      for (let wx = 0; wx < bw - 20; wx += 18) {
        if (((k * 13 + wi++) % 5) === 0) c.fillRect(x + 10 + wx, wy, 7, 8);
      }
  }
  // near buildings (faster parallax, darker)
  const par2 = zb.scroll * 0.5, off2 = par2 % 220;
  for (let x = -off2 - 220; x < ZW + 220; x += 220) {
    const k = Math.round((x + par2) / 220);
    const h = 80 + ((k * 53) % 5) * 22, bw = 150 + ((k * 17) % 3) * 18;
    c.fillStyle = "#0a0c1a"; c.fillRect(x, gy - h, bw, h);
    c.fillStyle = "#ffd76a";
    let wi = 0;
    for (let wy = gy - h + 14; wy < gy - 18; wy += 20)
      for (let wx = 0; wx < bw - 28; wx += 24) {
        if (((k * 23 + wi++) % 4) === 0) c.fillRect(x + 14 + wx, wy, 8, 10);
      }
  }

  // drifting fog
  for (const f of zFog) {
    f.x -= f.sp * 0.016;
    if (f.x < -f.r) f.x = ZW + f.r;
    const fg = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    fg.addColorStop(0, `rgba(180,180,210,${f.a})`); fg.addColorStop(1, "rgba(180,180,210,0)");
    c.fillStyle = fg; c.beginPath(); c.arc(f.x, f.y, f.r, 0, 6.28); c.fill();
  }

  // fence / grass edge
  c.fillStyle = "#2f4a24"; c.fillRect(0, gy - 6, ZW, 8);
  // road with subtle gradient
  const rg = c.createLinearGradient(0, gy, 0, ZH);
  rg.addColorStop(0, "#1b1f2c"); rg.addColorStop(1, "#0d0f18");
  c.fillStyle = rg; c.fillRect(0, gy, ZW, ZH - gy);
  const off3 = zb.scroll % 90;
  c.fillStyle = "#5a5a40";
  for (let x = -off3; x < ZW; x += 90) c.fillRect(x, gy + 18, 44, 4);

  // vignette (dark edges)
  const vg = c.createRadialGradient(ZW / 2, ZH / 2, Math.min(ZW, ZH) * 0.35, ZW / 2, ZH / 2, Math.max(ZW, ZH) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
  c.fillStyle = vg; c.fillRect(0, 0, ZW, ZH);
}

function zDrawPolice(c) {
  const x = zPoliceX(), y = zGroundY();
  const swing = zb.ending ? 0 : Math.sin(zb.walk);
  // ground shadow
  c.save();
  c.fillStyle = "rgba(0,0,0,0.45)";
  c.beginPath(); c.ellipse(x, y + 2, 26, 6, 0, 0, 6.28); c.fill();
  c.translate(x, y);
  c.lineCap = "round";
  // legs (with shading)
  const lg = c.createLinearGradient(-8, -46, -8, -5);
  lg.addColorStop(0, "#2a3a8b"); lg.addColorStop(1, "#141d52");
  c.strokeStyle = lg; c.lineWidth = 9;
  c.beginPath(); c.moveTo(-4, -46); c.lineTo(-4 + swing * 12, -5); c.moveTo(4, -46); c.lineTo(4 - swing * 12, -5); c.stroke();
  c.fillStyle = "#0a0a0a"; c.fillRect(-4 + swing * 12 - 7, -6, 16, 6); c.fillRect(4 - swing * 12 - 7, -6, 16, 6);
  // back arm
  c.strokeStyle = "#2a45b8"; c.lineWidth = 8;
  c.beginPath(); c.moveTo(-8, -76); c.lineTo(-16, -52); c.stroke();
  // torso with vertical gradient + belt
  const tg = c.createLinearGradient(-14, -84, 14, -44);
  tg.addColorStop(0, "#3a55c8"); tg.addColorStop(1, "#1e2f88");
  c.fillStyle = tg; zRoundRect(c, -14, -84, 28, 40, 6);
  // belt
  c.fillStyle = "#1a1a1a"; c.fillRect(-14, -50, 28, 5);
  c.fillStyle = "#ffd23c"; c.fillRect(-3, -50, 6, 5); // buckle
  // badge
  c.fillStyle = "#ffd23c"; c.beginPath(); c.arc(-6, -74, 3, 0, 6.28); c.fill();
  c.fillStyle = "#b8860b"; c.beginPath(); c.arc(-6, -74, 1.4, 0, 6.28); c.fill();
  // head (skin gradient) + face
  const hg = c.createRadialGradient(-2, -100, 2, 0, -98, 13);
  hg.addColorStop(0, "#f7d2a8"); hg.addColorStop(1, "#e0b07a");
  c.fillStyle = hg; c.beginPath(); c.arc(0, -98, 12, 0, 6.28); c.fill();
  // eyes
  c.fillStyle = "#222"; c.beginPath(); c.arc(-4, -99, 1.6, 0, 6.28); c.arc(4, -99, 1.6, 0, 6.28); c.fill();
  // mouth (determined)
  c.strokeStyle = "#7a4a2a"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-4, -93); c.lineTo(4, -93); c.stroke();
  // cap with badge
  c.fillStyle = "#1e2a6b"; c.fillRect(-13, -112, 26, 9); c.fillRect(-2, -106, 20, 4);
  c.fillStyle = "#ffd23c"; c.fillRect(-3, -111, 6, 6);
  c.fillStyle = "#b8860b"; c.beginPath(); c.arc(0, -108, 1.5, 0, 6.28); c.fill();
  // front arm holding a pistol (with recoil)
  const r = zb.recoil;
  c.strokeStyle = "#2a45b8"; c.lineWidth = 8;
  c.beginPath(); c.moveTo(6, -76); c.lineTo(30 - r, -73); c.stroke();
  // hand
  c.fillStyle = "#f1c48f"; c.beginPath(); c.arc(31 - r, -73, 5, 0, 6.28); c.fill();
  // pistol (slide + grip + trigger guard)
  c.fillStyle = "#1a1a1a"; c.fillRect(30 - r, -79, 28, 7); c.fillRect(32 - r, -73, 7, 11);
  c.strokeStyle = "#2a2a2a"; c.lineWidth = 2; c.beginPath(); c.arc(36 - r, -70, 4, 0, 3.14); c.stroke();
  // muzzle flash + light cone
  if (zb.flash > 0) {
    const fa = zb.flash / 0.07;
    // light cone toward zombies
    c.globalAlpha = fa * 0.35;
    const cone = c.createRadialGradient(60 - r, -75, 4, 60 - r, -75, 120);
    cone.addColorStop(0, "rgba(255,230,107,0.9)"); cone.addColorStop(1, "rgba(255,230,107,0)");
    c.fillStyle = cone;
    c.beginPath(); c.moveTo(60 - r, -75); c.lineTo(60 - r + 120, -95); c.lineTo(60 - r + 120, -55); c.closePath(); c.fill();
    c.globalAlpha = fa;
    c.fillStyle = "#ffe66b";
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28, rad = i % 2 ? 6 : 15;
      c.lineTo(60 - r + Math.cos(a) * rad, -75 + Math.sin(a) * rad);
    }
    c.closePath(); c.fill();
    c.globalAlpha = 1;
  }
  c.restore();
}

function zDrawZombie(c, z) {
  const gy = zGroundY();
  // ground shadow
  c.save();
  c.fillStyle = "rgba(0,0,0,0.4)";
  c.beginPath(); c.ellipse(z.x, gy + 2, 22 * z.scale, 5, 0, 0, 6.28); c.fill();
  c.translate(z.x, gy);
  if (z.dead) {
    const k = Math.min(1, z.fall / 0.5);
    c.globalAlpha = 1 - Math.max(0, (z.fall - 0.3) / 0.4);
    c.rotate(k * 1.5);   // ล้มหงายไปทางขวา
  }
  c.scale(z.scale, z.scale);
  const bob = Math.sin(z.phase) * 3, swing = Math.sin(z.phase);
  c.lineCap = "round";
  // legs (shaded)
  const lg = c.createLinearGradient(0, -44, 0, -5);
  lg.addColorStop(0, "#4a6a36"); lg.addColorStop(1, "#2a401c");
  c.strokeStyle = lg; c.lineWidth = 9;
  c.beginPath(); c.moveTo(-4, -44); c.lineTo(-4 - swing * 10, -5); c.moveTo(4, -44); c.lineTo(4 + swing * 10, -5); c.stroke();
  c.fillStyle = "#1a1a1a"; c.fillRect(-4 - swing * 10 - 6, -6, 14, 5); c.fillRect(4 + swing * 10 - 6, -6, 14, 5);
  // torso (torn shirt) with gradient
  const tg = c.createLinearGradient(-15, -82 + bob, 15, -42 + bob);
  tg.addColorStop(0, z.shirtLight); tg.addColorStop(1, z.shirtDark);
  c.fillStyle = tg; zRoundRect(c, -15, -82 + bob, 30, 40, 6);
  // exposed flesh patches
  c.fillStyle = "#7fc45a"; c.fillRect(-15, -50 + bob, 8, 8); c.fillRect(4, -56 + bob, 9, 6);
  // arms reaching left toward the police (shaded)
  c.strokeStyle = z.skin; c.lineWidth = 7;
  c.beginPath();
  c.moveTo(-8, -74 + bob); c.lineTo(-34, -70 + bob + swing * 3);
  c.moveTo(-8, -64 + bob); c.lineTo(-32, -57 + bob - swing * 3);
  c.stroke();
  // clawed fingers
  c.strokeStyle = z.skinDark; c.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    c.beginPath(); c.moveTo(-34, -70 + bob + swing * 3 + i * 2); c.lineTo(-40, -72 + bob + swing * 3 + i * 2); c.stroke();
    c.beginPath(); c.moveTo(-32, -57 + bob - swing * 3 + i * 2); c.lineTo(-38, -59 + bob - swing * 3 + i * 2); c.stroke();
  }
  // head (skin gradient)
  const hg = c.createRadialGradient(-3, -98 + bob, 2, 0, -96 + bob, 15);
  hg.addColorStop(0, z.skin); hg.addColorStop(1, z.skinDark);
  c.fillStyle = hg; c.beginPath(); c.arc(0, -96 + bob, 14, 0, 6.28); c.fill();
  // messy hair
  c.fillStyle = "#2d4a1c"; c.fillRect(-12, -111 + bob, 20, 6);
  c.strokeStyle = "#2d4a1c"; c.lineWidth = 2;
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-10 + i * 5, -111 + bob); c.lineTo(-12 + i * 5, -116 + bob); c.stroke(); }
  // glowing red eyes
  c.shadowColor = "#ff2020"; c.shadowBlur = 8;
  c.fillStyle = "#ff3b3b"; c.beginPath(); c.arc(-6, -98 + bob, 2.6, 0, 6.28); c.arc(2, -99 + bob, 2.6, 0, 6.28); c.fill();
  c.shadowBlur = 0;
  // fangs + bloody mouth
  c.fillStyle = "#3a0a0a"; c.fillRect(-10, -90 + bob, 11, 3);
  c.fillStyle = "#fff";
  c.beginPath(); c.moveTo(-8, -88 + bob); c.lineTo(-7, -84 + bob); c.lineTo(-6, -88 + bob); c.fill();
  c.beginPath(); c.moveTo(-2, -88 + bob); c.lineTo(-1, -84 + bob); c.lineTo(0, -88 + bob); c.fill();
  // blood drip
  c.fillStyle = "#a01010"; c.fillRect(-7, -84 + bob, 1.5, 4);
  // Chinese word above the head
  if (!z.dead) {
    const text = zFirst(z.word[0]);
    const fs = text.length > 3 ? 22 : text.length > 2 ? 27 : 34;
    c.font = `800 ${fs}px "Noto Sans SC", sans-serif`;
    const tw = c.measureText(text).width, bw = tw + 24, bh = fs + 16, by = -120 + bob - bh;
    // speech bubble with shadow
    c.shadowColor = "rgba(0,0,0,0.4)"; c.shadowBlur = 6; c.shadowOffsetY = 2;
    c.fillStyle = "rgba(255,255,255,.96)";
    zRoundRect(c, -bw / 2, by, bw, bh, 10);
    c.beginPath(); c.moveTo(-6, by + bh - 1); c.lineTo(6, by + bh - 1); c.lineTo(0, by + bh + 7); c.fill();
    c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.fillStyle = "#1a1a1a"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(text, 0, by + bh / 2 + 1);
  }
  c.restore();
}

function zDraw() {
  const c = zctx;
  zDrawBackground(c);
  const shx = zb.shake ? (Math.random() * 2 - 1) * 14 * (zb.shake / 0.5) : 0;
  const shy = zb.shake ? (Math.random() * 2 - 1) * 10 * (zb.shake / 0.5) : 0;
  c.save(); c.translate(shx, shy);
  // ตัวที่ล้มวาดก่อนเพื่อให้อยู่หลังตัวที่ยังเดินอยู่
  [...zb.zombies].sort((a, b) => (a.dead ? -1 : 1) - (b.dead ? -1 : 1)).forEach((z) => zDrawZombie(c, z));
  zDrawPolice(c);
  const tip = zGunTip();
  // bullet tracers (with glow)
  c.lineCap = "round";
  for (const b of zb.bullets) {
    c.globalAlpha = 0.9;
    c.strokeStyle = "#ffe66b"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(Math.max(tip.x, b.x - 60), tip.y); c.lineTo(b.x, tip.y); c.stroke();
    // glow
    c.strokeStyle = "rgba(255,230,107,0.4)"; c.lineWidth = 7;
    c.beginPath(); c.moveTo(Math.max(tip.x, b.x - 60), tip.y); c.lineTo(b.x, tip.y); c.stroke();
  }
  c.globalAlpha = 1;
  // particles (smoke uses radial gradient, others solid)
  for (const p of zb.particles) {
    const a = 1 - p.age / p.life;
    c.globalAlpha = a;
    if (p.smoke) {
      const sg = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      sg.addColorStop(0, `rgba(180,180,180,${a * 0.5})`); sg.addColorStop(1, "rgba(180,180,180,0)");
      c.fillStyle = sg; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.28); c.fill();
    } else {
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.28); c.fill();
    }
  }
  c.globalAlpha = 1;
  c.font = "800 22px 'Noto Sans Thai', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
  for (const f of zb.floaters) {
    c.globalAlpha = 1 - f.age / f.life;
    c.fillStyle = "#ffd76a";
    c.fillText(f.text, f.x, f.y);
  }
  c.globalAlpha = 1;
  c.restore();

  // red danger flash when a zombie is close to the police
  const closest = zAlive().reduce((m, z) => Math.min(m, z.x - zPoliceX()), Infinity);
  if (closest < 180) {
    const intensity = Math.max(0, 1 - closest / 180);
    c.fillStyle = `rgba(180,20,20,${0.35 * intensity})`;
    c.fillRect(0, 0, ZW, ZH);
  }
  // red flash on ending (zombie reached player)
  if (zb.ending) {
    c.fillStyle = "rgba(200,0,0,0.5)";
    c.fillRect(0, 0, ZW, ZH);
  }

  // color grading (cool dusk tint)
  const grade = c.createLinearGradient(0, 0, 0, ZH);
  grade.addColorStop(0, "rgba(40,20,80,0.12)"); grade.addColorStop(1, "rgba(80,20,40,0.12)");
  c.fillStyle = grade; c.fillRect(0, 0, ZW, ZH);

  // CRT scanlines (subtle)
  c.globalAlpha = 0.06; c.fillStyle = "#000";
  for (let y = 0; y < ZH; y += 3) c.fillRect(0, y, ZW, 1);
  c.globalAlpha = 1;
}

function zloop(t) {
  if (!zb) return;
  const dt = Math.min((t - zb.lastTime) / 1000, 0.05);
  zb.lastTime = t;
  if (!zb.paused) zUpdate(dt);
  if (!zb) return;
  zDraw();
  requestAnimationFrame(zloop);
}

function zombieGameOver(win) {
  const s = zb;
  zb = null;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("zWrongFlash").classList.remove("show");
  if (win) sfx.hit(); else sfx.over();
  showGameOver(win ? "🏆 รอดแล้ว! หมดเวลา" : "🧟 ซอมบี้ถึงตัวแล้ว!", s.score,
    `ยิงซอมบี้ ${s.kills} ตัว • HSK ${currentLevel} • ${DIFF[difficulty].label} • ${zDurLabel()}`,
    zombieBestKey());
}

$("zPauseBtn").addEventListener("click", () => {
  if (!zb || zb.paused) return;
  zb.paused = true;
  sfx.click();
  $("zPauseOverlay").classList.add("show");
});
$("zResumeBtn").addEventListener("click", () => {
  if (!zb) return;
  zb.paused = false;
  zb.lastTime = performance.now();
  sfx.click();
  $("zPauseOverlay").classList.remove("show");
});
$("zQuitBtn").addEventListener("click", () => {
  sfx.click();
  if (zb) saveBest(zombieBestKey(), zb.score);
  zb = null;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("zPauseOverlay").classList.remove("show");
  $("zWrongFlash").classList.remove("show");
  switchScreen(menuEl);
  updateBestLine();
});
$("zMuteBtn").addEventListener("click", () => toggleMute());

/* ================= Menu & controls ================= */
let matching = null;
const MATCH_DIFF = {
  easy: { cards: 6, columns: 3, label: "ง่าย · 6 ใบ" },
  medium: { cards: 8, columns: 4, label: "ปานกลาง · 8 ใบ" },
  hard: { cards: 10, columns: 5, label: "ยาก · 10 ใบ" },
};
const originalDiffLabels = Array.from(document.querySelectorAll(".diff-btn"), (b) => b.textContent);
const matchingBestKey = (level, diff, mode, duration) => `cr_best_hsk${level}_matching_${diff}_${mode}_${duration}`;
const matchTimeLabel = (duration) => duration ? `${duration} วินาที` : "ไม่จำกัดเวลา";
const matchModeLabel = (mode) => mode === "pinyin" ? "พินอิน" : "ภาษาไทย";
const matchTextKey = (text) => text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

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
    { pair, word, side: "chinese", text: word[0], matched: false },
    { pair, word, side: mode, text: word[attr], matched: false },
  ]));
}

function startMatchingGame(level, mode = quizMode, diff = difficulty, duration = zDuration) {
  stopMatchingGame();
  currentLevel = level;
  lastStarter = () => startMatchingGame(level, mode, diff, duration);
  matching = {
    level, mode, diff, duration, words: VOCAB[String(level)] || VOCAB["1"],
    score: 0, pairs: 0, attempts: 0, rounds: 0, elapsed: 0,
    deck: [], open: [], waitUntil: 0, paused: false,
    lastTime: performance.now(), frame: null,
  };
  $("matching").classList.remove("match-paused");
  $("matchPauseOverlay").classList.remove("show");
  const info = $("matchInfo");
  if (info) info.textContent = `HSK ${level} • ${MATCH_DIFF[diff].label} • จีน–${matchModeLabel(mode)} • ${matchTimeLabel(duration)}`;
  $("matchMuteBtn").textContent = muted ? "เปิดเสียง" : "ปิดเสียง";
  $("matchMuteBtn").setAttribute("aria-pressed", String(muted));
  switchScreen($("matching"));
  nextMatchingRound();
  updateMatchingHUD();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  music.start();
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
  s.open = []; s.waitUntil = 0;
  const board = $("matchBoard");
  board.replaceChildren();
  s.deck.forEach((card, i) => {
    const button = document.createElement("button");
    button.className = "match-card";
    const text = document.createElement("span");
    text.className = "match-text";
    button.append(text);
    button.addEventListener("click", () => flipMatchingCard(i));
    board.appendChild(button);
  });
  applyMatchLayout();
  $("matchFeedback").textContent = `ชุดที่ ${s.rounds + 1} — แตะคำจีนแล้วแตะคำตอบที่ตรงกัน`;
  renderMatchingCards();
}

function renderMatchingCards() {
  const s = matching;
  Array.from($("matchBoard").children).forEach((button, i) => {
    const card = s.deck[i];
    const selected = s.open.includes(i);
    const mismatch = s.open.length === 2 && s.deck[s.open[0]].pair !== s.deck[s.open[1]].pair && s.open.includes(i);
    // การ์ดเปิดเสมอ — แสดงข้อความตลอดเวลา (ไม่มีป้ายภาษา)
    button.className = "match-card open" + (card.matched ? " matched" : "") +
      (selected && !card.matched ? " selected" : "") +
      (mismatch ? " mismatch" : "") + (card.side === "chinese" ? " chinese" : "");
    button.disabled = s.paused || card.matched || s.waitUntil > 0;
    button.setAttribute("aria-pressed", String(card.matched || selected));
    button.children[0].textContent = card.text;
    button.children[0].lang = card.side === "chinese" ? "zh-CN" : card.side === "pinyin" ? "zh-Latn" : "th";
    button.setAttribute("aria-label", `${card.text}${card.matched ? " จับคู่แล้ว" : selected ? " (เลือกอยู่)" : ""}`);
  });
  // ปรับขนาดตัวอักษรให้เต็มการ์ด โดยคำนวณจากขนาดการ์ดและความยาวข้อความ
  requestAnimationFrame(() => fitMatchCardText());
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
    const maxFont = isChinese ? 60 : 40;
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

function updateMatchingHUD() {
  const s = matching;
  $("matchScore").textContent = `${s.score} คะแนน`;
  const seconds = s.duration ? Math.max(0, Math.ceil(s.duration - s.elapsed)) : Math.floor(s.elapsed);
  $("matchTimer").textContent = `${s.duration ? "เหลือ" : "เล่นไป"} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  $("matchTimer").classList.toggle("urgent", s.duration > 0 && seconds <= 10);
  const solved = s.deck.filter((c) => c.matched).length / 2;
  const progress = $("matchProgress");
  if (progress) progress.textContent = `ชุดที่ ${s.rounds + 1} • ${solved}/${s.deck.length / 2} คู่ • จับคู่ทั้งหมด ${s.pairs} คู่ • ลอง ${s.attempts} ครั้ง`;
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
    }
  }
  updateMatchingHUD();
}

function flipMatchingCard(i) {
  if (!matching || matching.paused) return;
  const deck = matching.deck;
  advanceMatching(performance.now());
  const s = matching;
  if (!s || s.deck !== deck || s.waitUntil || !s.deck[i] || s.deck[i].matched || s.open.includes(i)) return;
  s.open.push(i);
  sfx.click();
  if (s.open.length === 2) {
    s.attempts++;
    const [a, b] = s.open.map((index) => s.deck[index]);
    if (a.pair === b.pair && a.side !== b.side) {
      a.matched = b.matched = true;
      s.pairs++; s.score += 10;
      sfx.hit();
      setTimeout(() => speak(a.word[0].split(/[｜|]/)[0]), 150);
      $("matchFeedback").innerHTML =
        `<span class="fb-zh">${a.word[0]}</span> ` +
        `<span class="fb-py">${a.word[1]}</span> ` +
        `<span class="fb-th">${a.word[2]}</span>`;
      s.open = [];
      if (s.deck.every((c) => c.matched)) {
        s.waitUntil = s.elapsed + 1.2;
        $("matchFeedback").innerHTML =
          `<span class="fb-zh">${a.word[0]}</span> ` +
          `<span class="fb-py">${a.word[1]}</span> ` +
          `<span class="fb-th">${a.word[2]}</span>` +
          `<span class="fb-done">— ครบแล้ว! กำลังสุ่มชุดใหม่</span>`;
      }
    } else {
      s.waitUntil = s.elapsed + 0.6;
      sfx.wrong();
      $("matchFeedback").textContent = "ยังไม่ใช่คู่กัน ลองใหม่อีกครั้ง";
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
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function endMatchingGame(expired = false) {
  if (!matching) return;
  const s = matching;
  stopMatchingGame();
  sfx.hit();
  const rounds = s.rounds + Number(s.deck.every((c) => c.matched));
  const accuracy = s.attempts ? Math.round(s.pairs / s.attempts * 100) : 0;
  showGameOver(expired ? "หมดเวลา!" : "จบเกมจับคู่", s.score,
    `HSK ${s.level} • ${MATCH_DIFF[s.diff].label} • ${matchModeLabel(s.mode)} • ${matchTimeLabel(s.duration)} • ` +
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
  if ("speechSynthesis" in window) speechSynthesis.cancel();
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

let selectedLevel = null;
const MODE_TITLES = { meteor: "☄️ เกมยิงอุกกาบาต", vocab: "📖 เกมคำศัพท์", sentence: "🧩 เกมเรียงประโยค", zombie: "🧟 เกมยิงซอมบี้" };
MODE_TITLES.matching = "เกมแฟลชการ์ดจับคู่";
const bestKey = () => gameMode === "matching"
  ? matchingBestKey(selectedLevel, difficulty, quizMode, zDuration)
  : gameMode === "vocab"
  ? `cr_best_hsk${selectedLevel}_quiz_${quizMode}`
  : gameMode === "sentence"
    ? `cr_best_hsk${selectedLevel}_sent`
    : gameMode === "zombie"
      ? `cr_best_hsk${selectedLevel}_zombie_${difficulty}_${zDuration}`
      : `cr_best_hsk${selectedLevel}_${difficulty}`;
const startLabel = () => gameMode === "matching"
  ? `เริ่ม HSK ${selectedLevel} (${MATCH_DIFF[difficulty].label}, ${matchModeLabel(quizMode)}, ${matchTimeLabel(zDuration)})`
  : gameMode === "vocab"
  ? `🚀 เริ่ม HSK ${selectedLevel} (${quizMode === "pinyin" ? "เลือกพินอิน" : "เลือกคำแปลไทย"}, Endless)`
  : gameMode === "sentence"
    ? `🚀 เริ่ม HSK ${selectedLevel} (เกมเรียงประโยค, Endless)`
    : gameMode === "zombie"
      ? `🔫 เริ่ม HSK ${selectedLevel} (${DIFF[difficulty].label}, ${zDurLabel()})`
      : `🚀 เริ่มเกม HSK ${selectedLevel} (${DIFF[difficulty].label})`;

function updateStartBtn() {
  if (!gameMode) return;
  $("startBtn").disabled = !selectedLevel;
  $("startBtn").textContent = selectedLevel ? startLabel() : "เลือกระดับ HSK เพื่อเริ่ม";
  updateBestLine();
}
function updateBestLine() {
  if (!selectedLevel || !gameMode) { $("bestScoreLine").textContent = ""; return; }
  const best = +localStorage.getItem(bestKey()) || 0;
  $("bestScoreLine").textContent = best ? `สถิติ HSK ${selectedLevel}: ${best} คะแนน` : "";
}

$("cards").addEventListener("pointerdown", (e) => {
  const card = e.target.closest(".card");
  if (!card || card.classList.contains("locked")) return;
  e.preventDefault();
  sfx.click();
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
  gameMode = card.dataset.mode;
  if (gameMode === "sentence" && !SENT_OK) {
    $("setupTitle").textContent = "🧩 เกมเรียงประโยค";
    $("setupPanel").classList.add("show");
    $("startBtn").disabled = true;
    $("startBtn").textContent = "⚠️ รัน python tools\\extract_sentences.py ก่อน";
    return;
  }
  const isMatching = gameMode === "matching";
  const arcade = gameMode === "meteor" || gameMode === "zombie";
  $("setupTitle").textContent = MODE_TITLES[gameMode];
  $("diffRow").style.display = arcade || isMatching ? "" : "none";
  $("timeRow").style.display = gameMode === "zombie" || isMatching ? "" : "none";
  $("fmtRow").style.display = gameMode === "vocab" || isMatching ? "" : "none";
  $("lifeRow").style.display = arcade || isMatching ? "none" : "";
  $("nextRow").style.display = arcade || isMatching ? "none" : "";
  document.querySelectorAll(".diff-btn").forEach((b, i) => {
    b.textContent = isMatching ? MATCH_DIFF[b.dataset.diff].label : originalDiffLabels[i];
  });
  $("setupPanel").classList.add("show");
  updateStartBtn();
});

$("levelSelect").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".level-btn");
  if (!btn) return;
  e.preventDefault();
  sfx.click();
  document.querySelectorAll(".level-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedLevel = btn.dataset.level;
  updateStartBtn();
});

$("diffSelect").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".diff-btn");
  if (!btn) return;
  e.preventDefault();
  sfx.click();
  document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  difficulty = btn.dataset.diff;
  updateStartBtn();
});

$("timeSelect").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".time-btn");
  if (!btn) return;
  e.preventDefault();
  sfx.click();
  document.querySelectorAll(".time-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  zDuration = +btn.dataset.time;
  updateStartBtn();
});

$("ansSelect").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".ans-btn");
  if (!btn) return;
  e.preventDefault();
  sfx.click();
  document.querySelectorAll(".ans-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  quizMode = btn.dataset.ans;
  updateStartBtn();
});

$("lifeSelect").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".life-btn");
  if (!btn) return;
  e.preventDefault();
  sfx.click();
  document.querySelectorAll(".life-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  quizLivesOn = btn.dataset.life === "on";
});

$("nextSelect").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".next-btn");
  if (!btn) return;
  e.preventDefault();
  sfx.click();
  document.querySelectorAll(".next-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  autoNext = btn.dataset.next === "auto";
});

$("startBtn").addEventListener("click", () => {
  if (!selectedLevel || !gameMode) return;
  sfx.click();
  if (gameMode === "vocab") startQuizGame(selectedLevel);
  else if (gameMode === "sentence") startSentGame(selectedLevel);
  else if (gameMode === "zombie") startZombieGame(selectedLevel);
  else if (gameMode === "matching") startMatchingGame(selectedLevel);
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
  saveBest(`cr_best_hsk${currentLevel}_${difficulty}`, score);
  running = false;
  paused = false;
  music.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("pauseOverlay").classList.remove("show");
  switchScreen(menuEl);
  updateBestLine();
});

function toggleMute() {
  muted = !muted;
  music.setMuted(muted); // ปิดเฉพาะเพลงพื้นหลัง เสียงพูดภาษาจีนยังเล่นต่อ
  $("matchMuteBtn").textContent = muted ? "เปิดเสียง" : "ปิดเสียง";
  $("matchMuteBtn").setAttribute("aria-pressed", String(muted));
  $("muteBtn").textContent = muted ? "🔇" : "🔊";
  $("quizMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("sentMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("zMuteBtn").textContent = muted ? "🔇" : "🔊";
}
$("muteBtn").addEventListener("click", toggleMute);

$("againBtn").addEventListener("click", () => { sfx.click(); if (lastStarter) lastStarter(); });
$("menuBtn").addEventListener("click", () => { sfx.click(); switchScreen(menuEl); updateBestLine(); });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseMatchingGame();
  if (document.hidden && running && !paused) {
    paused = true;
    $("pauseOverlay").classList.add("show");
  }
  if (document.hidden && zb && !zb.paused) {
    zb.paused = true;
    $("zPauseOverlay").classList.add("show");
  }
});

// prevent double-tap zoom on iOS
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
