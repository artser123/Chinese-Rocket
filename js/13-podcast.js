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
// Private LAN addresses are allowed too so the same preview can be opened from
// a phone while `python serve.py --host 0.0.0.0` is running (still requires the
// explicit ?podcastPreview=1 flag, and never matches a public host).
const POD_PREVIEW_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const POD_LOCAL_PREVIEW = POD_PREVIEW_HOST.test(location.hostname) &&
  new URLSearchParams(location.search).get("podcastPreview") === "1";
const POD_THAI_VOICE_KEY = "cr_pod_thai_voice";
let podThaiVoiceEnabled = podLoadThaiVoiceEnabled();
// กล่องตัวเลือกเพิ่มเติมในแถบตัวเล่น (ความเร็ว / เล่นซ้ำ / อัตโนมัติ / ตั้งเวลาปิด /
// เสียงแปล) — เริ่มต้นปิดทุกครั้ง เพื่อให้แถบตัวเล่นเตี้ยที่สุดตอนอ่านบทความ
let podExtraOpen = false;
let podThaiVoicePlayback = null;
let podThaiVoiceLastIndex = -1;
let podSeekSequence = 0;
// One-shot status line shown after the next episode starts playing (podPlay()
// writes its own generic message once the media actually begins).
let podStatusNote = "";

// Auto-advance when an episode finishes. The ⏭ button cycles through three
// states (off → list order → random) so random playback needs no extra button;
// every state wraps inside the same filtered list (source + HSK/category
// filter). Off is still the default, so one episode stops when it finishes.
const POD_AUTO_NEXT_KEY = "cr_pod_auto_next";
let podAutoNextMode = podLoadAutoNextMode();   // "off" | "order" | "random"
let podRandomLastPick = null;                  // กันไม่ให้สุ่มได้ตอนเดิมซ้ำติดกัน

// Transcript text zoom (A-/A+ buttons). 1 = the CSS default, persisted so a
// chosen size survives episodes and app restarts.
const POD_FS_KEY = "cr_pod_font_scale";
const POD_FS_MIN = 0.8;
const POD_FS_MAX = 1.8;
const POD_FS_STEP = 0.1;
let podFontScale = podLoadFontScale();

// Podcast sources and list filters persist so the picker reopens as last used.
const POD_SRC_KEY = "cr_pod_source";
const POD_HSK_FILTER_KEY = "cr_pod_hsk_filter";
const POD_SPECIAL_FILTER_KEY = "cr_pod_special_filter";
let podSource = podLoadSource();
let podHskFilter = podLoadHskFilter();
let podSpecialFilter = podLoadSpecialFilter();
let podHskDataPromise = null;
let podSpecializedDataPromise = null;
let podIntroPlayback = null;

// ---- ความทนทานของการเล่นเบื้องหลัง ------------------------------------
// ตอนปิดหน้าจอ/สลับแอป Android อาจหยุดคลิปเอง หรือไม่ส่ง event "ended"
// ให้ ทำให้ตอนถัดไปไม่เดิน โฟกัสต่อไปคือ (1) จับเวลาไว้แล้วยิงเหตุการณ์
// ปลอม ๆ ถ้าเสียงจบจริง และ (2) เฝ้าดูว่าคลิปถูกหยุดเองหรือเปล่าแล้วสั่งเล่นต่อ
let podWatchTimer = null;
let podBusyUntil = 0;      // ช่วงที่กำลังโหลด/เลื่อนเสียง ห้ามสั่งเล่นซ้ำ
let podSaveTimer = null;
let podEndedFor = null;    // ตอนที่เพิ่งจัดการเหตุการณ์ "จบ" ไปแล้ว

function podBusy(ms) {
  podBusyUntil = Math.max(podBusyUntil, Date.now() + (ms || 0));
}

function podIsBusy() {
  return Date.now() < podBusyUntil;
}


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

function podLoadSpecializedData() {
  if (Array.isArray(window.PODCASTS_SPECIALIZED)) return Promise.resolve(window.PODCASTS_SPECIALIZED);
  if (!window.CR_OFFLINE_APP && !POD_LOCAL_PREVIEW) {
    return Promise.reject(new Error("Specialized articles are only available in the offline app"));
  }
  if (podSpecializedDataPromise) return podSpecializedDataPromise;
  podSpecializedDataPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "data/podcasts_specialized.js";
    script.onload = () => Array.isArray(window.PODCASTS_SPECIALIZED) && window.PODCASTS_SPECIALIZED.length
      ? resolve(window.PODCASTS_SPECIALIZED)
      : reject(new Error("Specialized podcast data is unavailable"));
    script.onerror = () => reject(new Error("Specialized podcast data could not be loaded"));
    document.head.appendChild(script);
  });
  return podSpecializedDataPromise;
}

// Episode list of the active (or given) source; each source wraps around its
// own list when auto-advancing.
function podEpisodesForSource(src = podSource) {
  if (src === "hsk") return window.PODCASTS_HSK || [];
  if (src === "specialized") return window.PODCASTS_SPECIALIZED || [];
  return window.PODCASTS || [];
}

function podSourceOf(ep) {
  return ep && (ep.src === "hsk" || ep.src === "specialized") ? ep.src : "maomi";
}

// บทความเฉพาะทาง: เรียงตามระดับ HSK จากน้อยไปมากเสมอ (HSK 1 → 9) เพื่อไล่ฟัง
// จากง่ายไปยากโดยไม่ต้องเลือกหมวดก่อน ภายในระดับเดียวกันคงลำดับเดิมไว้
// (เรียงตามหมวด → ลำดับบทความ) ด้วยการ sort แบบ stable
function podSortByHsk(list) {
  if (!Array.isArray(list) || list.length < 2) return list;
  return list
    .map((ep, index) => ({ ep, index }))
    .sort((a, b) => {
      const ha = typeof a.ep.hsk === "number" && Number.isFinite(a.ep.hsk) ? a.ep.hsk : 99;
      const hb = typeof b.ep.hsk === "number" && Number.isFinite(b.ep.hsk) ? b.ep.hsk : 99;
      return ha === hb ? a.index - b.index : ha - hb;
    })
    .map((row) => row.ep);
}

