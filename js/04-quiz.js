"use strict";
/* ================= Vocab quiz mode ================= */
const quizEl = $("quiz");
const qoptBtns = Array.from(document.querySelectorAll(".qopt"));

function startQuizGame(level) {
  currentLevel = level;
  pool = getVocabPool(level);
  if (!pool.length) pool = getVocabPool("1");
  lastStarter = () => startQuizGame(level);
  quiz = { lives: 3, score: 0, answered: false, nextTimer: null,
           reviewQueue: [], sinceReview: 0, wrongThisQ: 0, isReview: false,
           done: new Set() };
  stopSpeech();
  music.start("vocab");
  switchScreen(quizEl);
  updateQuizHUD();
  nextQuizQuestion();
}

function updateQuizHUD() {
  $("quizScore").textContent = quiz.score;
  $("quizLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, quiz.lives)) + "🖤".repeat(Math.max(0, 3 - quiz.lives))
    : "♾️ ไม่จำกัด";
  $("quizProg").textContent = progPct(quiz.done.size, pool.length);
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
  crSetHskBadge($("quizHskBadge"), quiz.word, currentLevel);
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
    quiz.done.add(quiz.word[0]);
    // ตอบผิดระหว่างทาง → คำนี้กลับเข้าคิวทบทวน (ถามซ้ำอีกหลังผ่านไป 5 คำ)
    if (quiz.wrongThisQ > 0) quiz.reviewQueue.push(quiz.word);
    btn.classList.add("correct");
    sfx.hit();
    confettiBurst(quizEl, 22);
    // reveal the complementary attribute on all 4 boxes so distractors are learned too
    quiz.options.forEach((o, j) => {
      const b = qoptBtns[j];
      b.classList.add("reveal");
      const other = quizMode === "pinyin" ? o[2] : o[1];
      b.querySelector(".sub").textContent = `${o[0]} · ${other}`;
    });
    updateQuizHUD();
    if (autoNext) {
      const answeredQuiz = quiz;
      speakWordHit(w, () => {
        if (quiz !== answeredQuiz || !quiz.answered) return;
        quiz.nextTimer = setTimeout(nextQuizQuestion, 400);
      });
    } else {
      speakWordHit(w);
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
  stopSpeech();
  sfx.over();
  const modeLabel = quizMode === "pinyin" ? "เลือกพินอิน" : "เลือกคำแปลไทย";
  showGameOver("📖 จบเกม!", finalScore,
    `${levelDisplayName(currentLevel)} • ${modeLabel}`,
    `cr_best_${catPrefix()}${currentLevel}_quiz_${quizMode}`);
}

qoptBtns.forEach((b, i) => b.addEventListener("pointerdown", (e) => { e.preventDefault(); answerQuiz(i); }));

/* ================= Sentence translation quiz mode (เกมทายประโยค) ================= */
const sentQuizBtns = Array.from(document.querySelectorAll(".sqopt"));

function sentenceQuizAnswerText(s, direction = sentQuizDirection) {
  return direction === "zh" ? (s[2] || "").trim() : (s[0] || "").trim().split(/[｜|]/)[0];
}

function applySentenceKaraoke(root, progress, selector = ".cp-zh-tok") {
  const tokens = Array.from(root.querySelectorAll(selector));
  if (!tokens.length) return;
  const weights = tokens.map((token) => Math.max(1, Array.from(token.textContent).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let position = Math.min(total - Number.EPSILON, Math.max(0, progress) * total);
  let activeIndex = 0;
  for (; activeIndex < weights.length - 1 && position >= weights[activeIndex]; activeIndex++) {
    position -= weights[activeIndex];
  }
  tokens.forEach((token, i) => {
    const active = i === activeIndex;
    token.classList.toggle("sq-karaoke-active", active);
    if (active) token.setAttribute("aria-current", "true");
    else token.removeAttribute("aria-current");
  });
}

function clearSentenceKaraoke(root) {
  root.querySelectorAll(".sq-karaoke-active").forEach((token) => {
    token.classList.remove("sq-karaoke-active");
    token.removeAttribute("aria-current");
  });
}

function updateSentenceQuizKaraoke(s, progress) {
  if (!sentQuiz || sentQuiz.current !== s || sentQuiz.direction !== "zh") return;
  applySentenceKaraoke($("sentQuizPrompt"), progress);
}

function clearSentenceQuizKaraoke(s) {
  if (!sentQuiz || sentQuiz.current !== s) return;
  clearSentenceKaraoke($("sentQuizPrompt"));
}

function updateCopyKaraoke(s, progress) {
  if (!cp || cp.current !== s) return;
  applySentenceKaraoke($("cpZh"), progress);
}

function clearCopyKaraoke(s) {
  if (!cp || cp.current !== s) return;
  clearSentenceKaraoke($("cpZh"));
}

function allCategorySentences() {
  if (currentCategory === "hsk") return SENT_OK ? Object.values(SENTENCES).flat() : [];
  return getSentencePool("all");
}

function startSentenceQuiz(level) {
  const list = getSentencePool(level).filter((s) => s && s[0] && s[2]);
  if (!list.length) return;
  currentLevel = level;
  lastStarter = () => startSentenceQuiz(level);
  const fallback = allCategorySentences().filter((s) => s && s[0] && s[2]);
  const answers = new Set(list.map((s) => sentenceQuizAnswerText(s)).filter(Boolean));
  const optionPool = answers.size >= 4 ? list : [...new Map([...list, ...fallback].map((s) => [sentenceQuizAnswerText(s), s])).values()];
  sentQuiz = {
    lives: 3, score: 0, answered: false, nextTimer: null,
    done: new Set(), deck: shuffle(list.slice()), current: null, options: [],
    direction: sentQuizDirection, showPinyin: sentQuizShowPinyin, optionPool, lastZh: ""
  };
  stopSpeech();
  music.start("sentencequiz");
  switchScreen($("sentQuiz"));
  updateSentenceQuizHUD();
  nextSentenceQuizQuestion();
}

function updateSentenceQuizHUD() {
  if (!sentQuiz) return;
  $("sentQuizScore").textContent = sentQuiz.score;
  $("sentQuizLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, sentQuiz.lives)) + "🖤".repeat(Math.max(0, 3 - sentQuiz.lives))
    : "♾️ ไม่จำกัด";
  $("sentQuizProg").textContent = progPct(sentQuiz.done.size, getSentencePool(currentLevel).length);
}

function nextSentenceQuizQuestion() {
  if (!sentQuiz) return;
  clearTimeout(sentQuiz.nextTimer);
  cpHideWordPopup();
  sentQuiz.answered = false;
  $("sentQuizNextBtn").classList.remove("show");
  if (!sentQuiz.deck.length) {
    sentQuiz.deck = shuffle(getSentencePool(currentLevel).filter((s) => s && s[0] && s[2]));
    if (sentQuiz.deck.length > 1 && sentQuiz.deck[sentQuiz.deck.length - 1][0] === sentQuiz.lastZh) sentQuiz.deck.unshift(sentQuiz.deck.pop());
  }
  sentQuiz.current = sentQuiz.deck.pop();
  if (!sentQuiz.current) return;
  sentQuiz.lastZh = sentQuiz.current[0];

  const direction = sentQuiz.direction;
  const unique = new Map();
  for (const s of sentQuiz.optionPool) {
    const answer = sentenceQuizAnswerText(s, direction);
    if (answer) unique.set(answer, s);
  }
  const correctText = sentenceQuizAnswerText(sentQuiz.current, direction);
  unique.set(correctText, sentQuiz.current);
  const distractors = shuffle([...unique.values()].filter((s) => sentenceQuizAnswerText(s, direction) !== correctText));
  sentQuiz.options = shuffle([sentQuiz.current, ...distractors.slice(0, 3)]);
  const prompt = $("sentQuizPrompt");
  prompt.replaceChildren();
  prompt.setAttribute("lang", direction === "zh" ? "zh" : "th");
  if (direction === "zh") {
    const main = document.createElement("span");
    main.className = "sq-prompt-main";
    renderZhTokens(main, sentQuiz.current);
    prompt.appendChild(main);
    if (sentQuiz.showPinyin && sentQuiz.current[1]) {
      const pinyin = document.createElement("span");
      pinyin.className = "sq-prompt-pinyin";
      pinyin.lang = "zh-Latn";
      pinyin.textContent = sentQuiz.current[1];
      prompt.appendChild(pinyin);
    }
  } else {
    prompt.textContent = sentQuiz.current[2];
  }
  crSetHskSentenceBadge($("sentQuizHskBadge"), sentQuiz.current);
  $("sentQuizHint").textContent = direction === "zh"
    ? "อ่านข้อความจีน แล้วเลือกคำแปลภาษาไทย • แตะคำเพื่อดูพินอินและความหมาย"
    : "อ่านข้อความไทย แล้วเลือกประโยคภาษาจีน";
  sentQuizBtns.forEach((btn, i) => {
    btn.className = "sqopt";
    btn.disabled = false;
    btn.replaceChildren();
    const option = sentQuiz.options[i];
    if (!option) return;
    const answer = document.createElement("span");
    answer.textContent = sentenceQuizAnswerText(option, direction);
    btn.appendChild(answer);
    if (direction === "th" && sentQuiz.showPinyin && option[1]) {
      const pinyin = document.createElement("span");
      pinyin.className = "sqopt-pinyin";
      pinyin.lang = "zh-Latn";
      pinyin.textContent = option[1];
      btn.appendChild(pinyin);
    }
  });
  const question = sentQuiz.current;
  speakSentencePrompt(question, direction === "th" ? "th" : "zh",
    (progress) => updateSentenceQuizKaraoke(question, progress),
    () => clearSentenceQuizKaraoke(question));
}

function answerSentenceQuiz(i) {
  if (!sentQuiz || sentQuiz.answered) return;
  const option = sentQuiz.options[i], btn = sentQuizBtns[i];
  if (!option || btn.disabled) return;
  if (sentenceQuizAnswerText(option) === sentenceQuizAnswerText(sentQuiz.current)) {
    sentQuiz.answered = true;
    sentQuiz.score++;
    sentQuiz.done.add(sentQuiz.current[0]);
    btn.classList.add("correct");
    sentQuizBtns.forEach((b, j) => {
      b.disabled = true;
      b.classList.add("reveal");
      const optionSentence = sentQuiz.options[j];
      if (!optionSentence) return;
      const meaning = document.createElement("span");
      meaning.className = "sqopt-sub";
      meaning.textContent = sentQuiz.direction === "zh"
        ? (optionSentence[0] || "").trim().split(/[｜|]/)[0]
        : (optionSentence[2] || "").trim();
      b.appendChild(meaning);
    });
    sfx.correct();
    confettiBurst($("sentQuiz"), 24);
    updateSentenceQuizHUD();
    if (autoNext) {
      const answeredQuiz = sentQuiz;
      const answeredSentence = sentQuiz.current;
      speakSentence(answeredSentence, false, () => {
        clearSentenceQuizKaraoke(answeredSentence);
        if (sentQuiz !== answeredQuiz || !sentQuiz.answered) return;
        sentQuiz.nextTimer = setTimeout(nextSentenceQuizQuestion, 400);
      }, (progress) => updateSentenceQuizKaraoke(answeredSentence, progress));
    } else {
      const answeredSentence = sentQuiz.current;
      speakSentence(answeredSentence, false, () => clearSentenceQuizKaraoke(answeredSentence),
        (progress) => updateSentenceQuizKaraoke(answeredSentence, progress));
      $("sentQuizNextBtn").classList.add("show");
    }
  } else {
    btn.classList.add("wrong");
    btn.disabled = true;
    sfx.wrong();
    if (quizLivesOn) {
      sentQuiz.lives--;
      updateSentenceQuizHUD();
      if (sentQuiz.lives <= 0) sentenceQuizGameOver();
    }
  }
}

function sentenceQuizGameOver() {
  clearTimeout(sentQuiz && sentQuiz.nextTimer);
  const finalScore = sentQuiz ? sentQuiz.score : 0;
  const direction = sentQuiz ? sentQuiz.direction : sentQuizDirection;
  sentQuiz = null;
  music.stop();
  stopSpeech();
  sfx.over();
  showGameOver("💬 จบเกม!", finalScore,
    `${levelDisplayName(currentLevel)} • ${direction === "zh" ? "จีน → ไทย" : "ไทย → จีน"}`,
    `cr_best_${catPrefix()}${currentLevel}_sentencequiz_${direction}`);
}

sentQuizBtns.forEach((btn, i) => btn.addEventListener("pointerdown", (e) => { e.preventDefault(); answerSentenceQuiz(i); }));
$("sentQuizSpeakBtn").addEventListener("click", () => {
  if (!sentQuiz || !sentQuiz.current) return;
  sfx.click();
  const question = sentQuiz.current;
  speakSentence(question, false, () => clearSentenceQuizKaraoke(question),
    (progress) => updateSentenceQuizKaraoke(question, progress));
});
$("sentQuizNextBtn").addEventListener("click", () => {
  sfx.click();
  if (!sentQuiz) return;
  $("sentQuizNextBtn").classList.remove("show");
  nextSentenceQuizQuestion();
});
$("sentQuizMuteBtn").addEventListener("click", toggleMute);
$("sentQuizQuitBtn").addEventListener("click", () => {
  sfx.click();
  if (sentQuiz) {
    clearTimeout(sentQuiz.nextTimer);
    saveBest(`cr_best_${catPrefix()}${currentLevel}_sentencequiz_${sentQuiz.direction}`, sentQuiz.score);
  }
  sentQuiz = null;
  music.stop();
  stopSpeech();
  exitToSetup("sentencequiz");
  updateBestLine();
});

/* ================= Sentence ordering mode (เกมเรียงประโยค) ================= */
function startSentGame(level) {
  const list = getSentencePool(level);
  if (!list || !list.length) return;
  currentLevel = level;
  lastStarter = () => startSentGame(level);
  sent = { lives: 3, score: 0, solved: false, nextTimer: null,
           reviewQueue: [], sinceReview: 0, wrongThisQ: 0, isReview: false,
           repeat: false, isRetry: false, current: null, pool: [], placed: [],
           done: new Set() };
  pool = list;
  stopSpeech();
  music.start("sentence");
  switchScreen($("sent"));
  updateSentHUD();
  nextSentQuestion();
}

function updateSentHUD() {
  $("sentScore").textContent = sent.score;
  $("sentLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, sent.lives)) + "🖤".repeat(Math.max(0, 3 - sent.lives))
    : "♾️ ไม่จำกัด";
  $("sentProg").textContent = progPct(sent.done.size, pool.length);
}

function nextSentQuestion() {
  sent.solved = false;
  sent.wrongThisQ = 0;
  $("sentNextBtn").textContent = "ประโยคถัดไป ▶";
  $("sentNextBtn").classList.remove("show");
  $("sentReveal").classList.remove("show", "correct", "wrong");
  $("sentGiveUpBtn").classList.remove("hide");
  // เรียงผิด/ยอมแพ้: ซ้ำประโยคเดิมทันทีจนกว่าจะถูก แล้วค่อยไปประโยคใหม่
  sent.isRetry = !!(sent.repeat && sent.current);
  sent.isReview = false;
  if (!sent.isRetry) {
    // คิวทบทวน: ประโยคที่เคยเรียงผิดวนกลับมาทุกๆ 5 ข้อ จนกว่าจะถูกในครั้งเดียว
    if (sent.reviewQueue.length && sent.sinceReview >= 5) {
      sent.current = sent.reviewQueue.shift();
      sent.sinceReview = 0;
      sent.isReview = true;
    } else {
      sent.current = pick(pool);
      sent.sinceReview++;
      const qi = sent.reviewQueue.findIndex((s) => s[0] === sent.current[0]);
      if (qi >= 0) { sent.reviewQueue.splice(qi, 1); sent.isReview = true; }
    }
  }
  const tokens = sent.current[4];
  // unique ids per chip so duplicate tokens still work
  let shuffled;
  do {
    shuffled = shuffle(tokens.map((t, i) => ({ t, id: i })));
  } while (tokens.length > 1 && shuffled.every((c, i) => c.id === i));
  shuffled.forEach((c, i) => { c.pi = i; c.used = false; });
  sent.pool = shuffled;
  sent.placed = [];
  $("sentTarget").textContent = (sent.isRetry ? "🔁 ลองอีกครั้ง: " : sent.isReview ? "🔁 ทบทวน: " : "") + sent.current[2];
  crSetHskSentenceBadge($("sentHskBadge"), sent.current);
  renderSent();
}

function renderSent() {
  const ans = $("sentAnswer"), poolEl = $("sentPool");
  ans.className = "";
  ans.innerHTML = "";
  poolEl.innerHTML = "";
  const want = sent.current[4];
  const full = sent.placed.length === want.length;
  if (full && sent.solved) ans.classList.add(sent.wrongThisQ > 0 ? "wrong-full" : "correct-full");
  sent.placed.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c.t;
    b.disabled = sent.solved;
    if (full) b.classList.add(want[i] === c.t ? "ok" : "bad");
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); sentRemove(i); });
    ans.appendChild(b);
  });
  sent.pool.forEach((c) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c.t;
    // ชิปที่ถูกเลือกแล้วคงช่องว่างไว้ที่ตำแหน่งเดิม (มองไม่เห็นแต่ยังกินที่)
    // เพื่อไม่ให้ชิปอื่นไหลมารวมกันตอนแตะเร็วๆ
    if (c.used) {
      b.classList.add("ghost");
      b.disabled = true;
    } else {
      b.disabled = sent.solved;
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); sentAdd(c.id); });
    }
    poolEl.appendChild(b);
  });
}

