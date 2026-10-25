"use strict";
/* ================= Private HSK story reader ================= */

let readerDataPromise = null;
let readerRuntime = null;
let readerState = null;
let readerWantPlay = false;
let readerSeekSequence = 0;
let readerThaiPlayback = null;
let readerLevel = 1;
let readerThaiVisible = true;
let readerPinyinVisible = true;
let readerFontScale = 1;
let readerAlternateEnabled = true;
let readerAutoNextEnabled = false;
let readerExtraOpen = false;
let readerWordTrie = null;
let readerQuizState = null;
let readerBubbleOpen = false;
let readerBubbleTap = null;

// ---- เสียงอ่านชื่อเรื่อง (จีน → ไทย → พัก 2 วินาที → เนื้อเรื่อง) ---------
// เหมือนบทความในโหมดพอดแคสต์: ไฟล์แยกจากเสียงเนื้อเรื่อง
// (reader_data/intro_zh/<id>.mp3 กับ intro_th/<id>.mp3)
let readerIntroPlayback = null;
let readerIntroUnavailable = false;
let readerIntroCounter = 0;

// ---- ความทนทานของการเล่นเบื้องหลัง ------------------------------------
// ตอนปิดหน้าจอ/สลับแอพ Android อาจหยุดคลิปเอง หรือไม่ส่ง event "ended"
// ทำให้ "เล่นเรื่องถัดไปอัตโนมัติ" ไม่เดิน จึงต้องมีตัวเฝ้าดูคอยเช็ก
let readerWatchTimer = null;
let readerBusyUntil = 0;
let readerSaveTimer = null;
let readerEndedFor = null;   // เรื่องที่เพิ่งจัดการเหตุการณ์ "จบ" ไปแล้ว
let readerKeepAlive = false; // กำลังสลับเรื่อง — อย่าปิดบริการ foreground

function readerBusy(ms) {
  readerBusyUntil = Math.max(readerBusyUntil, Date.now() + (ms || 0));
}

function readerIsBusy() {
  return Date.now() < readerBusyUntil;
}

// Local preview (APK-only mode in the real index.html). Private LAN addresses
// are allowed too so a phone can open it while `python serve.py --host 0.0.0.0`
// runs; the explicit ?readerPreview=1 flag is still required.
const READER_LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const READER_LOCAL_PREVIEW = READER_LOCAL_HOST.test(location.hostname) &&
  new URLSearchParams(location.search).get("readerPreview") === "1";
const READER_PARAMS = new URLSearchParams(location.search);
const READER_DATA_ROOT = READER_LOCAL_PREVIEW
  ? "HSK%20Database/HSK1-3_Story_Reader/"
  : "reader_data/";
const READER_LEVEL_KEY = "cr_reader_level";
const READER_PINYIN_KEY = "cr_reader_pinyin";
const READER_THAI_KEY = "cr_reader_thai";
const READER_ALT_KEY = "cr_reader_alternate";
const READER_NEXT_KEY = "cr_reader_auto_next";
const READER_FONT_KEY = "cr_reader_font_scale";
const READER_FS_MIN = 0.8;
const READER_FS_MAX = 1.8;

const readerCard = document.querySelector('.card[data-mode="reader"]');
if (readerCard) readerCard.hidden = !window.CR_OFFLINE_APP && !READER_LOCAL_PREVIEW;

function readerStorageGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function readerLoadSettings() {
  const level = Number(readerStorageGet(READER_LEVEL_KEY, "1"));
  readerLevel = [1, 2, 3].includes(level) ? level : 1;
  readerPinyinVisible = readerStorageGet(READER_PINYIN_KEY, "1") === "1";
  readerThaiVisible = readerStorageGet(READER_THAI_KEY, "1") === "1";
  readerAlternateEnabled = readerStorageGet(READER_ALT_KEY, "1") === "1";
  readerAutoNextEnabled = readerStorageGet(READER_NEXT_KEY, "0") === "1";
  const font = Number(readerStorageGet(READER_FONT_KEY, "1"));
  readerFontScale = Number.isFinite(font) ? Math.min(READER_FS_MAX, Math.max(READER_FS_MIN, font)) : 1;
}

readerLoadSettings();

function readerAssetUrl(relativePath) {
  const encodedPath = String(relativePath || "").split("/").map(encodeURIComponent).join("/");
  return new URL(READER_DATA_ROOT + encodedPath, document.baseURI).href;
}

