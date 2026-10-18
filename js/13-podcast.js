"use strict";
/* ================= MaoMi Chinese podcast practice ================= */
// Podcast transcripts are generated locally by tools/build_podcast_data.py.
// The offline APK plays bundled MP3 copies; the web build streams from the
// publisher's Buzzsprout CDN and hides this mode (see podCard below).
let podcastState = null;
let podActiveToken = null;
let podSeeking = false;
let podThaiVisible = true;
let podDataPromise = null;

// Transcript text zoom (A-/A+ buttons). 1 = the CSS default, persisted so a
// chosen size survives episodes and app restarts.
const POD_FS_KEY = "cr_pod_font_scale";
const POD_FS_MIN = 0.8;
const POD_FS_MAX = 1.8;
const POD_FS_STEP = 0.1;
let podFontScale = podLoadFontScale();

// The podcast dataset contains copyrighted transcript text. Keep it out of the
// public web build; the private offline APK loads its bundled copy on demand.
const podCard = document.querySelector('.card[data-mode="podcast"]');
if (podCard) podCard.hidden = !window.CR_OFFLINE_APP;

function podLoadData() {
  if (Array.isArray(window.PODCASTS)) return Promise.resolve(window.PODCASTS);
  if (!window.CR_OFFLINE_APP) return Promise.reject(new Error("Podcast is only available in the offline app"));
  if (podDataPromise) return podDataPromise;
  podDataPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "data/podcasts.js";
    script.onload = () => Array.isArray(window.PODCASTS)
      ? resolve(window.PODCASTS)
      : reject(new Error("Podcast data is unavailable"));
    script.onerror = () => reject(new Error("Podcast data could not be loaded"));
    document.head.appendChild(script);
  });
  return podDataPromise;
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

function podSetMetadata(ep) {
  try {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.zh || ep.t,
      artist: `MaoMi Chinese · ตอนที่ ${ep.n}`,
      album: "Chinese Rocket · ฟังพอดแคสต์",
    });
  } catch (e) {}
}

function podEpisodeList(query = "") {
  const list = $("podEpisodeList");
  const q = query.trim().toLowerCase();
  const episodes = (window.PODCASTS || []).filter((ep) =>
    !q || `${ep.n} ${ep.t} ${ep.zh}`.toLowerCase().includes(q));
  list.replaceChildren();
  if (!episodes.length) {
    const empty = document.createElement("p");
    empty.className = "pod-empty";
    empty.textContent = q ? "ไม่พบตอนที่ค้นหา" : "ยังไม่มีข้อมูลพอดแคสต์ในเครื่อง";
    list.appendChild(empty);
  }
  for (const ep of episodes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pod-episode";
    const n = document.createElement("span");
    n.className = "pod-episode-badge";
    n.textContent = `#${ep.n}`;
    const body = document.createElement("span");
    body.className = "pod-episode-copy";
    const title = document.createElement("strong");
    title.textContent = ep.t;
    const meta = document.createElement("small");
    const date = podEpisodeDate(ep.d);
    const duration = ep.dur ? podFormatTime(ep.dur) : "";
    meta.textContent = [date, duration].filter(Boolean).join(" · ");
    body.append(title, meta);
    const play = document.createElement("span");
    play.className = "pod-episode-play";
    play.textContent = "▶";
    button.append(n, body, play);
    button.addEventListener("click", () => podSelectEpisode(ep));
    list.appendChild(button);
  }
  $("podListStatus").textContent = q
    ? `พบ ${episodes.length} ตอน`
    : window.CR_OFFLINE_APP
    ? `${episodes.length} ตอนฟรี · ฟังได้แบบออฟไลน์`
    : `${episodes.length} ตอนฟรี · เสียงสตรีมจาก MaoMi/Buzzsprout`;
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
          sfx.click();
          if (typeof cpShowWordPopup === "function") cpShowWordPopup(text, word);
        });
        zh.appendChild(word);
      } else {
        zh.appendChild(document.createTextNode(text || ""));
      }
    }
    para.dataset.start = firstStart === null ? "" : String(firstStart);
    para.appendChild(zh);
    if (p.th) {
      const th = document.createElement("p");
      th.className = "pod-thai";
      th.lang = "th";
      th.textContent = p.th;
      para.appendChild(th);
    }
    para.addEventListener("click", (event) => {
      if (event.target.closest(".pod-word")) return;
      const start = Number(para.dataset.start);
      const audio = $("podAudio");
      if (Number.isFinite(start) && audio.duration) {
        audio.currentTime = Math.min(start, audio.duration);
        if (audio.paused) podPlay();
      }
    });
    root.appendChild(para);
  }
  const hasThai = paras.some((p) => p.th);
  $("podThaiNotice").hidden = hasThai;
  $("podThaiToggle").disabled = !hasThai;
  $("podThaiToggle").textContent = hasThai
    ? (podThaiVisible ? "🇹🇭 ซ่อนคำแปล" : "🇹🇭 แสดงคำแปล")
    : "🇹🇭 คำแปลยังไม่พร้อม";
  root.classList.toggle("pod-hide-thai", !podThaiVisible);
}

