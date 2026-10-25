"use strict";
/* ================= Listening practice mode (เกมฝึกฟัง) ================= */
// เล่นเสียง จีน→ไทย ของคำหรือประโยควนไปเรื่อยๆ สุ่มไม่ซ้ำจนครบกอง — ไม่มีเพลงพื้นหลัง
// ช่วงห่าง (lisGap) นับจากเสียงจบจนคำถัดไปเริ่ม เหมาะสำหรับฟังตอนเดินทาง
function lisSource() {
  return lis.type === "sent" ? getSentencePool(lis.level) : getVocabPool(lis.level);
}

// Use a native <audio> element for this mode: Web Audio can be suspended when a
// phone locks, while browser media playback can keep going and expose lock-screen controls.
function lisSetMediaState(state) {
  try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state; } catch (e) {}
}
// Shared by listen mode, podcast mode and the HSK reader: a native foreground
// service + partial wake lock keeps the WebView's JS running while the app is
// backgrounded or the screen is off. Without it Android freezes the page and
// any JS-driven audio handoff (e.g. the podcast pausing the source to play a
// Thai translation clip, or the auto-advance to the next episode) never
// resumes, so the audio dies on app switch / screen lock.
//
// Android 12+ (API 31) refuses to start a foreground service from the
// background (ForegroundServiceStartNotAllowedException) and the service may
// only be stopped from the foreground state we control. The service therefore
// has to stay up for as long as playback is wanted: it is started while the
// app is visible and is never stopped/restarted in the middle of a playback
// (a stop + start from the background would silently kill the keep-alive and
// the next episode would never start).
let crNativeBgWanted = false;   // the service should be running
let crNativeBgRunning = false;  // we believe the service is up
let crNativeBgInit = false;     // the first call always reaches the native side

function crNativeBackgroundCall(active) {
  try {
    const native = window.ChineseRocketAndroid
      || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeListen);
    if (!native || !native.setListenMode) return;
    const result = native.setListenMode({ active: !!active });
    if (result && typeof result.then === "function") {
      result.then((value) => {
        if (value && typeof value.running === "boolean") {
          crNativeBgRunning = value.running;
          if (value.running) { crNativeBgRetries = 0; return; }
          // เริ่มไม่สำเร็จ (เช่น Android 12+ ห้ามเริ่มจากเบื้องหลัง) — ลองใหม่
          // เมื่อแอปกลับมาเห็นหน้าจอ
          if (crNativeBgWanted) crNativeBackgroundRetrySoon();
        }
      }).catch(() => {});
    } else if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (e) {}
}

let crNativeBgRetryTimer = null;
let crNativeBgRetries = 0;

function crNativeBackgroundRetrySoon() {
  if (crNativeBgRetryTimer !== null || crNativeBgRetries > 8) return;
  crNativeBgRetries++;
  crNativeBgRetryTimer = setTimeout(() => {
    crNativeBgRetryTimer = null;
    crNativeBackgroundRetry();
  }, 1200);
}

function crSetNativeBackgroundAudio(active) {
  const want = !!active;
  if (crNativeBgInit && want === crNativeBgWanted) return; // no change → don't churn the service
  crNativeBgInit = true;
  crNativeBgWanted = want;
  if (!want) {
    crNativeBgRunning = false;
    crNativeBgRetries = 0;
    crNativeBackgroundCall(false);
    return;
  }
  if (crNativeBgRunning) return;  // already up → leave it alone
  if (document.hidden) {
    // Starting it now would throw on Android 12+; the retry happens as soon
    // as the app becomes visible again.
    return;
  }
  crNativeBgRunning = true;
  crNativeBackgroundCall(true);
}

// Retry a deferred service start once the app is in the foreground again.
function crNativeBackgroundRetry() {
  if (!crNativeBgWanted || crNativeBgRunning) return;
  if (document.hidden) return;
  crNativeBgRunning = true;
  crNativeBackgroundCall(true);
}
// ข้อความบนการแจ้งเตือนตอนเล่นเบื้องหลัง (ชื่อตอน/บทความที่กำลังฟัง)
function crSetNotificationText(title, text) {
  try {
    const native = window.ChineseRocketAndroid
      || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeListen);
    if (!native || !native.setNotificationText) return;
    const result = native.setNotificationText({ title: title || "", text: text || "" });
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch (e) {}
}