async function readerLoadData() {
  if (readerRuntime) return readerRuntime;
  if (!window.CR_OFFLINE_APP && !READER_LOCAL_PREVIEW) {
    throw new Error("บทอ่านชุดนี้เปิดได้ใน APK หรือหน้า localhost สำหรับทดสอบเท่านั้น");
  }
  if (readerDataPromise) return readerDataPromise;
  readerDataPromise = fetch(readerAssetUrl("reader_runtime.json"), { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (${response.status})`);
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data.stories) || !data.stories.length) throw new Error("ไม่พบรายการบทอ่าน");
      readerRuntime = data;
      readerWordTrie = readerBuildWordTrie();
      return data;
    })
    .catch((error) => {
      readerDataPromise = null;
      throw error;
    });
  return readerDataPromise;
}

function readerBuildWordTrie() {
  const root = {};
  if (typeof VOCAB === "undefined" || !VOCAB) return root;
  const levels = Object.values(VOCAB);
  if (typeof VOCAB_READING !== "undefined") levels.push(VOCAB_READING);
  for (const level of levels) {
    for (const row of level || []) {
      if (!Array.isArray(row) || !row[0]) continue;
      const variants = String(row[0]).split(/[｜|]/).map((word) => word.trim()).filter(Boolean);
      const pinyin = String(row[1] || "").split(/[｜|]/)[0].trim().replace(/\s+/g, " ");
      for (const word of variants) {
        const chars = [...word];
        if (!chars.length || !chars.every((char) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(char))) continue;
        let node = root;
        for (const char of chars) node = node[char] || (node[char] = {});
        if (!node.$) node.$ = { text: word, pinyin };
      }
    }
  }
  return root;
}

function readerTokenizeChars(chars) {
  const result = [];
  let index = 0;
  while (index < chars.length) {
    const first = chars[index];
    if (!/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(first.text)) {
      result.push({ text: first.text, pinyin: "", start: null, end: null, cjk: false });
      index++;
      continue;
    }

    let node = readerWordTrie || {};
    let best = null;
    let bestEnd = index;
    for (let cursor = index; cursor < chars.length; cursor++) {
      const char = chars[cursor].text;
      if (!/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(char) || !node[char]) break;
      node = node[char];
      if (node.$) {
        best = node.$;
        bestEnd = cursor + 1;
      }
    }

    const end = best ? bestEnd : index + 1;
    const selected = chars.slice(index, end);
    const timed = selected.filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
    result.push({
      text: best ? best.text : first.text,
      pinyin: best && best.pinyin ? best.pinyin : selected.map((item) => item.pinyin).filter(Boolean).join(" "),
      start: timed.length ? Math.min(...timed.map((item) => item.start)) : null,
      end: timed.length ? Math.max(...timed.map((item) => item.end)) : null,
      cjk: true,
    });
    index = end;
  }
  return result;
}

function readerFormatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function readerApplySettings() {
  const player = $("readerPlayer");
  if (player) {
    player.style.setProperty("--reader-fs", String(readerFontScale));
    player.classList.toggle("reader-hide-pinyin", !readerPinyinVisible);
    player.classList.toggle("reader-hide-thai", !readerThaiVisible);
  }
  const transcript = $("readerTranscript");
  if (transcript) {
    transcript.classList.toggle("reader-hide-pinyin", !readerPinyinVisible);
    transcript.classList.toggle("reader-hide-thai", !readerThaiVisible);
  }
  const pinyinButton = $("readerPinyinToggle");
  if (pinyinButton) {
    pinyinButton.setAttribute("aria-pressed", String(readerPinyinVisible));
    pinyinButton.textContent = "拼音";
    const label = readerPinyinVisible ? "ซ่อนพินอิน" : "แสดงพินอิน";
    pinyinButton.title = label;
    pinyinButton.setAttribute("aria-label", label);
  }
  const thaiButton = $("readerThaiToggle");
  if (thaiButton) {
    thaiButton.setAttribute("aria-pressed", String(readerThaiVisible));
    thaiButton.textContent = "ไทย";
    const label = readerThaiVisible ? "ซ่อนคำแปลไทย" : "แสดงคำแปลไทย";
    thaiButton.title = label;
    thaiButton.setAttribute("aria-label", label);
  }
  const altButton = $("readerAlternateBtn");
  if (altButton) {
    altButton.setAttribute("aria-pressed", String(readerAlternateEnabled));
    altButton.textContent = readerAlternateEnabled ? "🇨🇳↔🇹🇭 สลับจีน–ไทย: เปิด" : "🇨🇳↔🇹🇭 สลับจีน–ไทย: ปิด";
  }
  const nextButton = $("readerAutoNextBtn");
  if (nextButton) {
    nextButton.setAttribute("aria-pressed", String(readerAutoNextEnabled));
    nextButton.textContent = readerAutoNextEnabled ? "⏭ เล่นเรื่องถัดไป: เปิด" : "⏭ เล่นเรื่องถัดไป: ปิด";
  }
  const label = $("readerFontLabel");
  if (label) label.textContent = `${Math.round(readerFontScale * 100)}%`;
  const minus = $("readerFontMinus");
  const plus = $("readerFontPlus");
  if (minus) minus.disabled = readerFontScale <= READER_FS_MIN + 0.001;
  if (plus) plus.disabled = readerFontScale >= READER_FS_MAX - 0.001;
  readerSyncMoreBtn();
}

function readerPersist(key, value) {
  try { localStorage.setItem(key, value); } catch (error) {}
}

/* ---- กล่องตัวเลือกเพิ่มเติมของแถบตัวเล่น (⋯) ----------------------------
   แถบตัวเล่นต้องเตี้ยที่สุดเพื่อคืนพื้นที่ให้บทอ่าน ปุ่มที่ใช้เป็นครั้งคราว
   (ความเร็ว / สลับจีน–ไทย / เล่นเรื่องถัดไป / ตั้งเวลาปิด) จึงซ่อนไว้ในกล่องนี้ */
function readerApplyExtraOpen() {
  const box = $("readerExtra");
  const button = $("readerMoreBtn");
  if (!box || !button) return;
  box.hidden = !readerExtraOpen;
  button.setAttribute("aria-expanded", String(readerExtraOpen));
  const label = readerExtraOpen ? "ซ่อนตัวเลือกเพิ่มเติม" : "ตัวเลือกเพิ่มเติม";
  button.title = label;
  button.setAttribute("aria-label", label);
}

function readerToggleExtra() {
  readerExtraOpen = !readerExtraOpen;
  readerApplyExtraOpen();
}

// จุดสีบนปุ่ม "⋯" เมื่อ "เล่นเรื่องถัดไปอัตโนมัติ" เปิดค้างอยู่ (สถานะอื่นดูจากปุ่ม
// ในกล่อง และป้าย ⏱ บนแถบหัว)
function readerSyncMoreBtn() {
  const button = $("readerMoreBtn");
  if (!button) return;
  button.classList.toggle("has-active", readerAutoNextEnabled);
}

function readerStoryList() {
  const list = $("readerStoryList");
  if (!list || !readerRuntime) return;
  const query = $("readerSearch").value.trim().toLowerCase();
  const stories = readerRuntime.stories.filter((story) => story.level === readerLevel &&
    (!query || `${story.reader_story_number} ${story.title_zh} ${story.title_th}`.toLowerCase().includes(query)));
  list.replaceChildren();
  if (!stories.length) {
    const empty = document.createElement("p");
    empty.className = "pod-empty";
    empty.textContent = query ? "ไม่พบบทอ่านที่ค้นหา" : "ระดับนี้ยังไม่มีบทอ่าน";
    list.appendChild(empty);
  }
  for (const story of stories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-story-card";
    const thumb = document.createElement("img");
    thumb.className = "reader-story-thumb";
    thumb.alt = "";
    thumb.decoding = "async";
    const number = document.createElement("span");
    number.className = "reader-story-number-badge";
    number.textContent = String(story.story_number).padStart(2, "0");
    const copy = document.createElement("span");
    copy.className = "reader-story-copy";
    const title = document.createElement("strong");
    title.lang = "zh-CN";
    title.textContent = story.title_zh;
    const meta = document.createElement("small");
    meta.textContent = `${story.title_th || ""} · ${readerFormatTime(story.duration)}`;
    copy.append(title, meta);
    const play = document.createElement("span");
    play.className = "reader-story-play";
    play.textContent = "▶";
    button.append(thumb, number, copy, play);
    list.appendChild(button);
    crCoverImage(thumb, readerCoverUrl(story));
    button.addEventListener("click", () => readerSelectStory(story, true));
  }
  $("readerListStatus").textContent = query
    ? `HSK ${readerLevel} · พบ ${stories.length} เรื่อง`
    : `HSK ${readerLevel} · ${stories.length} เรื่อง · เปิดอ่านและฟังได้แบบออฟไลน์ใน APK`;
}

function readerMakeTranscript(story) {
  const root = $("readerTranscript");
  root.replaceChildren();
  const turns = story.turns || [];
  turns.forEach((turn, index) => {
    const article = document.createElement("article");
    article.className = "reader-turn";
    article.dataset.turn = String(index);
    article.dataset.start = String(turn.start);
    article.dataset.end = String(turn.end);
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", `ประโยคที่ ${index + 1}: ${turn.zh}`);

    const body = document.createElement("div");
    body.className = "reader-turn-body";

    const chinese = document.createElement("div");
    chinese.className = "reader-zh-line";
    chinese.lang = "zh-CN";
    // Tapping the Chinese text starts the story from that sentence. The empty
    // padding around the text and the Thai line stay inert — the ▶ button is
    // the explicit way to start a sentence.
    chinese.addEventListener("click", (event) => {
      if (event.target.closest(".reader-word")) return;
      sfx.click();
      readerPlayFromTurn(index);
    });
    const wordTokens = readerTokenizeChars(turn.tokens || []);
    for (const token of wordTokens) {
      if (token.cjk) {
        const cell = document.createElement("span");
        cell.className = "reader-word";
        cell.dataset.word = token.text;
        if (Number.isFinite(token.start)) cell.dataset.start = String(token.start);
        if (Number.isFinite(token.end)) cell.dataset.end = String(token.end);
        const hanzi = document.createElement("span");
        hanzi.className = "reader-word-hanzi";
        hanzi.textContent = token.text;
        const pinyin = document.createElement("small");
        pinyin.className = "reader-word-py";
        pinyin.lang = "zh-Latn";
        pinyin.textContent = token.pinyin || "";
        cell.append(hanzi, pinyin);
        // Tapping a word opens the same Thai-translation bubble as the podcast
        // and copy modes, including its "speak this word" button. While a
        // bubble is open the next outside tap only dismisses it.
        cell.addEventListener("click", (event) => {
          event.stopPropagation();
          if (readerBubbleOpen) {
            readerBubbleOpen = false;
            readerBubbleTap = null;
            if (typeof cpHideWordPopup === "function") cpHideWordPopup();
            return;
          }
          sfx.click();
          if (typeof cpShowWordPopup === "function") {
            cpShowWordPopup(token.text, cell);
            readerBubbleOpen = true;
          }
        });
        chinese.appendChild(cell);
      } else {
        chinese.appendChild(document.createTextNode(token.text));
      }
    }
    body.appendChild(chinese);

    const thaiText = (turn.thai || []).map((item) => item.text).filter(Boolean).join(" ");
    if (thaiText) {
      const thai = document.createElement("p");
      thai.className = "reader-thai";
      thai.lang = "th";
      thai.textContent = thaiText;
      body.appendChild(thai);
    }
    article.appendChild(body);

    // Explicit controls on the right of every sentence: replay from this turn,
    // or pause the narration to read at your own pace.
    const controls = document.createElement("div");
    controls.className = "reader-turn-controls";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "reader-replay";
    play.title = "เล่นตั้งแต่ประโยคนี้";
    play.setAttribute("aria-label", `เล่นตั้งแต่ประโยคที่ ${index + 1}`);
    play.textContent = "▶";
    play.addEventListener("click", (event) => {
      event.stopPropagation();
      sfx.click();
      readerPlayFromTurn(index);
    });
    const pause = document.createElement("button");
    pause.type = "button";
    pause.className = "reader-replay reader-pause";
    pause.title = "หยุดชั่วคราวเพื่ออ่านประโยคนี้";
    pause.setAttribute("aria-label", `หยุดเสียงชั่วคราวเพื่ออ่านประโยคที่ ${index + 1}`);
    pause.textContent = "⏸";
    pause.addEventListener("click", (event) => {
      event.stopPropagation();
      sfx.click();
      readerPause();
      $("readerStatus").textContent = "หยุดเสียงชั่วคราว · อ่านบทอ่านต่อได้ แล้วแตะ ▶ เพื่อฟังต่อ";
    });
    controls.append(play, pause);
    article.appendChild(controls);

    article.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        readerPlayFromTurn(index);
      }
    });
    root.appendChild(article);
  });
  root.classList.toggle("reader-hide-pinyin", !readerPinyinVisible);
  root.classList.toggle("reader-hide-thai", !readerThaiVisible);

  const questions = $("readerQuestionList");
  if (questions) questions.replaceChildren();
  readerMakeQuiz(story);
  $("readerQuestions").hidden = !(story.quiz || []).length;

  const note = $("readerAlignmentNote");
  note.hidden = !(story.weak_alignment || story.approximate_pairing);
  if (!note.hidden) {
    note.textContent = story.weak_alignment
      ? "จังหวะเน้นข้อความบางช่วงเป็นเวลาโดยประมาณ"
      : "บางช่วงคำพูดถูกรวมให้ตรงกับคำแปลไทยตามบทสนทนา";
  }
}

function readerResolveFile(path) {
  return readerAssetUrl(path);
}

// รูปประกอบเรื่อง (ไม่บังคับ) — <reader data root>/img/<id>.webp
// สร้างด้วย tools/gen_podcast_images.py --source reader; ถ้าไม่มีไฟล์ รูป/ปุ่มจะซ่อน
function readerCoverUrl(story) {
  return readerAssetUrl(`img/${story.id}.webp`);
}

// While the word bubble is open, the next tap outside it only dismisses the
// bubble: the tap is swallowed so it cannot start playback or open another
// word at the same time.
function readerInstallBubbleGuard() {
  document.addEventListener("pointerdown", (event) => {
    if (!readerBubbleOpen) { readerBubbleTap = null; return; }
    const popup = $("cpWordPopup");
    if (!popup || popup.hidden) {
      // The bubble was closed some other way (Escape / close button): the next
      // tap behaves normally again.
      readerBubbleOpen = false;
      readerBubbleTap = null;
      return;
    }
    if (popup.contains(event.target)) {
      readerBubbleTap = null;
      return;
    }
    readerBubbleTap = "dismiss";
    if (typeof cpHideWordPopup === "function") cpHideWordPopup();
    readerBubbleOpen = false;
  }, true);
  document.addEventListener("click", (event) => {
    if (readerBubbleTap !== "dismiss") return;
    readerBubbleTap = null;
    event.stopPropagation();
    event.preventDefault();
  }, true);
}

function readerMakeQuiz(story) {
  const root = $("readerQuizList");
  const score = $("readerQuizScore");
  if (!root) return;
  root.replaceChildren();
  if (score) score.textContent = "";
  const quiz = story.quiz || [];
  if (!quiz.length) return;

  const state = { answered: 0, correct: 0 };
  readerQuizState = state;

  quiz.forEach((question, questionIndex) => {    const block = document.createElement("section");
    block.className = "reader-quiz-item";

    const head = document.createElement("div");
    head.className = "reader-quiz-head";
    const title = document.createElement("p");
    title.className = "reader-quiz-question";
    title.lang = "zh-CN";
    title.textContent = `${questionIndex + 1}. ${question.question_zh}`;
    head.appendChild(title);
    const source = document.createElement("span");
    source.className = "reader-quiz-source";
    source.textContent = question.source === "gemini" ? "เพิ่มเติม" : "จากหนังสือ";
    head.appendChild(source);
    block.appendChild(head);

    if (question.question_th) {
      const thai = document.createElement("p");
      thai.className = "reader-quiz-question-th";
      thai.lang = "th";
      thai.textContent = question.question_th;
      block.appendChild(thai);
    }

    const options = document.createElement("div");
    options.className = "reader-quiz-options";
    (question.options || []).forEach((option, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reader-quiz-option";
      const zh = document.createElement("span");
      zh.className = "reader-quiz-option-zh";
      zh.lang = "zh-CN";
      zh.textContent = option.zh;
      button.appendChild(zh);
      if (option.th) {
        const thai = document.createElement("small");
        thai.className = "reader-quiz-option-th";
        thai.lang = "th";
        thai.textContent = option.th;
        button.appendChild(thai);
      }
      button.addEventListener("click", () => {
        if (block.dataset.answered === "1") return;
        block.dataset.answered = "1";
        state.answered++;
        const isCorrect = optionIndex === question.answer_index;
        if (isCorrect) state.correct++;
        button.classList.add(isCorrect ? "correct" : "wrong");
        if (!isCorrect) {
          const correctButton = options.children[question.answer_index];
          if (correctButton) correctButton.classList.add("correct");
        }
        for (const sibling of options.children) sibling.disabled = true;
        const verdict = document.createElement("p");
        verdict.className = `reader-quiz-verdict ${isCorrect ? "correct" : "wrong"}`;
        const correctOption = (question.options || [])[question.answer_index];
        verdict.textContent = isCorrect
          ? "✅ ถูกต้อง"
          : `❌ ยังไม่ใช่ — คำตอบคือ ${correctOption ? correctOption.zh : ""}`;
        block.appendChild(verdict);
        if (score) {
          score.textContent = `ตอบแล้ว ${state.answered}/${quiz.length} · ถูก ${state.correct}/${state.answered}`;
        }
        if (isCorrect) sfx.correct();
        else sfx.wrong();
      });
      options.appendChild(button);
    });
    block.appendChild(options);
    root.appendChild(block);
  });
}

function readerSetMediaState(state) {
  try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state; } catch (error) {}
}

function readerSetMetadata(story) {
  try {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${story.title_zh} · ${story.title_th || ""}`,
      artist: `Chinese Rocket · HSK ${story.level}`,
      album: "HSK Story Reader",
    });
  } catch (error) {}
}