function sentAdd(id) {
  if (sent.solved) return;
  const chip = sent.pool.find((c) => c.id === id);
  if (!chip || chip.used) return;
  chip.used = true;
  sent.placed.push(chip);
  const complete = sent.placed.length === sent.current[4].length;
  const question = sent.current;
  const audioKey = wordAudioKey(chip.t, chip.t === "了" ? "le" : "");
  const spokenChip = audioKey === "了-le" ? "le" : chip.t;
  // เล่นเสียงชิปที่เลือกก่อนเสมอ; ถ้าเป็นชิปสุดท้ายค่อยตรวจและเล่นเสียงทั้งประโยคต่อ
  playWordAudio(audioKey, [[spokenChip, "zh-CN"]], complete ? () => {
    if (sent && sent.current === question && !sent.solved && sent.placed.length === question[4].length) {
      checkSentAnswer();
    }
  } : undefined);
  renderSent();
}

function sentRemove(i) {
  if (sent.solved) return;
  // เอาชิปออกจากช่องคำตอบ — ชิปกลับไปโผล่ที่ตำแหน่งเดิมในกอง (pool ไม่เคยถูก splice)
  const chip = sent.placed.splice(i, 1)[0];
  if (chip) chip.used = false;
  renderSent();
}

// เล่นเสียงประโยคจากไฟล์ audio/zh|th/<ประโยคจีน>.mp3 (edge-tts จาก tools/gen_sentence_audio.py)
// ถ้าไม่มีไฟล์จะ fallback เป็น TTS อัตโนมัติผ่าน playWordAudio
function speakSentence(s, withTh = false, onDone, onProgress) {
  const zh = s[0].trim().split(/[｜|]/)[0];
  const th = (s[2] || "").trim();
  wordAudio.play([
    { url: `audio/zh/${zh}.mp3`, tts: [zh, "zh-CN"], duck: withTh },
    ...(withTh && th ? [{ url: `audio/th/${zh}.mp3`, tts: [th, "th-TH"], duck: true }] : []),
  ], onDone, onProgress);
}