// ปุ่มบนหูฟังบลูทูธ / หน้าจอล็อก / การแจ้งเตือน (แอป Android เท่านั้น)
// WebView ไม่ผูก navigator.mediaSession เข้ากับระบบ จึงต้องมี MediaSession
// ฝั่งเนทีฟ (NativeListenPlugin.setMediaSession). ฝั่ง JS บอกสถานะว่ากำลัง
// เปิดโหมดไหนและเล่นอยู่หรือพัก ส่วนฝั่งเนทีฟส่งเหตุการณ์กลับมาที่
// window.crNativeMediaAction("play" | "pause" | "nexttrack" | "previoustrack" | "stop")
function crSetMediaButtons(active, playing, title, text) {
  try {
    const native = window.ChineseRocketAndroid
      || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeListen);
    if (!native || !native.setMediaSession) return;
    const result = native.setMediaSession({
      active: !!active,
      playing: !!playing,
      title: title || "",
      text: text || "",
    });
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch (e) {}
}

/* ---- Session restore (พอดแคสต์ / อ่านบทความ) ------------------------
   ถ้า Android ฆ่าแอปตอนอยู่เบื้องหลัง (บริการ foreground กันไว้เกือบทั้งหมด
   แต่ระบบยังอาจเก็บหน่วยความจำ) หน้าเว็บจะโหลดใหม่และผู้ใช้เจอหน้าเมนู
   จึงเก็บสถานะการเล่นไว้ใน localStorage เพื่อกลับไปที่ตอน/บทความเดิม
   ที่ตำแหน่งเดิมได้ */
const CR_SESSION_KEY = "cr_media_session";

