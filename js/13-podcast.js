"use strict";
/* ================= MaoMi Chinese podcast practice ================= */
// Podcast transcripts are generated locally by tools/build_podcast_data.py.
// The offline APK plays bundled MP3 copies; the web build streams from the
// publisher's Buzzsprout CDN and hides this mode (see podCard below).
let podcastState = null;
let podActiveToken = null;
let podWantPlay = false;
let podSeeking = false;
let podBubbleOpen = false;
let podBubbleTap = null;
let podThaiVisible = true;
// Pinyin visibility (independent of the Thai toggle): a learner can hide the
// romanisation to test reading comprehension without losing the translation.
const POD_PINYIN_KEY = "cr_pod_pinyin";
let podPinyinVisible = podLoadPinyinVisible();
let podDataPromise = null;
// Private localhost-only path for testing the APK-only podcast feature in the
// real index.html without exposing its generated data in public web builds.
const POD_LOCAL_PREVIEW = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) &&
  new URLSearchParams(location.search).get("podcastPreview") === "1";
const POD_THAI_VOICE_KEY = "cr_pod_thai_voice";
let podThaiVoiceEnabled = podLoadThaiVoiceEnabled();
let podThaiVoicePlayback = null;
let podThaiVoiceLastIndex = -1;
let podSeekSequence = 0;
// One-shot status line shown after the next episode starts playing (podPlay()
// writes its own generic message once the media actually begins).
let podStatusNote = "";

// Auto-advance through the episode list (wrapping around at the end). Off by
// default so a single episode still stops when it finishes, as before.
const POD_AUTO_NEXT_KEY = "cr_pod_auto_next";
let podAutoNextEnabled = podLoadAutoNextEnabled();

// Transcript text zoom (A-/A+ buttons). 1 = the CSS default, persisted so a
// chosen size survives episodes and app restarts.
const POD_FS_KEY = "cr_pod_font_scale";
const POD_FS_MIN = 0.8;
const POD_FS_MAX = 1.8;
const POD_FS_STEP = 0.1;
let podFontScale = podLoadFontScale();

// Podcast source ("maomi" = the streamed MaoMi episodes, "hsk" = the locally
// generated HSK 1-9 articles) plus the HSK level filter (0 = all levels).
// Both persist so the episode picker reopens the way the user left it.
const POD_SRC_KEY = "cr_pod_source";
const POD_HSK_FILTER_KEY = "cr_pod_hsk_filter";
let podSource = podLoadSource();
let podHskFilter = podLoadHskFilter();
let podHskDataPromise = null;

// The podcast dataset contains copyrighted transcript text. Keep it out of the
// public web build; the private offline APK loads its bundled copy on demand.
const podCard = document.querySelector('.card[data-mode="podcast"]');
if (podCard) podCard.hidden = !window.CR_OFFLINE_APP && !POD_LOCAL_PREVIEW;

function podLoadData() {
  if (Array.isArray(window.PODCASTS)) return Promise.resolve(window.PODCASTS);
  if (!window.CR_OFFLINE_APP && !POD_LOCAL_PREVIEW) return Promise.reject(new Error("Podcast is only available in the offline app"));
  if (podDataPromise) return podDataPromise;
  podDataPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "data/podcasts.js";
    script.onload = async () => {
      if (!Array.isArray(window.PODCASTS)) {
        reject(new Error("Podcast data is unavailable"));
        return;
      }
      if (POD_LOCAL_PREVIEW) {
        try {
          await Promise.all(window.PODCASTS.map(async (ep) => {
            const response = await fetch(`podcast_cache/audio_th/ep${ep.n}.json`, { cache: "no-store" });
            if (!response.ok) return;
            const clips = await response.json();
            const complete = Array.isArray(clips) && clips.length === ep.paras.length &&
              clips.every((clip, index) => clip.index === index && clip.th === (ep.paras[index].th || "").trim());
            if (!complete) return;
            ep.mp3Local = `podcast_cache/audio/ep${ep.n}.mp3`;
            ep.thaiAudioLocal = ep.paras.map((_, index) =>
              `podcast_cache/audio_th/ep${ep.n}/${String(index).padStart(3, "0")}.mp3`);
          }));
          resolve(window.PODCASTS);
        } catch (error) {
          reject(error);
        }
        return;
      }
      resolve(window.PODCASTS);
    };
    script.onerror = () => reject(new Error("Podcast data could not be loaded"));
    document.head.appendChild(script);
  });
  return podDataPromise;
}

// The HSK article dataset (data/podcasts_hsk.js) is loaded on demand the same
// lazy way: the web build never ships it, the APK/preview loads it locally.
function podLoadHskData() {
  if (Array.isArray(window.PODCASTS_HSK)) return Promise.resolve(window.PODCASTS_HSK);
  if (!window.CR_OFFLINE_APP && !POD_LOCAL_PREVIEW) {
    return Promise.reject(new Error("HSK articles are only available in the offline app"));
  }
  if (podHskDataPromise) return podHskDataPromise;
  podHskDataPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "data/podcasts_hsk.js";
    script.onload = () => {
      if (Array.isArray(window.PODCASTS_HSK) && window.PODCASTS_HSK.length) {
        resolve(window.PODCASTS_HSK);
      } else {
        reject(new Error("HSK podcast data is unavailable"));
      }
    };
    script.onerror = () => reject(new Error("HSK podcast data could not be loaded"));
    document.head.appendChild(script);
  });
  return podHskDataPromise;
}

// Episode list of the active (or given) source; each source wraps around its
// own list when auto-advancing.
function podEpisodesForSource(src = podSource) {
  return src === "hsk" ? (window.PODCASTS_HSK || []) : (window.PODCASTS || []);
}

function podSourceOf(ep) {
  return ep && ep.src === "hsk" ? "hsk" : "maomi";
}

// ---- transcript text size (A-/A+) --------------------------------------
function podClampFontScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(POD_FS_MAX, Math.max(POD_FS_MIN, Math.round(n * 10) / 10));
}

function podLoadFontScale() {
  try {
    const raw = localStorage.getItem(POD_FS_KEY);
    return raw === null || raw === "" ? 1 : podClampFontScale(raw);
  } catch (err) {
    return 1;
  }
}