function speakSentencePrompt(s, language, onProgress, onDone) {
  const zh = (s[0] || "").trim().split(/[｜|]/)[0];
  const th = (s[2] || "").trim();
  if (language === "th" && th) {
    wordAudio.play([{ url: `audio/th/${zh}.mp3`, tts: [th, "th-TH"], duck: true }], onDone);
  } else if (zh) {
    wordAudio.play([{ url: `audio/zh/${zh}.mp3`, tts: [zh, "zh-CN"] }], onDone, onProgress);
  }
}

function showSentReveal(wrong) {
  const rv = $("sentReveal");
  rv.classList.remove("correct", "wrong");
  rv.classList.add(wrong ? "wrong" : "correct");
  rv.replaceChildren();
  const zh = document.createElement("div");
  zh.className = "r-zh";
  zh.lang = "zh";
  renderZhTokens(zh, sent.current);
  rv.appendChild(zh);
  const py = document.createElement("div");
  py.className = "r-py";
  py.textContent = sent.current[1] || "";
  rv.appendChild(py);
  if (sent.current[3]) {
    const focus = document.createElement("div");
    focus.className = "r-focus";
    focus.textContent = "📐 จุดไวยากรณ์: " + sent.current[3];
    rv.appendChild(focus);
  }
  rv.classList.add("show");
}