function crSaveMediaSession(session) {
  try {
    if (!session) { localStorage.removeItem(CR_SESSION_KEY); return; }
    localStorage.setItem(CR_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    try { localStorage.removeItem(CR_SESSION_KEY); } catch (e) {}
  }
}

function crLoadMediaSession() {
  try {
    const raw = localStorage.getItem(CR_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch (error) {
    return null;
  }
}

function crClearMediaSession() {
  try { localStorage.removeItem(CR_SESSION_KEY); } catch (error) {}
}

/* ---- ตั้งเวลาปิดเสียงอัตโนมัติ (sleep timer) ---------------------------
   ใช้ได้ทั้งโหมดพอดแคสต์และโหมดอ่านบทความ: เลือกได้ 5-60 นาที (หรือ 0 = ปิด)
   เมื่อครบเวลาจะหยุดเสียงทันที (หยุดทั้งคลิปจีนและคลิปแปลไทย) แต่ละโหมดมี
   ตัวจับเวลาของตัวเอง แยกกัน (view) แต่ใช้ตัวเดินนาฬิกาตัวเดียวกัน */
const CR_SLEEP_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];
const crSleepViews = [];
let crSleepTicker = null;

function crSleepFormat(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function crSleepRemaining(view) {
  if (!view.deadline) return 0;
  return Math.max(0, view.deadline - Date.now());
}

function crSleepRender() {
  for (const view of crSleepViews) {
    const left = crSleepRemaining(view);
    const on = left > 0;
    // วาดใหม่เฉพาะตอนข้อความหรือสถานะเปลี่ยนจริง (เรียกได้บ่อย ๆ จาก timeupdate)
    const stamp = `${on ? crSleepFormat(left) : ""}|${view.minutes}`;
    if (view.stamp === stamp) continue;
    view.stamp = stamp;
    view.button.setAttribute("aria-pressed", String(on));
    if (view.showTime) view.button.textContent = on ? `🌙 ${crSleepFormat(left)}` : view.idleLabel;
    if (view.hint) view.hint.textContent = on ? `⏱ ${crSleepFormat(left)}` : (view.idleHint || "");
    for (const option of view.options.querySelectorAll(".sleep-opt")) {
      option.setAttribute("aria-pressed", String(Number(option.dataset.minutes) === view.minutes));
    }
  }
}

function crSleepStopTicker() {
  if (crSleepTicker === null) return;
  clearInterval(crSleepTicker);
  crSleepTicker = null;
}

function crSleepSyncTicker() {
  const any = crSleepViews.some((view) => view.deadline > 0);
  if (any && crSleepTicker === null) crSleepTicker = setInterval(crSleepTick, 1000);
  else if (!any) crSleepStopTicker();
}

function crSleepTick() {
  for (const view of crSleepViews) {
    if (!view.deadline) continue;
    if (crSleepRemaining(view) > 0) continue;
    view.deadline = 0;
    view.minutes = 0;
    view.stamp = null;
    try { view.onExpire(); } catch (error) { /* หยุดเสียงไม่สำเร็จก็ปล่อยไป */ }
  }
  crSleepRender();
  crSleepSyncTicker();
}

function crSleepSet(view, minutes) {
  const value = CR_SLEEP_OPTIONS.includes(Number(minutes)) ? Number(minutes) : 0;
  view.minutes = value;
  view.deadline = value > 0 ? Date.now() + value * 60000 : 0;
  crSleepRender();
  crSleepSyncTicker();
}

function crSleepCloseOptions(view) {
  view.options.hidden = true;
  view.button.setAttribute("aria-expanded", "false");
}

// view = { button, hint, options, showTime, idleLabel, idleHint, active, onExpire }
function crSleepRegister(view) {
  view.minutes = 0;
  view.deadline = 0;
  const box = view.options;
  box.replaceChildren();
  for (const minutes of CR_SLEEP_OPTIONS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "sleep-opt";
    option.dataset.minutes = String(minutes);
    option.textContent = minutes === 0 ? "ปิด" : `${minutes} นาที`;
    option.addEventListener("click", () => {
      crSleepSet(view, minutes);
      crSleepCloseOptions(view);
    });
    box.appendChild(option);
  }
  view.button.setAttribute("aria-expanded", "false");
  view.button.addEventListener("click", () => {
    const open = box.hidden;
    box.hidden = !open;
    view.button.setAttribute("aria-expanded", String(open));
  });
  crSleepViews.push(view);
  crSleepRender();
}

// แตะที่อื่นนอกกล่องตัวเลือก = ปิดกล่อง
document.addEventListener("pointerdown", (event) => {
  for (const view of crSleepViews) {
    if (view.options.hidden) continue;
    if (view.options.contains(event.target) || view.button.contains(event.target)) continue;
    crSleepCloseOptions(view);
  }
}, true);

/* ---- จอไม่ดับขณะเล่นเสียง (ฝึกฟัง / พอดแคสต์ / อ่านบทความ) ----
   ผู้ใช้บางครั้งเปิดหน้าจอทิ้งไว้เพื่ออ่านข้อความ จึงขอกันจอดับตลอดที่เสียงเล่นอยู่
   และปล่อยคืนเมื่อกดพัก/ออกจากโหมด
   - เว็บ/WebView ใหม่: Screen Wake Lock API (`navigator.wakeLock`) —
     เบราว์เซอร์ปล่อยเองตอนแท็บถูกซ่อน จึงขอใหม่ใน visibilitychange
   - APK: FLAG_KEEP_SCREEN_ON ทางปลั๊กอินแบบเนทีฟ (setScreenAwake) —
     เฟรมแฟล็กนี้มีผลเฉพาะตอนแอปอยู่หน้าจอ พอล็อกจอ/สลับแอปจึงไม่ต่างจากเดิม
     (เสียงเล่นต่อด้วย partial wake lock ของฟอร์กราวด์เซอร์วิส) */
let crScreenAwakeSentinel = null;
let crScreenAwakeWanted = false;
let crScreenAwakeSeq = 0;

function crScreenAwakeNative(active) {
  try {
    const native = window.ChineseRocketAndroid
      || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeListen);
    if (!native || !native.setScreenAwake) return;
    const result = native.setScreenAwake({ active: !!active });
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch (e) {}
}

function crScreenAwakeApply() {
  const seq = ++crScreenAwakeSeq;
  const active = crScreenAwakeWanted && !document.hidden;
  crScreenAwakeNative(active); // แฟล็กหน้าต่างเนทีฟ — สั่งซ้ำได้เสมอ ถูก/ไม่มีปลั๊กอินก็เงียบไป
  if (!active) {
    if (crScreenAwakeSentinel) {
      crScreenAwakeSentinel.release().catch(() => {});
      crScreenAwakeSentinel = null;
    }
    return;
  }
  if (crScreenAwakeSentinel || !("wakeLock" in navigator)) return;
  navigator.wakeLock.request("screen").then((sentinel) => {
    if (seq !== crScreenAwakeSeq || !crScreenAwakeWanted || document.hidden) {
      sentinel.release().catch(() => {});
      return;
    }
    crScreenAwakeSentinel = sentinel;
    // ระบบปล่อยเอง (เช่นตอนสลับแอป) → ขอใหม่เมื่อกลับมาเห็นหน้าจอ ถ้ายังเล่นเสียงอยู่
    sentinel.addEventListener("release", () => {
      if (crScreenAwakeSentinel === sentinel) crScreenAwakeSentinel = null;
      if (crScreenAwakeWanted && !document.hidden) crScreenAwakeApply(); // seq เพิ่มใน apply ตัด race ทิ้ง
    });
  }).catch(() => {}); // ไม่มีสิทธิ์/ไม่รองรับ → พึ่งแฟล็กเนทีฟอย่างเดียวก็พอ
}

function crSetScreenAwake(active) {
  crScreenAwakeWanted = !!active;
  crScreenAwakeApply();
}

document.addEventListener("visibilitychange", () => {
  if (crScreenAwakeWanted) crScreenAwakeApply(); // ซ่อนอยู่ → ปล่อย/ไม่ขอ; กลับมาเห็น → ขอใหม่
  // กลับมาเห็นหน้าจอแล้วจึงเริ่มบริการ foreground ได้ (Android 12+ ห้ามเริ่มจากเบื้องหลัง)
  if (!document.hidden) crNativeBackgroundRetry();
});

// เปิด/ปิดการเล่นของโหมดฝึกฟังครั้งเดียว ครอบคลุมทั้งเสียงเบื้องหลังและจอไม่ดับ
function crSetPlaybackState(active) {
  crSetNativeBackgroundAudio(active);
  crSetScreenAwake(active);
}
function lisStopMedia() {
  lisMediaSeq++;
  clearTimeout(lisMediaWatchTimer);
  lisMediaWatchTimer = null;
  lisMediaAudio.onended = null;
  lisMediaAudio.ontimeupdate = null;
  lisMediaAudio.onloadedmetadata = null;
  lisMediaAudio.onerror = null;
  lisMediaAudio.pause();
  lisMediaAudio.removeAttribute("src");
  lisMediaAudio.load();
  lisSetMediaState("paused");
}
function lisSetMediaMetadata(item) {
  if (!("mediaSession" in navigator)) return;
  try {
    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item[0],
        artist: `Chinese Rocket · HSK ${lis.level}`,
        album: lis.type === "sent" ? "ฟังประโยคภาษาจีน" : "ฟังคำศัพท์ภาษาจีน",
      });
    }
  } catch (e) {}
}
function lisPlayMediaItems(items, onDone, onProgress) {
  lisStopMedia();
  const token = lisMediaSeq;
  stopSpeech(); // Cancel any previous TTS/Web Audio fallback.
  let index = 0;
  let failed = false;
  const fallback = () => {
    if (failed || lisMediaSeq !== token || !lis || !lis.playing) return;
    failed = true;
    clearTimeout(lisMediaWatchTimer);
    lisMediaWatchTimer = null;
    lisMediaAudio.onended = null;
    lisMediaAudio.ontimeupdate = null;
    lisMediaAudio.onloadedmetadata = null;
    lisMediaAudio.onerror = null;
    lisMediaAudio.pause();
    lisMediaAudio.removeAttribute("src");
    lisMediaAudio.load();
    // Retry with Web Audio/TTS if native playback never advances or errors;
    // this also guarantees onDone can release the queue if `ended` never fires.
    wordAudio.play(items.slice(index), onDone, onProgress);
  };
  const playNext = () => {
    if (lisMediaSeq !== token || !lis || !lis.playing) return;
    if (index >= items.length) {
      lisSetMediaState("playing");
      if (onDone) onDone();
      return;
    }
    const item = items[index];
    let itemFinished = false;
    let itemStart = 0;
    let itemEnd = Infinity;
    let lastProgressTime = 0;
    const armProgressWatch = () => {
      clearTimeout(lisMediaWatchTimer);
      lisMediaWatchTimer = setTimeout(() => {
        if (failed || itemFinished || lisMediaSeq !== token || !lis || !lis.playing || lisMediaAudio.paused) return;
        if (lisMediaAudio.currentTime <= lastProgressTime + 0.025) fallback();
        else {
          lastProgressTime = lisMediaAudio.currentTime;
          armProgressWatch();
        }
      }, 1200);
    };
    const trimStart = Math.max(0, item.trimStart || 0);
    const trimEnd = Math.max(0, item.trimEnd || 0);
    const applyTrim = () => {
      if (failed || itemFinished || lisMediaSeq !== token) return;
      const duration = lisMediaAudio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const minKeep = Math.min(0.45, duration * 0.65);
      const trimRoom = Math.max(0, duration - minKeep);
      itemStart = Math.min(trimStart, trimRoom / 2);
      const endTrim = Math.min(trimEnd, Math.max(0, duration - itemStart - minKeep));
      itemEnd = duration - endTrim;
      if (lisMediaAudio.currentTime < itemStart - 0.015) {
        try { lisMediaAudio.currentTime = itemStart; } catch (e) {}
      }
      if (trimEnd > 0 && lisMediaAudio.currentTime >= itemEnd) finishItem();
    };
    const finishItem = () => {
      if (failed || itemFinished || lisMediaSeq !== token) return;
      itemFinished = true;
      if (onProgress && item.tts && String(item.tts[1] || "").startsWith("zh")) onProgress(1);
      clearTimeout(lisMediaWatchTimer);
      lisMediaWatchTimer = null;
      lisMediaAudio.onended = null;
      lisMediaAudio.ontimeupdate = null;
      lisMediaAudio.onloadedmetadata = null;
      lisMediaAudio.onerror = null;
      index++;
      playNext();
    };
    const reportProgress = () => {
      if (!onProgress || !item.tts || !String(item.tts[1] || "").startsWith("zh")
        || !Number.isFinite(itemEnd) || itemEnd <= itemStart) return;
      onProgress(Math.min(1, Math.max(0, (lisMediaAudio.currentTime - itemStart) / (itemEnd - itemStart))));
    };
    const playbackRate = Number(item.playbackRate) > 0 ? Number(item.playbackRate) : 1;
    lisMediaAudio.defaultPlaybackRate = playbackRate;
    lisMediaAudio.playbackRate = playbackRate;
    if ("preservesPitch" in lisMediaAudio) lisMediaAudio.preservesPitch = true;
    lisMediaAudio.src = encodeURI(item.url);
    lisMediaAudio.onloadedmetadata = () => {
      applyTrim();
      if (itemFinished) return;
      reportProgress();
      lastProgressTime = lisMediaAudio.currentTime;
      armProgressWatch();
    };
    lisMediaAudio.ontimeupdate = () => {
      applyTrim();
      if (itemFinished) return;
      reportProgress();
      if (lisMediaAudio.currentTime > lastProgressTime + 0.025) {
        lastProgressTime = lisMediaAudio.currentTime;
        armProgressWatch();
      }
    };
    lisMediaAudio.onended = finishItem;
    lisMediaAudio.onerror = fallback;
    lisMediaAudio.play().then(() => {
      lisSetMediaState("playing");
      armProgressWatch();
    }).catch(fallback);
  };
  playNext();
}

