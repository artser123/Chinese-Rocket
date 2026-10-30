"use strict";
/* ================= เกมดูแฟลชการ์ด (สไลด์โชว์การ์ดรูป) =================
   ใช้ข้อมูลและการเลือกหมวดชุดเดียวกับเกมทายแฟลชการ์ด (fcCats / fcPool ใน 17-flashcards.js)
   แสดงทีละใบ: รูป + จีน + พินอิน + ไทย แล้วอ่านเสียงจีน → ไทย จากนั้นรอ fvGap วินาที (นับหลังเสียงจบ
   เหมือนเกมฝึกฟัง) ค่อยพลิกไปใบถัดไป — สุ่มไม่ซ้ำจนครบกอง แล้วสับกองใหม่ (ใบแรกไม่ซ้ำใบที่เพิ่งดู)
   - ⏮ / ⏭ / ปัดซ้าย-ขวา / ลูกศรคีย์บอร์ด = การ์ดก่อนหน้า/ถัดไป (ย้อนได้ตลอดประวัติ fv.order)
     ตอนพักอยู่ เลื่อนดูได้โดยยังพักต่อ (อ่านเสียงใบนั้นครั้งเดียว ไม่เดินต่อเอง)
   - เสียงเล่นผ่าน <audio> ตัวเดียวกับเกมฝึกฟัง (lisPlayMediaItems) จึงเล่นต่อตอนล็อกจอได้ และปุ่ม
     หูฟังบลูทูธ/หน้าจอล็อกควบคุมได้ — เว็บผ่าน navigator.mediaSession, APK ผ่าน MediaSession เนทีฟ
     (crSetMediaButtons → window.crNativeMediaAction ใน 14-reader.js)
   - ✍️ = popup วิธีเขียน #voStrokePopup ตัวเดียวกับเกมรวมคำศัพท์ (พักสไลด์ระหว่างดู แล้วเล่นต่อเมื่อปิด)
   - พินอิน/ไทยที่ตั้งค่าซ่อนไว้ (fcShowPy/fcShowTh) จะเผยหลังเสียงจีนจบ หรือแตะการ์ดเพื่อเผยเอง
   - การ์ดเปลี่ยนด้วยแอนิเมชันพลิก 3 มิติ (Web Animations API, ทิศตามการเลื่อน) — ผู้ใช้ที่ตั้ง
     ลดการเคลื่อนไหวได้แบบจางเข้าแทน */
let fv = null;
const FV_GAPS = [0.5, 1, 2, 3]; // ค่าเก่า 5/8 วิ ที่บันทึกไว้จะกลับเป็นค่าเริ่มต้น 2 วิ
const FV_VOICES = ["both", "zh", "off"];
let fvGap = FV_GAPS.includes(+localStorage.getItem("cr_flashview_gap")) ? +localStorage.getItem("cr_flashview_gap") : 2;
let fvVoice = FV_VOICES.includes(localStorage.getItem("cr_flashview_voice")) ? localStorage.getItem("cr_flashview_voice") : "both";
let fvFlipSeq = 0;
let fvFlipAnims = []; // แอนิเมชันพลิกที่กำลังเล่น (ไม่ใช้ getAnimations — จะรวมแอนิเมชัน CSS ของการ์ดด้วย)
const fvReduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

function fvSyncSetup() {
  document.querySelectorAll("#fvGapSelect .fvo-btn").forEach((b) => b.classList.toggle("selected", +b.dataset.fvgap === fvGap));
  document.querySelectorAll("#fvVoiceSelect .fvo-btn").forEach((b) => b.classList.toggle("selected", b.dataset.fvvoice === fvVoice));
}

$("fvGapSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".fvo-btn");
  if (!btn) return;
  sfx.click();
  fvGap = +btn.dataset.fvgap;
  localStorage.setItem("cr_flashview_gap", String(fvGap));
  fvSyncSetup();
  updateStartBtn();
});
$("fvVoiceSelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".fvo-btn");
  if (!btn) return;
  sfx.click();
  fvVoice = btn.dataset.fvvoice;
  localStorage.setItem("cr_flashview_voice", fvVoice);
  fvSyncSetup();
});
fvSyncSetup();