function readerRegisterMediaActions() {
  // ในแอป Android ปุ่มหูฟังบลูทูธ/ล็อกสกรีนมาทาง MediaSession ฝั่งเนทีฟ
  // (NativeListenPlugin.setMediaSession) จึงไม่ลงทะเบียนซ้ำทาง JS —
  // ไม่งั้นปุ่ม "เรื่องถัดไป" อาจถูกสั่งสองครั้ง
  if (window.CR_OFFLINE_APP) return;
  try {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => {
      if (!readerState) return;
      if ($("readerAudio").ended) readerSeekTo(0, true, 0);
      else readerPlay();
    });
    navigator.mediaSession.setActionHandler("pause", readerPause);
    navigator.mediaSession.setActionHandler("stop", quitReaderGame);
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      const offset = details && details.seekOffset ? details.seekOffset : 10;
      readerSeekTo($("readerAudio").currentTime - offset, readerWantPlay);
    });
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      const offset = details && details.seekOffset ? details.seekOffset : 10;
      readerSeekTo($("readerAudio").currentTime + offset, readerWantPlay);
    });
    // ปุ่มก่อนหน้า/ถัดไป บนหูฟัง = เรื่องก่อนหน้า/เรื่องถัดไป (ไม่ใช่กรอกลับ)
    navigator.mediaSession.setActionHandler("previoustrack", () => readerGoToAdjacentStory(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => readerGoToAdjacentStory(1));
  } catch (error) {}
}