function checkSentAnswer() {
  const want = sent.current[4];
  const correct = sent.placed.every((c, i) => want[i] === c.t);
  const zh = sent.current[0];
  if (correct) {
    sent.solved = true;
    sent.repeat = false;
    sent.score++;
    sent.done.add(sent.current[0]);
    $("sentAnswer").classList.add("correct-full");
    $("sentGiveUpBtn").classList.add("hide");
    sfx.correct();
    confettiBurst($("sent"), 30);
    speakSentence(sent.current);
    showSentReveal(false);
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
    sent.repeat = true;
    // คงการเรียงของผู้เล่นไว้ให้เห็นว่าผิดตรงไหน (เฉลยแสดงในกล่อง sentReveal)
    if (!sent.reviewQueue.some((s) => s[0] === zh)) sent.reviewQueue.push(sent.current);
    $("sentGiveUpBtn").classList.add("hide");
    sfx.wrong();
    speakSentence(sent.current);
    renderSent();
    showSentReveal(true);
    if (quizLivesOn) sent.lives--;
    updateSentHUD();
    if (autoNext) {
      sent.nextTimer = setTimeout(() => {
        if (!sent) return;
        if (quizLivesOn && sent.lives <= 0) sentGameOver();
        else nextSentQuestion();
      }, 3000);
    } else {
      $("sentNextBtn").textContent = quizLivesOn && sent.lives <= 0 ? "ดูผลคะแนน ▶" : "🔁 ลองอีกครั้ง ▶";
      $("sentNextBtn").classList.add("show");
    }
  }
}