function podLoadSource() {
  try {
    return localStorage.getItem(POD_SRC_KEY) === "hsk" ? "hsk" : "maomi";
  } catch (err) {
    return "maomi";
  }
}

function podLoadHskFilter() {
  try {
    const n = Number(localStorage.getItem(POD_HSK_FILTER_KEY));
    return Number.isInteger(n) && n >= 0 && n <= 9 ? n : 0;
  } catch (err) {
    return 0;
  }
}

function podLoadThaiVoiceEnabled() {
  try {
    const raw = localStorage.getItem(POD_THAI_VOICE_KEY);
    return raw === null ? true : raw === "1";
  } catch (err) {
    return true;
  }
}

function podSaveThaiVoiceEnabled() {
  try { localStorage.setItem(POD_THAI_VOICE_KEY, podThaiVoiceEnabled ? "1" : "0"); } catch (err) {}
}

function podLoadAutoNextEnabled() {
  try {
    return localStorage.getItem(POD_AUTO_NEXT_KEY) === "1";
  } catch (err) {
    return false;
  }
}

function podLoadPinyinVisible() {
  try {
    const raw = localStorage.getItem(POD_PINYIN_KEY);
    return raw === null ? true : raw === "1";
  } catch (err) {
    return true;
  }
}

function podSavePinyinVisible() {
  try { localStorage.setItem(POD_PINYIN_KEY, podPinyinVisible ? "1" : "0"); } catch (err) {}
}

function podApplyPinyinToggle() {
  const button = $("podPinyinToggle");
  if (button) {
    button.setAttribute("aria-pressed", String(podPinyinVisible));
    button.textContent = podPinyinVisible ? "🔤 ซ่อนพินอิน" : "🔤 แสดงพินอิน";
  }
  $("podTranscript").classList.toggle("pod-hide-pinyin", !podPinyinVisible);
}

function podApplyAutoNextToggle() {
  const button = $("podAutoNextBtn");
  const hint = $("podAutoNextHint");
  if (button) {
    button.setAttribute("aria-pressed", String(podAutoNextEnabled));
    button.title = podAutoNextEnabled
      ? "เล่นตอนถัดไปอัตโนมัติ: เปิด (วนลูปทั้งหมด) — แตะเพื่อปิด"
      : "เล่นตอนถัดไปอัตโนมัติ: ปิด — แตะเพื่อเปิด";
  }
  if (hint) hint.textContent = podAutoNextEnabled
    ? "⏭ เล่นตอนถัดไปอัตโนมัติ: เปิด (วนลูป)"
    : "⏭ เล่นตอนถัดไปอัตโนมัติ: ปิด";
}

// Episode order is the list order shown in the picker; wrapping at the end
// restarts the whole set from the first episode. MaoMi and HSK articles each
// wrap within their own source list.
function podEpisodeIndex(ep) {
  if (!ep) return -1;
  const list = podEpisodesForSource(podSourceOf(ep));
  return list.findIndex((item) => item === ep ||
    (item && item.src === ep.src && item.id === ep.id) ||
    (item && item.src === ep.src && item.n === ep.n));
}

function podNextEpisode(ep) {
  const list = podEpisodesForSource(podSourceOf(ep));
  if (!list.length) return null;
  const index = podEpisodeIndex(ep);
  return list[index < 0 ? 0 : (index + 1) % list.length];
}

function podReplayCurrent() {
  if (!podcastState) return;
  podInterruptThaiVoice();
  podWantPlay = true;
  podThaiVoiceLastIndex = -1;
  podStatusNote = "🔁 เริ่มเล่นตอนนี้ซ้ำตั้งแต่ต้น";
  podSeekAudio(0, true);
  $("podStatus").textContent = podStatusNote;
}

function podGoToNextEpisode(manual = false) {
  if (!podcastState) return;
  const list = podEpisodesForSource(podSourceOf(podcastState.episode));
  const next = podNextEpisode(podcastState.episode);
  if (!next) return;
  if (next === podcastState.episode && list.length <= 1) {
    podReplayCurrent();
    return;
  }
  const wrapped = podEpisodeIndex(podcastState.episode) === list.length - 1;
  podSelectEpisode(next);
  podStatusNote = manual
    ? `ข้ามไปตอนที่ #${next.n}`
    : `⏭ เล่นตอนถัดไปอัตโนมัติ · #${next.n}${wrapped ? " (วนกลับตอนแรก)" : ""}`;
  $("podStatus").textContent = podStatusNote;
}

function podThaiVoiceAvailable(ep) {
  return Boolean((window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW) && ep && Array.isArray(ep.paras) &&
    Array.isArray(ep.thaiAudioLocal) && ep.thaiAudioLocal.length === ep.paras.length &&
    ep.thaiAudioLocal.every((path) => typeof path === "string" && path));
}

function podApplyThaiVoiceToggle(ep = podcastState && podcastState.episode) {
  const button = $("podVoiceToggle");
  const available = podThaiVoiceAvailable(ep);
  button.hidden = !available;
  $("podVoiceHint").hidden = !available;
  button.setAttribute("aria-pressed", String(podThaiVoiceEnabled));
  button.textContent = podThaiVoiceEnabled ? "🇹🇭 เสียงแปลอัตโนมัติ: เปิด" : "🇹🇭 เสียงแปลอัตโนมัติ: ปิด";
}

function podSentenceIntervals(ep) {
  return (ep.paras || []).map((para) => {
    const rows = (para.tk || []).filter((row) => Number.isFinite(row[2]) && Number.isFinite(row[3]));
    if (!rows.length) return null;
    return {
      start: Math.min(...rows.map((row) => row[2])),
      end: Math.max(...rows.map((row) => row[3])),
    };
  });
}

function podResetThaiVoicePosition(time) {
  if (!podcastState || !podThaiVoiceAvailable(podcastState.episode)) {
    podThaiVoiceLastIndex = -1;
    return;
  }
  podThaiVoiceLastIndex = -1;
  podcastState.intervals.forEach((interval, index) => {
    if (interval && interval.end <= time) podThaiVoiceLastIndex = index;
  });
}