function readerRestoreMediaActions() {
  // Podcast is the existing default Media Session handler; listen mode
  // re-registers its own handlers whenever it starts.
  if (typeof podRegisterMediaActions === "function") podRegisterMediaActions();
}

function readerSyncBackgroundAudio() {
  const active = Boolean(readerState && (readerWantPlay || readerKeepAlive));
  crSetNativeBackgroundAudio(active);
  crSetScreenAwake(active); // จอไม่ดับขณะฟังบทความ ปล่อยเมื่อพัก/ปิดเรื่อง
  if (active) readerWatchStart();
  else readerWatchStop();
  readerSyncMediaButtons();
}

// ปุ่มบนหูฟังบลูทูธ / หน้าจอล็อก (แอป Android): บอกฝั่งเนทีฟว่ากำลังอ่านเรื่องไหน
// เพื่อให้ play/pause/previous/next ส่งกลับมาที่ window.crNativeMediaAction
function readerSyncMediaButtons() {
  const open = Boolean(readerState) && !$("readerPlayer").hidden;
  const title = open ? (readerState.story.title_zh || "") : "";
  crSetMediaButtons(open, open && readerWantPlay, title, "Chinese Rocket · บทอ่าน HSK");
}

// ---- ตัวเฝ้าดูการเล่นเบื้องหลัง -------------------------------------------
//  - ถ้า event "ended" หายไปตอนปิดหน้าจอ ให้เดินไปเรื่องถัดไปเอง
//  - ถ้าระบบหยุดคลิปเอง ให้สั่งเล่นต่อ
//  - การสลับจีน–ไทยอาศับ "timeupdate" ที่ถูกลดความถี่ตอนแอปอยู่เบื้องหลัง
//    จึงตรวจซ้ำจากตัวเฝ้าดูด้วย
function readerWatchStart() {
  if (readerWatchTimer !== null) return;
  readerWatchTimer = setInterval(readerWatch, 1500);
}

function readerWatchStop() {
  if (readerWatchTimer === null) return;
  clearInterval(readerWatchTimer);
  readerWatchTimer = null;
}

function readerWatch() {
  if (!readerState || !readerWantPlay) { readerWatchStop(); return; }
  if (readerIntroPlayback) {
    // ระหว่างอ่านชื่อเรื่อง ไฟล์เนื้อหายังไม่เริ่ม อย่าสั่งเล่นซ้ำ
    if (readerIntroPlayback.phase === "clip") {
      const introAudio = $("readerIntroAudio");
      if (introAudio && introAudio.paused && !introAudio.ended && !readerIsBusy()) readerResumeIntro();
    }
    return;
  }
  if (readerState.playback || readerIsBusy()) return;
  const audio = $("readerAudio");
  if (!audio || !audio.src) return;
  if (audio.ended) {
    readerEnded();
    return;
  }
  if (audio.paused) {
    readerResumeAudio();
    return;
  }
  readerMaybePlayThai(audio.currentTime);
}

function readerResumeAudio(attempt = 0) {
  if (!readerWantPlay || !readerState || readerIntroPlayback) return;
  const audio = $("readerAudio");
  if (!audio || !audio.src || !audio.paused || audio.ended) return;
  if (readerIsBusy()) return;
  if (attempt >= 4) return;
  setTimeout(() => {
    if (!readerWantPlay || !readerState) return;
    const el = $("readerAudio");
    if (!el.paused || el.ended) return;
    el.play().catch(() => readerResumeAudio(attempt + 1));
  }, 400 + attempt * 700);
}

/* ---- บันทึก/กู้คืนเรื่องที่กำลังอ่าน -------------------------------------
   ถ้า Android ฆ่าแอปตอนอยู่เบื้องหลัง หน้าเว็บจะโหลดใหม่และผู้ใช้จะเจอหน้า
   เมนู (หน้า Index) จึงเก็บเรื่องที่อ่านค้างไว้ เพื่อกลับมาเปิดเรื่องเดิมที่ตำแหน่งเดิม */
function readerSaveSession() {
  if (!readerState || !readerState.story) { crClearMediaSession(); return; }
  const story = readerState.story;
  const audio = $("readerAudio");
  crSaveMediaSession({
    mode: "reader",
    id: story.id,
    level: story.level,
    time: Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime) : 0,
    playing: Boolean(readerWantPlay),
  });
}

function readerSaveSessionSoon() {
  if (readerSaveTimer !== null) return;
  readerSaveTimer = setTimeout(() => {
    readerSaveTimer = null;
    readerSaveSession();
  }, 4000);
}

function readerRestorePosition(time) {
  const target = Number(time) || 0;
  if (target <= 1) return;
  const audio = $("readerAudio");
  const apply = () => {
    try {
      const max = Number.isFinite(audio.duration) ? audio.duration : target;
      audio.currentTime = Math.min(target, Math.max(0, max - 0.5));
    } catch (error) { /* เสียงยังโหลดไม่เสร็จ */ }
  };
  if (audio.readyState >= 1) apply();
  else audio.addEventListener("loadedmetadata", apply, { once: true });
}

async function readerRestoreSession(session) {
  if (!session || !session.id) return false;
  await readerLoadData();
  const story = readerRuntime.stories.find((item) => item.id === session.id);
  if (!story) return false;
  readerLevel = [1, 2, 3].includes(story.level) ? story.level : readerLevel;
  readerUpdateLevelButtons();
  readerSelectStory(story, Boolean(session.playing), false);
  readerRestorePosition(session.time);
  return true;
}

function readerThaiText(turn) {
  return (turn.thai || []).map((item) => item.text).filter(Boolean).join(" ");
}

/* ---- เสียงอ่านชื่อเรื่องก่อนเนื้อหา --------------------------------------
   ลำดับ: ชื่อเรื่องภาษาจีน → ชื่อเรื่องภาษาไทย → พัก 2 วินาที → บทอ่าน
   ไฟล์เสียงแยกจากตัวเรื่อง จึงไม่กระทบตำแหน่งคาราโอเกะของเนื้อหา */
function readerIntroClips(story) {
  if (!story || !story.id) return null;
  return {
    zh: readerAssetUrl(`intro_zh/${story.id}.mp3`),
    th: readerAssetUrl(`intro_th/${story.id}.mp3`),
  };
}