function sentGiveUp() {
  if (!sent || sent.solved) return;
  sfx.click();
  // เปิดเผยเฉลยและถือว่าเป็นการตอบผิดของข้อนี้ (เสีย 1 ชีวิตถ้าเปิดพลังชีวิต)
  const zh = sent.current[0];
  sent.wrongThisQ++;
  sent.solved = true;
  sent.repeat = true;
  // คงการเรียงของผู้เล่นไว้ให้เห็นว่าผิดตรงไหน (เฉลยแสดงในกล่อง sentReveal)
  if (!sent.reviewQueue.some((s) => s[0] === zh)) sent.reviewQueue.push(sent.current);
  $("sentGiveUpBtn").classList.add("hide");
  sfx.wrong();
  speakSentence(sent.current);
  renderSent();
  showSentReveal(true);
  if (quizLivesOn) sent.lives--;
  updateSentHUD();
  if (autoNext) {
    sent.nextTimer = setTimeout(() => {
      if (!sent) return;
      if (quizLivesOn && sent.lives <= 0) sentGameOver();
      else nextSentQuestion();
    }, 3000);
  } else {
    $("sentNextBtn").textContent = quizLivesOn && sent.lives <= 0 ? "ดูผลคะแนน ▶" : "🔁 ลองอีกครั้ง ▶";
    $("sentNextBtn").classList.add("show");
  }
}