function podSelectEpisode(ep) {
  podcastState = { episode: ep };
  const screen = $("podcast");
  $("podEpisodes").hidden = true;
  $("podPlayer").hidden = false;
  $("podHeading").textContent = "กำลังฟังพอดแคสต์";
  $("podEpisodeNumber").textContent = `MAOMI CHINESE · EPISODE ${ep.n}`;
  $("podTitle").textContent = ep.zh || podEnglishTitle(ep.t) || ep.t;
  $("podEnglishTitle").textContent = ep.zh ? podEnglishTitle(ep.t) : "";
  const date = podEpisodeDate(ep.d);
  $("podMeta").textContent = [date, ep.dur ? podFormatTime(ep.dur) : "", ep.weak ? "ไฮไลท์บางส่วนเป็นเวลาโดยประมาณ" : ""].filter(Boolean).join(" · ");
  $("podStatus").textContent = window.CR_OFFLINE_APP
    ? "กำลังเปิดไฟล์เสียงในเครื่อง…"
    : "กำลังเชื่อมต่อเสียงจาก Buzzsprout…";
  podTranscript(ep);
  const audio = $("podAudio");
  audio.pause();
  audio.src = window.CR_OFFLINE_APP && ep.mp3Local ? ep.mp3Local : ep.mp3;
  audio.playbackRate = Number($("podRate").value) || 1;
  audio.load();
  podSetMetadata(ep);
  podSetMediaState("paused");
  switchScreen(screen);
  podPlay();
  requestAnimationFrame(() => $("podPlayer").scrollTop = 0);
}

function podPlay() {
  const audio = $("podAudio");
  if (!audio.src) return;
  audio.play().then(() => {
    $("podPlayBtn").textContent = "⏸ พัก";
    podSetMediaState("playing");
    $("podStatus").textContent = "กำลังเล่นเสียงต้นฉบับ · แตะคำเพื่อดูความหมาย";
  }).catch(() => {
    $("podPlayBtn").textContent = "▶ เล่น";
    $("podStatus").textContent = window.CR_OFFLINE_APP
      ? "เล่นไฟล์เสียงในเครื่องไม่ได้ — ลองปิดเปิดแอปอีกครั้ง"
      : "เล่นเสียงไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วแตะเล่นอีกครั้ง";
    podSetMediaState("paused");
  });
}

function podPause() {
  const audio = $("podAudio");
  audio.pause();
  $("podPlayBtn").textContent = "▶ เล่น";
  podSetMediaState("paused");
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

function podBackToList() {
  podPause();
  cpHideWordPopup();
  $("podPlayer").hidden = true;
  $("podEpisodes").hidden = false;
  $("podHeading").textContent = "เลือกตอนพอดแคสต์";
  podSetMediaState("none");
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (e) {}
}

function quitPodcastGame() {
  const audio = $("podAudio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
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
    $("podListStatus").textContent = "โหลดข้อมูลพอดแคสต์ไม่ได้ — ตรวจสอบว่า APK มีไฟล์ข้อมูลตอนพอดแคสต์";
    $("podEpisodeList").replaceChildren();
    return;
  }
  if (document.querySelector(".screen.active") !== $("podcast")) return;
  const episodes = window.PODCASTS;
  if (!Array.isArray(episodes) || !episodes.length) {
    $("podListStatus").textContent = "ยังไม่มีข้อมูลพอดแคสต์ใน APK";
    return;
  }
  podEpisodeList();
  podSetMediaState("none");
}

$("podSearch").addEventListener("input", () => podEpisodeList($("podSearch").value));
$("podBackBtn").addEventListener("click", () => { sfx.click(); podBackToList(); });
$("podQuitBtn").addEventListener("click", () => { sfx.click(); quitPodcastGame(); });
$("podPlayBtn").addEventListener("click", () => {
  sfx.click();
  if ($("podAudio").paused) podPlay();
  else podPause();
});
$("podRewindBtn").addEventListener("click", () => {
  sfx.click();
  const audio = $("podAudio");
  audio.currentTime = Math.max(0, audio.currentTime - 10);
  podUpdateHighlight();
});
$("podForwardBtn").addEventListener("click", () => {
  sfx.click();
  const audio = $("podAudio");
  audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10);
  podUpdateHighlight();
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
  if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 1000;
  podSeeking = false;
  podUpdateHighlight();
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
$("podThaiToggle").addEventListener("click", () => {
  if ($("podThaiToggle").disabled) return;
  podThaiVisible = !podThaiVisible;
  $("podTranscript").classList.toggle("pod-hide-thai", !podThaiVisible);
  $("podThaiToggle").setAttribute("aria-pressed", String(podThaiVisible));
  $("podThaiToggle").textContent = podThaiVisible ? "🇹🇭 ซ่อนคำแปล" : "🇹🇭 แสดงคำแปล";
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
  $("podPlayBtn").textContent = "▶ เล่น";
  if (podcastState) podSetMediaState("paused");
});
$("podAudio").addEventListener("ended", () => {
  $("podPlayBtn").textContent = "▶ เล่นซ้ำ";
  podSetMediaState("paused");
});
$("podAudio").addEventListener("error", () => {
  if (podcastState) $("podStatus").textContent = window.CR_OFFLINE_APP
    ? "โหลดไฟล์เสียงในเครื่องไม่สำเร็จ — ลองปิดเปิดแอปอีกครั้ง"
    : "โหลดเสียงไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต หรือเปิดหน้าตอนบน MaoMi Chinese";
});