function readerClearIntro() {
  const state = readerIntroPlayback;
  if (state && state.timer) clearTimeout(state.timer);
  readerIntroPlayback = null;
  const audio = $("readerIntroAudio");
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

function readerIntroActive() {
  return Boolean(readerIntroPlayback);
}

function readerPlayIntroClip() {
  const state = readerIntroPlayback;
  if (!state || !readerWantPlay) return;
  const lang = state.index === 0 ? "zh" : "th";
  const audio = $("readerIntroAudio");
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.phase = "clip";
  state.token = ++readerIntroCounter;
  audio.pause();
  audio.src = state.clips[lang];
  audio.playbackRate = Number($("readerRate").value) || 1;
  audio.load();
  $("readerPlayBtn").textContent = "⏸ พัก";
  readerSetMediaState("playing");
  $("readerStatus").textContent = lang === "zh"
    ? `🎧 ชื่อเรื่องภาษาจีน · ${state.story.title_zh}`
    : `🎧 ชื่อเรื่องภาษาไทย · ${state.story.title_th || ""}`;
  audio.play().catch(() => {
    if (readerIntroPlayback === state) readerAdvanceIntro(state.token);
  });
}

function readerAdvanceIntro(token) {
  const state = readerIntroPlayback;
  if (!state || !readerWantPlay) return;
  if (token !== undefined && token !== state.token) return; // เหตุการณ์ค้างจากคลิปก่อน
  if (state.index === 0) {
    state.index = 1;
    readerPlayIntroClip();
    return;
  }
  state.phase = "gap";
  state.remaining = 2000;
  $("readerStatus").textContent = "จบการอ่านชื่อเรื่อง · เริ่มบทอ่านในอีก 2 วินาที";
  readerScheduleIntroGap();
}

function readerScheduleIntroGap() {
  const state = readerIntroPlayback;
  if (!state || !readerWantPlay || state.phase !== "gap") return;
  if (state.timer) clearTimeout(state.timer);
  const token = state.token;
  state.timer = setTimeout(() => {
    if (readerIntroPlayback !== state || token !== state.token || !readerWantPlay) return;
    readerClearIntro();
    readerPlay();
  }, Math.max(0, state.remaining));
}

function readerStartIntro(story) {
  if (readerIntroUnavailable) return false;
  const clips = readerIntroClips(story);
  if (!clips) return false;
  readerClearIntro();
  readerIntroPlayback = { story, clips, index: 0, phase: "clip", timer: null, token: ++readerIntroCounter };
  readerWantPlay = true;
  readerSyncBackgroundAudio();
  readerPlayIntroClip();
  return true;
}

function readerResumeIntro() {
  const state = readerIntroPlayback;
  if (!state) return false;
  readerWantPlay = true;
  readerSyncBackgroundAudio();
  $("readerPlayBtn").textContent = "⏸ พัก";
  readerSetMediaState("playing");
  if (state.phase === "gap") readerScheduleIntroGap();
  else $("readerIntroAudio").play().catch(() => {
    if (readerIntroPlayback === state) readerAdvanceIntro(state.token);
  });
  return true;
}

function readerSelectStory(story, resume = false, withIntro = true) {
  // สลับเรื่องตอนเล่นอัตโนมัติต้องไม่ปิดบริการ foreground คั่นระหว่างทาง
  // (Android 12+ เริ่มบริการใหม่จากเบื้องหลังไม่ได้ → เสียงจะหยุด)
  const wasPlaying = readerWantPlay || resume;
  readerKeepAlive = wasPlaying;
  readerStopCurrentAudio(true);
  readerState = { story, nextTurn: 0, activeTurn: -1, playback: null, resume };
  readerEndedFor = null;
  readerShowPlayerView(true);
  $("readerHeading").textContent = story.title_zh;
  $("readerStoryNumber").textContent = `HSK ${story.level} · STORY ${story.reader_story_number}`;
  $("readerTitle").textContent = story.title_zh;
  $("readerTitlePinyin").textContent = story.title_pinyin || "";
  $("readerMeta").textContent = `${story.title_th || ""} · ${readerFormatTime(story.duration)} · ${story.turns.length} ช่วงบทพูด`;
  crCoverImage($("readerCover"), readerCoverUrl(story));
  $("readerStatus").textContent = "แตะประโยคเพื่อเริ่มฟังจากช่วงนั้น";
  $("readerPlayer").scrollTop = 0;
  readerMakeTranscript(story);
  readerRegisterMediaActions();
  crSetNotificationText(`กำลังอ่าน · ${story.title_zh}`, "เล่นต่อได้แม้ปิดหน้าจอ");

  const audio = $("readerAudio");
  audio.src = readerResolveFile(story.zh_audio);
  audio.playbackRate = Number($("readerRate").value) || 1;
  audio.load();
  readerBusy(6000); // กำลังโหลดเรื่องใหม่ อย่าสั่งเล่นซ้ำระหว่างนี้
  $("readerPlayBtn").textContent = "▶ เล่น";
  readerSetMetadata(story);
  readerSetMediaState("paused");
  switchScreen($("reader"));
  readerSyncBackgroundAudio(); // ยังถือบริการไว้ตอนสลับเรื่อง
  requestAnimationFrame(() => { $("readerPlayer").scrollTop = 0; });
  if (resume) {
    // เปิดเรื่องใหม่ → อ่านชื่อเรื่องจีน/ไทยก่อน แล้วค่อยเข้าบทอ่าน
    if (!(withIntro && readerStartIntro(story))) readerPlay();
  } else {
    readerKeepAlive = false;
    readerSyncBackgroundAudio();
  }
  readerSaveSession();
}

function readerPlay(attempt = 0) {
  if (!readerState) return;
  readerWantPlay = true;
  readerEndedFor = null;
  readerSyncBackgroundAudio();
  if (readerResumeIntro()) return; // กำลังอ่านชื่อเรื่องอยู่ → เล่นชื่อเรื่องต่อ
  const audio = $("readerAudio");
  if (!audio.src) return;
  audio.play().then(() => {
    $("readerPlayBtn").textContent = "⏸ พัก";
    readerSetMediaState("playing");
    $("readerStatus").textContent = readerAlternateEnabled
      ? "ฟังภาษาจีน แล้วตามด้วยเสียงแปลไทยแต่ละช่วง"
      : "กำลังฟังเสียงภาษาจีนต้นฉบับ";
    readerUpdateProgress();
    readerMaybePlayThai(audio.currentTime);
  }).catch(() => {
    // บางครั้ง WebView ยังไม่พร้อมเล่นเสียง (เช่น หลังสลับแอป) — ลองใหม่ได้ไม่กี่ครั้ง
    if (attempt < 3 && readerWantPlay && readerState) {
      setTimeout(() => readerPlay(attempt + 1), 600 + attempt * 500);
      return;
    }
    readerWantPlay = false;
    readerSyncBackgroundAudio();
    $("readerPlayBtn").textContent = "▶ เล่น";
    $("readerStatus").textContent = "เปิดเสียงบทอ่านไม่ได้ — ลองแตะเล่นอีกครั้ง";
    readerSetMediaState("paused");
  });
}

function readerPause(keepAlive = false) {
  readerSeekSequence++;
  readerWantPlay = false;
  if (readerState) readerState.playback = null;
  const audio = $("readerAudio");
  const thaiAudio = $("readerThaiAudio");
  audio.pause();
  thaiAudio.pause();
  // หยุดเสียงชื่อเรื่องไว้ชั่วคราว (กด ▶ อีกครั้งจะอ่านชื่อเรื่องต่อ)
  const introAudio = $("readerIntroAudio");
  if (introAudio && readerIntroPlayback) introAudio.pause();
  thaiAudio.removeAttribute("src");
  thaiAudio.load();
  $("readerPlayBtn").textContent = "▶ เล่น";
  readerSetMediaState("paused");
  if (!keepAlive) readerSyncBackgroundAudio();
}

function readerStopCurrentAudio(keepAlive = false) {
  readerClearIntro();
  readerPause(keepAlive);
  const audio = $("readerAudio");
  audio.removeAttribute("src");
  audio.load();
  readerState = null;
}

function readerPlayThaiClip() {
  const playback = readerState && readerState.playback;
  if (!playback || !readerWantPlay) return;
  if (playback.clipIndex >= playback.turn.thai.length) {
    readerState.nextTurn = playback.turnIndex + 1;
    readerState.activeTurn = playback.turnIndex;
    readerState.playback = null;
    readerSyncBackgroundAudio();
    readerPlay();
    return;
  }
  const item = playback.turn.thai[playback.clipIndex];
  const audio = $("readerThaiAudio");
  audio.playbackRate = Number($("readerRate").value) || 1;
  audio.src = readerResolveFile(item.file);
  audio.load();
  $("readerStatus").textContent = `เสียงแปลไทย · ช่วงที่ ${playback.turnIndex + 1}/${readerState.story.turns.length}`;
  audio.play().catch(() => {
    // Keep the Mandarin track usable even if one local TTS clip is unavailable.
    playback.clipIndex = playback.turn.thai.length;
    readerPlayThaiClip();
  });
}

function readerMaybePlayThai(time) {
  if (!readerState || !readerWantPlay || !readerAlternateEnabled || readerState.playback) return;
  const index = readerState.nextTurn;
  const turn = readerState.story.turns[index];
  if (!turn || time + 0.04 < turn.end) return;
  $("readerAudio").pause();
  readerState.activeTurn = index;
  readerState.playback = { turn, turnIndex: index, clipIndex: 0 };
  readerRenderActiveTurn();
  readerRenderActiveWord();
  readerPlayThaiClip();
}

// Start playing at the given sentence and keep going: the Mandarin turn plays,
// its Thai clip follows, and the story continues with the sentences below
// exactly like normal playback.
function readerPlayFromTurn(index) {
  if (!readerState) return;
  const turn = readerState.story.turns[index];
  if (!turn) return;
  readerPause();
  readerClearIntro();
  readerState.activeTurn = index;
  readerState.nextTurn = index;
  readerRenderActiveTurn();
  readerRenderActiveWord();
  const audio = $("readerAudio");
  const start = Math.max(0, turn.start);
  const sequence = ++readerSeekSequence;
  const onSeeked = () => {
    audio.removeEventListener("seeked", onSeeked);
    if (sequence !== readerSeekSequence || !readerState) return;
    readerWantPlay = true;
    readerSyncBackgroundAudio();
    audio.play().then(() => {
      $("readerPlayBtn").textContent = "⏸ พัก";
      readerSetMediaState("playing");
      $("readerStatus").textContent = `กำลังเล่นตั้งแต่ประโยคที่ ${index + 1}`;
    }).catch(() => {
      readerWantPlay = false;
      readerSyncBackgroundAudio();
      $("readerPlayBtn").textContent = "▶ เล่น";
      readerSetMediaState("paused");
    });
  };
  audio.addEventListener("seeked", onSeeked);
  try {
    audio.currentTime = start;
    if (!audio.seeking && Math.abs(audio.currentTime - start) < 0.05) {
      audio.removeEventListener("seeked", onSeeked);
      onSeeked();
    }
  } catch (error) {
    audio.removeEventListener("seeked", onSeeked);
  }
}

function readerUpdateProgress() {
  const audio = $("readerAudio");
  if (!readerState) return;
  if (!readerSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    $("readerSeek").value = String(Math.round(audio.currentTime / audio.duration * 1000));
  }
  $("readerCurrentTime").textContent = readerFormatTime(audio.currentTime);
  if (Number.isFinite(audio.duration)) $("readerDuration").textContent = readerFormatTime(audio.duration);
  if (!readerAlternateEnabled) {
    while (readerState.nextTurn < readerState.story.turns.length &&
        readerState.story.turns[readerState.nextTurn].end <= audio.currentTime) {
      readerState.activeTurn = readerState.nextTurn;
      readerState.nextTurn++;
    }
  }
  if (!readerState.playback) {
    const active = readerState.story.turns.findIndex((turn) =>
      audio.currentTime >= turn.start && audio.currentTime <= turn.end);
    if (active >= 0) readerState.activeTurn = active;
  }
  readerRenderActiveTurn();
  readerRenderActiveWord();
}

function readerKeepTurnVisible(active, word) {
  if (!active) return;
  const player = $("readerPlayer");
  const viewport = player.getBoundingClientRect();
  const sticky = $("reader").querySelector(".reader-sticky-controls");
  const safeTop = Math.max(viewport.top + 4, sticky ? sticky.getBoundingClientRect().bottom + 8 : viewport.top);
  const safeBottom = viewport.bottom - 8;
  const available = safeBottom - safeTop;
  if (available <= 0) return;
  const rect = active.getBoundingClientRect();
  let delta;
  if (rect.height <= available) {
    // ประโยคที่กำลังเล่นปักไว้ที่ขอบบนของพื้นที่อ่าน (แบบ teleprompter)
    delta = rect.top - safeTop;
  } else {
    // ประโยคยาวเกินหนึ่งหน้าจอ: ตามคำที่กำลังไฮไลต์แทน
    const focus = word ? word.getBoundingClientRect() : rect;
    if (focus.top < safeTop) delta = focus.top - safeTop;
    else if (focus.bottom > safeBottom) delta = focus.bottom - safeBottom;
    else return;
  }
  if (Math.abs(delta) > 2) {
    player.scrollBy({ top: delta, behavior: Math.abs(delta) > available * 0.8 ? "auto" : "smooth" });
  }
}

function readerRenderActiveTurn() {
  if (!readerState) return;
  const index = readerState.activeTurn;
  const active = $("readerTranscript").querySelector(`[data-turn="${index}"]`);
  const current = $("readerTranscript").querySelector(".reader-turn.reader-current");
  if (current === active) return;
  if (current) current.classList.remove("reader-current");
  if (!active) return;
  active.classList.add("reader-current");
  readerKeepTurnVisible(active, active.querySelector(".reader-word-current"));
}

function readerRenderActiveWord() {
  const transcript = $("readerTranscript");
  const previous = transcript.querySelector(".reader-word-current");
  if (previous) previous.classList.remove("reader-word-current");
  if (!readerState || readerState.playback || readerState.activeTurn < 0) return;
  const row = transcript.querySelector(`[data-turn="${readerState.activeTurn}"]`);
  if (!row) return;
  const time = $("readerAudio").currentTime;
  for (const word of row.querySelectorAll(".reader-word[data-start][data-end]")) {
    const start = Number(word.dataset.start), end = Number(word.dataset.end);
    if (time >= start && time <= end) {
      word.classList.add("reader-word-current");
      // ประโยคที่ยาวเกินหน้าจอ: เลื่อนตามคำที่กำลังออกเสียง
      readerKeepTurnVisible(row, word);
      return;
    }
  }
}

let readerSeeking = false;
function readerSeekTo(time, resume = false, turnIndex = null) {
  if (!readerState) return;
  readerPause();
  readerClearIntro(); // ข้ามเสียงชื่อเรื่องเมื่อผู้ใช้เลือกตำแหน่งเอง
  const audio = $("readerAudio");
  const target = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : time, Number(time) || 0));
  if (turnIndex !== null) {
    readerState.nextTurn = turnIndex;
    readerState.activeTurn = turnIndex;
  } else {
    const next = readerState.story.turns.findIndex((turn) => turn.end > target);
    readerState.nextTurn = next < 0 ? readerState.story.turns.length : next;
    readerState.activeTurn = next;
  }
  const sequence = ++readerSeekSequence;
  const finish = () => {
    if (sequence !== readerSeekSequence) return;
    audio.removeEventListener("seeked", finish);
    readerUpdateProgress();
    if (resume) readerPlay();
  };
  audio.addEventListener("seeked", finish);
  try { audio.currentTime = target; }
  catch (error) { audio.removeEventListener("seeked", finish); }
  if (!audio.seeking && Math.abs(audio.currentTime - target) < 0.05) queueMicrotask(finish);
}