function sentGameOver() {
  clearTimeout(sent && sent.nextTimer);
  const finalScore = sent ? sent.score : 0;
  sent = null;
  music.stop();
  stopSpeech();
  sfx.over();
  showGameOver("🧩 จบเกม!", finalScore,
    `${levelDisplayName(currentLevel)} • เกมเรียงประโยค`,
    `cr_best_${catPrefix()}${currentLevel}_sent`);
}

$("sentNextBtn").addEventListener("click", () => {
  sfx.click();
  $("sentNextBtn").classList.remove("show");
  if (!sent) return;
  if (quizLivesOn && sent.lives <= 0) sentGameOver();
  else nextSentQuestion();
});
$("sentGiveUpBtn").addEventListener("click", sentGiveUp);
$("sentMuteBtn").addEventListener("click", toggleMute);
$("sentQuitBtn").addEventListener("click", () => {
  sfx.click();
  saveBest(`cr_best_${catPrefix()}${currentLevel}_sent`, sent ? sent.score : 0);
  sent = null;
  music.stop();
  stopSpeech();
  exitToSetup("sentence");
  updateBestLine();
});

/* ================= Fill-in-the-blank mode (เกมเติมคำในประโยค) ================= */
function startFillGame(level) {
  const sPool = getSentencePool(level);
  if (!sPool || !sPool.length) return;
  cpHideWordPopup();
  currentLevel = level;
  pool = sPool;
  lastStarter = () => startFillGame(level);
  fill = { lives: 3, score: 0, solved: false, nextTimer: null,
           autoNextPaused: false,
           reviewQueue: [], sinceReview: 0, isReview: false,
           current: null, blankIdx: 0, answer: "", picked: null, options: [],
           done: new Set() };
  stopSpeech();
  music.start("fillblank");
  switchScreen($("fill"));
  updateFillHUD();
  nextFillQuestion();
}