// Lock-screen / headset controls, where the browser supports the Media Session API.
function lisRegisterMediaActions() {
  if (!("mediaSession" in navigator)) return;
  const mediaAction = (name, handler) => {
    try { navigator.mediaSession.setActionHandler(name, handler); } catch (e) {}
  };
  mediaAction("play", () => { if (lis && !lis.playing) lisReplayBtnClick(); });
  mediaAction("pause", () => lisPausePlayback());
  mediaAction("nexttrack", () => lisSkipTrack());
  mediaAction("previoustrack", () => lisPreviousTrack());
}
lisRegisterMediaActions();

// ปุ่มหูฟังบลูทูธ / หน้าจอล็อก (แอป): บอกฝั่งเนทีฟว่าโหมดฝึกฟังเปิดและเล่นอยู่
// หรือไม่ (เรียกจากทุกจุดที่สถานะเล่น/พักเปลี่ยน) — ปุ่มที่ผู้ใช้กดวนกลับมาที่
// window.crNativeMediaAction (js/14-reader.js) แล้วเข้าฟังก์ชันข้างล่างนี้
function lisSyncMediaButtons() {
  if (!lis) { crSetMediaButtons(false, false, "", ""); return; }
  const title = lis.current ? lis.current[0].split(/[｜|]/)[0].trim() : "";
  crSetMediaButtons(true, !!lis.playing, title,
    `Chinese Rocket · ${lis.type === "sent" ? "ฝึกฟังประโยค" : "ฝึกฟังคำศัพท์"} HSK ${lis.level}`);
}