function startFlashview() {
  fcClosePicker();
  const cats = fcSelectedCats();
  const pool = fcPool(cats);
  if (!pool.length) return;
  stopFlashview();
  gameMode = "flashview";
  lastStarter = () => startFlashview();
  fv = {
    cats, label: fcSelLabel(), pool, total: pool.length,
    order: shuffle(pool.slice()), idx: -1,
    playing: true, timer: null, revealTimer: null, seq: 0,
    shown: 0, seen: new Set(), revealed: false, resumeAfterStrokes: false,
  };
  $("fvMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("fvCount").textContent = "0";
  $("fvProg").textContent = "0%";
  $("fvPlayBtn").textContent = "⏸ พัก";
  music.stop(); // เน้นเสียงอ่านคำ — ไม่มีเพลงพื้นหลังเหมือนเกมฝึกฟัง
  stopSpeech();
  lisStopMedia();
  switchScreen($("flashview"));
  fvRegisterMediaActions();
  crSetPlaybackState(true);
  fvStep(1, { first: true });
}

const fvItem = () => (fv && fv.idx >= 0 ? fv.order[fv.idx] : null);

// กองถัดไปต่อท้ายประวัติ — ใบแรกของกองใหม่ไม่ซ้ำใบสุดท้ายของกองเดิม
function fvEnsureAhead() {
  if (fv.idx + 1 < fv.order.length) return;
  const last = fv.order[fv.order.length - 1];
  const deck = shuffle(fv.pool.slice());
  if (deck.length > 1 && last && deck[0].zh === last.zh) {
    const i = deck.findIndex((x) => x.zh !== last.zh);
    if (i > 0) [deck[0], deck[i]] = [deck[i], deck[0]];
  }
  fv.order.push(...deck);
}

// เลื่อนการ์ด: dir = 1 ถัดไป / -1 ก่อนหน้า (ใบแรกของประวัติแล้ว = อ่านใบปัจจุบันซ้ำ)
function fvStep(dir, opts = {}) {
  if (!fv) return;
  fvClearTimers();
  if (dir < 0 && fv.idx <= 0) {
    fvStatus("⏮ นี่คือการ์ดแรกแล้ว");
    fvPlayCurrent();
    return;
  }
  if (dir > 0) fvEnsureAhead();
  fv.idx += dir > 0 ? 1 : -1;
  const item = fvItem();
  if (dir > 0) {
    fv.shown++;
    fv.seen.add(item.zh);
  }
  fvEnsureAhead();
  const next = fv.order[fv.idx + 1];
  if (next) { const pre = new Image(); pre.decoding = "async"; pre.src = next.img; } // รูปใบถัดไปพร้อมก่อนพลิก
  fvStatus(fv.playing ? "" : "⏸ พักอยู่ — เลื่อนดูทีละใบได้ กด ▶ เพื่อเล่นอัตโนมัติต่อ");
  fvFlip(opts.first ? 0 : dir, () => fvRender(item));
  fvPlayCurrent();
  fvSyncMediaButtons();
}

function fvRender(item) {
  const cat = item.cat;
  $("fvCatTag").textContent = `${cat.icon} ${cat.th} · ${cat.zh}`;
  const img = $("fvImg");
  img.src = item.img;
  img.alt = item.th || item.zh;
  $("fvZh").textContent = item.zh;
  $("fvPy").textContent = item.py || "";
  $("fvTh").textContent = item.th || "";
  fv.revealed = false;
  fvApplyDisplay();
  fvTimerBar(0);
  $("fvCount").textContent = String(fv.shown);
  $("fvProg").textContent = progPct(fv.seen.size, fv.total);
  fvSetMediaMetadata(item);
}

// พินอิน/ไทยที่ตั้งค่า "ไม่แสดง" ซ่อนไว้จนกว่าจะเผย (หลังเสียงจีน หรือแตะการ์ด)
function fvApplyDisplay() {
  for (const [id, show] of [["fvPy", fcShowPy], ["fvTh", fcShowTh]]) {
    const el = $(id);
    el.classList.toggle("fv-masked", !show && !fv.revealed);
    el.classList.toggle("fc-revealed", !show && fv.revealed);
  }
}
function fvReveal() {
  if (!fv || fv.revealed) return;
  fv.revealed = true;
  fvApplyDisplay();
}

// พลิกการ์ด: ครึ่งแรกหมุนออก → ใส่ข้อมูลใบใหม่ → ครึ่งหลังหมุนเข้า (ทิศตาม dir)
// กดรัว ๆ ระหว่างพลิก: ข้ามครึ่งแรก ใส่ข้อมูลทันทีแล้วหมุนเข้า
function fvFlip(dir, apply) {
  const card = $("fvCard");
  const seq = ++fvFlipSeq;
  const busy = fvFlipAnims.filter((a) => a.playState === "running" || a.playState === "paused");
  fvFlipAnims.forEach((a) => a.cancel());
  fvFlipAnims = [];
  // จอล็อก/แอปอยู่เบื้องหลัง: แอนิเมชันไม่เดิน → เปลี่ยนข้อมูลทันที (ชื่อบนหน้าจอล็อกต้องตรงกับเสียง)
  if (!card.animate || document.hidden) { apply(); return; }
  const run = (frames, opts) => { const a = card.animate(frames, opts); fvFlipAnims.push(a); return a; };
  if (fvReduceMotion()) {
    apply();
    run([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    return;
  }
  const sign = dir < 0 ? -1 : 1;
  const flipIn = () => run([
    { transform: `rotateY(${82 * sign}deg) translateX(${24 * sign}px) scale(.94)`, opacity: .35 },
    { transform: `rotateY(${-6 * sign}deg) scale(1.01)`, opacity: 1, offset: .75 },
    { transform: "none", opacity: 1 },
  ], { duration: 340, easing: "cubic-bezier(.2,.75,.3,1)" });
  if (!dir || busy.length) {
    apply();
    if (dir) flipIn();
    else run([{ transform: "scale(.9)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.3,1.2)" });
    return;
  }
  const out = run([
    { transform: "none", opacity: 1 },
    { transform: `rotateY(${-82 * sign}deg) translateX(${-24 * sign}px) scale(.94)`, opacity: .35 },
  ], { duration: 200, easing: "cubic-bezier(.55,0,.8,.4)", fill: "forwards" });
  let swapped = false;
  const swap = () => {
    if (swapped || seq !== fvFlipSeq) return; // ถูกแทนด้วยการพลิกครั้งใหม่ — ครั้งใหม่ใส่ข้อมูลเอง
    swapped = true;
    apply();
    out.cancel();
    fvFlipAnims = fvFlipAnims.filter((a) => a !== out);
    flipIn();
  };
  out.finished.then(swap).catch(() => {});
  setTimeout(swap, 260); // สำรอง: timeline ถูกหน่วง (หน้าเว็บถูกพัก) ก็ยังเปลี่ยนการ์ดตรงเวลา
}

// แถบนับถอยหลังใต้การ์ด: 0 = ว่าง, >0 = วิ่งเต็มภายใน ms มิลลิวินาที
function fvTimerBar(ms) {
  const bar = $("fvTimerBar");
  if (!bar) return;
  if (bar.getAnimations) bar.getAnimations().forEach((a) => a.cancel());
  if (!ms || !bar.animate) { bar.style.transform = "scaleX(0)"; return; }
  bar.style.transform = "scaleX(1)";
  bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: ms, easing: "linear" });
}

function fvClearTimers() {
  if (!fv) return;
  clearTimeout(fv.timer);
  clearTimeout(fv.revealTimer);
  fv.timer = fv.revealTimer = null;
  fvTimerBar(0);
}

// อ่านเสียงการ์ดปัจจุบัน (จีน → เผยพินอิน/ไทย → ไทย) แล้วตั้งเวลาไปใบถัดไปถ้ากำลังเล่นอัตโนมัติ
function fvPlayCurrent() {
  if (!fv) return;
  const item = fvItem();
  if (!item) return;
  fvClearTimers();
  const token = ++fv.seq;
  const cur = fv;
  const alive = () => fv === cur && fv.seq === token;
  const done = () => {
    if (!alive()) return;
    $("fvCard").classList.remove("speaking");
    if (!fv.playing) return;
    const ms = fvGap * 1000;
    if (fvVoice === "off" && !fv.revealed) fv.revealTimer = setTimeout(() => { if (alive()) fvReveal(); }, ms / 2);
    fvTimerBar(ms);
    fv.timer = setTimeout(() => { if (alive() && fv.playing) fvStep(1); }, ms);
  };
  lisStopMedia();
  stopSpeech();
  if (fvVoice === "off") { done(); return; }
  $("fvCard").classList.add("speaking");
  const key = wordAudioKey(item.zh, item.py);
  const zh = [{ url: `audio/zh/${key}.mp3`, tts: [item.zh, "zh-CN"], ...LIS_EDGE_TTS_TRIM }];
  const th = [{ url: `audio/th_fc/${item.ta || key}.mp3`, tts: [item.th, "th-TH"], ...LIS_EDGE_TTS_TRIM }];
  lisPlayMediaItems(zh, () => {
    if (!alive()) return;
    fvReveal();
    if (fvVoice === "both" && item.th) lisPlayMediaItems(th, done, null, alive);
    else done();
  }, null, alive);
}

function fvPause() {
  if (!fv || !fv.playing) return;
  fv.playing = false;
  fv.seq++; // คิวเสียง/ตัวจับเวลาที่ค้างอยู่ยอมแพ้
  fvClearTimers();
  lisStopMedia();
  stopSpeech();
  $("fvCard").classList.remove("speaking");
  $("fvPlayBtn").textContent = "▶ เล่นต่อ";
  $("flashview").classList.add("paused");
  fvStatus("⏸ พักอยู่ — เลื่อนดูทีละใบได้ กด ▶ เพื่อเล่นอัตโนมัติต่อ");
  crSetPlaybackState(false);
  fvSyncMediaButtons();
}

// เล่นต่อ = อ่านใบปัจจุบันอีกรอบ แล้วเดินต่ออัตโนมัติ
function fvResume() {
  if (!fv || fv.playing) return;
  fv.playing = true;
  $("fvPlayBtn").textContent = "⏸ พัก";
  $("flashview").classList.remove("paused");
  fvStatus("");
  crSetPlaybackState(true);
  fvPlayCurrent();
  fvSyncMediaButtons();
}

function fvStatus(text) { $("fvStatus").textContent = text; }

// ---- ปุ่มหูฟังบลูทูธ / หน้าจอล็อก ----
function fvSetMediaMetadata(item) {
  if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.zh,
      artist: [item.py, item.th].filter(Boolean).join(" · "),
      album: `Chinese Rocket · ดูแฟลชการ์ด ${fv.label}`,
      artwork: [{ src: new URL(item.img, location.href).href, sizes: "420x315", type: "image/webp" }],
    });
  } catch (e) {}
}