function updateFillHUD() {
  $("fillScore").textContent = fill.score;
  $("fillLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, fill.lives)) + "🖤".repeat(Math.max(0, 3 - fill.lives))
    : "♾️ ไม่จำกัด";
  $("fillProg").textContent = progPct(fill.done.size, pool.length);
}

function nextFillQuestion() {
  clearTimeout(fill.nextTimer);
  fill.nextTimer = null;
  cpHideWordPopup();
  fill.solved = false;
  fill.autoNextPaused = false;
  fill.picked = null;
  $("fillNextBtn").classList.remove("show");
  $("fillReveal").classList.remove("show", "correct", "wrong");
  // ประโยคที่เคยตอบผิดวนกลับมาถามทุกๆ 5 ข้อ จนกว่าจะถูกในครั้งเดียว
  fill.isReview = false;
  if (fill.reviewQueue.length && fill.sinceReview >= 5) {
    fill.current = fill.reviewQueue.shift();
    fill.sinceReview = 0;
    fill.isReview = true;
  } else {
    fill.current = pick(pool);
    fill.sinceReview++;
    const qi = fill.reviewQueue.findIndex((s) => s[0] === fill.current[0]);
    if (qi >= 0) { fill.reviewQueue.splice(qi, 1); fill.isReview = true; }
  }
  const tokens = fill.current[4];
  // ช่องว่าง: สุ่มชิ้นคำที่เป็นตัวอักษรจีน (ข้ามเครื่องหมายวรรคตอนถ้ามี)
  const hanIdx = tokens.map((t, i) => /[一-鿿]/.test(t) ? i : -1).filter((i) => i >= 0);
  fill.blankIdx = hanIdx.length ? pick(hanIdx) : Math.floor(Math.random() * tokens.length);
  fill.answer = tokens[fill.blankIdx];
  // ตัวหลอก 3 ใบ: ชิ้นคำจากประโยคอื่นในระดับเดียวกัน (ไม่พอค่อยเติมจาก VOCAB)
  const used = new Set([fill.answer]);
  const opts = [];
  let guard = 0;
  while (opts.length < 3 && guard++ < 600) {
    const cand = pick(pick(pool)[4]);
    if (/[一-鿿]/.test(cand) && !used.has(cand)) { used.add(cand); opts.push(cand); }
  }
  const vpool = getVocabPool(currentLevel) || [];
  guard = 0;
  while (opts.length < 3 && vpool.length && guard++ < 600) {
    const cand = (pick(vpool)[0] || "").split(/[｜|]/)[0].trim();
    if (cand && /[一-鿿]/.test(cand) && !used.has(cand)) { used.add(cand); opts.push(cand); }
  }
  fill.options = shuffle([fill.answer, ...opts]);
  $("fillTarget").textContent = (fill.isReview ? "🔁 ทบทวน: " : "") + fill.current[2];
  crSetHskSentenceBadge($("fillHskBadge"), fill.current);
  renderFill();
}

function pauseFillAutoNext() {
  if (!fill || !fill.solved) return;
  fill.autoNextPaused = true;
  if (fill.nextTimer) {
    clearTimeout(fill.nextTimer);
    fill.nextTimer = null;
    $("fillNextBtn").textContent = quizLivesOn && fill.lives <= 0 ? "ดูผลคะแนน ▶" : "ประโยคถัดไป ▶";
    $("fillNextBtn").classList.add("show");
  }
}

function renderFill() {
  const correct = fill.picked === fill.answer;
  const box = $("fillSentence");
  box.className = fill.solved ? (correct ? "correct-full" : "wrong-full") : "";
  box.replaceChildren();
  fill.current[4].forEach((t, i) => {
    if (i !== fill.blankIdx) {
      if (/[㐀-鿿豈-﫿]/.test(t)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cp-zh-tok";
        b.lang = "zh";
        b.textContent = t;
        b.addEventListener("click", () => {
          sfx.click();
          pauseFillAutoNext();
          cpShowWordPopup(t, b);
        });
        box.appendChild(b);
      } else {
        box.appendChild(document.createTextNode(t));
      }
      return;
    }
    if (!fill.solved) {
      const b = document.createElement("span");
      b.className = "fill-blank";
      b.textContent = "＿＿";
      box.appendChild(b);
    } else {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fill-blank cp-zh-tok" + (correct ? " ok" : " bad");
      b.lang = "zh";
      b.textContent = t;
      b.addEventListener("click", () => {
        sfx.click();
        pauseFillAutoNext();
        cpShowWordPopup(t, b);
      });
      box.appendChild(b);
    }
  });
  const poolEl = $("fillOptions");
  poolEl.replaceChildren();
  fill.options.forEach((t) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = t;
    if (fill.solved) {
      b.disabled = true;
      if (t === fill.answer) b.classList.add("ok");
      else if (t === fill.picked) b.classList.add("bad");
    }
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); fillPick(t); });
    poolEl.appendChild(b);
  });
}