// พักการเล่น — ใช้ร่วมกันทั้งปุ่มบนหน้าจอและ pause/stop จากหูฟัง/หน้าจอล็อก
function lisPausePlayback() {
  if (!lis || !lis.playing) return;
  lis.playing = false;
  crSetPlaybackState(false);
  clearTimeout(lis.timer);
  lis.timer = null;
  $("lisPlayBtn").textContent = "▶ เล่นต่อ";
  $("lisCard").classList.remove("playing");
  lisStopMedia();
  stopSpeech();
  if (lis.current) clearListenKaraoke(lis.current);
  lisSyncMediaButtons();
}

// ข้ามไปคำ/ประโยคถัดไป — ใช้ร่วมกันทั้งปุ่มบนหน้าจอและ nexttrack จากหูฟัง/หน้าจอล็อก
function lisSkipTrack() {
  if (!lis) return;
  lis.playing = true;
  crSetPlaybackState(true);
  $("lisPlayBtn").textContent = "⏸ พัก";
  lisAdvance();
  lisSyncMediaButtons();
}

// ย้อนกลับไปคำ/ประโยคก่อนหน้าในกองเดิม (previoustrack จากหูฟัง/หน้าจอล็อก)
// ถ้าเป็นตัวแรกของกองแล้ว เล่นตัวปัจจุบันซ้ำแทน
function lisPreviousTrack() {
  if (!lis) return;
  if (lis.pos >= 2) {
    lis.pos -= 2; // lisAdvance จะกินตัวที่ lis.pos ชี้อยู่ = ตัวก่อนหน้าของตัวปัจจุบัน
    lis.played = Math.max(0, lis.played - 1);
    lisSkipTrack();
  } else {
    lisReplayBtnClick();
  }
}