// Wait until the media element has completed a seek before resuming playback.
// Calling play() immediately after setting currentTime can make some WebViews
// start from 0 while the requested seek is still pending.
function podSeekAudio(target, resumeAfterSeek = false) {
  const audio = $("podAudio");
  if (audio.readyState < 1 && audio.src) {
    // Media metadata (duration/currentTime) is not known yet, so a seek would
    // be dropped. Retry once the browser has loaded the media header.
    const onMetadata = () => {
      audio.removeEventListener("loadedmetadata", onMetadata);
      podSeekAudio(target, resumeAfterSeek);
    };
    audio.addEventListener("loadedmetadata", onMetadata);
    return;
  }
  const duration = audio.duration;
  const requested = Number(target);
  const maxTime = Number.isFinite(duration) ? duration : Math.max(0, requested || 0);
  const time = Math.min(maxTime, Math.max(0, requested || 0));

  // Some sources cannot be seeked at all — the browser then reports a seekable
  // range of [0, 0] (e.g. a server that ignores HTTP Range requests). Assigning
  // currentTime is silently dropped in that case and playback would just restart
  // from 0:00, so refuse the jump and say why instead of faking it.
  const ranges = audio.seekable;
  if (ranges && ranges.length && audio.readyState >= 2 &&
      ranges.end(ranges.length - 1) - ranges.start(0) < 1 && time > 1) {
    podUpdateHighlight();
    $("podStatus").textContent = "ไฟล์เสียงนี้เลื่อนไปยังประโยคที่เลือกไม่ได้ — ต้องเปิดผ่านเครื่องเล่นที่รองรับการเลื่อน";
    return;
  }

  const episode = podcastState && podcastState.episode;
  const sequence = ++podSeekSequence;
  let timer = null;
  let finished = false;

  audio.pause();
  if (!resumeAfterSeek) podWantPlay = false;

  const cleanup = () => {
    audio.removeEventListener("seeked", onSeeked);
    if (timer !== null) clearTimeout(timer);
  };
  const finish = (timedOut = false) => {
    if (finished) return;
    if (sequence !== podSeekSequence) {
      finished = true;
      cleanup();
      return;
    }
    if (audio.seeking && !timedOut) return;
    if (Math.abs(audio.currentTime - time) > 1) {
      if (!timedOut) return;
      finished = true;
      cleanup();
      podWantPlay = false;
      $("podStatus").textContent = "เลื่อนไปยังประโยคที่เลือกไม่ได้ — ลองแตะอีกครั้ง";
      return;
    }

    finished = true;
    cleanup();
    podResetThaiVoicePosition(time);
    podUpdateHighlight();
    if (resumeAfterSeek && podcastState && podcastState.episode === episode &&
        document.querySelector(".screen.active") === $("podcast")) {
      podPlay();
    }
  };
  const onSeeked = () => finish();

  audio.addEventListener("seeked", onSeeked);
  timer = setTimeout(() => finish(true), 3000);
  try {
    audio.currentTime = time;
  } catch (error) {
    finish(true);
    return;
  }
  podResetThaiVoicePosition(time);
  if (!audio.seeking && Math.abs(audio.currentTime - time) <= 0.05) {
    queueMicrotask(() => finish());
  }
}

function podInterruptThaiVoice() {
  if (!podThaiVoicePlayback) return false;
  const resume = podThaiVoicePlayback.resumeAfter;
  podThaiVoicePlayback = null;
  const voice = $("podThaiAudio");
  voice.pause();
  voice.removeAttribute("src");
  voice.load();
  return resume;
}

function podFinishThaiVoice(resumeAfter = true) {
  if (!podThaiVoicePlayback) return;
  const playback = podThaiVoicePlayback;
  podThaiVoicePlayback = null;
  const voice = $("podThaiAudio");
  voice.removeAttribute("src");
  voice.load();
  if (resumeAfter && playback.resumeAfter && podcastState && podcastState.episode === playback.episode &&
      document.querySelector(".screen.active") === $("podcast")) {
    podPlay();
  } else {
    podWantPlay = false;
    podSyncNativeBackgroundAudio();
    $("podPlayBtn").textContent = "▶ เล่น";
    podSetMediaState("paused");
  }
}

function podStartThaiVoice(index) {
  const ep = podcastState && podcastState.episode;
  const path = ep && ep.thaiAudioLocal && ep.thaiAudioLocal[index];
  if (!ep || !path) {
    podThaiVoiceLastIndex = index;
    return;
  }
  const source = $("podAudio");
  const voice = $("podThaiAudio");
  podThaiVoiceLastIndex = index;
  podThaiVoicePlayback = { episode: ep, index, resumeAfter: true };
  source.pause();
  // Pause at the observed sentence boundary without seeking the source audio.
  // Some native/HTTP audio streams cannot seek reliably; timeupdate can arrive
  // a fraction late, but leaving currentTime alone avoids jumping to 0.
  voice.pause();
  voice.src = path;
  voice.load();
  $("podPlayBtn").textContent = "⏸ พัก";
  $("podStatus").textContent = `กำลังเล่นเสียงแปลไทย · ประโยค ${index + 1}/${ep.paras.length}`;
  podSetMediaState("playing");
  voice.play().catch(() => podFinishThaiVoice(true));
}

function podMaybePlayThaiVoice(time) {
  if (!podThaiVoiceEnabled || !podcastState || !podThaiVoiceAvailable(podcastState.episode) ||
      podThaiVoicePlayback || $("podAudio").paused) return;
  const index = podThaiVoiceLastIndex + 1;
  const interval = podcastState.intervals[index];
  if (!interval || time < interval.end) return;
  podStartThaiVoice(index);
}

function podApplyFontScale() {
  const root = $("podcast");
  if (root) root.style.setProperty("--pod-fs", String(podFontScale));
  const label = $("podFontLabel");
  if (label) label.textContent = `${Math.round(podFontScale * 100)}%`;
  const minus = $("podFontMinus");
  const plus = $("podFontPlus");
  if (minus) minus.disabled = podFontScale <= POD_FS_MIN + 0.001;
  if (plus) plus.disabled = podFontScale >= POD_FS_MAX - 0.001;
}

