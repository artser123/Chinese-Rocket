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
// Shared by listen mode and podcast mode: a native foreground service + partial
// wake lock keeps the WebView's JS running while the app is backgrounded or the
// screen is off. Without it Android freezes the page and any JS-driven audio
// handoff (e.g. the podcast pausing the source to play a Thai translation clip)
// never resumes, so the audio dies on app switch / screen lock.
function crSetNativeBackgroundAudio(active) {
  try {
    const native = window.ChineseRocketAndroid
      || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeListen);
    if (!native || !native.setListenMode) return;
    const result = native.setListenMode({ active: !!active });
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch (e) {}
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
if ("mediaSession" in navigator) {
  const mediaAction = (name, handler) => {
    try { navigator.mediaSession.setActionHandler(name, handler); } catch (e) {}
  };
  mediaAction("play", () => {
    if (!lis) return;
    lis.playing = true;
    crSetNativeBackgroundAudio(true);
    clearTimeout(lis.timer);
    lis.timer = null;
    $("lisPlayBtn").textContent = "⏸ พัก";
    lisPlayCurrent();
  });
  mediaAction("pause", () => {
    if (!lis || !lis.playing) return;
    lis.playing = false;
    crSetNativeBackgroundAudio(false);
    clearTimeout(lis.timer);
    lisStopMedia();
    stopSpeech();
    $("lisPlayBtn").textContent = "▶ เล่นต่อ";
    $("lisCard").classList.remove("playing");
    if (lis.current) clearListenKaraoke(lis.current);
  });
  mediaAction("nexttrack", () => {
    if (!lis) return;
    lis.playing = true;
    crSetNativeBackgroundAudio(true);
    $("lisPlayBtn").textContent = "⏸ พัก";
    lisAdvance();
  });
  mediaAction("previoustrack", () => { if (lis) lisReplayBtnClick(); });
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
  crSetNativeBackgroundAudio(true);
  $("lisPlayBtn").textContent = "⏸ พัก";
  lisPlayCurrent();
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
  lis.deck = shuffle(lisSource().slice());
  lis.total = lis.deck.length;
  crSetNativeBackgroundAudio(false);
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
  crSetNativeBackgroundAudio(true);
  lisAdvance();
}

$("lisPlayBtn").addEventListener("click", () => {
  if (!lis) return;
  sfx.click();
  lis.playing = !lis.playing;
  crSetNativeBackgroundAudio(lis.playing);
  $("lisPlayBtn").textContent = lis.playing ? "⏸ พัก" : "▶ เล่นต่อ";
  if (lis.playing) {
    lisPlayCurrent(); // เล่นเสียงคำปัจจุบันใหม่ตั้งแต่ต้นแล้วไปต่อ
  } else {
    clearTimeout(lis.timer);
    lis.timer = null;
    $("lisCard").classList.remove("playing");
    lisStopMedia();
    stopSpeech();
    if (lis.current) clearListenKaraoke(lis.current);
  }
});
$("lisReplayBtn").addEventListener("click", () => {
  if (!lis) return;
  sfx.click();
  lisReplayBtnClick();
});
$("lisSkipBtn").addEventListener("click", () => {
  if (!lis) return;
  sfx.click();
  lis.playing = true;
  crSetNativeBackgroundAudio(true);
  $("lisPlayBtn").textContent = "⏸ พัก";
  lisAdvance();
});
$("lisMuteBtn").addEventListener("click", toggleMute);
$("lisQuitBtn").addEventListener("click", () => {
  sfx.click();
  clearTimeout(lis && lis.timer);
  if (lis) lis.timer = null;
  crSetNativeBackgroundAudio(false);
  lisStopMedia();
  if (lis && lis.current) clearListenKaraoke(lis.current);
  lis = null;
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