// เล่นเสียงคำ/ประโยคปัจจุบัน แล้วตั้งตัวจับเวลาไปตัวถัดไปเมื่อเสียงจบ + ห่าง lisGap วิ
function renderListenSentence(s) {
  const el = $("lisZh"), zh = s[0] || "";
  el.replaceChildren();
  let pos = 0;
  const addText = (text) => { if (text) el.appendChild(document.createTextNode(text)); };
  for (const token of s[4] || []) {
    if (!token) continue;
    const at = zh.indexOf(token, pos);
    if (at < 0) continue;
    addText(zh.slice(pos, at));
    if (/[㐀-鿿豈-﫿]/.test(token)) {
      const span = document.createElement("span");
      span.className = "lis-zh-tok";
      span.textContent = token;
      el.appendChild(span);
    } else addText(token);
    pos = at + token.length;
  }
  addText(zh.slice(pos));
}

function updateListenKaraoke(s, progress) {
  if (!lis || lis.type !== "sent" || lis.current !== s) return;
  if (progress >= 1) clearSentenceKaraoke($("lisZh"));
  else applySentenceKaraoke($("lisZh"), progress, ".lis-zh-tok");
}

function clearListenKaraoke(s) {
  if (!lis || lis.current !== s) return;
  clearSentenceKaraoke($("lisZh"));
}