function readerSeekTurn(index, play = true) {
  if (!readerState) return;
  const turn = readerState.story.turns[index];
  if (!turn) return;
  readerSeekTo(turn.start, play, index);
}

function readerNextStory() {
  if (!readerAutoNextEnabled) return false;
  return readerOpenAdjacentStory(1);
}

function readerOpenAdjacentStory(delta) {
  if (!readerState) return false;
  const stories = readerRuntime.stories.filter((story) => story.level === readerLevel);
  const index = stories.findIndex((story) => story.id === readerState.story.id);
  const next = stories[(index + delta + stories.length) % stories.length];
  if (!next) return false;
  readerSelectStory(next, true);
  return true;
}

// ปุ่มในตัวเล่น / ปุ่มหูฟังบลูทูธ: เปลี่ยนเรื่องก่อนหน้า–ถัดไป (วนเมื่อสุดทาง)
// พร้อมบอกว่าไปเรื่องไหน (ถ้าตอนนั้นหยุดพักอยู่ — ถ้าเล่นอยู่ ข้อความของ
// readerSelectStory/readerPlay จะเป็นตัวบอกสถานะแทน)
function readerGoToAdjacentStory(delta) {
  if (!readerState) return false;
  const stories = readerRuntime.stories.filter((story) => story.level === readerLevel);
  const index = stories.findIndex((story) => story.id === readerState.story.id);
  const target = stories.length
    ? stories[(index + delta + stories.length) % stories.length]
    : null;
  const wasPlaying = readerWantPlay;
  if (!readerOpenAdjacentStory(delta)) return false;
  if (target && !wasPlaying) {
    const wrapped = stories.length > 1 && (delta < 0 ? index === 0 : index === stories.length - 1);
    const label = delta < 0 ? "⏮ เรื่องก่อนหน้า" : "⏭ เรื่องถัดไป";
    const loop = wrapped ? (delta < 0 ? " (วนกลับเรื่องสุดท้าย)" : " (วนกลับเรื่องแรก)") : "";
    $("readerStatus").textContent = `${label} · ${target.title_zh}${loop}`;
  }
  return true;
}