function podSetFontScale(next) {
  podFontScale = podClampFontScale(next);
  try {
    localStorage.setItem(POD_FS_KEY, String(podFontScale));
  } catch (err) {
    /* storage unavailable (private mode): keep the in-memory value */
  }
  podApplyFontScale();
}

function podFormatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const n = Math.floor(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function podEpisodeDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

function podEnglishTitle(title) {
  return String(title || "")
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[\s·|–—-]+$/g, "")
    .trim();
}

function podSetMediaState(state) {
  try {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state;
  } catch (e) {}
}

// The podcast swaps between two <audio> elements (the episode and the Thai
// translation clip) under JS control, so the page must keep running while the
// app is backgrounded or the screen is locked — otherwise the swap stalls and
// the audio stops. Reuse the same native foreground service listen mode uses.
function podSyncNativeBackgroundAudio() {
  const active = Boolean(podcastState && podWantPlay);
  crSetNativeBackgroundAudio(active);
  crSetScreenAwake(active); // จอไม่ดับขณะฟังพอดแคสต์ ปล่อยเมื่อพัก/ออกจากตอน
}

function podSetMetadata(ep) {
  try {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.zh || ep.t,
      artist: ep.src === "hsk"
        ? `Chinese Rocket · HSK ${ep.hsk}`
        : `MaoMi Chinese · ตอนที่ ${ep.n}`,
      album: "Chinese Rocket · ฟังพอดแคสต์",
    });
  } catch (e) {}
}

function podEpisodeList(query = "") {
  const list = $("podEpisodeList");
  const q = query.trim().toLowerCase();
  const episodes = podEpisodesForSource().filter((ep) => {
    if (podSource === "hsk" && podHskFilter && ep.hsk !== podHskFilter) return false;
    const hay = ep.src === "hsk"
      ? `${ep.id} ${ep.hsk} ${ep.cat || ""} ${ep.t} ${ep.zh}`
      : `${ep.n} ${ep.t} ${ep.zh}`;
    return !q || hay.toLowerCase().includes(q);
  });
  list.replaceChildren();
  if (!episodes.length) {
    const empty = document.createElement("p");
    empty.className = "pod-empty";
    if (podSource === "hsk" && podHskFilter && !q) {
      empty.textContent = "ยังไม่มีบทความในระดับ HSK นี้";
    } else {
      empty.textContent = q ? "ไม่พบตอนที่ค้นหา" : "ยังไม่มีข้อมูลพอดแคสต์ในเครื่อง";
    }
    list.appendChild(empty);
  }
  for (const ep of episodes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pod-episode";
    const n = document.createElement("span");
    n.className = "pod-episode-badge";
    if (ep.src === "hsk") {
      n.classList.add("pod-badge-hsk");
      n.textContent = `HSK ${ep.hsk}`;
    } else {
      n.textContent = `#${ep.n}`;
    }
    const body = document.createElement("span");
    body.className = "pod-episode-copy";
    const title = document.createElement("strong");
    title.textContent = ep.t;
    const meta = document.createElement("small");
    const date = podEpisodeDate(ep.d);
    const duration = ep.dur ? podFormatTime(ep.dur) : "";
    const weakNote = ep.src === "hsk" && ep.weakCount ? `ไฮไลท์ ${ep.weakCount} ประโยคเป็นเวลาโดยประมาณ` : "";
    meta.textContent = [ep.src === "hsk" ? (ep.cat || "") : date, duration, weakNote]
      .filter(Boolean).join(" · ");
    body.append(title, meta);
    const play = document.createElement("span");
    play.className = "pod-episode-play";
    play.textContent = "▶";
    button.append(n, body, play);
    button.addEventListener("click", () => podSelectEpisode(ep));
    list.appendChild(button);
  }
  if (q) {
    $("podListStatus").textContent = `พบ ${episodes.length} ตอน`;
  } else if (podSource === "hsk") {
    $("podListStatus").textContent = `${episodes.length} บทความ HSK · เสียงและคำแปลในเครื่อง`;
  } else {
    $("podListStatus").textContent = window.CR_OFFLINE_APP
      ? `${episodes.length} ตอนฟรี · ฟังได้แบบออฟไลน์`
      : POD_LOCAL_PREVIEW
      ? `${episodes.length} ตอน · พรีวิวไฟล์ในเครื่อง`
      : `${episodes.length} ตอนฟรี · เสียงสตรีมจาก MaoMi/Buzzsprout`;
  }
}