function lisPlayCurrent() {
  if (!lis || !lis.current || !lis.playing) return;
  const it = lis.current;
  const done = () => {
    if (!lis || !lis.playing) return;
    clearListenKaraoke(it);
    $("lisCard").classList.remove("playing");
    lis.timer = setTimeout(() => {
      if (lis) lis.timer = null;
      if (lis && lis.playing) lisAdvance();
    }, lis.gap * 1000);
  };
  $("lisCard").classList.add("playing");
  if (lis.type === "sent") {
    clearListenKaraoke(it);
    const zh = it[0].trim().split(/[｜|]/)[0];
    const th = (it[2] || "").trim();
    lisPlayMediaItems([
      { url: `audio/zh/${zh}.mp3`, tts: [zh, "zh-CN"], playbackRate: 0.9, ...LIS_SENTENCE_ZH_TRIM },
      ...(th ? [{ url: `audio/th/${zh}.mp3`, tts: [th, "th-TH"], ...LIS_VOICECLONE_TRIM }] : []),
    ], done, (progress) => updateListenKaraoke(it, progress));
  } else {
    const zh = it[0].split(/[｜|]/)[0].trim();
    const m = (it[2] || "").trim();
    const key = wordAudioKey(it[0], it[1]); // 了 (คำช่วย le) ใช้ไฟล์ 了-le.mp3 ที่อ่านถูก
    lisPlayMediaItems([
      { url: `audio/zh/${key}.mp3`, tts: [key === "了-le" ? "le" : zh, "zh-CN"], ...LIS_EDGE_TTS_TRIM },
      ...(m ? [{ url: `audio/th/${key}.mp3`, tts: [m, /[\u0E00-\u0E7F]/.test(m) ? "th-TH" : "en-US"], ...LIS_EDGE_TTS_TRIM }] : []),
    ], done);
  }
  lisSetMediaMetadata(it);
}

function lisReplayBtnClick() {
  if (!lis) return;
  clearTimeout(lis.timer);
  lis.timer = null;
  lis.playing = true;
  crSetPlaybackState(true);
  $("lisPlayBtn").textContent = "⏸ พัก";
  lisPlayCurrent();
  lisSyncMediaButtons();
}

// ดึงตัวถัดไปจากกองที่สับไว้ — ครบกองแล้วสับใหม่ (ตัวแรกรอบใหม่จะไม่ซ้ำตัวที่เพิ่งเล่น)
function lisAdvance() {
  if (!lis) return;
  clearTimeout(lis.timer);
  lis.timer = null;
  if (lis.pos >= lis.deck.length) {
    const lastZh = lis.current && lis.current[0];
    lis.deck = shuffle(lisSource().slice());
    if (lis.deck.length > 1 && lis.deck[0][0] === lastZh) {
      const i = lis.deck.findIndex((x) => x[0] !== lastZh);
      if (i > 0) [lis.deck[0], lis.deck[i]] = [lis.deck[i], lis.deck[0]];
    }
    lis.pos = 0;
  }
  if (!lis.deck.length) return;
  lis.current = lis.deck[lis.pos++];
  lis.done.add(lis.current[0]);
  $("lisProg").textContent = progPct(lis.done.size, lis.total);
  const it = lis.current;
  if (lis.type === "sent") renderListenSentence(it);
  else $("lisZh").textContent = it[0];
  $("lisPy").textContent = it[1] || "";
  $("lisTh").textContent = it[2] || "";
  $("lisSub").textContent = lis.type === "sent" && it[3] ? `📐 จุดไวยากรณ์: ${it[3]}` : "";
  $("lisCount").textContent = ++lis.played;
  $("lisStatus").textContent =
    `สุ่มไม่ซ้ำ กองละ ${lis.deck.length} ${lis.type === "sent" ? "ประโยค" : "คำ"} • ห่าง ${lis.gap} วิ • ล็อกจอ/สลับแอปเพื่อฟังต่อได้`;
  lisPlayCurrent();
  fitListenCard(); // วัดทันทีหลังใส่ข้อความ (ไม่รอเฟรมถัดไป จะได้ไม่เห็นตัวใหญ่แล้วหดให้เห็น)
  requestAnimationFrame(fitListenCard); // ย้ำอีกรอบเผื่อรอบแรกเลย์เอาต์/ฟอนต์ยังไม่นิ่ง
}