// จบเรื่อง: เรียกได้ทั้งจาก event "ended" และจากตัวเฝ้าดู (event อาจหายไป
// ตอนปิดหน้าจอ/สลับแอป) จึงต้องกันการเดินซ้ำสองครั้ง
function readerEnded() {
  if (!readerState) return;
  const audio = $("readerAudio");
  if (!audio.ended) return;
  const story = readerState.story;
  if (readerEndedFor === story) return;
  if (audio.getAttribute("src") !== readerResolveFile(story.zh_audio)) return; // เหตุการณ์ค้างจากเรื่องก่อน
  readerEndedFor = story;
  if (readerAlternateEnabled && readerState && readerWantPlay) {
    readerMaybePlayThai($("readerAudio").currentTime);
    if (readerState.playback) return;
  }
  if (readerNextStory()) return;
  readerWantPlay = false;
  readerState.playback = null;
  $("readerPlayBtn").textContent = "▶ เล่นอีกครั้ง";
  $("readerStatus").textContent = "จบบทอ่านแล้ว";
  readerSetMediaState("paused");
  readerSyncBackgroundAudio();
}

// สลับหน้า รายการบทอ่าน ↔ หน้าเนื้อหาบทอ่าน — ตอนอยู่หน้าเนื้อหา ปุ่ม ✖️ ออกจากโหมด
// ถูกแทนด้วยปุ่ม "เลือกบทอ่าน" (กลับรายการ) ตามที่ผู้ใช้ขอ ออกจากโหมดทำที่หน้ารายการ
function readerShowPlayerView(on) {
  $("readerPlayer").hidden = !on;
  $("readerLibrary").hidden = on;
  $("readerSelectBtn").hidden = !on;
  $("readerQuitBtn").hidden = on;
}

function readerBackToList() {
  readerStopCurrentAudio();
  readerRestoreMediaActions();
  crClearMediaSession();
  readerShowPlayerView(false);
  $("readerHeading").textContent = "เลือกบทอ่าน";
  readerSetMediaState("none");
  readerSyncMediaButtons();
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (error) {}
  readerStoryList();
}

function quitReaderGame() {
  readerStopCurrentAudio();
  readerRestoreMediaActions();
  crClearMediaSession();
  readerShowPlayerView(false);
  $("readerHeading").textContent = "เลือกบทอ่าน";
  readerSetMediaState("none");
  readerSyncMediaButtons();
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (error) {}
  switchScreen(menuEl);
}

async function startReaderGame() {
  switchScreen($("reader"));
  readerShowPlayerView(false);
  $("readerHeading").textContent = "เลือกบทอ่าน";
  $("readerSearch").value = "";
  $("readerListStatus").textContent = "กำลังโหลดบทอ่านส่วนตัวในเครื่อง…";
  $("readerStoryList").replaceChildren();
  readerApplySettings();
  try {
    await readerLoadData();
  } catch (error) {
    $("readerListStatus").textContent = error.message || "โหลดข้อมูลบทอ่านไม่ได้";
    return;
  }
  if (document.querySelector(".screen.active") !== $("reader")) return;
  readerRestoreMediaActions();
  readerLevel = [1, 2, 3].includes(readerLevel) ? readerLevel : 1;
  readerStoryList();
  readerUpdateLevelButtons();
  readerSetMediaState("none");
}

function readerUpdateLevelButtons() {
  for (const button of $("readerLevelTabs").querySelectorAll("[data-reader-level]")) {
    const selected = Number(button.dataset.readerLevel) === readerLevel;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function readerSetLevel(level) {
  readerLevel = Number(level);
  readerPersist(READER_LEVEL_KEY, String(readerLevel));
  readerUpdateLevelButtons();
  readerStoryList();
}

function readerGoToNextTurn() {
  if (!readerState) return;
  const next = readerState.nextTurn;
  if (next < readerState.story.turns.length) readerSeekTurn(next, true);
}

function readerHandleThaiEnded() {
  const playback = readerState && readerState.playback;
  if (!playback || !readerWantPlay) return;
  playback.clipIndex++;
  readerPlayThaiClip();
}

// ---- interface wiring ---------------------------------------------------
$("readerQuitBtn").addEventListener("click", () => { sfx.click(); quitReaderGame(); });
$("readerSelectBtn").addEventListener("click", () => { sfx.click(); readerBackToList(); });
$("readerMoreBtn").addEventListener("click", () => { sfx.click(); readerToggleExtra(); });
readerApplyExtraOpen();
readerSyncMoreBtn();
$("readerSearch").addEventListener("input", readerStoryList);
$("readerLevelTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-reader-level]");
  if (!button) return;
  sfx.click();
  readerSetLevel(button.dataset.readerLevel);
});
$("readerPlayBtn").addEventListener("click", () => {
  sfx.click();
  if (readerWantPlay) readerPause();
  else {
    if (readerState && $("readerAudio").ended) readerSeekTo(0, true, 0);
    else readerPlay();
  }
});
$("readerRewindBtn").addEventListener("click", () => readerSeekTo($("readerAudio").currentTime - 10, readerWantPlay));
$("readerForwardBtn").addEventListener("click", () => readerSeekTo($("readerAudio").currentTime + 10, readerWantPlay));
// ปุ่มเรื่องก่อนหน้า / เรื่องถัดไป ในแถบตัวเล่น
$("readerPrevBtn").addEventListener("click", () => {
  sfx.click();
  readerGoToAdjacentStory(-1);
});
$("readerNextBtn").addEventListener("click", () => {
  sfx.click();
  readerGoToAdjacentStory(1);
});
$("readerSeek").addEventListener("input", () => {
  if (!readerState || !Number.isFinite($("readerAudio").duration)) return;
  readerSeeking = true;
  const target = Number($("readerSeek").value) / 1000 * $("readerAudio").duration;
  $("readerCurrentTime").textContent = readerFormatTime(target);
});
$("readerSeek").addEventListener("change", () => {
  if (!readerState || !Number.isFinite($("readerAudio").duration)) return;
  const target = Number($("readerSeek").value) / 1000 * $("readerAudio").duration;
  readerSeeking = false;
  readerSeekTo(target, readerWantPlay);
});
$("readerRate").addEventListener("change", () => {
  const rate = Number($("readerRate").value) || 1;
  $("readerAudio").playbackRate = rate;
  $("readerThaiAudio").playbackRate = rate;
  $("readerIntroAudio").playbackRate = rate;
});
$("readerAlternateBtn").addEventListener("click", () => {
  readerAlternateEnabled = !readerAlternateEnabled;
  readerPersist(READER_ALT_KEY, readerAlternateEnabled ? "1" : "0");
  readerApplySettings();
  if (readerState && readerWantPlay) {
    if (!readerAlternateEnabled) {
      readerThaiAudioPause();
      readerSkipPastCurrentTime();
      readerPlay();
    } else {
      readerMaybePlayThai($("readerAudio").currentTime);
    }
  }
});
$("readerAutoNextBtn").addEventListener("click", () => {
  readerAutoNextEnabled = !readerAutoNextEnabled;
  readerPersist(READER_NEXT_KEY, readerAutoNextEnabled ? "1" : "0");
  readerApplySettings();
});
$("readerPinyinToggle").addEventListener("click", () => {
  readerPinyinVisible = !readerPinyinVisible;
  readerPersist(READER_PINYIN_KEY, readerPinyinVisible ? "1" : "0");
  readerApplySettings();
});
$("readerThaiToggle").addEventListener("click", () => {
  readerThaiVisible = !readerThaiVisible;
  readerPersist(READER_THAI_KEY, readerThaiVisible ? "1" : "0");
  readerApplySettings();
});
$("readerFontMinus").addEventListener("click", () => readerSetFontScale(readerFontScale - 0.1));
$("readerFontPlus").addEventListener("click", () => readerSetFontScale(readerFontScale + 0.1));
$("readerThaiAudio").addEventListener("ended", readerHandleThaiEnded);
$("readerIntroAudio").addEventListener("ended", () => {
  const state = readerIntroPlayback;
  if (!state || state.phase !== "clip") return;
  readerAdvanceIntro(state.token);
});
$("readerIntroAudio").addEventListener("error", () => {
  const state = readerIntroPlayback;
  if (!state || state.phase !== "clip") return;
  // ไฟล์เสียงชื่อเรื่องหาย (เช่น APK รุ่นเก่าที่ยังไม่มี) → ข้ามไปเล่นบทอ่าน
  state.failed = (state.failed || 0) + 1;
  if (state.failed >= 2) readerIntroUnavailable = true;
  readerAdvanceIntro(state.token);
});
$("readerAudio").addEventListener("timeupdate", () => {
  if (!readerState) return;
  readerUpdateProgress();
  readerMaybePlayThai($("readerAudio").currentTime);
  readerSaveSessionSoon();
  // ตัวจับเวลาปิดอัตโนมัติ: เช็กจาก timeupdate ด้วย เพื่อให้หยุดตรงเวลาแม้
  // นาฬิกา JS ถูกลดความถี่ตอนแอปอยู่เบื้องหลัง
  crSleepTick();
});
$("readerAudio").addEventListener("loadedmetadata", readerUpdateProgress);
$("readerAudio").addEventListener("ended", readerEnded);
$("readerAudio").addEventListener("pause", () => {
  if (!readerState) return;
  if (readerState.playback) return;
  if (readerWantPlay) {
    // ระบบอาจหยุดคลิปเองตอนปิดหน้าจอ/สลับแอป — สั่งเล่นต่อให้อัตโนมัติ
    // (ผู้ใช้ที่กดพักเองจะตั้ง readerWantPlay = false ไว้แล้ว จึงไม่กระทบ)
    readerResumeAudio();
    return;
  }
  $("readerPlayBtn").textContent = "▶ เล่น";
  readerSetMediaState("paused");
});
document.addEventListener("visibilitychange", () => {
  if (!readerState) return;
  if (document.hidden) {
    readerSaveSession(); // บันทึกตำแหน่งไว้ก่อน เผื่อระบบฆ่าแอปตอนอยู่เบื้องหลัง
    return;
  }
  if (!readerWantPlay) return;
  readerSyncBackgroundAudio();
  if (readerState.playback) {
    if ($("readerThaiAudio").paused) readerPlayThaiClip();
  } else if ($("readerAudio").paused) {
    readerPlay();
  }
});