function podTranscript(ep) {
  const root = $("podTranscript");
  root.replaceChildren();
  podActiveToken = null;
  const paras = Array.isArray(ep.paras) ? ep.paras : [];
  let totalChars = 0;
  for (const p of paras) {
    for (const tk of p.tk || []) {
      if (/[\u3400-\u9fff\uf900-\ufaff]/.test(tk[0] || "")) totalChars += [...tk[0]].length;
    }
  }
  // When ASR/alignment is unavailable, give the text a gentle proportional
  // timing so karaoke still advances (clearly labelled as approximate).
  const span = Math.max(1, (ep.dur || 300) - 10);
  let charOffset = 0;
  for (const p of paras) {
    const para = document.createElement("article");
    para.className = "pod-para";
    para.dataset.start = "";
    const body = document.createElement("div");
    body.className = "pod-para-body";
    const zh = document.createElement("div");
    zh.className = "pod-zh-line";
    zh.lang = "zh-CN";
    let firstStart = null;
    for (const row of p.tk || []) {
      const [text, py, givenStart, givenEnd] = row;
      if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text || "")) {
        const count = [...text].length;
        const approximateStart = 8 + span * charOffset / Math.max(1, totalChars);
        const approximateEnd = 8 + span * (charOffset + count) / Math.max(1, totalChars);
        const start = Number.isFinite(givenStart) ? givenStart : approximateStart;
        const end = Number.isFinite(givenEnd) ? givenEnd : approximateEnd;
        charOffset += count;
        if (firstStart === null) firstStart = start;
        const word = document.createElement("button");
        word.type = "button";
        word.className = "pod-word cp-zh-tok";
        word.dataset.start = String(start);
        word.dataset.end = String(end);
        word.setAttribute("aria-label", py ? `${text} ${py}` : text);
        const hanzi = document.createElement("span");
        hanzi.className = "pod-hanzi";
        hanzi.textContent = text;
        const pinyin = document.createElement("small");
        pinyin.className = "pod-pinyin";
        pinyin.textContent = py || "";
        word.append(hanzi, pinyin);
        word.addEventListener("click", (event) => {
          event.stopPropagation();
          if (podBubbleOpen) {
            podBubbleOpen = false;
            podBubbleTap = null;
            if (typeof cpHideWordPopup === "function") cpHideWordPopup();
            return;
          }
          sfx.click();
          if (typeof cpShowWordPopup === "function") {
            cpShowWordPopup(text, word);
            podBubbleOpen = true;
          }
        });
        zh.appendChild(word);
      } else {
        zh.appendChild(document.createTextNode(text || ""));
      }
    }
    para.dataset.start = firstStart === null ? "" : String(firstStart);
    body.appendChild(zh);
    if (p.th) {
      const th = document.createElement("p");
      th.className = "pod-thai";
      th.lang = "th";
      th.textContent = p.th;
      body.appendChild(th);
    }
    para.appendChild(body);

    const controls = document.createElement("div");
    controls.className = "pod-para-controls";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "reader-replay";
    play.textContent = "▶";
    play.title = "เล่นตั้งแต่ประโยคนี้";
    play.setAttribute("aria-label", "เล่นตั้งแต่ประโยคนี้");
    play.disabled = firstStart === null || !Number.isFinite(Number(firstStart));
    play.addEventListener("click", (event) => {
      event.stopPropagation();
      if (play.disabled) return;
      sfx.click();
      podInterruptThaiVoice();
      podWantPlay = true;
      // Resume only after the seek completes; Android WebView can otherwise
      // restart the episode from 0 while a sentence seek is pending.
      podSeekAudio(Number(para.dataset.start), true);
    });
    const pause = document.createElement("button");
    pause.type = "button";
    pause.className = "reader-replay pod-para-pause";
    pause.textContent = "⏸";
    pause.title = "หยุดชั่วคราวเพื่ออ่านประโยคนี้";
    pause.setAttribute("aria-label", "หยุดเสียงชั่วคราวเพื่ออ่านประโยคนี้");
    pause.addEventListener("click", (event) => {
      event.stopPropagation();
      sfx.click();
      podPause();
      $("podStatus").textContent = "หยุดเสียงชั่วคราว · อ่านบทความต่อได้ แล้วแตะ ▶ เพื่อฟังต่อ";
    });
    controls.append(play, pause);
    para.appendChild(controls);
    root.appendChild(para);
  }
  const hasThai = paras.some((p) => p.th);
  $("podThaiNotice").hidden = hasThai;
  $("podThaiToggle").disabled = !hasThai;
  $("podThaiToggle").textContent = hasThai
    ? (podThaiVisible ? "🇹🇭 ซ่อนคำแปล" : "🇹🇭 แสดงคำแปล")
    : "🇹🇭 คำแปลยังไม่พร้อม";
  root.classList.toggle("pod-hide-thai", !podThaiVisible);
  root.classList.toggle("pod-hide-pinyin", !podPinyinVisible);
  podApplyPinyinToggle();
}

function podSelectEpisode(ep) {
  // HSK articles whose narration has not been generated yet cannot be opened.
  if (ep.src === "hsk" && !ep.mp3Local) {
    $("podListStatus").textContent = "บทความนี้ยังไม่มีไฟล์เสียง — สร้างเสียงก่อนด้วย tools/gen_hsk_podcast_audio.py";
    return;
  }
  podSeekSequence++;
  podInterruptThaiVoice();
  podStatusNote = "";
  podcastState = { episode: ep, intervals: podSentenceIntervals(ep) };
  podThaiVoiceLastIndex = -1;
  const screen = $("podcast");
  $("podEpisodes").hidden = true;
  $("podPlayer").hidden = false;
  $("podHeading").textContent = "กำลังฟังพอดแคสต์";
  $("podEpisodeNumber").textContent = ep.src === "hsk"
    ? `HSK ${ep.hsk} · ${ep.cat || ""}`
    : `MAOMI CHINESE · EPISODE ${ep.n}`;
  $("podTitle").textContent = ep.zh || podEnglishTitle(ep.t) || ep.t;
  $("podEnglishTitle").textContent = ep.zh ? podEnglishTitle(ep.t) : "";
  const date = podEpisodeDate(ep.d);
  $("podMeta").textContent = [date, ep.dur ? podFormatTime(ep.dur) : "", ep.weak ? "ไฮไลท์บางส่วนเป็นเวลาโดยประมาณ" : ""].filter(Boolean).join(" · ");
  $("podStatus").textContent = window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW
    ? "กำลังเปิดไฟล์เสียงในเครื่อง…"
    : "กำลังเชื่อมต่อเสียงจาก Buzzsprout…";
  podTranscript(ep);
  podApplyThaiVoiceToggle(ep);
  const audio = $("podAudio");
  audio.pause();
  audio.src = (window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW) && ep.mp3Local ? ep.mp3Local : ep.mp3;
  audio.playbackRate = Number($("podRate").value) || 1;
  audio.load();
  podSetMetadata(ep);
  podSetMediaState("paused");
  switchScreen(screen);
  podPlay();
  requestAnimationFrame(() => $("podPlayer").scrollTop = 0);
}

function podPlay() {
  podSeekSequence++;
  podWantPlay = true;
  podInterruptThaiVoice();
  const audio = $("podAudio");
  if (!audio.src) return;
  podSyncNativeBackgroundAudio();
  audio.play().then(() => {
    $("podPlayBtn").textContent = "⏸ พัก";
    podSetMediaState("playing");
    if (podStatusNote) {
      $("podStatus").textContent = podStatusNote;
      podStatusNote = "";
    } else {
      $("podStatus").textContent = "กำลังเล่นเสียงต้นฉบับ · แตะคำเพื่อดูความหมาย";
    }
  }).catch(() => {
    podWantPlay = false;
    podSyncNativeBackgroundAudio();
    $("podPlayBtn").textContent = "▶ เล่น";
    $("podStatus").textContent = window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW
      ? "เล่นไฟล์เสียงในเครื่องไม่ได้ — ลองปิดเปิดแอปอีกครั้ง"
      : "เล่นเสียงไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วแตะเล่นอีกครั้ง";
    podSetMediaState("paused");
  });
}

