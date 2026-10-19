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
let readerWordTrie = null;

const READER_LOCAL_PREVIEW = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) &&
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
  for (const level of Object.values(VOCAB)) {
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
    pinyinButton.textContent = readerPinyinVisible ? "拼音 พินอิน: เปิด" : "拼音 พินอิน: ปิด";
  }
  const thaiButton = $("readerThaiToggle");
  if (thaiButton) {
    thaiButton.setAttribute("aria-pressed", String(readerThaiVisible));
    thaiButton.textContent = readerThaiVisible ? "🇹🇭 ไทย: เปิด" : "🇹🇭 ไทย: ซ่อน";
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
}

function readerPersist(key, value) {
  try { localStorage.setItem(key, value); } catch (error) {}
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
    button.append(number, copy, play);
    button.addEventListener("click", () => readerSelectStory(story, true));
    list.appendChild(button);
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

    const chinese = document.createElement("div");
    chinese.className = "reader-zh-line";
    chinese.lang = "zh-CN";
    const wordTokens = readerTokenizeChars(turn.tokens || []);
    for (const token of wordTokens) {
      if (token.cjk) {
        const cell = document.createElement("span");
        cell.className = "reader-word";
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
        chinese.appendChild(cell);
      } else {
        chinese.appendChild(document.createTextNode(token.text));
      }
    }
    article.appendChild(chinese);

    const thaiText = (turn.thai || []).map((item) => item.text).filter(Boolean).join(" ");
    if (thaiText) {
      const thai = document.createElement("p");
      thai.className = "reader-thai";
      thai.lang = "th";
      thai.textContent = thaiText;
      article.appendChild(thai);
    }
    const seek = () => readerSeekTurn(index, true);
    article.addEventListener("click", seek);
    article.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        seek();
      }
    });
    root.appendChild(article);
  });
  root.classList.toggle("reader-hide-pinyin", !readerPinyinVisible);
  root.classList.toggle("reader-hide-thai", !readerThaiVisible);

  const questions = $("readerQuestionList");
  questions.replaceChildren();
  for (const question of story.questions_zh || []) {
    const item = document.createElement("li");
    item.lang = "zh-CN";
    item.textContent = question;
    questions.appendChild(item);
  }
  $("readerQuestions").hidden = !(story.questions_zh || []).length;

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
    navigator.mediaSession.setActionHandler("previoustrack", () => readerSeekTo(0, readerWantPlay, 0));
    navigator.mediaSession.setActionHandler("nexttrack", () => readerOpenAdjacentStory(1));
  } catch (error) {}
}

function readerRestoreMediaActions() {
  // Podcast is the existing default Media Session handler; listen mode
  // re-registers its own handlers whenever it starts.
  if (typeof podRegisterMediaActions === "function") podRegisterMediaActions();
}

function readerSyncBackgroundAudio() {
  crSetNativeBackgroundAudio(Boolean(readerState && readerWantPlay));
}

function readerThaiText(turn) {
  return (turn.thai || []).map((item) => item.text).filter(Boolean).join(" ");
}

function readerSelectStory(story, resume = false) {
  readerStopCurrentAudio();
  readerState = { story, nextTurn: 0, activeTurn: -1, playback: null, resume };
  $("readerLibrary").hidden = true;
  $("readerPlayer").hidden = false;
  $("readerHeading").textContent = story.title_zh;
  $("readerStoryNumber").textContent = `HSK ${story.level} · STORY ${story.reader_story_number}`;
  $("readerTitle").textContent = story.title_zh;
  $("readerTitlePinyin").textContent = story.title_pinyin || "";
  $("readerMeta").textContent = `${story.title_th || ""} · ${readerFormatTime(story.duration)} · ${story.turns.length} ช่วงบทพูด`;
  $("readerStatus").textContent = "แตะประโยคเพื่อเริ่มฟังจากช่วงนั้น";
  $("readerPlayer").scrollTop = 0;
  readerMakeTranscript(story);
  readerRegisterMediaActions();

  const audio = $("readerAudio");
  audio.src = readerResolveFile(story.zh_audio);
  audio.playbackRate = Number($("readerRate").value) || 1;
  audio.load();
  $("readerPlayBtn").textContent = "▶ เล่น";
  readerSetMetadata(story);
  readerSetMediaState("paused");
  switchScreen($("reader"));
  readerSyncBackgroundAudio();
  requestAnimationFrame(() => { $("readerPlayer").scrollTop = 0; });
  if (resume) readerPlay();
}