function readerSetFontScale(value) {
  readerFontScale = Math.min(READER_FS_MAX, Math.max(READER_FS_MIN, Math.round(value * 10) / 10));
  readerPersist(READER_FONT_KEY, String(readerFontScale));
  readerApplySettings();
}

function readerSkipPastCurrentTime() {
  if (!readerState) return;
  const time = $("readerAudio").currentTime;
  while (readerState.nextTurn < readerState.story.turns.length && readerState.story.turns[readerState.nextTurn].end <= time) {
    readerState.activeTurn = readerState.nextTurn;
    readerState.nextTurn++;
  }
}

function readerThaiAudioPause() {
  const thaiAudio = $("readerThaiAudio");
  thaiAudio.pause();
  thaiAudio.removeAttribute("src");
  thaiAudio.load();
  if (readerState) readerState.playback = null;
  readerSyncBackgroundAudio();
}

/* ---- ตั้งเวลาปิดเล่นอัตโนมัติ ------------------------------------------
   เลือกได้ 5-60 นาที เมื่อครบเวลาจะหยุดเสียงทันที (ปิดทั้งคลิปจีนและคลิปแปลไทย)
   และหยุด "เล่นเรื่องถัดไปอัตโนมัติ" ด้วย เพื่อไม่ให้เดินต่อเองหลังหยุด */
function readerSleepExpire() {
  readerWantPlay = false;
  readerPause();
  $("readerStatus").textContent = "หยุดอ่านอัตโนมัติ · ครบเวลาที่ตั้งไว้";
  readerSaveSession();
}

crSleepRegister({
  button: $("readerSleepBtn"),
  hint: $("readerSleepHint"),
  options: $("readerSleepOptions"),
  showTime: true,
  idleLabel: "🌙 ตั้งเวลาปิด: ปิด",
  idleHint: "",
  active: () => document.querySelector(".screen.active") === $("reader"),
  onExpire: readerSleepExpire,
});

readerApplySettings();
readerInstallBubbleGuard();
if (READER_LOCAL_PREVIEW && READER_PARAMS.get("openReader") === "1") {
  queueMicrotask(() => startReaderGame());
}

/* ---- กู้คืนหน้าจอเมื่อแอปถูกระบบฆ่าแล้วเปิดใหม่ ------------------
   ถ้า Android ฆ่าแอปตอนอยู่เบื้องหลัง หน้าเว็บจะโหลดใหม่และผู้ใช้จะเจอหน้า
   เมนู (หน้า Index) แทนที่จะกลับไปที่ตอน/เรื่องที่กำลังฟัง จึงเก็บสถานะไว้
   แล้วเปิดกลับไปที่เดิมพร้อมตำแหน่งเดิม */
async function crRestoreMediaSession() {
  if (!window.CR_OFFLINE_APP) return;
  const session = crLoadMediaSession();
  if (!session || !session.mode) return;
  try {
    if (session.mode === "podcast") {
      if (typeof podRestoreSession === "function") await podRestoreSession(session);
    } else if (session.mode === "reader") {
      await readerRestoreSession(session);
    }
  } catch (error) {
    // กู้คืนไม่สำเร็จก็ปล่อยให้ผู้ใช้เลือกเองจากหน้าเมนู
  }
}

if (window.CR_OFFLINE_APP) {
  const restore = () => setTimeout(() => { crRestoreMediaSession(); }, 400);
  if (document.readyState === "complete") restore();
  else window.addEventListener("load", restore, { once: true });
}

/* ---- ปุ่มหูฟังบลูทูธ (แอป Android) ------------------------------------
   MediaSession ฝั่งเนทีฟ (NativeListenPlugin.setMediaSession) เรียกฟังก์ชันนี้
   เมื่อผู้ใช้กด play/pause/เรื่องก่อนหน้า/เรื่องถัดไป/หยุด บนหูฟัง การแจ้งเตือน
   หรือหน้าจอล็อก — เลือกโหมดที่กำลังเปิดอยู่ (พอดแคสต์ บทอ่าน หรือฝึกฟัง) ให้เอง
   ทำซ้ำได้ปลอดภัย (กด play ตอนเล่นอยู่แล้ว = ไม่ทำอะไร) */
window.crNativeMediaAction = function crNativeMediaAction(action) {
  const name = String(action || "");
  if (!name) return;
  try {
    if (typeof podcastState !== "undefined" && podcastState) {
      if (name === "play") { if (!podWantPlay) podPlay(); return; }
      if (name === "pause" || name === "stop") { if (podWantPlay || podThaiVoicePlayback) podPause(); return; }
      if (name === "nexttrack") { podGoToNextEpisode(true); return; }
      if (name === "previoustrack") { podGoToPreviousEpisode(true); return; }
      return;
    }
    if (typeof readerState !== "undefined" && readerState) {
      if (name === "play") {
        if (readerWantPlay) return;
        if ($("readerAudio").ended) readerSeekTo(0, true, 0);
        else readerPlay();
        return;
      }
      if (name === "pause" || name === "stop") { if (readerWantPlay) readerPause(); return; }
      if (name === "nexttrack") { readerGoToAdjacentStory(1); return; }
      if (name === "previoustrack") { readerGoToAdjacentStory(-1); return; }
    }
    if (typeof lis !== "undefined" && lis) {
      if (name === "play") { if (!lis.playing) lisReplayBtnClick(); return; }
      if (name === "pause" || name === "stop") { lisPausePlayback(); return; }
      if (name === "nexttrack") { lisSkipTrack(); return; }
      if (name === "previoustrack") { lisPreviousTrack(); return; }
    }
  } catch (error) {}
};

// แตะรูปปกเรื่อง -> เปิดรูปเต็มจอ (overlay เดียวกับโหมดพอดแคสต์)
crWireCoverButton("readerCover");