function podPause() {
  podSeekSequence++;
  podWantPlay = false;
  podInterruptThaiVoice();
  const audio = $("podAudio");
  audio.pause();
  $("podPlayBtn").textContent = "▶ เล่น";
  podSetMediaState("paused");
  podSyncNativeBackgroundAudio();
}

function podKeepSentenceAndThaiVisible(word) {
  const player = $("podPlayer");
  const sentence = word.closest(".pod-para");
  if (!player || !sentence) return;

  const viewport = player.getBoundingClientRect();
  const sticky = $("podcast").querySelector(".pod-sticky-controls");
  const stickyBottom = sticky ? sticky.getBoundingClientRect().bottom : viewport.top;
  const safeTop = Math.max(viewport.top + 4, stickyBottom + 8);
  const safeBottom = viewport.bottom - 8;
  const available = safeBottom - safeTop;
  if (available <= 0) return;

  const wordRect = word.getBoundingClientRect();
  const thai = sentence.querySelector(".pod-thai");
  const thaiRect = thai ? thai.getBoundingClientRect() : null;
  const thaiVisible = thaiRect && thaiRect.height > 0;
  const focusTop = thaiVisible ? Math.min(wordRect.top, thaiRect.top) : wordRect.top;
  const focusBottom = thaiVisible ? Math.max(wordRect.bottom, thaiRect.bottom) : wordRect.bottom;
  const focusHeight = focusBottom - focusTop;

  let delta = 0;
  if (focusHeight <= available) {
    if (focusTop < safeTop) delta = focusTop - safeTop;
    else if (focusBottom > safeBottom) delta = focusBottom - safeBottom;
  } else {
    // Very long sentences may not fit as a whole; center the active word and
    // its Thai line together as closely as the available viewport permits.
    delta = (focusTop + focusBottom) / 2 - (safeTop + safeBottom) / 2;
  }
  if (Math.abs(delta) > 2) {
    // Long hops (a seek, or the intro skip) feel broken as a slow glide, so
    // jump instantly past roughly one screen and glide only for small follows.
    const behavior = Math.abs(delta) > available * 0.8 ? "auto" : "smooth";
    player.scrollBy({ top: delta, behavior });
  }
}

function podUpdateHighlight() {
  const audio = $("podAudio");
  const time = audio.currentTime;
  const seek = $("podSeek");
  if (!podSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    seek.value = String(Math.round(time / audio.duration * 1000));
  }
  $("podCurrentTime").textContent = podFormatTime(time);
  if (Number.isFinite(audio.duration)) $("podDuration").textContent = podFormatTime(audio.duration);
  podMaybePlayThaiVoice(time);
  let active = null;
  for (const word of $("podTranscript").querySelectorAll(".pod-word")) {
    const start = Number(word.dataset.start), end = Number(word.dataset.end);
    if (time >= start && time <= end) { active = word; break; }
  }
  if (active === podActiveToken) return;
  if (podActiveToken) podActiveToken.classList.remove("pod-current");
  podActiveToken = active;
  if (!active) return;
  active.classList.add("pod-current");
  podKeepSentenceAndThaiVisible(active);
}

// While a transcript-word bubble is open, the first tap outside it only closes
// the bubble. Swallow the matching click so it cannot activate playback,
// controls, or another word underneath it.
function podInstallBubbleGuard() {
  document.addEventListener("pointerdown", (event) => {
    if (!podBubbleOpen) { podBubbleTap = null; return; }
    const popup = $("cpWordPopup");
    if (!popup || popup.hidden) {
      podBubbleOpen = false;
      podBubbleTap = null;
      return;
    }
    if (popup.contains(event.target)) {
      podBubbleTap = null;
      return;
    }
    podBubbleTap = "dismiss";
    if (typeof cpHideWordPopup === "function") cpHideWordPopup();
    podBubbleOpen = false;
  }, true);
  document.addEventListener("click", (event) => {
    if (podBubbleTap !== "dismiss") return;
    podBubbleTap = null;
    event.stopPropagation();
    event.preventDefault();
  }, true);
}

function podBackToList() {
  podWantPlay = false;
  podStatusNote = "";
  podPause();
  cpHideWordPopup();
  $("podPlayer").hidden = true;
  $("podEpisodes").hidden = false;
  $("podHeading").textContent = "เลือกตอนพอดแคสต์";
  podSetMediaState("none");
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (e) {}
}