function showFillReveal(wrong) {
  const rv = $("fillReveal");
  rv.classList.remove("correct", "wrong");
  rv.classList.add(wrong ? "wrong" : "correct");
  rv.replaceChildren();

  const zhBox = document.createElement("div");
  zhBox.className = "r-zh";
  zhBox.lang = "zh";
  renderZhTokens(zhBox, fill.current, () => pauseFillAutoNext());
  rv.appendChild(zhBox);

  const pyBox = document.createElement("div");
  pyBox.className = "r-py";
  pyBox.textContent = fill.current[1] || "";
  rv.appendChild(pyBox);

  if (fill.current[3]) {
    const focusBox = document.createElement("div");
    focusBox.className = "r-focus";
    focusBox.textContent = `📐 จุดไวยากรณ์: ${fill.current[3]}`;
    rv.appendChild(focusBox);
  }
  rv.classList.add("show");
}

function fillPick(t) {
  if (!fill || fill.solved) return;
  cpHideWordPopup();
  fill.solved = true;
  fill.autoNextPaused = false;
  fill.picked = t;
  const answeredFill = fill;
  const answeredSentence = fill.current;
  const answeredAt = performance.now();
  const correct = t === fill.answer;
  if (correct) {
    fill.score++;
    fill.done.add(fill.current[0]);
    sfx.correct();
    confettiBurst($("fill"), 30);
  } else {
    // ตอบผิด → เฉลยสีแดง เสีย 1 ชีวิต (ถ้าเปิดพลังชีวิต) และประโยคเข้าคิวทบทวน
    if (!fill.reviewQueue.some((s) => s[0] === fill.current[0])) fill.reviewQueue.push(fill.current);
    sfx.wrong();
    if (quizLivesOn) fill.lives--;
  }
  // พูดประโยคภาษาจีนตามด้วยคำแปลไทย ทั้งตอนตอบถูกและตอบผิด (ไฟล์ mp3 ถ้ามี, ไม่งั้น TTS)
  speakSentence(fill.current, true, () => {
    if (fill !== answeredFill || !fill.solved || fill.current !== answeredSentence) return;
    if (autoNext && !fill.autoNextPaused) {
      // Keep the original 4-second review window, but never advance before both
      // the window and the Chinese+Thai sentence playback have finished.
      const delay = Math.max(0, 4000 - (performance.now() - answeredAt));
      fill.nextTimer = setTimeout(() => {
        if (fill !== answeredFill || !fill.solved || fill.current !== answeredSentence) return;
        fill.nextTimer = null;
        if (quizLivesOn && fill.lives <= 0) fillGameOver();
        else nextFillQuestion();
      }, delay);
    } else {
      $("fillNextBtn").textContent = quizLivesOn && fill.lives <= 0 ? "ดูผลคะแนน ▶" : "ประโยคถัดไป ▶";
      $("fillNextBtn").classList.add("show");
    }
  });
  renderFill();
  showFillReveal(!correct);
  updateFillHUD();
}

function fillGameOver() {
  cpHideWordPopup();
  clearTimeout(fill && fill.nextTimer);
  const finalScore = fill ? fill.score : 0;
  fill = null;
  music.stop();
  stopSpeech();
  sfx.over();
  showGameOver("✏️ จบเกม!", finalScore,
    `${levelDisplayName(currentLevel)} • เกมเติมคำในประโยค`,
    `cr_best_${catPrefix()}${currentLevel}_fill`);
}

$("fillNextBtn").addEventListener("click", () => {
  sfx.click();
  cpHideWordPopup();
  $("fillNextBtn").classList.remove("show");
  if (!fill) return;
  if (quizLivesOn && fill.lives <= 0) fillGameOver();
  else nextFillQuestion();
});
$("fillMuteBtn").addEventListener("click", toggleMute);
$("fillQuitBtn").addEventListener("click", () => {
  sfx.click();
  cpHideWordPopup();
  saveBest(`cr_best_${catPrefix()}${currentLevel}_fill`, fill ? fill.score : 0);
  clearTimeout(fill && fill.nextTimer);
  fill = null;
  music.stop();
  stopSpeech();
  exitToSetup("fillblank");
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
  saveBest(`cr_best_${catPrefix()}${currentLevel}_quiz_${quizMode}`, quiz ? quiz.score : 0);
  quiz = null;
  music.stop();
  stopSpeech();
  exitToSetup("vocab");
  updateBestLine();
});