function fvRegisterMediaActions() {
  // APK: ปุ่มมาทาง MediaSession เนทีฟ → crNativeMediaAction แล้ว (ลงทะเบียนซ้ำทาง JS อาจสั่งสองครั้ง)
  if (window.CR_OFFLINE_APP || !("mediaSession" in navigator)) return;
  const act = (name, handler) => { try { navigator.mediaSession.setActionHandler(name, handler); } catch (e) {} };
  act("play", () => fvResume());
  act("pause", () => fvPause());
  act("stop", () => fvPause());
  act("nexttrack", () => fvStep(1));
  act("previoustrack", () => fvStep(-1));
}

function fvSyncMediaButtons() {
  if (!fv) { crSetMediaButtons(false, false, "", ""); return; }
  const item = fvItem();
  crSetMediaButtons(true, fv.playing, item ? item.zh : "", `Chinese Rocket · ดูแฟลชการ์ด ${fv.label}`);
}

// ---- ดูเส้นขีด: popup เดียวกับเกมรวมคำศัพท์ — พักสไลด์ระหว่างดู แล้วเล่นต่อเมื่อปิด ----
function fvOpenStrokes() {
  const item = fvItem();
  if (!fv || !item) return;
  fv.resumeAfterStrokes = fv.playing;
  fvPause();
  const cur = fv;
  voOpenStrokes(item, {
    onSound: (it) => fcSpeakWord(it),
    onClose: () => {
      if (fv !== cur || !cur.resumeAfterStrokes) return;
      cur.resumeAfterStrokes = false;
      fvResume();
    },
  });
}