function quitPodcastGame() {
  podSeekSequence++;
  podWantPlay = false;
  podStatusNote = "";
  podSyncNativeBackgroundAudio();
  const audio = $("podAudio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  podInterruptThaiVoice();
  cpHideWordPopup();
  podcastState = null;
  podActiveToken = null;
  $("podPlayer").hidden = true;
  $("podEpisodes").hidden = false;
  $("podPlayBtn").textContent = "▶ เล่น";
  podSetMediaState("none");
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (e) {}
  switchScreen(menuEl);
}

async function startPodcastGame() {
  podRegisterMediaActions();
  switchScreen($("podcast"));
  $("podPlayer").hidden = true;
  $("podEpisodes").hidden = false;
  $("podHeading").textContent = "เลือกตอนพอดแคสต์";
  $("podSearch").value = "";
  $("podListStatus").textContent = "กำลังเตรียมรายการพอดแคสต์…";
  $("podEpisodeList").replaceChildren();
  try {
    await podLoadData();
  } catch (e) {
    $("podListStatus").textContent = POD_LOCAL_PREVIEW
      ? "โหลดข้อมูลพรีวิวไม่ได้ — ตรวจสอบข้อมูลพอดแคสต์และไฟล์แปลในเครื่อง"
      : "โหลดข้อมูลพอดแคสต์ไม่ได้ — ตรวจสอบว่า APK มีไฟล์ข้อมูลตอนพอดแคสต์";
    $("podEpisodeList").replaceChildren();
    return;
  }
  if (document.querySelector(".screen.active") !== $("podcast")) return;
  if (podSource === "hsk") {
    try {
      await podLoadHskData();
    } catch (e) {
      // Stay on the MaoMi list rather than an empty screen.
      podSource = "maomi";
      podApplySourceUI();
      $("podListStatus").textContent = "โหลดบทความ HSK ไม่ได้ — ตรวจสอบว่า APK มีไฟล์ข้อมูลบทความ HSK";
    }
  }
  if (document.querySelector(".screen.active") !== $("podcast")) return;
  const episodes = podEpisodesForSource();
  if (!Array.isArray(episodes) || !episodes.length) {
    $("podListStatus").textContent = podSource === "hsk"
      ? "ยังไม่มีข้อมูลบทความ HSK ในเครื่อง"
      : "ยังไม่มีข้อมูลพอดแคสต์ใน APK";
    return;
  }
  podApplySourceUI();
  podEpisodeList();
  podSetMediaState("none");
}

$("podSearch").addEventListener("input", () => podEpisodeList($("podSearch").value));
$("podBackBtn").addEventListener("click", () => { sfx.click(); podBackToList(); });
$("podQuitBtn").addEventListener("click", () => { sfx.click(); quitPodcastGame(); });
$("podPlayBtn").addEventListener("click", () => {
  sfx.click();
  if (podThaiVoicePlayback) podPause();
  else if ($("podAudio").paused) podPlay();
  else podPause();
});
$("podRewindBtn").addEventListener("click", () => {
  sfx.click();
  const audio = $("podAudio");
  const resumeAfterSeek = !audio.paused;
  const resumeAfterVoice = podInterruptThaiVoice();
  podSeekAudio(Math.max(0, audio.currentTime - 10), resumeAfterSeek || resumeAfterVoice);
});
$("podForwardBtn").addEventListener("click", () => {
  sfx.click();
  const audio = $("podAudio");
  const resumeAfterSeek = !audio.paused;
  const resumeAfterVoice = podInterruptThaiVoice();
  podSeekAudio(Math.min(audio.duration || Infinity, audio.currentTime + 10), resumeAfterSeek || resumeAfterVoice);
});
$("podRate").addEventListener("change", (event) => {
  $("podAudio").playbackRate = Number(event.target.value) || 1;
});
$("podSeek").addEventListener("pointerdown", () => { podSeeking = true; });
$("podSeek").addEventListener("input", (event) => {
  const audio = $("podAudio");
  if (Number.isFinite(audio.duration)) {
    const target = audio.duration * Number(event.target.value) / 1000;
    $("podCurrentTime").textContent = podFormatTime(target);
  }
});
$("podSeek").addEventListener("change", (event) => {
  const audio = $("podAudio");
  const resumeAfterSeek = !audio.paused;
  const resumeAfterVoice = podInterruptThaiVoice();
  podSeeking = false;
  if (Number.isFinite(audio.duration)) {
    podSeekAudio(audio.duration * Number(event.target.value) / 1000, resumeAfterSeek || resumeAfterVoice);
  }
});
window.addEventListener("pointerup", () => { podSeeking = false; });
$("podFontMinus").addEventListener("click", () => {
  sfx.click();
  podSetFontScale(podFontScale - POD_FS_STEP);
});
$("podFontPlus").addEventListener("click", () => {
  sfx.click();
  podSetFontScale(podFontScale + POD_FS_STEP);
});
podApplyFontScale();
$("podReplayBtn").addEventListener("click", () => {
  sfx.click();
  podReplayCurrent();
});
$("podAutoNextBtn").addEventListener("click", () => {
  sfx.click();
  podAutoNextEnabled = !podAutoNextEnabled;
  try { localStorage.setItem(POD_AUTO_NEXT_KEY, podAutoNextEnabled ? "1" : "0"); } catch (err) {}
  podApplyAutoNextToggle();
  if (podcastState) $("podStatus").textContent = podAutoNextEnabled
    ? "เปิดเล่นตอนถัดไปอัตโนมัติ · วนลูปครบทุกตอนแล้วกลับตอนแรก"
    : "ปิดเล่นตอนถัดไปอัตโนมัติ · จบตอนแล้วจะหยุด";
});
podApplyAutoNextToggle();

// ---- podcast source tabs (MaoMi / HSK articles) + HSK level filter -------
function podApplySourceUI() {
  const maoBtn = $("podSrcMaoMi");
  const hskBtn = $("podSrcHsk");
  if (maoBtn) maoBtn.setAttribute("aria-pressed", String(podSource === "maomi"));
  if (hskBtn) hskBtn.setAttribute("aria-pressed", String(podSource === "hsk"));
  const row = $("podHskFilter");
  if (row) {
    row.hidden = podSource !== "hsk";
    for (const chip of row.querySelectorAll(".pod-hsk-chip")) {
      chip.setAttribute("aria-pressed", String(Number(chip.dataset.hsk) === podHskFilter));
    }
  }
}

function podBuildHskFilter() {
  const row = $("podHskFilter");
  if (!row) return;
  const chip = (label, value) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pod-hsk-chip";
    b.textContent = label;
    b.dataset.hsk = String(value);
    b.addEventListener("click", () => {
      sfx.click();
      podHskFilter = value;
      try { localStorage.setItem(POD_HSK_FILTER_KEY, String(podHskFilter)); } catch (err) {}
      podApplySourceUI();
      podEpisodeList($("podSearch").value);
    });
    return b;
  };
  row.replaceChildren(chip("ทั้งหมด", 0),
    ...Array.from({ length: 9 }, (_, i) => chip(String(i + 1), i + 1)));
}

function podSetSource(src) {
  if (podSource === src) return;
  podSource = src;
  try { localStorage.setItem(POD_SRC_KEY, podSource); } catch (err) {}
  podApplySourceUI();
  if (podSource === "hsk" && !Array.isArray(window.PODCASTS_HSK)) {
    $("podListStatus").textContent = "กำลังโหลดบทความ HSK…";
    $("podEpisodeList").replaceChildren();
    podLoadHskData()
      .then(() => podEpisodeList($("podSearch").value))
      .catch(() => {
        $("podListStatus").textContent = "โหลดบทความ HSK ไม่ได้ — บทความ HSK มีในแอปออฟไลน์เท่านั้น";
      });
    return;
  }
  podEpisodeList($("podSearch").value);
}