function readerPlay() {
  if (!readerState) return;
  readerWantPlay = true;
  readerSyncBackgroundAudio();
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
    readerWantPlay = false;
    readerSyncBackgroundAudio();
    $("readerPlayBtn").textContent = "▶ เล่น";
    $("readerStatus").textContent = "เปิดเสียงบทอ่านไม่ได้ — ลองแตะเล่นอีกครั้ง";
    readerSetMediaState("paused");
  });
}

function readerPause() {
  readerSeekSequence++;
  readerWantPlay = false;
  const audio = $("readerAudio");
  const thaiAudio = $("readerThaiAudio");
  audio.pause();
  thaiAudio.pause();
  thaiAudio.removeAttribute("src");
  thaiAudio.load();
  if (readerState) readerState.playback = null;
  $("readerPlayBtn").textContent = "▶ เล่น";
  readerSetMediaState("paused");
  readerSyncBackgroundAudio();
}

function readerStopCurrentAudio() {
  readerPause();
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

function readerRenderActiveTurn() {
  if (!readerState) return;
  const index = readerState.activeTurn;
  const active = $("readerTranscript").querySelector(`[data-turn="${index}"]`);
  const current = $("readerTranscript").querySelector(".reader-turn.reader-current");
  if (current === active) return;
  if (current) current.classList.remove("reader-current");
  if (!active) return;
  active.classList.add("reader-current");
  const player = $("readerPlayer");
  const viewport = player.getBoundingClientRect();
  const sticky = $("reader").querySelector(".reader-sticky-controls");
  const safeTop = Math.max(viewport.top + 4, sticky ? sticky.getBoundingClientRect().bottom + 8 : viewport.top);
  const rect = active.getBoundingClientRect();
  if (rect.top < safeTop || rect.bottom > viewport.bottom - 8) {
    const delta = rect.top < safeTop ? rect.top - safeTop : rect.bottom - (viewport.bottom - 8);
    player.scrollBy({ top: delta, behavior: Math.abs(delta) > player.clientHeight * 0.8 ? "auto" : "smooth" });
  }
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
      return;
    }
  }
}

let readerSeeking = false;
function readerSeekTo(time, resume = false, turnIndex = null) {
  if (!readerState) return;
  readerPause();
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

function readerEnded() {
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

function readerBackToList() {
  readerStopCurrentAudio();
  readerRestoreMediaActions();
  $("readerPlayer").hidden = true;
  $("readerLibrary").hidden = false;
  $("readerHeading").textContent = "เลือกบทอ่าน";
  readerSetMediaState("none");
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (error) {}
  readerStoryList();
}

function quitReaderGame() {
  readerStopCurrentAudio();
  readerRestoreMediaActions();
  $("readerPlayer").hidden = true;
  $("readerLibrary").hidden = false;
  $("readerHeading").textContent = "เลือกบทอ่าน";
  readerSetMediaState("none");
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (error) {}
  switchScreen(menuEl);
}

async function startReaderGame() {
  switchScreen($("reader"));
  $("readerPlayer").hidden = true;
  $("readerLibrary").hidden = false;
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
$("readerBackBtn").addEventListener("click", () => { sfx.click(); readerBackToList(); });
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
$("readerAudio").addEventListener("timeupdate", () => {
  if (!readerState) return;
  readerUpdateProgress();
  readerMaybePlayThai($("readerAudio").currentTime);
});
$("readerAudio").addEventListener("loadedmetadata", readerUpdateProgress);
$("readerAudio").addEventListener("ended", readerEnded);
$("readerAudio").addEventListener("pause", () => {
  if (!readerState || readerState.playback || readerWantPlay) return;
  $("readerPlayBtn").textContent = "▶ เล่น";
  readerSetMediaState("paused");
});
document.addEventListener("visibilitychange", () => {
  if (!readerState || !readerWantPlay) return;
  readerSyncBackgroundAudio();
  if (document.hidden) return;
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

readerApplySettings();
if (READER_LOCAL_PREVIEW && READER_PARAMS.get("openReader") === "1") {
  queueMicrotask(() => startReaderGame());
}