function stopFlashview() {
  if (!fv) return;
  fvClearTimers();
  fv.seq++;
  fv = null;
  fvFlipSeq++;
  voCloseStrokes();
  lisStopMedia();
  stopSpeech();
  crSetPlaybackState(false);
  fvSyncMediaButtons();
  $("fvCard").classList.remove("speaking");
  $("flashview").classList.remove("paused");
  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  } catch (e) {}
}

function quitFlashview() {
  stopFlashview();
  exitToSetup("flashview");
}

$("fvMuteBtn").addEventListener("click", toggleMute);
$("fvQuitBtn").addEventListener("click", () => { sfx.click(); quitFlashview(); });
$("fvPlayBtn").addEventListener("click", () => {
  if (!fv) return;
  sfx.click();
  if (fv.playing) fvPause();
  else fvResume();
});
$("fvPrevBtn").addEventListener("click", () => { sfx.click(); fvStep(-1); });
$("fvNextBtn").addEventListener("click", () => { sfx.click(); fvStep(1); });
$("fvSpeakBtn").addEventListener("click", () => { sfx.click(); fvPlayCurrent(); });
$("fvStrokeBtn").addEventListener("click", () => { sfx.click(); fvOpenStrokes(); });

// ปัดซ้าย = ถัดไป, ปัดขวา = ก่อนหน้า • แตะเฉย ๆ = เผยพินอิน/ไทยที่ซ่อนไว้
let fvSwipe = null;
$("fvStage").addEventListener("pointerdown", (e) => {
  if (!fv || (e.pointerType === "mouse" && e.button !== 0)) return;
  fvSwipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
$("fvStage").addEventListener("pointerup", (e) => {
  const s = fvSwipe;
  fvSwipe = null;
  if (!fv || !s || s.id !== e.pointerId) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) fvStep(dx < 0 ? 1 : -1);
  else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) fvReveal();
});
$("fvStage").addEventListener("pointercancel", () => { fvSwipe = null; });