// ย่อข้อความในบัตรฟังให้พอดีจอ — ประโยคยาวๆ (เช่น HSK 5 ที่ยาวสุด 54 ตัวอักษร) จะได้ไม่ต้องเลื่อนจออ่าน
// ลดตัวคูณ --lis-fit ทีละขั้น (ขั้นต่ำ 0.5 กันตัวจิ๋วเกินไป) จนกว่า #listen จะเลื่อนไม่ได้
// ทุกครั้งที่เปลี่ยนคำ/ประโยคจะเริ่มจาก 1 ใหม่ ข้อความสั้นจึงกลับมาใหญ่เต็มขนาดเสมอ
function fitListenCard() {
  if (!lis) return;
  const list = $("listen");
  const card = $("lisCard");
  if (!list || !card) return;
  card.style.setProperty("--lis-fit", "1");
  let scale = 1;
  while (list.scrollHeight > list.clientHeight + 1 && scale > 0.5) {
    scale = Math.round((scale - 0.05) * 100) / 100;
    card.style.setProperty("--lis-fit", String(scale));
  }
}

function startListenGame(level) {
  const words = lisType === "sent" ? getSentencePool(level) : getVocabPool(level);
  if (!words || !words.length) return;
  currentLevel = level;
  lastStarter = () => startListenGame(level);
  lis = { level, type: lisType, gap: lisGap, deck: [], pos: 0,
          played: 0, playing: true, timer: null, current: null,
          done: new Set(), total: 0 };
  lisRegisterMediaActions();
  lis.deck = shuffle(lisSource().slice());
  lis.total = lis.deck.length;
  crSetPlaybackState(false);
  lisStopMedia();
  stopSpeech();
  music.stop(); // ไม่มีเพลงพื้นหลัง — โหมดนี้เน้นฟังเสียงพูดล้วนๆ
  switchScreen($("listen"));
  $("lisLabel").textContent = lis.type === "sent"
    ? "ฟังประโยคจีนแล้วตามด้วยคำแปลไทย — เล่นวนไปเรื่อยๆ"
    : "ฟังคำจีนแล้วตามด้วยคำแปล — เล่นวนไปเรื่อยๆ";
  $("lisPlayBtn").textContent = "⏸ พัก";
  $("lisCount").textContent = "0";
  $("lisProg").textContent = "0%";
  crSetPlaybackState(true);
  lisAdvance();
  lisSyncMediaButtons();
}

$("lisPlayBtn").addEventListener("click", () => {
  if (!lis) return;
  sfx.click();
  if (lis.playing) lisPausePlayback();
  else lisReplayBtnClick();
});
$("lisReplayBtn").addEventListener("click", () => {
  if (!lis) return;
  sfx.click();
  lisReplayBtnClick();
});
$("lisSkipBtn").addEventListener("click", () => {
  if (!lis) return;
  sfx.click();
  lisSkipTrack();
});
$("lisMuteBtn").addEventListener("click", toggleMute);
$("lisQuitBtn").addEventListener("click", () => {
  sfx.click();
  clearTimeout(lis && lis.timer);
  if (lis) lis.timer = null;
  crSetPlaybackState(false);
  lisStopMedia();
  if (lis && lis.current) clearListenKaraoke(lis.current);
  lis = null;
  lisSyncMediaButtons(); // ปิด MediaSession เนทีฟ (ปุ่มหูฟังเลิกควบคุมโหมดนี้)
  $("lisCard").classList.remove("playing");
  stopSpeech();
  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  } catch (e) {}
  switchScreen(menuEl);
});

// จอหมุน/เปลี่ยนขนาด และฟอนต์โหลดเสร็จ → วัดใหม่ (ความสูงบรรทัดของฟอนต์เปลี่ยนได้หลังโหลด)
window.addEventListener("resize", () => { if (lis) fitListenCard(); });
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { if (lis) requestAnimationFrame(fitListenCard); });
}