$("podSrcMaoMi").addEventListener("click", () => { sfx.click(); podSetSource("maomi"); });
$("podSrcHsk").addEventListener("click", () => { sfx.click(); podSetSource("hsk"); });
podBuildHskFilter();
podApplySourceUI();
$("podThaiToggle").addEventListener("click", () => {
  if ($("podThaiToggle").disabled) return;
  podThaiVisible = !podThaiVisible;
  $("podTranscript").classList.toggle("pod-hide-thai", !podThaiVisible);
  $("podThaiToggle").setAttribute("aria-pressed", String(podThaiVisible));
  $("podThaiToggle").textContent = podThaiVisible ? "🇹🇭 ซ่อนคำแปล" : "🇹🇭 แสดงคำแปล";
});
$("podPinyinToggle").addEventListener("click", () => {
  sfx.click();
  podPinyinVisible = !podPinyinVisible;
  podSavePinyinVisible();
  podApplyPinyinToggle();
});
$("podVoiceToggle").addEventListener("click", () => {
  if (!podThaiVoiceAvailable(podcastState && podcastState.episode)) return;
  sfx.click();
  podThaiVoiceEnabled = !podThaiVoiceEnabled;
  podSaveThaiVoiceEnabled();
  podApplyThaiVoiceToggle();
  if (podThaiVoiceEnabled && podcastState) podResetThaiVoicePosition($("podAudio").currentTime);
  if (!podThaiVoiceEnabled && podThaiVoicePlayback) {
    const resumeAfterVoice = podInterruptThaiVoice();
    if (resumeAfterVoice) podPlay();
  }
  if (podcastState) $("podStatus").textContent = podThaiVoiceEnabled
    ? "เปิดเสียงแปลไทยหลังจบแต่ละประโยค"
    : "ปิดเสียงแปลไทย · กำลังเล่นพอดแคสต์ต้นฉบับ";
});
$("podAudio").addEventListener("timeupdate", podUpdateHighlight);
$("podAudio").addEventListener("loadedmetadata", () => {
  $("podDuration").textContent = podFormatTime($("podAudio").duration);
  podUpdateHighlight();
});
$("podAudio").addEventListener("play", () => {
  $("podPlayBtn").textContent = "⏸ พัก";
  podSetMediaState("playing");
});
$("podAudio").addEventListener("pause", () => {
  if (podThaiVoicePlayback) {
    $("podPlayBtn").textContent = "⏸ พัก";
    return;
  }
  $("podPlayBtn").textContent = "▶ เล่น";
  if (podcastState) podSetMediaState("paused");
});
$("podAudio").addEventListener("ended", () => {
  podWantPlay = false;
  podSyncNativeBackgroundAudio();
  podSetMediaState("paused");
  // Auto-advance (wraps to the first episode after the last one).
  if (podAutoNextEnabled && podcastState) {
    $("podPlayBtn").textContent = "⏭ ตอนถัดไป";
    podGoToNextEpisode(false);
    return;
  }
  $("podPlayBtn").textContent = "▶ เล่นซ้ำ";
});
$("podAudio").addEventListener("error", () => {
  if (podcastState) $("podStatus").textContent = window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW
    ? "โหลดไฟล์เสียงในเครื่องไม่สำเร็จ — ลองปิดเปิดแอปอีกครั้ง"
    : "โหลดเสียงไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต หรือเปิดหน้าตอนบน MaoMi Chinese";
});
$("podThaiAudio").addEventListener("ended", () => podFinishThaiVoice(true));
$("podThaiAudio").addEventListener("error", () => {
  if (podThaiVoicePlayback) {
    $("podStatus").textContent = "เสียงแปลไทยเล่นไม่ได้ — เล่นพอดแคสต์ต้นฉบับต่อ";
    podFinishThaiVoice(true);
  }
});


// ---- Background / lock-screen support (like listen mode) -----------------
function podRegisterMediaActions() {
  if (!("mediaSession" in navigator)) return;
  const podMediaAction = (name, handler) => {
    try { navigator.mediaSession.setActionHandler(name, handler); } catch (e) {}
  };
  podMediaAction("play", () => {
    if (!podcastState) return;
    podWantPlay = true;
    if ($("podAudio").paused && !podThaiVoicePlayback) podPlay();
  });
  podMediaAction("pause", () => {
    if (!podcastState) return;
    podWantPlay = false;
    podPause();
  });
  podMediaAction("seekbackward", (details) => {
    if (!podcastState) return;
    const audio = $("podAudio");
    const resumeAfterSeek = !audio.paused || podWantPlay;
    const resumeAfterVoice = podInterruptThaiVoice();
    podSeekAudio(Math.max(0, audio.currentTime - (details && details.seekOffset ? details.seekOffset : 10)), resumeAfterSeek || resumeAfterVoice);
  });
  podMediaAction("seekforward", (details) => {
    if (!podcastState) return;
    const audio = $("podAudio");
    const resumeAfterSeek = !audio.paused || podWantPlay;
    const resumeAfterVoice = podInterruptThaiVoice();
    podSeekAudio(Math.min(audio.duration || Infinity, audio.currentTime + (details && details.seekOffset ? details.seekOffset : 10)), resumeAfterSeek || resumeAfterVoice);
  });
  podMediaAction("stop", () => {
    if (!podcastState) return;
    podWantPlay = false;
    quitPodcastGame();
  });
  // Lock-screen / headset next & previous episode buttons.
  podMediaAction("previoustrack", () => {
    if (!podcastState) return;
    podReplayCurrent();
  });
  podMediaAction("nexttrack", () => {
    if (!podcastState) return;
    podGoToNextEpisode(true);
  });
}
podRegisterMediaActions();

document.addEventListener("visibilitychange", () => {
  if (!podcastState) return;
  const audio = $("podAudio");
  if (document.hidden) return;
  podSyncNativeBackgroundAudio();
  if (podWantPlay && audio.paused && !podThaiVoicePlayback) {
    podPlay();
  }
});
podInstallBubbleGuard();