document.addEventListener("keydown", (e) => {
  if (!fv || !$("flashview").classList.contains("active")) return;
  if (!$("voStrokePopup").hidden || !$("backConfirm").hidden) return;
  if (e.key === "ArrowRight") { e.preventDefault(); fvStep(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); fvStep(-1); }
  else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    if (fv.playing) fvPause(); else fvResume();
  }
});

// กลับมาเห็นหน้าจอ: ขอให้จอไม่ดับ/บริการเบื้องหลังใหม่ (ระบบปล่อยเองตอนสลับแอป)
// และกู้คืนสไลด์ที่ค้าง (เหมือนเกมฝึกฟัง): สายเรียกเข้า/แอปอื่นแย่งเสียงทำให้ <audio> หยุดเอง
// โดยไม่มี "ended" คิวเสียงจึงไม่จบและไม่มีตัวจับเวลาไปใบถัดไป → อ่านใบปัจจุบันซ้ำแล้วเดินต่อ
// (ไม่กู้ตอนยังอยู่เบื้องหลัง จะได้ไม่แย่งเสียงคืนจากแอปที่ผู้ใช้กำลังฟังอยู่)
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !fv) return;
  crSetPlaybackState(fv.playing);
  if (fv.playing && fvVoice !== "off" && lisMediaAudio.paused && !fv.timer) fvPlayCurrent();
});