function podFilteredEpisodes(src = podSource) {
  const list = podEpisodesForSource(src).filter((ep) => {
    if (src === "hsk" && podHskFilter && ep.hsk !== podHskFilter) return false;
    if (src === "specialized" && podSpecialFilter !== "all" && ep.categoryKey !== podSpecialFilter) return false;
    return true;
  });
  return src === "specialized" ? podSortByHsk(list) : list;
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
    const saved = localStorage.getItem(POD_SRC_KEY);
    return ["maomi", "hsk", "specialized"].includes(saved) ? saved : "maomi";
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

function podLoadAutoNextMode() {
  try {
    const raw = localStorage.getItem(POD_AUTO_NEXT_KEY);
    if (raw === "random") return "random";
    // "1" คือค่าเดิมก่อนมีโหมดสุ่ม (เดิมเก็บเป็น true/false)
    return raw === "order" || raw === "1" ? "order" : "off";
  } catch (err) {
    return "off";
  }
}

function podSaveAutoNextMode() {
  try { localStorage.setItem(POD_AUTO_NEXT_KEY, podAutoNextMode); } catch (err) {}
}

// วงจรของปุ่ม ⏭: ปิด → ตามรายการ → สุ่ม → ปิด (ใช้ปุ่มเดิม ไม่เพิ่มปุ่มใหม่)
function podNextAutoNextMode(mode = podAutoNextMode) {
  if (mode === "off") return "order";
  return mode === "order" ? "random" : "off";
}

function podLoadPinyinVisible() {
  try {
    const raw = localStorage.getItem(POD_PINYIN_KEY);
    return raw === null ? true : raw === "1";
  } catch (err) {
    return true;
  }
}

function podApplyExtraOpen() {
  const box = $("podExtra");
  const button = $("podMoreBtn");
  if (!box || !button) return;
  box.hidden = !podExtraOpen;
  button.setAttribute("aria-expanded", String(podExtraOpen));
  const label = podExtraOpen ? "ซ่อนตัวเลือกเพิ่มเติม" : "ตัวเลือกเพิ่มเติม";
  button.title = label;
  button.setAttribute("aria-label", label);
}

function podToggleExtra() {
  podExtraOpen = !podExtraOpen;
  podApplyExtraOpen();
}

// จุดสีเล็ก ๆ บนปุ่ม "⋯" เพื่อบอกว่า "เล่นตอนถัดไปอัตโนมัติ" เปิดค้างไว้
// แม้กล่องตัวเลือกจะถูกพับอยู่ (สถานะอื่นดูได้จากปุ่มในกล่องและป้าย ⏱ บนแถบหัว)
function podSyncMoreBtn() {
  const button = $("podMoreBtn");
  if (!button) return;
  button.classList.toggle("has-active", podAutoNextMode !== "off");
}

function podSavePinyinVisible() {
  try { localStorage.setItem(POD_PINYIN_KEY, podPinyinVisible ? "1" : "0"); } catch (err) {}
}

function podApplyPinyinToggle() {
  const button = $("podPinyinToggle");
  if (button) {
    button.setAttribute("aria-pressed", String(podPinyinVisible));
    button.textContent = "拼音";
    const label = podPinyinVisible ? "ซ่อนพินอิน" : "แสดงพินอิน";
    button.title = label;
    button.setAttribute("aria-label", label);
  }
  $("podTranscript").classList.toggle("pod-hide-pinyin", !podPinyinVisible);
}

function podApplyAutoNextToggle() {
  const button = $("podAutoNextBtn");
  const mode = podAutoNextMode;
  const random = mode === "random";
  if (button) {
    button.setAttribute("aria-pressed", String(mode !== "off"));
    button.dataset.mode = mode;
    button.textContent = random ? "🔀" : "⏭";
    button.title = mode === "off"
      ? "เล่นตอนถัดไปอัตโนมัติ: ปิด — แตะเพื่อเล่นตามรายการ"
      : random
      ? "เล่นตอนถัดไปอัตโนมัติ: สุ่ม — แตะเพื่อปิด"
      : "เล่นตอนถัดไปอัตโนมัติ: ตามรายการ (วนลูปทั้งหมด) — แตะเพื่อสลับเป็นสุ่ม";
    button.setAttribute("aria-label", button.title);
  }
  podSyncMoreBtn();
}

// เทียบว่าเป็นตอนเดียวกันหรือไม่ (ใช้ตัดสิน "ตอนเดิมหรือเปล่า" ตอนกดเล่นซ้ำ)
function podSameEpisode(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const src = podSourceOf(a);
  if (src !== podSourceOf(b)) return false;
  if (src === "maomi") return a.n === b.n;
  if (a.id && b.id) return a.id === b.id;
  return a.n === b.n && a.hsk === b.hsk;
}

// Episode order is the list order shown in the picker; wrapping at the end
// restarts the whole set from the first episode. MaoMi and HSK articles each
// wrap within their own source list.
function podEpisodeIndex(ep) {
  if (!ep) return -1;
  const list = podFilteredEpisodes(podSourceOf(ep));
  const direct = list.indexOf(ep);
  if (direct >= 0) return direct;
  // ตอน MaoMi ไม่มี src/id จึงต้องเทียบด้วยเลขตอน ไม่งั้น item.id === ep.id
  // (undefined === undefined) จะจับคู่ตอนแรกของรายการเสมอ ทำให้ "ตอนถัดไป"
  // ค้างอยู่ที่ตอนเดิม
  const src = podSourceOf(ep);
  return list.findIndex((item) => {
    if (!item || podSourceOf(item) !== src) return false;
    if (ep.id || item.id) return item.id === ep.id;
    return item.n === ep.n;
  });
}

function podNextEpisode(ep) {
  const list = podFilteredEpisodes(podSourceOf(ep));
  if (!list.length) return null;
  const index = podEpisodeIndex(ep);
  return list[index < 0 ? 0 : (index + 1) % list.length];
}

// ตอนถัดไปแบบสุ่ม — เลือกจากรายการที่กรองอยู่ (แหล่ง + ระดับ HSK/หมวด + คำค้น)
// โดยข้ามบทความที่ยังไม่มีไฟล์เสียง และไม่ซ้ำตอนปัจจุบันหรือตอนที่เพิ่งสุ่มไป
function podRandomEpisode(ep) {
  const list = podFilteredEpisodes(podSourceOf(ep)).filter((item) => {
    if (!item) return false;
    const src = podSourceOf(item);
    return src === "maomi" || Boolean(item.mp3Local);
  });
  if (!list.length) return null;
  if (list.length === 1) return podSameEpisode(list[0], ep) ? null : list[0];
  let pool = list.filter((item) => !podSameEpisode(item, ep));
  if (!pool.length) pool = list;
  if (podRandomLastPick && pool.length > 1) {
    const narrowed = pool.filter((item) => !podSameEpisode(item, podRandomLastPick));
    if (narrowed.length) pool = narrowed;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  podRandomLastPick = pick;
  return pick;
}

// ตอนก่อนหน้า — ใช้รายการที่กรองอยู่ (แหล่ง + ระดับ HSK + คำค้น) เหมือนตอนถัดไป
// และวนกลับไปตอนสุดท้ายเมื่ออยู่ตอนแรก
function podPreviousEpisode(ep) {
  const list = podFilteredEpisodes(podSourceOf(ep));
  if (!list.length) return null;
  const index = podEpisodeIndex(ep);
  return list[index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length];
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

// ป้ายสั้น ๆ ของตอน/บทความ สำหรับข้อความสถานะในแถบล่าง
// (MaoMi ใช้เลขตอน #n แต่บทความ HSK/เฉพาะทางใช้ระดับ HSK ซึ่งเป็นสิ่งที่ผู้ใช้เห็น)
function podEpisodeTag(ep) {
  if (!ep) return "";
  return ep.src === "hsk" || ep.src === "specialized" ? `HSK ${ep.hsk}` : `#${ep.n}`;
}

function podGoToNextEpisode(manual = false) {
  if (!podcastState) return;
  const list = podFilteredEpisodes(podSourceOf(podcastState.episode));
  const random = podAutoNextMode === "random";
  const next = random ? podRandomEpisode(podcastState.episode) : podNextEpisode(podcastState.episode);
  if (!next) return;
  if (podSameEpisode(next, podcastState.episode) && list.length <= 1) {
    podReplayCurrent();
    return;
  }
  const wrapped = !random && podEpisodeIndex(podcastState.episode) === list.length - 1;
  const tag = podEpisodeTag(next);
  podSelectEpisode(next);
  podStatusNote = random
    ? (manual ? `🎲 สุ่มไปที่ ${tag}` : `🔀 สุ่มถัดไป · ${tag}`)
    : manual
    ? `ข้ามไป ${tag}`
    : `⏭ เล่นถัดไปอัตโนมัติ · ${tag}${wrapped ? " (วนกลับตอนแรก)" : ""}`;
  $("podStatus").textContent = podStatusNote;
}

// ย้อนไปตอนก่อนหน้า (ปุ่มในตัวเล่น / ปุ่มหูฟังบลูทูธ)
function podGoToPreviousEpisode(manual = true) {
  if (!podcastState) return;
  const list = podFilteredEpisodes(podSourceOf(podcastState.episode));
  const prev = podPreviousEpisode(podcastState.episode);
  if (!prev) return;
  if (podSameEpisode(prev, podcastState.episode) && list.length <= 1) {
    podReplayCurrent();
    return;
  }
  const wrapped = podEpisodeIndex(podcastState.episode) === 0;
  const tag = podEpisodeTag(prev);
  podSelectEpisode(prev);
  podStatusNote = manual
    ? `⏮ ย้อนไป ${tag}${wrapped ? " (วนกลับตอนสุดท้าย)" : ""}`
    : `⏮ ก่อนหน้า · ${tag}`;
  $("podStatus").textContent = podStatusNote;
}

// ไฟล์เสียงของตอนนี้ (ใช้เทียบกับ element เพื่อกันเหตุการณ์ค้างจากตอนก่อน)
function podEpisodeSrc(ep) {
  if (!ep) return "";
  return (window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW) && ep.mp3Local ? ep.mp3Local : (ep.mp3 || "");
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
  button.setAttribute("aria-pressed", String(podThaiVoiceEnabled));
  button.textContent = podThaiVoiceEnabled ? "🇹🇭 เสียงแปล: เปิด" : "🇹🇭 เสียงแปล: ปิด";
  podSyncMoreBtn();
}

function podSentenceIntervals(ep) {
  const paras = ep.paras || [];
  const countChars = (para) => (para.tk || []).reduce((total, row) =>
    total + ([...(row[0] || "")].filter((ch) => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch)).length), 0);
  const totalChars = Math.max(1, paras.reduce((total, para) => total + countChars(para), 0));
  const span = Math.max(1, (ep.dur || 300) - 10);
  let charOffset = 0;
  return paras.map((para) => {
    const rows = (para.tk || []).filter((row) => Number.isFinite(row[2]) && Number.isFinite(row[3]));
    const chars = countChars(para);
    let interval = null;
    if (rows.length) {
      interval = {
        start: Math.min(...rows.map((row) => row[2])),
        end: Math.max(...rows.map((row) => row[3])),
      };
    } else if (Number.isFinite(para.start) && Number.isFinite(para.end) && para.end > para.start) {
      // TTS article datasets have exact sentence clip offsets even if ASR could
      // not align a token (e.g. a model pronounces a phrase unusually).
      interval = { start: para.start, end: para.end };
    } else if (chars > 0) {
      // Legacy/MaoMi fallback mirrors podTranscript's proportional karaoke.
      interval = {
        start: 8 + span * charOffset / totalChars,
        end: 8 + span * (charOffset + chars) / totalChars,
      };
    }
    charOffset += chars;
    return interval;
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

function podLoadSpecialFilter() {
  try { return localStorage.getItem(POD_SPECIAL_FILTER_KEY) || "all"; }
  catch (err) { return "all"; }
}

// Wait until the media element has completed a seek before resuming playback.
// Calling play() immediately after setting currentTime can make some WebViews
// start from 0 while the requested seek is still pending.
function podSeekAudio(target, resumeAfterSeek = false) {
  if (podIntroPlayback) {
    podClearIntro();
    $("podTranscript").hidden = false;
  }
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
  podBusy(4000); // กำลังเลื่อนเสียง อย่าสั่งเล่นซ้ำระหว่างนี้

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
  if (active) podWatchStart();
  else podWatchStop();
  podSyncMediaButtons();
}

// ชื่อตอนสำหรับการแจ้งเตือน/หน้าจอล็อก
function podMediaTitle() {
  const ep = podcastState && podcastState.episode;
  if (!ep) return "";
  return ep.zh || podEnglishTitle(ep.t) || ep.t || "";
}

// ปุ่มบนหูฟังบลูทูธ / หน้าจอล็อก (แอป Android): บอกฝั่งเนทีฟว่ากำลังเล่นตอนไหน
// อยู่ เพื่อให้ปุ่ม play/pause/previous/next ส่งกลับมาที่ window.crNativeMediaAction
function podSyncMediaButtons() {
  const open = Boolean(podcastState) && !$("podPlayer").hidden;
  crSetMediaButtons(open, open && podWantPlay, podMediaTitle(), "Chinese Rocket · พอดแคสต์");
}

// ---- เฝ้าดูการเล่นเบื้องหลัง ------------------------------------------------
// ฟังก์ชันนี้ทำให้ "เล่นตอนถัดไปอัตโนมัติ" ทำงานต่อได้แม้ปิดหน้าจอหรือสลับแอป:
//  - ถ้า event "ended" หายไป (WebView ไม่ส่งตอนถูกหยุด) ให้ตรวจเวลาจบเองแล้วเดินต่อ
//  - ถ้าระบบหยุดคลิปเอง (audio.paused) ให้สั่งเล่นต่อ
function podWatchStart() {
  if (podWatchTimer !== null) return;
  podWatchTimer = setInterval(podWatch, 1500);
}

function podWatchStop() {
  if (podWatchTimer === null) return;
  clearInterval(podWatchTimer);
  podWatchTimer = null;
}

function podWatch() {
  if (!podcastState || !podWantPlay) { podWatchStop(); return; }
  if (podIntroPlayback || podThaiVoicePlayback || podIsBusy()) return;
  const audio = $("podAudio");
  if (!audio || !audio.src) return;
  if (audio.ended) {
    // จบตอนแล้วแต่ event "ended" ไม่มา (เช่นตอนปิดหน้าจอ) → เดินต่อเอง
    podHandleEnded();
    return;
  }
  if (audio.paused) podResumeAudio();
}

// เดินตอนถัดไปอัตโนมัติ: คง "ตั้งใจเล่นต่อ" ไว้เสมอ เพื่อไม่ให้บริการ
// foreground ถูกสั่งหยุดแล้วต้องเริ่มใหม่ตอนที่แอปอยู่เบื้องหลัง
// (Android 12+ เริ่มบริการจากเบื้องหลังไม่ได้ → ตอนถัดไปจะไม่เดิน)
// ฟังก์ชันนี้ถูกเรียกได้ทั้งจาก event "ended" และจากตัวเฝ้าดู เพื่อกันเหตุการณ์
// ที่หายไปตอนปิดหน้าจอ/สลับแอป
function podHandleEnded() {
  if (!podcastState) return;
  const audio = $("podAudio");
  if (!audio.ended) return;                              // ยังไม่จบจริง
  const episode = podcastState.episode;
  if (podEndedFor === episode) return;                    // จัดการตอนนี้ไปแล้ว
  if (audio.getAttribute("src") !== podEpisodeSrc(episode)) return; // เหตุการณ์ค้างจากตอนก่อน
  podEndedFor = episode;
  if (podAutoNextMode !== "off") {
    podWantPlay = true;
    podSyncNativeBackgroundAudio();
    podSetMediaState("playing");
    $("podPlayBtn").textContent = podAutoNextMode === "random" ? "🔀 สุ่มตอนถัดไป" : "⏭ ตอนถัดไป";
    podGoToNextEpisode(false);
    return;
  }
  podWantPlay = false;
  podSyncNativeBackgroundAudio();
  podSetMediaState("paused");
  $("podPlayBtn").textContent = "▶ เล่นซ้ำ";
}

// ระบบอาจหยุดคลิปเองตอนแอปอยู่เบื้องหลัง — สั่งเล่นต่อแบบซ้ำได้ไม่กี่ครั้ง
function podResumeAudio(attempt = 0) {
  if (!podWantPlay || !podcastState) return;
  const audio = $("podAudio");
  if (!audio || !audio.src || !audio.paused || audio.ended) return;
  if (podIsBusy()) return;
  if (attempt >= 4) return;
  setTimeout(() => {
    if (!podWantPlay || !podcastState) return;
    const el = $("podAudio");
    if (!el.paused || el.ended) return;
    el.play().catch(() => podResumeAudio(attempt + 1));
  }, 400 + attempt * 700);
}

/* ---- บันทึก/กู้คืนตอนที่กำลังฟัง ---------------------------------------
   ถ้า Android ฆ่าแอปตอนอยู่เบื้องหลัง หน้าเว็บจะโหลดใหม่และผู้ใช้จะเจอหน้า
   เมนู (หน้า Index) จึงเก็บตอนที่ฟังค้างไว้ เพื่อกลับมาเปิดตอนเดิมที่ตำแหน่งเดิม */
function podSessionKey(ep) {
  if (!ep) return "";
  if (ep.src === "hsk" || ep.src === "specialized") return `${ep.src}:${ep.id}`;
  return `maomi:${ep.n}`;
}

function podSaveSession() {
  if (!podcastState || !podcastState.episode) { crClearMediaSession(); return; }
  const ep = podcastState.episode;
  const audio = $("podAudio");
  crSaveMediaSession({
    mode: "podcast",
    key: podSessionKey(ep),
    src: podSourceOf(ep),
    n: ep.n,
    id: ep.id,
    hsk: ep.hsk,
    hskFilter: podHskFilter,
    specialFilter: podSpecialFilter,
    time: Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime) : 0,
    playing: Boolean(podWantPlay),
  });
}

function podSaveSessionSoon() {
  if (podSaveTimer !== null) return;
  podSaveTimer = setTimeout(() => {
    podSaveTimer = null;
    podSaveSession();
  }, 4000);
}

function podRestorePosition(time) {
  const target = Number(time) || 0;
  if (target <= 1) return;
  const audio = $("podAudio");
  const apply = () => {
    try {
      const max = Number.isFinite(audio.duration) ? audio.duration : target;
      audio.currentTime = Math.min(target, Math.max(0, max - 0.5));
    } catch (error) { /* เสียงยังโหลดไม่เสร็จ */ }
  };
  if (audio.readyState >= 1) apply();
  else audio.addEventListener("loadedmetadata", apply, { once: true });
}

async function podRestoreSession(session) {
  if (!session || !session.key) return false;
  const src = session.src === "hsk" || session.src === "specialized" ? session.src : "maomi";
  podSource = src;
  if (src === "hsk" && Number.isInteger(session.hskFilter)) podHskFilter = session.hskFilter;
  if (src === "specialized" && typeof session.specialFilter === "string") podSpecialFilter = session.specialFilter;
  try {
    localStorage.setItem(POD_SRC_KEY, podSource);
    if (src === "hsk") localStorage.setItem(POD_HSK_FILTER_KEY, String(podHskFilter));
    if (src === "specialized") localStorage.setItem(POD_SPECIAL_FILTER_KEY, podSpecialFilter);
  } catch (error) { /* storage unavailable */ }
  await podLoadData();
  if (src === "hsk") await podLoadHskData();
  if (src === "specialized") await podLoadSpecializedData();
  const episode = podEpisodesForSource(src).find((item) => podSessionKey(item) === session.key);
  if (!episode) return false;
  podApplySourceUI();
  podEpisodeList($("podSearch").value);
  switchScreen($("podcast"));
  podSelectEpisode(episode, { autoplay: session.playing !== false });
  podRestorePosition(session.time);
  return true;
}

function podSetMetadata(ep) {
  try {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.zh || ep.t,
      artist: ep.src === "hsk"
        ? `Chinese Rocket · HSK ${ep.hsk}`
        : ep.src === "specialized"
        ? `Chinese Rocket · ${ep.cat || "บทความเฉพาะทาง"}`
        : `MaoMi Chinese · ตอนที่ ${ep.n}`,
      album: "Chinese Rocket · ฟังพอดแคสต์",
    });
  } catch (e) {}
}

// AI cover images: podcast_img/<id>.webp, produced by tools/gen_podcast_images.py.
// A cover can be missing (batch still running, or an article without one), so
// nothing here is allowed to leave a broken-image icon behind.
function podImageId(ep) {
  if (ep.id) return ep.id;
  return `maomi-${String(ep.n || 0).padStart(3, "0")}`;
}

// List thumbnail. It is appended *after* the level badge and only covers it
// once it has pixels, which is why a missing file can just remove itself.
// `loading="lazy"` works because the element is never display:none (Chromium
// never fetches a lazy image that is not rendered).
function podThumbImage(ep, onShown) {
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.loading = "lazy";
  img.addEventListener("load", () => { if (onShown) onShown(); });
  img.addEventListener("error", () => img.remove());
  img.src = `podcast_img/${podImageId(ep)}.webp`;
  return img;
}

// Player cover: one image, loaded eagerly so it is ready before the card is
// scrolled into view; hidden (with its button) when the article has no cover
// yet. Tapping it opens the fullscreen viewer — see crCoverImage in 03-helpers.
function podCoverImage(img, ep) {
  crCoverImage(img, `podcast_img/${podImageId(ep)}.webp`);
}

function podEpisodeList(query = "") {
  const list = $("podEpisodeList");
  const q = query.trim().toLowerCase();
  const filtered = podEpisodesForSource().filter((ep) => {
    if (podSource === "hsk" && podHskFilter && ep.hsk !== podHskFilter) return false;
    if (podSource === "specialized" && podSpecialFilter !== "all" && ep.categoryKey !== podSpecialFilter) return false;
    const hay = ep.src === "hsk" || ep.src === "specialized"
      ? `${ep.id} ${ep.hsk} ${ep.cat || ""} ${ep.t} ${ep.zh}`
      : `${ep.n} ${ep.t} ${ep.zh}`;
    return !q || hay.toLowerCase().includes(q);
  });
  const episodes = podSource === "specialized" ? podSortByHsk(filtered) : filtered;
  list.replaceChildren();
  if (!episodes.length) {
    const empty = document.createElement("p");
    empty.className = "pod-empty";
    if (podSource === "hsk" && podHskFilter && !q) {
      empty.textContent = "ยังไม่มีบทความในระดับ HSK นี้";
    } else if (podSource === "specialized" && podSpecialFilter !== "all" && !q) {
      empty.textContent = "ไม่มีบทความในหมวดนี้";
    } else {
      empty.textContent = q ? "ไม่พบตอนที่ค้นหา" : "ยังไม่มีข้อมูลพอดแคสต์ในเครื่อง";
    }
    list.appendChild(empty);
  }
  for (const ep of episodes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pod-episode";
    const thumb = document.createElement("span");
    thumb.className = "pod-episode-thumb";
    const n = document.createElement("span");
    n.className = "pod-episode-badge";
    if (ep.src === "hsk" || ep.src === "specialized") {
      n.classList.add("pod-badge-hsk");
      n.textContent = `HSK ${ep.hsk}`;
    } else {
      n.textContent = `#${ep.n}`;
    }
    const thumbImg = podThumbImage(ep, () => thumb.classList.add("has-image"));
    thumb.append(n, thumbImg);
    const body = document.createElement("span");
    body.className = "pod-episode-copy";
    const title = document.createElement("strong");
    title.textContent = ep.t;
    const meta = document.createElement("small");
    const date = podEpisodeDate(ep.d);
    const duration = ep.dur ? podFormatTime(ep.dur) : "";
    const weakNote = (ep.src === "hsk" || ep.src === "specialized") && ep.weakCount
      ? `ไฮไลท์ ${ep.weakCount} ประโยคเป็นเวลาโดยประมาณ` : "";
    meta.textContent = [ep.src === "maomi" ? date : (ep.cat || ""), duration, weakNote]
      .filter(Boolean).join(" · ");
    body.append(title, meta);
    const play = document.createElement("span");
    play.className = "pod-episode-play";
    play.textContent = "▶";
    button.append(thumb, body, play);
    button.addEventListener("click", () => podSelectEpisode(ep));
    list.appendChild(button);
  }
  if (q) {
    $("podListStatus").textContent = `พบ ${episodes.length} ตอน`;
  } else if (podSource === "hsk") {
    $("podListStatus").textContent = `${episodes.length} บทความ HSK · เสียงและคำแปลในเครื่อง`;
  } else if (podSource === "specialized") {
    $("podListStatus").textContent = `${episodes.length} บทความเฉพาะทาง · เรียงตามระดับ HSK`;
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
  root.hidden = false;
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
  const thaiButton = $("podThaiToggle");
  thaiButton.disabled = !hasThai;
  thaiButton.textContent = "ไทย";
  thaiButton.title = hasThai
    ? (podThaiVisible ? "ซ่อนคำแปลไทย" : "แสดงคำแปลไทย")
    : "ตอนนี้ยังไม่มีคำแปลไทย";
  thaiButton.setAttribute("aria-label", thaiButton.title);
  root.classList.toggle("pod-hide-thai", !podThaiVisible);
  root.classList.toggle("pod-hide-pinyin", !podPinyinVisible);
  podApplyPinyinToggle();
}

function podClearIntro() {
  if (podIntroPlayback && podIntroPlayback.timer) clearTimeout(podIntroPlayback.timer);
  podIntroPlayback = null;
  const audio = $("podIntroAudio");
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

function podPlayIntroClip() {
  const state = podIntroPlayback;
  if (!state || !podWantPlay) return;
  const lang = state.index === 0 ? "zh" : "th";
  const audio = $("podIntroAudio");
  const path = state.clips[lang];
  state.phase = "clip";
  audio.pause();
  audio.src = path;
  audio.load();
  $("podPlayBtn").textContent = "⏸ พัก";
  $("podStatus").textContent = lang === "zh"
    ? "กำลังอ่านชื่อเรื่องภาษาจีน…"
    : "กำลังอ่านชื่อเรื่องภาษาไทย…";
  podSetMediaState("playing");
  audio.play().catch(() => {
    if (podIntroPlayback === state) podAdvanceIntro();
  });
}

function podAdvanceIntro() {
  const state = podIntroPlayback;
  if (!state || !podWantPlay) return;
  if (state.index === 0) {
    state.index = 1;
    podPlayIntroClip();
    return;
  }
  state.phase = "gap";
  state.remaining = 2000;
  $("podStatus").textContent = "จบการอ่านชื่อเรื่อง · เริ่มบทความในอีก 2 วินาที";
  podScheduleIntroGap(state);
}

function podScheduleIntroGap(state) {
  if (!state || !podWantPlay || state.phase !== "gap") return;
  state.until = performance.now() + state.remaining;
  state.timer = setTimeout(() => {
    if (podIntroPlayback !== state || !podWantPlay) return;
    podClearIntro();
    podPlayMainAudio();
  }, state.remaining);
}

function podStartIntro(ep) {
  const clips = ep && ep.introAudioLocal;
  if (!clips || !clips.zh || !clips.th || podSourceOf(ep) === "maomi") return false;
  podIntroPlayback = { episode: ep, clips, index: 0, phase: "clip", timer: null, remaining: 0 };
  $("podTranscript").hidden = true;
  podWantPlay = true;
  podSyncNativeBackgroundAudio();
  podPlayIntroClip();
  return true;
}

function podResumeIntro() {
  const state = podIntroPlayback;
  if (!state) return false;
  podWantPlay = true;
  podSyncNativeBackgroundAudio();
  if (state.phase === "clip") {
    $("podIntroAudio").play().catch(() => podAdvanceIntro());
    $("podPlayBtn").textContent = "⏸ พัก";
    podSetMediaState("playing");
  } else if (state.phase === "gap") {
    podScheduleIntroGap(state);
    $("podPlayBtn").textContent = "⏸ พัก";
    podSetMediaState("playing");
  }
  return true;
}

function podSelectEpisode(ep, options = {}) {
  // Articles whose narration has not been generated yet cannot be opened.
  if ((ep.src === "hsk" || ep.src === "specialized") && !ep.mp3Local) {
    $("podListStatus").textContent = "บทความนี้ยังไม่มีไฟล์เสียง — ไฟล์เสียงยังสร้างไม่ครบ";
    return;
  }
  podClearIntro();
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
    : ep.src === "specialized"
    ? `${ep.cat || "บทความเฉพาะทาง"} · HSK ${ep.hsk}`
    : `MAOMI CHINESE · EPISODE ${ep.n}`;
  $("podTitle").textContent = ep.zh || podEnglishTitle(ep.t) || ep.t;
  podCoverImage($("podCover"), ep);
  const introTitle = $("podIntroTitle");
  const hasArticleIntro = podSourceOf(ep) !== "maomi";
  introTitle.hidden = !hasArticleIntro;
  introTitle.textContent = hasArticleIntro ? `故事：${ep.zh || ep.t} · เรื่อง: ${ep.t || ep.zh}` : "";
  $("podEnglishTitle").textContent = ep.zh ? podEnglishTitle(ep.t) : "";
  const date = podEpisodeDate(ep.d);
  $("podMeta").textContent = [date, ep.dur ? podFormatTime(ep.dur) : "", ep.weak ? "ไฮไลท์บางส่วนเป็นเวลาโดยประมาณ" : ""].filter(Boolean).join(" · ");
  $("podStatus").textContent = window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW
    ? "กำลังเตรียมเสียง…"
    : "กำลังเชื่อมต่อเสียงจาก Buzzsprout…";
  podTranscript(ep);
  podApplyThaiVoiceToggle(ep);
  crSetNotificationText(
    (window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW)
      ? `กำลังเล่น · ${ep.zh || podEnglishTitle(ep.t) || ep.t}`
      : "Chinese Rocket · ฟังพอดแคสต์",
    "เล่นต่อได้แม้ปิดหน้าจอ"
  );
  const audio = $("podAudio");
  audio.pause();
  audio.src = podEpisodeSrc(ep);
  audio.playbackRate = Number($("podRate").value) || 1;
  audio.load();
  podBusy(6000); // กำลังโหลดตอนใหม่ อย่าสั่งเล่นซ้ำระหว่างนี้
  podEndedFor = null;
  podSetMetadata(ep);
  podSetMediaState("paused");
  switchScreen(screen);
  if (options.autoplay === false) {
    // กู้คืนเฉพาะหน้าจอ (ยังไม่เล่นต่อ)
    podWantPlay = false;
    podSyncNativeBackgroundAudio();
    $("podPlayBtn").textContent = "▶ เล่น";
  } else if (!podStartIntro(ep)) {
    podPlay();
  }
  podSaveSession();
  requestAnimationFrame(() => $("podPlayer").scrollTop = 0);
}

function podPlay() {
  podSeekSequence++;
  podInterruptThaiVoice();
  if (podIntroPlayback) {
    podResumeIntro();
    return;
  }
  podWantPlay = true;
  podPlayMainAudio();
}

function podPlayMainAudio(attempt = 0) {
  podWantPlay = true;
  podEndedFor = null;
  $("podTranscript").hidden = false;
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
    // บางครั้ง WebView ยังไม่พร้อมเล่นเสียง (เช่น หลังสลับแอป) — ลองใหม่ได้ไม่กี่ครั้ง
    if (attempt < 3 && podWantPlay) {
      setTimeout(() => podPlayMainAudio(attempt + 1), 600 + attempt * 500);
      return;
    }
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
  if (podIntroPlayback) {
    const state = podIntroPlayback;
    if (state.phase === "gap") {
      clearTimeout(state.timer);
      state.timer = null;
      state.remaining = Math.max(0, state.until - performance.now());
    }
    $("podIntroAudio").pause();
  }
  const audio = $("podAudio");
  audio.pause();
  $("podPlayBtn").textContent = "▶ เล่น";
  if (podIntroPlayback) $("podStatus").textContent = "หยุดชั่วคราว · แตะเล่นเพื่ออ่านชื่อเรื่องต่อ";
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

  const sentenceRect = sentence.getBoundingClientRect();
  const wordRect = word.getBoundingClientRect();

  let delta;
  if (sentenceRect.height <= available) {
    // ประโยคที่กำลังเล่นปักไว้ที่ขอบบนของพื้นที่อ่าน (แบบ teleprompter):
    // บรรทัดจีน + คำแปลไทยของประโยคปัจจุบันอยู่ใต้แถบควบคุมเสมอ
    // แล้วประโยคถัดไปจะไหลขึ้นมาอยู่ด้านล่างให้อ่านล่วงหน้าได้
    delta = sentenceRect.top - safeTop;
  } else if (wordRect.top < safeTop) {
    // ประโยคยาวเกินหนึ่งหน้าจอ: ตามคำที่กำลังออกเสียงแทนการปักหัวประโยค
    delta = wordRect.top - safeTop;
  } else if (wordRect.bottom > safeBottom) {
    delta = wordRect.bottom - safeBottom;
  } else {
    return;
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
  podClearIntro();
  cpHideWordPopup();
  crClearMediaSession();
  $("podPlayer").hidden = true;
  $("podEpisodes").hidden = false;
  $("podHeading").textContent = "เลือกตอนพอดแคสต์";
  podSetMediaState("none");
  podSyncMediaButtons();
  try { if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; } catch (e) {}
}

function quitPodcastGame() {
  podSeekSequence++;
  podWantPlay = false;
  podStatusNote = "";
  podClearIntro();
  podSyncNativeBackgroundAudio();
  const audio = $("podAudio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  podInterruptThaiVoice();
  cpHideWordPopup();
  crClearMediaSession();
  podcastState = null;
  podActiveToken = null;
  $("podPlayer").hidden = true;
  $("podEpisodes").hidden = false;
  $("podPlayBtn").textContent = "▶ เล่น";
  podSetMediaState("none");
  podSyncMediaButtons();
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
  } else if (podSource === "specialized") {
    try {
      await podLoadSpecializedData();
      podBuildSpecializedFilter();
    } catch (e) {
      podSource = "maomi";
      podApplySourceUI();
      $("podListStatus").textContent = "โหลดบทความเฉพาะทางไม่ได้ — ตรวจสอบว่า APK มีไฟล์ข้อมูลบทความ";
    }
  }
  if (document.querySelector(".screen.active") !== $("podcast")) return;
  const episodes = podEpisodesForSource();
  if (!Array.isArray(episodes) || !episodes.length) {
    $("podListStatus").textContent = podSource === "hsk"
      ? "ยังไม่มีข้อมูลบทความ HSK ในเครื่อง"
      : podSource === "specialized"
      ? "ยังไม่มีข้อมูลบทความเฉพาะทางในเครื่อง"
      : "ยังไม่มีข้อมูลพอดแคสต์ใน APK";
    return;
  }
  podApplySourceUI();
  podEpisodeList();
  podSetMediaState("none");
}

$("podSearch").addEventListener("input", () => podEpisodeList($("podSearch").value));
$("podBackBtn").addEventListener("click", () => { sfx.click(); podBackToList(); });
$("podMoreBtn").addEventListener("click", () => { sfx.click(); podToggleExtra(); });
podApplyExtraOpen();
podSyncMoreBtn();
$("podQuitBtn").addEventListener("click", () => { sfx.click(); quitPodcastGame(); });
$("podPlayBtn").addEventListener("click", () => {
  sfx.click();
  if (podThaiVoicePlayback || podWantPlay) podPause();
  else podPlay();
});
$("podRewindBtn").addEventListener("click", () => {
  sfx.click();
  const audio = $("podAudio");
  const resumeAfterSeek = podWantPlay || !audio.paused;
  const resumeAfterVoice = podInterruptThaiVoice();
  podSeekAudio(Math.max(0, audio.currentTime - 10), resumeAfterSeek || resumeAfterVoice);
});
$("podForwardBtn").addEventListener("click", () => {
  sfx.click();
  const audio = $("podAudio");
  const resumeAfterSeek = podWantPlay || !audio.paused;
  const resumeAfterVoice = podInterruptThaiVoice();
  podSeekAudio(Math.min(audio.duration || Infinity, audio.currentTime + 10), resumeAfterSeek || resumeAfterVoice);
});
// ปุ่มเรื่องก่อนหน้า / เรื่องถัดไป ในแถบตัวเล่น
$("podPrevBtn").addEventListener("click", () => {
  sfx.click();
  podGoToPreviousEpisode(true);
});
$("podNextBtn").addEventListener("click", () => {
  sfx.click();
  podGoToNextEpisode(true);
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
  const resumeAfterSeek = podWantPlay || !audio.paused;
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
/* ---- ตั้งเวลาปิดเล่นอัตโนมัติ ------------------------------------------
   เลือกได้ 5-60 นาที เมื่อครบเวลาจะหยุดเสียงทันที (ปิดทั้งคลิปจีนและคลิปแปลไทย)
   และหยุด "เล่นตอนถัดไปอัตโนมัติ" ด้วย เพื่อไม่ให้เดินต่อเองหลังหยุด */
function podSleepExpire() {
  podWantPlay = false;
  podPause();
  $("podStatus").textContent = "หยุดเล่นอัตโนมัติ · ครบเวลาที่ตั้งไว้";
  podSaveSession();
}

crSleepRegister({
  button: $("podSleepBtn"),
  hint: $("podSleepHint"),
  options: $("podSleepOptions"),
  showTime: true,
  idleLabel: "🌙",
  idleHint: "",
  active: () => document.querySelector(".screen.active") === $("podcast"),
  onExpire: podSleepExpire,
});

// กดปุ่มตอนถัดไปด้วยมือ — ตัวจับเวลายังนับถอยหลังตามเวลาจริง ไม่เริ่มใหม่
$("podAutoNextBtn").addEventListener("click", () => {
  sfx.click();
  podAutoNextMode = podNextAutoNextMode();
  podSaveAutoNextMode();
  podApplyAutoNextToggle();
  if (!podcastState) return;
  $("podStatus").textContent = podAutoNextMode === "off"
    ? "ปิดเล่นตอนถัดไปอัตโนมัติ · จบตอนแล้วจะหยุด"
    : podAutoNextMode === "random"
    ? "เปิดเล่นตอนถัดไปอัตโนมัติ · สุ่มตอนถัดไป (แตะ ⏭ อีกครั้งเพื่อปิด)"
    : "เปิดเล่นตอนถัดไปอัตโนมัติ · วนลูปตามรายการ (แตะ ⏭ อีกครั้งเพื่อสุ่ม)";
});
podApplyAutoNextToggle();

// ---- podcast source tabs (MaoMi / HSK articles) + HSK level filter -------
function podApplySourceUI() {
  const maoBtn = $("podSrcMaoMi");
  const hskBtn = $("podSrcHsk");
  const specialBtn = $("podSrcSpecialized");
  if (maoBtn) maoBtn.setAttribute("aria-pressed", String(podSource === "maomi"));
  if (hskBtn) hskBtn.setAttribute("aria-pressed", String(podSource === "hsk"));
  if (specialBtn) specialBtn.setAttribute("aria-pressed", String(podSource === "specialized"));
  const brand = $("podcast").querySelector(".pod-brand");
  if (brand) brand.textContent = podSource === "hsk"
    ? "📚 HSK ARTICLES"
    : podSource === "specialized"
    ? "🗂 SPECIALIZED CHINESE"
    : "🎙️ MAOMI CHINESE";
  const row = $("podHskFilter");
  if (row) {
    row.hidden = podSource !== "hsk";
    for (const chip of row.querySelectorAll(".pod-hsk-chip")) {
      chip.setAttribute("aria-pressed", String(Number(chip.dataset.hsk) === podHskFilter));
    }
  }
  const specialWrap = $("podSpecializedFilterWrap");
  if (specialWrap) specialWrap.hidden = podSource !== "specialized";
  const specialSelect = $("podSpecializedFilter");
  if (specialSelect) specialSelect.value = podSpecialFilter;
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

function podBuildSpecializedFilter() {
  const select = $("podSpecializedFilter");
  if (!select) return;
  const categories = new Map();
  for (const ep of window.PODCASTS_SPECIALIZED || []) {
    if (ep.categoryKey && ep.cat) categories.set(ep.categoryKey, ep.cat);
  }
  const options = [new Option("ทุกหมวด", "all")];
  for (const [key, label] of [...categories.entries()].sort((a, b) => a[1].localeCompare(b[1], "th"))) {
    options.push(new Option(label, key));
  }
  select.replaceChildren(...options);
  if (!["all", ...categories.keys()].includes(podSpecialFilter)) podSpecialFilter = "all";
  select.value = podSpecialFilter;
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
  if (podSource === "specialized" && !Array.isArray(window.PODCASTS_SPECIALIZED)) {
    $("podListStatus").textContent = "กำลังโหลดบทความเฉพาะทาง…";
    $("podEpisodeList").replaceChildren();
    podLoadSpecializedData()
      .then(() => { podBuildSpecializedFilter(); podApplySourceUI(); podEpisodeList($("podSearch").value); })
      .catch(() => { $("podListStatus").textContent = "โหลดข้อมูลบทความเฉพาะทางไม่ได้"; });
    return;
  }
  if (podSource === "specialized") podBuildSpecializedFilter();
  podEpisodeList($("podSearch").value);
}

$("podSrcMaoMi").addEventListener("click", () => { sfx.click(); podSetSource("maomi"); });
$("podSrcHsk").addEventListener("click", () => { sfx.click(); podSetSource("hsk"); });
$("podSpecializedFilter").addEventListener("change", (event) => {
  sfx.click();
  podSpecialFilter = event.target.value || "all";
  try { localStorage.setItem(POD_SPECIAL_FILTER_KEY, podSpecialFilter); } catch (err) {}
  podEpisodeList($("podSearch").value);
});
$("podSrcSpecialized").addEventListener("click", () => { sfx.click(); podSetSource("specialized"); });
podBuildHskFilter();
podApplySourceUI();
$("podThaiToggle").addEventListener("click", () => {
  if ($("podThaiToggle").disabled) return;
  podThaiVisible = !podThaiVisible;
  $("podTranscript").classList.toggle("pod-hide-thai", !podThaiVisible);
  const button = $("podThaiToggle");
  button.setAttribute("aria-pressed", String(podThaiVisible));
  button.title = podThaiVisible ? "ซ่อนคำแปลไทย" : "แสดงคำแปลไทย";
  button.setAttribute("aria-label", button.title);
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
$("podAudio").addEventListener("timeupdate", () => {
  podUpdateHighlight();
  podSaveSessionSoon();
  // ตัวจับเวลาปิดอัตโนมัติ: เช็กจาก timeupdate ด้วย เพื่อให้หยุดตรงเวลาแม้
  // นาฬิกา JS ถูกลดความถี่ตอนแอปอยู่เบื้องหลัง
  crSleepTick();
});
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
  // Android อาจหยุดคลิปเองตอนปิดหน้าจอ/สลับแอป — สั่งเล่นต่อให้อัตโนมัติ
  // (ผู้ใช้ที่กดพักเองจะตั้ง podWantPlay = false ไว้แล้ว จึงไม่กระทบ)
  if (podWantPlay && !podIntroPlayback) podResumeAudio();
});
$("podAudio").addEventListener("ended", () => podHandleEnded());
$("podAudio").addEventListener("error", () => {
  if (podcastState) $("podStatus").textContent = window.CR_OFFLINE_APP || POD_LOCAL_PREVIEW
    ? "โหลดไฟล์เสียงในเครื่องไม่สำเร็จ — ลองปิดเปิดแอปอีกครั้ง"
    : "โหลดเสียงไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต หรือเปิดหน้าตอนบน MaoMi Chinese";
});
$("podIntroAudio").addEventListener("ended", () => podAdvanceIntro());
$("podIntroAudio").addEventListener("error", () => {
  if (!podIntroPlayback) return;
  const lang = podIntroPlayback.index === 0 ? "จีน" : "ไทย";
  $("podStatus").textContent = `เสียงอ่านชื่อเรื่องภาษา${lang}เล่นไม่ได้ · ข้ามไปขั้นถัดไป`;
  podAdvanceIntro();
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
  // ในแอป Android ปุ่มหูฟังบลูทูธ/ล็อกสกรีนมาทาง MediaSession ฝั่งเนทีฟ
  // (NativeListenPlugin.setMediaSession) — ไม่ต้องลงทะเบียนซ้ำทาง JS
  // ไม่งั้นปุ่ม "ตอนถัดไป" อาจถูกสั่งสองครั้ง
  if (window.CR_OFFLINE_APP) return;
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
    podGoToPreviousEpisode(true);
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
  if (document.hidden) {
    podSaveSession(); // บันทึกตำแหน่งไว้ก่อน เผื่อระบบฆ่าแอปตอนอยู่เบื้องหลัง
    return;
  }
  podSyncNativeBackgroundAudio();
  if (podWantPlay && audio.paused && !podThaiVoicePlayback) {
    podPlay();
  }
});
podInstallBubbleGuard();
crWireCoverButton("podCover");
