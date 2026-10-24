"use strict";
/* ================= Audio (WebAudio, no assets) ================= */
let AC = null, muted = false;
// หมายเหตุ: ปุ่มปิดเสียงสั่งปิดเฉพาะเพลงเบื้องหลัง (music.setMuted) — เสียงเอฟเฟกต์และเสียงเขียนยังเล่นปกติ
function beep(freq, dur, type = "square", vol = 0.12, slide = 0, force = false) {
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
function noiseBurst(dur, vol, hp, lp, force = false) {
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
  bombBlast: () => { noiseBurst(0.7, 0.45, 70, 3200); beep(110, 0.5, "sawtooth", 0.18, -80); beep(65, 0.8, "triangle", 0.24, -35); },
  wrong:   () => { beep(160, 0.22, "sawtooth", 0.14, -60); music.nudge(-0.12); },
  hit:     () => beep(880, 0.1, "square", 0.1, 300),
  damage:  () => { beep(90, 0.4, "sawtooth", 0.2, -50); beep(55, 0.5, "triangle", 0.18, -30); },
  over:    () => { beep(220, 0.5, "sawtooth", 0.15, -180); setTimeout(() => beep(140, 0.7, "sawtooth", 0.15, -100), 250); },
  click:   () => beep(440, 0.05, "square", 0.06),
  // weapon-specific sounds
  bowShot: () => { beep(800, 0.08, "sine", 0.18, -400); noiseBurst(0.06, 0.15, 1000, 3000); },
  bowMiss: () => { noiseBurst(0.12, 0.08, 400, 1200); beep(300, 0.15, "sine", 0.06, -200); },
  pistol:  () => { noiseBurst(0.18, 0.4, 400, 5000); beep(180, 0.12, "triangle", 0.3, -120); beep(80, 0.2, "sine", 0.25, -50); },
  smg:     () => { for (let i = 0; i < 3; i++) setTimeout(() => { noiseBurst(0.12, 0.3, 500, 6000); beep(200, 0.08, "triangle", 0.22, -130); }, i * 70); },
  hmg:     () => { for (let i = 0; i < 3; i++) setTimeout(() => { noiseBurst(0.2, 0.5, 300, 4000); beep(120, 0.12, "triangle", 0.4, -80); beep(50, 0.2, "sine", 0.35, -30); }, i * 80); },
  sniper:  () => { noiseBurst(0.4, 0.7, 200, 4000); beep(90, 0.25, "triangle", 0.5, -60); beep(40, 0.4, "sine", 0.4, -20); },
  grenade: () => { beep(200, 0.1, "sine", 0.15, -100); setTimeout(() => { noiseBurst(0.5, 0.6, 100, 2000); beep(80, 0.4, "sawtooth", 0.3, -50); beep(40, 0.5, "triangle", 0.25, -20); }, 300); },
  bazooka: () => { beep(150, 0.15, "sawtooth", 0.2, -80); noiseBurst(0.3, 0.4, 200, 3000); setTimeout(() => { noiseBurst(0.6, 0.8, 80, 1500); beep(60, 0.5, "sawtooth", 0.4, -40); beep(30, 0.6, "triangle", 0.3, -15); }, 250); },
  click1:  () => { noiseBurst(0.03, 0.25, 2500, 9000); setTimeout(() => noiseBurst(0.025, 0.18, 3000, 9000), 70); },
  click3:  () => { for (let i = 0; i < 3; i++) setTimeout(() => { noiseBurst(0.03, 0.25, 2500, 9000); }, i * 90); },
  upgrade: () => { beep(523, 0.1, "square", 0.15); setTimeout(() => beep(659, 0.1, "square", 0.15), 100); setTimeout(() => beep(784, 0.15, "square", 0.15), 200); },
  // แฟนแฟร์ตอบถูก — ปุ่มปิดเสียงมีผลเฉพาะเพลงเบื้องหลัง เสียงเอฟเฟกต์ยังเล่นเสมอ
  correct: () => {
    music.nudge(0.05); // ตอบถูกติดกัน = เพลงเข้มข้นขึ้น (ค่อยๆ กลับลงเป็นค่าฐานเอง)
    [523, 659, 784].forEach((f, i) => setTimeout(() => {
      beep(f, 0.13, "square", 0.15, 80, true);
      beep(f * 2, 0.09, "triangle", 0.06, 0, true);
    }, i * 85));
    setTimeout(() => {
      beep(1047, 0.34, "square", 0.14, 0, true);
      beep(1319, 0.34, "square", 0.1, 0, true);
      beep(1568, 0.34, "triangle", 0.09, 40, true);
      noiseBurst(0.3, 0.07, 5000, 14000, true);
    }, 280);
  },
};

/* ================= Chinese speech (TTS) ================= */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    stopSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.85;
    const v = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("zh"));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}

const FEMALE_TH_VOICE = /premwadee|achara|kanya|female|google/i;
const MALE_TH_VOICE = /pattara|niwat|\bmale\b/i;
let speechDuckTimer = null;

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith(lang.slice(0, 2)));
  if (!voices.length) return null;
  if (lang.startsWith("th")) {
    return voices.find((v) => FEMALE_TH_VOICE.test(v.name))
      || voices.find((v) => !MALE_TH_VOICE.test(v.name))
      || voices[0];
  }
  return voices[0];
}

function duckMusic(on, safetyMs = 6000) {
  if (!music.master || !AC) return;
  music.master.gain.setTargetAtTime(on && !muted ? 0.2 : muted ? 0 : 1, AC.currentTime, 0.05);
  clearTimeout(speechDuckTimer);
  speechDuckTimer = on && safetyMs > 0 ? setTimeout(() => duckMusic(false), safetyMs) : null;
}

// ตัวนับรอบเสียงพูด — ทุกครั้งที่ stopSpeech() ถูกเรียก ค่าจะเพิ่มขึ้น
// ทำให้ onDone ของ utterance ที่ถูก cancel ไม่ทำงานต่อ (เช่นตอนกดข้าม/ออก)
let speechSeqId = 0;
function speakSeq(parts, onDone, duckAll = false, onProgress) {
  if (!("speechSynthesis" in window) || !parts.length) {
    if (duckAll) duckMusic(false);
    if (onDone) setTimeout(onDone, 0);
    return;
  }
  try {
    stopSpeech();
    const sid = speechSeqId;
    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      if (sid === speechSeqId && onDone) onDone();
    };
    parts.forEach(([text, lang], i) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.85;
      const v = pickVoice(lang);
      if (v) u.voice = v;
      const last = i === parts.length - 1;
      if (onProgress && lang.startsWith("zh")) {
        u.onboundary = (event) => {
          if (sid !== speechSeqId) return;
          const length = String(text || "").length;
          if (length) onProgress(Math.min(1, Math.max(0, event.charIndex / length)));
        };
      }
      const shouldDuck = duckAll || lang.startsWith("th");
      if (shouldDuck) {
        if (lang.startsWith("th")) {
          u.volume = 1;
          if (!v || MALE_TH_VOICE.test(v.name)) u.pitch = 1.35;
        }
        u.onstart = () => duckMusic(true, duckAll ? 120000 : 6000);
        u.onend = u.onerror = () => {
          if (!duckAll || last) duckMusic(false);
          if (last) finish();
        };
      } else if (last) {
        u.onend = u.onerror = finish;
      }
      speechSynthesis.speak(u);
    });
  } catch (e) {
    if (duckAll) duckMusic(false);
    if (onDone) setTimeout(onDone, 0);
  }
}

/* Pre-generated audio files (gen_audio.py -> audio/zh|th/<word>.mp3) with TTS fallback */
const missingAudio = new Set();
// ตัดช่วงเงียบหัว-ท้ายของคลิป (edge-tts มี ~0.2s นำหน้าและ ~1s ต่อท้าย) แล้วต่อคลิปแบบไร้ช่องว่าง
function audioBounds(buf, thr = 0.015) {
  const d = buf.getChannelData(0);
  let lo = 0, hi = d.length - 1;
  while (lo < hi && Math.abs(d[lo]) < thr) lo++;
  while (hi > lo && Math.abs(d[hi]) < thr) hi--;
  return { start: Math.max(0, lo / buf.sampleRate - 0.02),
           end: Math.min(buf.duration, hi / buf.sampleRate + 0.04) };
}
const wordAudio = {
  seq: 0, srcs: [], timers: [], progressFrame: 0,
  stop() {
    this.seq++;
    if (this.progressFrame) cancelAnimationFrame(this.progressFrame);
    this.progressFrame = 0;
    this.srcs.forEach((s) => { try { s.stop(); } catch (e) {} });
    this.srcs = [];
    this.timers.forEach(clearTimeout);
    this.timers = [];
    duckMusic(false);
  },
  play(items, onDone, onProgress) {
    this.stop();
    stopSpeech();
    const token = this.seq;
    (async () => {
      const ac = AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
      if (ac.state === "suspended") ac.resume();
      const clips = [];
      for (const it of items) {
        if (missingAudio.has(it.url)) break;
        try {
          const res = await fetch(encodeURI(it.url));
          if (!res.ok) throw 0;
          clips.push({ it, buf: await ac.decodeAudioData(await res.arrayBuffer()) });
        } catch (e) { missingAudio.add(it.url); break; }
      }
      if (this.seq !== token) return;
      let t = ac.currentTime + 0.03;
      let progressStart = 0, progressEnd = 0;
      let duckAt = Infinity, unduckAt = 0;
      for (const { it, buf } of clips) {
        const { start, end } = audioBounds(buf);
        const dur = Math.max(0.05, end - start);
        const rateValue = Number(it.playbackRate);
        const rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 1;
        const playDur = dur / rate;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        src.connect(ac.destination);
        src.start(t, start, dur);
        this.srcs.push(src);
        if (onProgress && it.tts && String(it.tts[1] || "").startsWith("zh")) {
          progressStart = t;
          progressEnd = t + playDur;
        }
        if (it.duck) { duckAt = Math.min(duckAt, t); unduckAt = t + playDur; }
        t += playDur + 0.03;
      }
      const after = (delay, fn) => this.timers.push(setTimeout(() => { if (this.seq === token) fn(); }, delay));
      const rest = items.slice(clips.length);
      const duckTts = rest.length > 0 && rest.every((x) => x.duck);
      if (duckAt < Infinity) {
        const duckSafetyMs = Math.max(6000, (unduckAt - duckAt) * 1000 + 1000);
        after(Math.max(0, (duckAt - ac.currentTime) * 1000), () => duckMusic(true, duckSafetyMs));
        if (!duckTts) after(Math.max(0, (unduckAt - ac.currentTime) * 1000), () => duckMusic(false));
      }
      if (onProgress && progressEnd > progressStart) {
        onProgress(0);
        const tick = () => {
          if (this.seq !== token) return;
          const fraction = Math.min(1, Math.max(0, (ac.currentTime - progressStart) / (progressEnd - progressStart)));
          onProgress(fraction);
          if (fraction < 1) this.progressFrame = requestAnimationFrame(tick);
          else this.progressFrame = 0;
        };
        this.progressFrame = requestAnimationFrame(tick);
      }
      if (rest.length) after(Math.max(0, (t - ac.currentTime) * 1000), () =>
        speakSeq(rest.map((x) => x.tts), onDone, duckTts, onProgress));
      else if (onDone) after(Math.max(0, (t - ac.currentTime) * 1000), onDone);
    })().catch(() => {
      if (this.seq === token) speakSeq(items.map((x) => x.tts), onDone, items.length > 0 && items.every((x) => x.duck), onProgress);
    });
  },
};

function stopSpeech() {
  speechSeqId++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  wordAudio.stop();
}

function playWordAudio(word, parts, onDone) {
  const items = [{ url: `audio/zh/${word}.mp3`, tts: parts[0] }];
  if (parts[1]) items.push({ url: `audio/th/${word}.mp3`, tts: parts[1], duck: parts[1][1].startsWith("th") });
  wordAudio.play(items, onDone);
}
// เล่นเสียงคำศัพท์จีนแล้วตามด้วยคำแปล (ไฟล์ mp3 ถ้ามี, ไม่มีก็ TTS) — ใช้ตอนยิง/ตอบถูก
// 了 มีสองเสียงในตารางคำศัพท์ — คำช่วยอ่าน "le" ส่วนคำกริยา (HSK 3) อ่าน "liǎo"
// ไฟล์ 了.mp3 สร้างแบบไม่มีบริบทจึงอ่าน liǎo ดังนั้นคำช่วยใช้คีย์แยก "了-le"
// (ไฟล์นี้ตัดพยางค์ "le" จากเสียงเดียวกัน) — ใช้ร่วมทั้งโหมดยิง/ตอบถูกและโหมดฝึกฟัง
function wordAudioKey(zh, pinyin) {
  const base = String(zh || "").split(/[｜|]/)[0].trim();
  return base === "了" && String(pinyin || "").trim().toLowerCase() === "le" ? "了-le" : base;
}

// เล่นเสียงคำศัพท์จีนแล้วตามด้วยคำแปล (ไฟล์ mp3 ถ้ามี, ไม่มีก็ TTS) — ใช้ตอนยิง/ตอบถูก
function speakWordHit(w, onDone) {
  const zh = w[0].split(/[｜|]/)[0].trim();
  const audioKey = wordAudioKey(w[0], w[1]);
  const spokenZh = audioKey === "了-le" ? "le" : zh;
  const meaning = (w[2] || "").trim();
  playWordAudio(audioKey, [[spokenZh, "zh-CN"],
    ...(meaning ? [[meaning, /[\u0E00-\u0E7F]/.test(meaning) ? "th-TH" : "en-US"]] : [])], onDone);
}
// อ่านตัวอักษรจีนเดี่ยวๆ ด้วยไฟล์สำเร็จรูป audio/zh/<char>.mp3 (มี TTS สำรองให้อัตโนมัติ)
// จำเป็นเพราะ Android WebView ไม่มี speechSynthesis เลย — speak() จะเงียบใน APK
function speakChar(ch) {
  const c = String(ch || "").trim();
  if (!c) return;
  wordAudio.play([{ url: `audio/zh/${c}.mp3`, tts: [c, "zh-CN"] }]);
}
if ("speechSynthesis" in window) speechSynthesis.getVoices(); // warm up voice list

/* ============== Background music (WebAudio synth + FX bus) ============== */
// แต่ละโหมดมีเพลง 5 เพลงไม่ซ้ำกัน — music.start(mode) สับลำดับแล้วเล่นวนไม่รู้จบ
// เพลงหนึ่ง = ลูปเมโลดี้ 32 สเต็ป (null = เงียบ) เล่นซ้ำ SONG_LOOPS รอบก่อนเปลี่ยนเพลง
// ฟิลด์ต่อเพลง: bpm, wave/bassWave, melVol/bassVol/kickVol, mul=คูณระดับเสียง,
// roots เบสต่อจังหวะ (8 ค่า), kickEvery=จังหวะเตะกลอง, snare/hats เปิดปิด
// ฟิลด์ใหม่ (ตั้งที่ _XXX ต่อโหมด จะ override รายเพลงก็ได้): swing=ดีเลย์โน้ตประให้มี groove,
// pad/arp=ระดับเสียง pad/arpeggio (arp เปิดเฉพาะตอนความเข้มข้นสูง), detune=เซนต์ห่างออสซิลเลเตอร์คู่,
// base=ความเข้มข้นเริ่มต้นของ layer สำหรับ adaptive music (0..1)
const SONG_LOOPS = 6;
// วิ — เวลาตัดหางเสียงตอนเปลี่ยนเพลง (โน้ตอย่าง pad ลากยาว ~1.5 วิ ถ้าไม่ตัดจะล้นไปซ้อนเพลงถัดไป)
const SONG_FADE = 0.15;
const _MET = { wave: "triangle", bassWave: "sawtooth", melVol: 0.055, bassVol: 0.09, kickVol: 0.22, mul: 1, kickEvery: 4, snare: true, hats: true, swing: 0.07, pad: 0.034, arp: 0.032, detune: 6, base: 0.45 };
const _VOC = { wave: "square", bassWave: "triangle", melVol: 0.045, bassVol: 0.07, kickVol: 0.16, mul: 1, kickEvery: 4, snare: false, hats: true, swing: 0.05, pad: 0.032, arp: 0.03, detune: 5, base: 0.4 };
const _SEN = { wave: "triangle", bassWave: "triangle", melVol: 0.05, bassVol: 0.08, kickVol: 0.18, mul: 1, kickEvery: 4, snare: true, hats: true, swing: 0.06, pad: 0.034, arp: 0.03, detune: 6, base: 0.4 };
const _FIL = { wave: "triangle", bassWave: "sawtooth", melVol: 0.05, bassVol: 0.08, kickVol: 0.2, mul: 1, kickEvery: 4, snare: true, hats: true, swing: 0.06, pad: 0.032, arp: 0.032, detune: 6, base: 0.45 };
const _ZOM = { wave: "sawtooth", bassWave: "sawtooth", melVol: 0.045, bassVol: 0.11, kickVol: 0.26, mul: 0.5, kickEvery: 2, snare: true, hats: true, swing: 0.03, pad: 0.036, arp: 0.034, detune: 9, base: 0.65 };
const _MAT = { wave: "sine", bassWave: "sine", melVol: 0.05, bassVol: 0.06, kickVol: 0.1, mul: 1, kickEvery: 4, snare: false, hats: true, swing: 0.05, pad: 0.032, arp: 0.028, detune: 5, base: 0.35 };
const _BOM = { wave: "square", bassWave: "sawtooth", melVol: 0.05, bassVol: 0.09, kickVol: 0.24, mul: 1, kickEvery: 2, snare: true, hats: true, swing: 0.04, pad: 0.032, arp: 0.034, detune: 8, base: 0.5 };
const _TRA = { wave: "triangle", bassWave: "triangle", melVol: 0.05, bassVol: 0.075, kickVol: 0.14, mul: 1, kickEvery: 4, snare: false, hats: true, swing: 0.08, pad: 0.034, arp: 0.026, detune: 4, base: 0.3 };
const _SQUIZ = { wave: "sine", bassWave: "sine", melVol: 0.03, bassVol: 0.035, kickVol: 0.05, mul: 0.82, kickEvery: 0, snare: false, hats: false, swing: 0.1, pad: 0.026, arp: 0.014, detune: 2, base: 0.16 };
const MUSIC_THEMES = {
  meteor: [
    { ..._MET, bpm: 122,
      melody: [0, 3, 7, 10, 12, 10, 7, 3, 7, 10, 12, 15, 12, 10, 7, 3,
               7, 10, 15, 12, 10, 7, 3, 7, 0, 3, 7, 10, 12, 15, 17, 19],
      roots: [0, -4, -2, 0, 0, -2, -4, -2] },
    { ..._MET, bpm: 126, wave: "square",
      melody: [7, 10, 12, 15, 19, 15, 12, 10, 12, 15, 19, 22, 19, 15, 12, 10,
               7, 10, 12, 15, 17, 15, 12, 10, 12, 15, 17, 19, 15, 12, 10, 7],
      roots: [0, 0, -4, -4, -2, -2, -5, -4] },
    { ..._MET, bpm: 118, snare: false,
      melody: [3, 3, 7, 7, 10, 10, 7, 3, 5, 5, 8, 8, 12, 10, 8, 7,
               3, 3, 7, 7, 10, 10, 12, 10, 8, 7, 5, 3, 2, 0, 3, null],
      roots: [0, -2, 0, -4, -5, -4, -2, 0] },
    { ..._MET, bpm: 128,
      melody: [0, null, 3, 0, 7, null, 10, 7, 12, null, 10, 7, 3, null, 7, 3,
               0, null, 3, 0, 7, null, 10, 7, 15, 14, 12, 10, 7, 5, 3, null],
      roots: [0, 0, -5, -5, -4, -4, -2, -2] },
    { ..._MET, bpm: 124, wave: "square", bassWave: "triangle",
      melody: [12, 10, 7, 3, 7, 10, 12, 15, 14, 12, 10, 7, 10, 12, 14, 15,
               12, 10, 7, 3, 7, 10, 12, 10, 7, 5, 7, 3, 2, 0, null, null],
      roots: [0, -4, 0, -2, -5, -2, -4, 0] },
  ],
  vocab: [
    { ..._VOC, bpm: 104,
      melody: [0, 4, 7, 4, 9, 7, 4, 0, 4, 7, 9, 12, 9, 7, 4, 2,
               0, 4, 7, 4, 9, 7, 4, 0, 2, 4, 7, 9, 7, 4, 2, 0],
      roots: [0, -3, -5, -3, 0, -3, -7, -5] },
    { ..._VOC, bpm: 110,
      melody: [0, 2, 4, 7, 9, 7, 4, 2, 0, 2, 4, 7, 12, 9, 7, 4,
               9, 7, 4, 2, 4, 7, 9, 12, 14, 12, 9, 7, 4, 2, 4, null],
      roots: [0, 0, -5, -5, -3, -3, -7, -5] },
    { ..._VOC, bpm: 100, wave: "triangle",
      melody: [4, 4, 7, 4, 9, 4, 7, 4, 5, 5, 9, 5, 12, 9, 7, 5,
               4, 4, 7, 4, 9, 4, 7, 4, 2, 4, 7, 9, 7, 4, 2, 0],
      roots: [0, -3, 0, -5, -7, -5, -3, 0] },
    { ..._VOC, bpm: 108, snare: true,
      melody: [7, 9, 12, 9, 7, 4, 7, 9, 12, 14, 16, 14, 12, 9, 7, 4,
               7, 9, 12, 9, 7, 4, 7, 9, 10, 9, 7, 4, 2, 0, 2, 4],
      roots: [0, -5, -3, -5, 0, -3, -5, -7] },
    { ..._VOC, bpm: 112, wave: "triangle", bassWave: "sawtooth",
      melody: [0, 4, 7, 9, 12, 9, 7, 4, 2, 4, 7, 9, 7, 4, 2, 0,
               0, 4, 7, 9, 12, 14, 16, 19, 16, 14, 12, 9, 7, 4, null, null],
      roots: [0, 0, -3, -3, -5, -5, -7, -3] },
  ],
  sentence: [
    { ..._SEN, bpm: 110,
      melody: [0, null, 7, null, 10, null, 7, null, 12, null, 10, 7, null, 7, 3, null,
               0, null, 7, null, 10, null, 12, null, 15, 12, 10, 7, null, null, null, null],
      roots: [0, -2, -4, -5, 0, -2, -4, -2] },
    { ..._SEN, bpm: 106,
      melody: [3, null, null, 7, null, 10, null, 7, null, 5, null, 7, null, 3, null, null,
               3, null, null, 7, null, 10, null, 12, null, 10, null, 7, null, 5, null, 3],
      roots: [0, -5, -4, -2, 0, -4, -5, -2] },
    { ..._SEN, bpm: 114, wave: "square",
      melody: [0, 3, 7, null, 12, null, 10, null, 7, 3, 5, null, 7, null, null, null,
               0, 3, 7, null, 12, null, 15, null, 12, 10, 7, 5, 3, null, null, null],
      roots: [0, -2, 0, -4, -5, -4, -2, 0] },
    { ..._SEN, bpm: 108, snare: false,
      melody: [7, null, 10, null, 12, null, 10, 7, 5, null, 7, null, 3, null, null, null,
               7, null, 10, null, 12, null, 15, 12, 10, 7, 5, 3, 2, 3, null, null],
      roots: [0, -4, -2, 0, -5, -2, -4, -2] },
    { ..._SEN, bpm: 104, bassWave: "sawtooth",
      melody: [0, null, 5, null, 7, null, 10, null, 12, null, 10, null, 7, null, 5, null,
               0, null, 5, null, 7, null, 10, null, 7, 5, 3, 2, 0, null, null, null],
       roots: [0, -5, -3, -5, 0, -5, -4, -2] },
  ],
  sentencequiz: [
    { ..._SQUIZ, bpm: 72,
      melody: [0, null, 4, null, 7, null, null, 4, 5, null, 9, null, 7, null, 4, null,
               0, null, 4, null, 7, null, 9, null, 7, null, 4, null, 2, null, null, null],
      roots: [0, -5, -7, -5, 0, -5, -2, -5] },
    { ..._SQUIZ, bpm: 76, wave: "triangle", mul: 0.76,
      melody: [7, null, null, 4, null, 2, null, null, 5, null, null, 2, null, 0, null, null,
               4, null, 7, null, 9, null, 7, null, 5, null, 4, null, 2, null, null, null],
      roots: [-2, -7, -5, -7, -2, -7, -4, -7] },
    { ..._SQUIZ, bpm: 70, melVol: 0.026, pad: 0.03,
      melody: [0, null, null, 5, null, null, 7, null, 9, null, 7, null, 5, null, null, null,
               4, null, null, 7, null, 9, null, 12, null, 9, null, 7, 4, null, null, null],
      roots: [0, -3, -5, -3, 0, -3, -7, -5] },
    { ..._SQUIZ, bpm: 78, swing: 0.06, mul: 0.72,
      melody: [5, null, 7, null, 9, null, null, 7, 4, null, null, 2, null, 4, null, null,
               5, null, 7, null, 9, null, 12, null, 9, null, 7, null, 5, null, null, null],
      roots: [-5, -2, -7, -2, -5, -2, 0, -2] },
    { ..._SQUIZ, bpm: 74, wave: "triangle", melVol: 0.027, bassVol: 0.03,
      melody: [0, null, 3, null, 7, null, null, 5, 3, null, null, 0, null, 2, null, null,
               0, null, 3, null, 5, null, 7, null, 10, null, 7, null, 5, null, 3, null],
      roots: [0, -4, -5, -4, 0, -4, -2, -5] },
  ],
  trace: [
    { ..._TRA, bpm: 96,
      melody: [0, null, 4, null, 7, null, 4, null, 5, null, 7, null, 9, null, 7, null,
               0, null, 4, null, 7, null, 12, null, 9, null, 7, null, 4, null, null, null],
      roots: [0, -3, -5, -3, 0, -3, -5, -7] },
    { ..._TRA, bpm: 90, snare: false,
      melody: [7, null, null, 9, null, 7, null, 5, null, 4, null, 2, null, 0, null, null,
               7, null, null, 9, null, 12, null, 9, null, 7, null, 5, null, 4, null, null],
      roots: [0, -5, -4, -2, 0, -5, -4, -7] },
    { ..._TRA, bpm: 100, wave: "sine",
      melody: [0, 2, 4, null, 7, null, 5, 4, 5, 7, 9, null, 12, null, 9, 7,
               9, 7, 5, null, 4, null, 2, 0, 2, 4, 7, null, 4, null, null, null],
      roots: [0, -3, 0, -5, -3, -5, -4, -2] },
    { ..._TRA, bpm: 92, bassWave: "sine",
      melody: [4, null, 7, null, 11, null, 7, null, 9, null, 7, null, 4, null, 2, null,
               4, null, 7, null, 11, null, 14, null, 11, null, 9, null, 7, null, 4, null],
      roots: [0, -4, -2, -5, 0, -4, -2, -7] },
    { ..._TRA, bpm: 98,
      melody: [0, 4, 7, 4, 9, 7, 4, 0, 5, 9, 12, 9, 7, 5, 4, 2,
               0, 4, 7, 4, 9, 7, 12, 9, 7, 5, 4, 2, 0, null, null, null],
      roots: [0, -3, -5, -3, 0, -5, -4, -2] },
  ],
  fillblank: [
    { ..._FIL, bpm: 112,
      melody: [7, 7, 10, 7, 12, null, 10, 7, 9, 9, 12, 9, 14, 12, 9, 7,
               7, 7, 10, 7, 12, null, 14, 15, 12, 10, 7, 3, 7, null, null, null],
      roots: [0, -5, -3, -5, 0, -4, -2, -4] },    { ..._FIL, bpm: 118, wave: "square",
      melody: [7, 10, 7, 10, 12, 10, 7, 10, 9, 12, 9, 12, 14, 12, 9, 12,
               10, 12, 10, 12, 15, 12, 10, 12, 14, 15, 14, 12, 10, 9, 7, null],
      roots: [0, 0, -4, -4, -5, -5, -2, -2] },
    { ..._FIL, bpm: 110, bassWave: "triangle",
      melody: [5, 7, 9, 7, 12, 9, 7, 5, 7, 9, 12, 14, 12, 9, 7, 5,
               5, 7, 9, 7, 12, 9, 7, 5, 9, 7, 5, 3, 2, 0, null, null],
      roots: [0, -3, -5, -3, 0, -5, -7, -5] },
    { ..._FIL, bpm: 108, snare: false,
      melody: [12, null, 12, null, 14, null, 12, 10, 9, null, 9, null, 10, null, 9, 7,
               12, null, 12, null, 14, null, 15, 14, 12, 10, 9, 7, 5, 7, null, null],
      roots: [0, -2, -4, -2, 0, -4, -5, -4] },
    { ..._FIL, bpm: 116,
      melody: [7, 7, 7, 10, 9, 9, 9, 12, 10, 10, 10, 14, 12, 10, 9, 7,
               14, 14, 14, 12, 10, 10, 10, 9, 7, 9, 10, 12, 10, 9, 7, null],
      roots: [0, 0, -5, -5, -4, -4, -2, 0] },
  ],
  zombie: [
    { ..._ZOM, bpm: 122, kickEvery: 4,
      melody: [0, 3, 5, 3, 0, 3, 5, 7, 8, 7, 5, 3, 5, 3, 2, 0,
               0, 3, 5, 3, 0, 3, 5, 7, 10, 8, 7, 5, 3, 5, 3, 0],
      roots: [0, 0, -2, -2, -4, -4, -2, -2] },
    { ..._ZOM, bpm: 118, kickEvery: 4,
      melody: [0, 0, 3, 0, 5, 0, 3, 0, 7, 0, 5, 0, 3, 0, 2, 0,
               8, 0, 7, 0, 5, 0, 3, 0, 5, 0, 3, 0, 2, 0, 1, 0],
      roots: [0, 0, 0, -4, -4, 0, -2, -2] },
    { ..._ZOM, bpm: 126, kickEvery: 4,
      melody: [10, 8, 7, 5, 7, 8, 10, 12, 10, 8, 7, 5, 3, 5, 3, 2,
               0, 3, 5, 7, 8, 7, 5, 3, 5, 7, 8, 10, 8, 7, 5, 3],
      roots: [0, -2, 0, -2, -4, -2, -5, -4] },
    { ..._ZOM, bpm: 116, wave: "square", kickEvery: 4,
      melody: [0, 3, 0, 5, 0, 3, 0, 2, 0, 3, 0, 5, 0, 7, 0, 5,
               8, 5, 8, 7, 5, 7, 5, 3, 2, 3, 2, 0, 2, 0, null, 0],
      roots: [0, 0, -5, -5, -4, -4, -4, -2] },
    { ..._ZOM, bpm: 130, mul: 0.7,
      melody: [5, 3, 2, 0, 3, 5, 7, 8, 10, 8, 7, 5, 7, 5, 3, 2,
               5, 3, 2, 0, 3, 5, 7, 8, 12, 10, 8, 7, 5, 3, 2, 0],
      roots: [-2, -2, 0, 0, -5, -5, -4, -2] },
  ],
  matching: [
    { ..._MAT, bpm: 92,
      melody: [0, null, null, 7, null, null, 5, null, 9, null, 7, null, 5, null, null, null,
               0, null, null, 7, null, null, 9, null, 12, null, 10, 7, null, null, null, null],
      roots: [0, -5, -4, -2, 0, -5, -4, -7] },
    { ..._MAT, bpm: 88,
      melody: [0, null, 4, null, 7, null, null, null, 9, null, 7, null, 4, null, null, null,
               0, null, 4, null, 7, null, null, null, 5, null, 4, null, 2, null, null, null],
      roots: [0, 0, -5, -5, -4, -4, -2, -5] },
    { ..._MAT, bpm: 90, wave: "triangle",
      melody: [7, null, null, null, 9, null, 7, null, 5, null, null, null, 4, null, 2, null,
               7, null, null, null, 12, null, 9, null, 7, null, 5, null, null, null, null, null],
      roots: [0, -5, -3, -5, -7, -5, -4, -2] },
    { ..._MAT, bpm: 96, hats: false,
      melody: [0, null, null, 5, null, 7, null, null, null, 9, null, 7, null, 5, null, null,
               4, null, null, 9, null, 7, null, null, null, 5, null, 4, null, 2, null, null],
      roots: [0, -4, -5, -4, 0, -2, -5, -7] },
    { ..._MAT, bpm: 86, kickEvery: 8,
      melody: [12, null, null, null, 10, null, 9, null, 7, null, null, null, 5, null, null, null,
               9, null, null, null, 7, null, 5, null, 4, null, 2, null, 0, null, null, null],
      roots: [-5, -5, 0, 0, -4, -4, -5, -7] },
  ],
  bomb: [
    { ..._BOM, bpm: 134,
      melody: [12, 12, 15, 12, 10, 12, 10, 7, 12, 12, 15, 17, 15, 12, 10, 7,
               12, 12, 15, 12, 19, 17, 15, 12, 10, 12, 14, 15, 12, 10, 7, 5],
      roots: [0, 0, -2, 0, -4, 0, -2, 0] },
    { ..._BOM, bpm: 140, wave: "sawtooth", kickEvery: 4,
      melody: [12, 14, 12, 10, 12, 10, 9, 7, 12, 14, 15, 17, 19, 17, 15, 14,
               12, 14, 12, 10, 12, 10, 9, 7, 10, 9, 7, 5, 7, 5, 3, 2],
      roots: [0, -2, 0, -2, -4, -2, 0, -5] },
    { ..._BOM, bpm: 130, bassWave: "square", kickEvery: 4,
      melody: [15, 12, 15, 12, 17, 15, 12, 10, 14, 12, 14, 12, 15, 14, 12, 10,
               12, 15, 12, 19, 17, 15, 17, 19, 20, 19, 17, 15, 14, 12, 10, 7],
      roots: [0, 0, -4, -4, -2, -2, -5, -4] },
    { ..._BOM, bpm: 144, kickEvery: 4,
      melody: [7, 10, 12, 10, 14, 12, 10, 7, 9, 12, 14, 12, 15, 14, 12, 9,
               7, 10, 12, 10, 14, 12, 10, 7, 17, 15, 14, 12, 10, 9, 7, 5],
      roots: [0, -4, 0, -4, -5, -4, -2, -4] },
    { ..._BOM, bpm: 138, wave: "sawtooth", bassWave: "square", kickEvery: 4,
      melody: [12, 12, 12, 15, 14, 14, 14, 17, 15, 15, 15, 19, 17, 15, 14, 12,
               19, 19, 19, 17, 15, 15, 15, 14, 12, 14, 15, 17, 15, 14, 12, 10],
      roots: [0, 0, -2, -2, 0, 0, -4, -5] },
  ],
};
// ปริมาณส่ง FX ของแต่ละ layer (โครงสร้างคงที่ — ตั้งครั้งเดียว ไม่ต้องแก้รายเพลง)
// วิ — ลำโพงมือถือเล่นเสียงต่ำกว่า ~90 Hz ไม่ได้: เบสมี sub ครึ่งความถี่ (~55 Hz) ทุกจังหวะ
// และ kick ไล่ลงถึง 44 Hz → ลำโพงไม่สามารถขยับตามได้ จะ "คราง/แตกรั่ว" ออกมาเป็นเสียง noise
// ตลอดทั้งเพลง (ทุกโหมด ฟังไม่เจอใน Chrome บนคอมเพราะลำโพง/หูฟังใหญ่กว่า)
// จึงตัดความถี่ต่ำทิ้งก่อนเข้า limiter ด้วย highpass 2 ตัวต่อกัน (24 dB/oct)
// เบสจริง (110 Hz) แทบไม่ลด (~-2.7 dB) แต่ sub/kick ที่ทำให้เกิด noise หายไป >16 dB
const MUSIC_HP = 78;
// วิ — เมื่อตัด rumble ออก เพลงจะดังขึ้น ~1.2 dB (limiter ทำงานน้อยลง) จึงชดเชยด้วย trim
// เพื่อให้ระดับเสียง/พีคใกล้เคียงของเดิม (ไม่ให้ผู้เล่นรู้สึกว่าเพลงเปลี่ยนความดัง)
const MUSIC_TRIM = 0.85;
const LAYER_FX = {
  drums: { rev: 0.06, dly: 0 }, bass: { rev: 0.03, dly: 0 }, pad: { rev: 0.55, dly: 0.05 },
  arp: { rev: 0.3, dly: 0.45 }, lead: { rev: 0.22, dly: 0.32 }, perc: { rev: 0.16, dly: 0 },
};
const music = {
  playing: false, timer: null, step: 0, nextTime: 0, loopCount: 0,
  themeName: "meteor", theme: MUSIC_THEMES.meteor[0],
  songs: MUSIC_THEMES.meteor, order: [0], orderPos: 0, stepsLeft: 0,
  stepDur: 60 / 140 / 4,
  intensity: 0.5, baseIntensity: 0.5,
  voices: [], // เสียงที่ยังดังอยู่ (gain + เวลาจบ) สำหรับตัดหางตอนเปลี่ยนเพลง
  human: () => (Math.random() - 0.5) * 0.008, // ขยับจังหวะกลองเล็กน้อยให้ไม่แข็งเหมือนเครื่อง
  // convolver กิน CPU — ปิด reverb ถ้าเครื่องมี 4 คอร์หรือน้อยกว่า
  revOn: () => !(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4),
  // impulse response ของ reverb สร้างเองจาก noise (ไม่ใช้ไฟล์) — decay ยิ่งมาก หางยิ่งสั้น
  makeIR(dur, decay) {
    const ac = AC, len = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  },
  // สายสัญญาณ: layer → dry + ส่ง reverb/ดีเลย์ (ping-pong) → master (mute/duck) → limiter → destination
  buildGraph() {
    const ac = AC;
    this.master = ac.createGain();
    this.master.gain.value = muted ? 0 : 1;
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -12; this.limiter.knee.value = 6; this.limiter.ratio.value = 5;
    this.limiter.attack.value = 0.004; this.limiter.release.value = 0.22;
    // highpass 2 ชั้น: ตัด rumble ที่ลำโพงมือถือทำไม่ได้ (ต้นเหตุเสียง noise ตลอดเพลง)
    this.hp1 = ac.createBiquadFilter(); this.hp1.type = "highpass"; this.hp1.Q.value = 0.7;
    this.hp2 = ac.createBiquadFilter(); this.hp2.type = "highpass"; this.hp2.Q.value = 0.7;
    this.hp1.frequency.value = MUSIC_HP; this.hp2.frequency.value = MUSIC_HP;
    this.trim = ac.createGain(); this.trim.gain.value = MUSIC_TRIM;
    this.master.connect(this.hp1); this.hp1.connect(this.hp2);
    this.hp2.connect(this.trim); this.trim.connect(this.limiter);
    this.limiter.connect(ac.destination);

    this.rev = ac.createConvolver();
    this.rev.buffer = this.makeIR(1.5, 3.4);
    this.revLP = ac.createBiquadFilter();
    this.revLP.type = "lowpass"; this.revLP.frequency.value = 3800;
    this.revOut = ac.createGain();
    this.revOut.gain.value = this.revOn() ? 0.8 : 0;
    this.rev.connect(this.revLP); this.revLP.connect(this.revOut); this.revOut.connect(this.master);

    this.dlyL = ac.createDelay(1); this.dlyR = ac.createDelay(1);
    this.dlyFB = ac.createGain(); this.dlyFB.gain.value = 0.32;
    this.dlyLP = ac.createBiquadFilter();
    this.dlyLP.type = "lowpass"; this.dlyLP.frequency.value = 2400;
    const panL = ac.createStereoPanner(), panR = ac.createStereoPanner();
    panL.pan.value = -0.7; panR.pan.value = 0.7;
    this.dlyIn = ac.createGain();
    this.dlyIn.connect(this.dlyL);
    this.dlyL.connect(panL); panL.connect(this.master);
    this.dlyL.connect(this.dlyR); this.dlyR.connect(panR); panR.connect(this.master);
    this.dlyR.connect(this.dlyLP); this.dlyLP.connect(this.dlyFB); this.dlyFB.connect(this.dlyL);

    this.layers = {};
    for (const name of Object.keys(LAYER_FX)) {
      const g = ac.createGain(), fx = LAYER_FX[name];
      g.connect(this.master);
      if (fx.rev) { const s = ac.createGain(); s.gain.value = fx.rev; g.connect(s); s.connect(this.rev); }
      if (fx.dly) { const s = ac.createGain(); s.gain.value = fx.dly; g.connect(s); s.connect(this.dlyIn); }
      this.layers[name] = g;
    }
  },
  getAC() {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    if (!this.master) this.buildGraph();
    return AC;
  },
  // โน้ตหนึ่งตัว: ออสซิลเลเตอร์คู่ detune (กว้าง/มีมิติ) + filter envelope + ADSR + pan
  // opts: layer, pan, slide, detune, attack/hold/release, cutoff/q, sub (เสียงซับของเบส)
  tone(freq, t, dur, type, vol, opts = {}) {
    if (!freq) return;
    const ac = this.getAC();
    const { layer = "lead", pan = 0, slide = 0, detune = 0, attack = 0.008, hold = 0.6,
            release = 0.14, cutoff = 2400, q = 0.9, sub = 0 } = opts;
    const bus = (this.layers && this.layers[layer]) || this.master;
    const f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = "lowpass"; f.Q.value = q;
    f.frequency.setValueAtTime(Math.min(12000, cutoff * 2.4), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff), t + attack + Math.min(dur * 0.3, 0.22));
    const n = 1 + (detune ? 2 : 0); // ออสซิลเลเตอร์หลักมีกี่ตัว → หารระดับเสียงให้ดังรวมเท่าเดิม
    const peak = Math.max(0.0006, vol / Math.sqrt(n));
    const rel = Math.max(0.02, release);
    g.gain.setValueAtTime(0.0006, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.004, attack));
    g.gain.exponentialRampToValueAtTime(Math.max(0.0006, peak * hold), t + attack + Math.min(dur * 0.35, 0.2));
    g.gain.setTargetAtTime(0.0006, t + dur, rel / 3);
    this.reg(g, t, t + dur + rel * 3 + 0.05); // ลงทะเบียนไว้ตัดหางตอนเปลี่ยนเพลง
    f.connect(g);
    if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(bus); }
    else g.connect(bus);
    const mk = (mul, wave, cents, level) => {
      const o = ac.createOscillator();
      o.type = wave; o.frequency.value = Math.max(20, freq * mul);
      if (cents) o.detune.value = cents;
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * mul + slide), t + dur);
      if (level === undefined) o.connect(f);
      else { const lg = ac.createGain(); lg.gain.value = level; o.connect(lg); lg.connect(f); }
      o.start(t); o.stop(t + dur + rel * 3 + 0.05);
    };
    mk(1, type, 0);
    if (detune) { mk(1, type, detune + Math.random() * 1.5); mk(1, type, -detune - Math.random() * 1.5); }
    if (sub) mk(0.5, "sine", 0, sub);
  },
  // เสียงสาย percussive ทั้งหมดใช้ noise buffer ก้อนเดียวที่แชร์กัน
  nz(t, dur, vol, opts = {}) {
    const ac = this.getAC();
    if (!this._nbuf || this._nbuf.sampleRate !== ac.sampleRate) {
      this._nbuf = ac.createBuffer(1, Math.ceil(ac.sampleRate), ac.sampleRate);
      const d = this._nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = this._nbuf;
    f.type = opts.type || "highpass"; f.frequency.value = opts.freq || 6000; f.Q.value = opts.q || 1;
    g.gain.setValueAtTime(Math.max(0.0008, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    this.reg(g, t, t + dur + 0.03);
    src.connect(f); f.connect(g);
    const bus = (this.layers && this.layers[opts.layer || "drums"]) || this.master;
    if (opts.pan) { const p = ac.createStereoPanner(); p.pan.value = opts.pan; g.connect(p); p.connect(bus); }
    else g.connect(bus);
    src.start(t); src.stop(t + dur + 0.03);
  },
  kick(t, vol) {
    const ac = this.getAC(), bus = (this.layers && this.layers.drums) || this.master;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.1);
    g.gain.setValueAtTime(Math.max(0.001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    this.reg(g, t, t + 0.32);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + 0.32);
    this.nz(t, 0.02, vol * 0.22, { freq: 2200 }); // click บางๆ ให้มี punch
  },
  snare(t, vol) {
    this.nz(t, 0.17, vol * 0.55, { type: "bandpass", freq: 1900, q: 0.8, pan: 0.06 });
    this.tone(185, t, 0.09, "triangle", vol * 0.16, { layer: "drums", cutoff: 1300, release: 0.05 });
  },
  hat(t, vol, open) { this.nz(t, open ? 0.2 : 0.045, vol, { freq: 8200, pan: (Math.random() - 0.5) * 0.6 }); },
  shaker(t, vol) { this.nz(t, 0.07, vol * 0.7, { type: "bandpass", freq: 5200, q: 1.2, pan: (Math.random() - 0.5) * 0.9 }); },
  tom(t, vol, mul) { this.tone(200 * mul, t, 0.18, "sine", vol * 0.5, { layer: "drums", slide: -70, cutoff: 900, release: 0.08 }); },
  bell(t, freq, vol) { // ระฆังแบบ FM บางๆ (ใช้ตอนปิดลูป/แครช)
    const ac = this.getAC(), bus = (this.layers && this.layers.perc) || this.master;
    const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
    car.type = "sine"; car.frequency.value = freq;
    mod.type = "sine"; mod.frequency.value = freq * 2.4;
    mg.gain.value = freq * 1.6;
    mod.connect(mg); mg.connect(car.frequency);
    g.gain.setValueAtTime(Math.max(0.0008, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);
    this.reg(g, t, t + 0.62);
    car.connect(g); g.connect(bus);
    car.start(t); car.stop(t + 0.62); mod.start(t); mod.stop(t + 0.62);
  },
  crash(t, vol) { this.nz(t, 0.7, vol * 0.4, { freq: 3200, pan: -0.25 }); this.bell(t, 1046, vol * 0.16); },
  setMuted(m) {
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.getAC().currentTime, 0.01);
  },
  // ---- เปลี่ยนเพลง: ตัดหางเสียงของเพลงเก่า ไม่ให้ล้นไปซ้อนเพลงใหม่ ----
  // โน้ตอย่าง pad/bass ข้ามสเต็ปได้ (pad ยาว ~15 สเต็ป) ถ้าปล่อยไว้จะดังทับเพลงถัดไป
  // (คนละคอร์ด คนละจังหวะ) — ทุกเสียงจึงถูกลงทะเบียนไว้เพื่อ "ตัดหาง" ได้ทีหลัง
  reg(g, start, until) { this.voices.push({ g, start, until }); },
  // t = เวลาที่เริ่มตัดหาง (null = ตอนนี้) — ไล่ gain ลงถึง 0 ในเวลา fade วิ
  // ใช้ cancelAndHoldAtTime คงค่า gain ปัจจุบันไว้ก่อนไล่ลง จึงไม่แตก/ไม่คลิก
  fadeVoices(t, fade = SONG_FADE) {
    if (!AC) return;
    const now = AC.currentTime, at = Math.max(t == null ? now : t, now);
    this.voices = this.voices.filter((v) => v.until > now); // ทิ้งรายการที่เสียงจบไปแล้ว
    for (const v of this.voices) {
      const p = v.g.gain;
      if (v.start >= at) { // เสียงที่ยังไม่เริ่ม (ค้างอยู่ในคิว) — เงียบไว้ตั้งแต่ต้นเลย
        p.cancelScheduledValues(at);
        p.setValueAtTime(0.0006, at);
      } else {
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at);
        else { p.cancelScheduledValues(at); p.setValueAtTime(Math.max(0.0006, p.value), at); }
        p.exponentialRampToValueAtTime(0.0006, at + fade);
      }
    }
  },
  // ---- โครงเพลง: คอร์ดของแต่ละครึ่งบาร์ (เดาจากรากเบส + โน้ตเมโลดี้ครึ่งบาร์นั้น) ----
  // โน้ตที่ห่างจากราก 3 ฮาล์ฟโทน = คอร์ดไมเนอร์, ห่าง 4 = เมเจอร์
  chordAt(s) {
    const th = this.theme;
    const half = s >= 16 ? 1 : 0;
    const root = th.roots[half * 4] ?? th.roots[0] ?? 0;
    let third = 4;
    for (let i = half * 16; i < (half + 1) * 16; i++) {
      const m = th.melody[i];
      if (m == null) continue;
      const iv = ((m - root) % 12 + 12) % 12;
      if (iv === 3) { third = 3; break; }
      if (iv === 4) third = 4;
    }
    return { root, third };
  },
  // pad: คอร์ด 3 เสียงกอดไว้ครึ่งบาร์ แผ่ซ้าย-กลาง-ขวา ให้เสียงกว้างมีมิติ
  pad(s, t) {
    const th = this.theme, chord = this.chordAt(s);
    const base = 220 * Math.pow(2, chord.root / 12);
    [0, chord.third, 7].forEach((iv, i) => {
      this.tone(base * Math.pow(2, iv / 12), t, this.stepDur * 15, i === 1 ? "sine" : "triangle", th.pad,
        { layer: "pad", attack: 0.45, hold: 0.85, release: 0.9, cutoff: 1800, detune: 8, pan: [-0.55, 0, 0.55][i] });
    });
  },
  // arp: ไล่เสียงในคอร์ดทุก 8th note — เล่นเฉพาะตอนความเข้มข้นสูง (gate ที่ gain ของ layer)
  arp(s, t) {
    const th = this.theme;
    if (!th.arp || !this.layers || this.layers.arp.gain.value < 0.02) return;
    const chord = this.chordAt(s), tones = [0, chord.third, 7, 12, 7, chord.third];
    const iv = tones[((s / 2) | 0) % tones.length];
    this.tone(220 * Math.pow(2, (chord.root + iv) / 12), t, this.stepDur * 1.5, "sine", th.arp,
      { layer: "arp", attack: 0.006, hold: 0.45, release: 0.2, cutoff: 3000, pan: ((s / 2) | 0) % 2 ? 0.3 : -0.3 });
  },
  // ---- adaptive music: ความเข้มข้น 0..1 เปิด-ปิด layer ให้เพลงโตตามสถานการณ์เกม ----
  applyIntensity() {
    if (!this.layers || !AC) return;
    const i = Math.max(0, Math.min(1, this.intensity)), now = AC.currentTime;
    const to = (name, v) => this.layers[name].gain.setTargetAtTime(v, now, 0.35);
    to("perc", Math.max(0, (i - 0.45) / 0.55)); // shaker เข้าเมื่อเริ่มตึง
    to("arp", Math.max(0, (i - 0.3) / 0.7));    // arpeggio เข้าเมื่อตึงกลางๆ
    to("pad", 0.75 + 0.25 * i);
    to("lead", 0.9 + 0.1 * i);
    to("drums", 0.95 + 0.05 * i);
    to("bass", 1);
  },
  setIntensity(v) {
    v = Math.max(0, Math.min(1, v));
    if (Math.abs(v - this.intensity) < 0.02) return; // เปลี่ยนนิดเดียว: ข้าม ไม่ต้องเขียน automation ซ้ำทุกเฟรม
    this.intensity = v; this.applyIntensity();
  },
  nudge(d) { this.setIntensity(this.intensity + d); },
  scheduleStep(s, t) {
    const th = this.theme, step = this.stepDur;
    const swing = (th.swing || 0) * step * (s % 2); // ดีเลย์โน้ตประให้มี groove
    const ts = t + swing;
    // ---- lead (melody 16th note) ----
    const m = th.melody[s];
    if (m != null) this.tone(440 * th.mul * Math.pow(2, m / 12), ts, step * 0.95, th.wave, th.melVol,
      { layer: "lead", detune: th.detune || 5, attack: 0.006, hold: 0.55, release: 0.11, cutoff: 3200, pan: (s % 16) < 8 ? -0.12 : 0.12 });
    // ---- bass ทุกจังหวะ ----
    if (s % 4 === 0) {
      const root = th.roots[(s / 4) | 0] ?? 0;
      this.tone(110 * Math.pow(2, root / 12), t, step * 3.5, th.bassWave, th.bassVol,
        { layer: "bass", attack: 0.012, hold: 0.8, release: 0.14, cutoff: 900, sub: 0.45 });
    }
    // ---- โครงเพลง: pad ต้นครึ่งบาร์ + arp เบาๆ ระหว่างนั้น ----
    if (s % 16 === 0) this.pad(s, t);
    else if (s % 2 === 0) this.arp(s, ts + this.human());
    // ---- กลอง ----
    if (th.kickEvery && s % th.kickEvery === 0) this.kick(t, th.kickVol);
    if (th.snare && s % 8 === 4) this.snare(t, th.kickVol * 0.62);
    if (th.hats && s % 4 === 2) this.hat(ts + this.human(), th.kickVol * 0.16, false);
    if (th.hats && this.layers && this.layers.perc.gain.value > 0.05 && s % 4 === 0) this.shaker(ts + this.human(), th.kickVol * 0.1);
    // ---- fill ปิดลูป (ทุกรอบที่ 2) ให้มีจุดพลิกก่อนวนใหม่ ----
    const last = th.melody.length;
    if (this.loopCount % 2 === 1) {
      if (s === last - 2) this.tom(t, th.kickVol, 1);
      else if (s === last - 1) { this.tom(t, th.kickVol, 0.8); this.tom(t + step * 0.5, th.kickVol * 0.72, 0.62); }
    } else if (s === 0 && this.loopCount > 0) {
      this.crash(t, th.kickVol * 0.55);
    }
    // ---- ค่อยๆ กลับเข้าความเข้มข้นฐานของโหมด (0.7%/สเต็ป ≈ ครึ่งทางใน ~10 วิ) ----
    this.intensity += (this.baseIntensity - this.intensity) * 0.007;
    if (s % 4 === 0) this.applyIntensity();
  },
  // โหลดเพลงปัจจุบันของเพลย์ลิสต์ (ตั้ง bpm / ความเข้มข้นฐาน / จำนวนสเต็ปก่อนข้ามเพลง)
  loadSong() {
    this.theme = this.songs[this.order[this.orderPos]];
    this.stepDur = 60 / this.theme.bpm / 4;
    this.step = 0;
    this.loopCount = 0;
    this.stepsLeft = this.theme.melody.length * SONG_LOOPS;
    this.baseIntensity = this.theme.base ?? 0.5;
    this.syncDelay();
  },
  // ตั้งเวลาดีเลย์ให้ตรงจังหวะเพลง (โน้ตเขบ็ต 3 ชั้น) — ต้องเรียกอีกครั้งหลังสร้าง graph
  syncDelay() {
    if (!this.dlyL || !this.theme) return;
    const d = (60 / this.theme.bpm) * 0.75;
    this.dlyL.delayTime.value = d;
    this.dlyR.delayTime.value = d;
  },
  // ไปเพลงถัดไปในลำดับที่สับไว้ — เล่นครบทุกเพลงแล้วสับใหม่
  // (เพลงแรกของรอบใหม่จะไม่ซ้ำกับเพลงที่เพิ่งจบ)
  advanceSong() {
    // ตัดหางเสียงเพลงเดิมที่ "ขอบเพลง" พอดี (nextTime = จังหวะแรกของเพลงใหม่) — กันเพลงซ้อนกัน
    this.fadeVoices(this.nextTime);
    this.orderPos++;
    if (this.orderPos >= this.order.length) {
      const last = this.order[this.order.length - 1];
      do { this.order = shuffle([...this.songs.keys()]); }
      while (this.order.length > 1 && this.order[0] === last);
      this.orderPos = 0;
    }
    this.loadSong();
  },
  start(themeName) {
    if (themeName && themeName !== this.themeName) this.stop(); // สลับโหมด: รีสตาร์ทลูปให้ใช้เพลย์ลิสต์ใหม่
    if (this.playing) return;
    if (themeName) this.themeName = themeName;
    this.songs = MUSIC_THEMES[this.themeName] || MUSIC_THEMES.meteor;
    this.order = shuffle([...this.songs.keys()]);
    this.orderPos = 0;
    this.loadSong();
    const ac = this.getAC();
    this.syncDelay(); // graph เพิ่งถูกสร้างใน getAC() — ตั้งดีเลย์ให้ตรงจังหวะเพลงแรกด้วย
    this.setIntensity(this.baseIntensity); // เริ่มที่ความเข้มข้นฐานของโหมด (adaptive จะขยับต่อตามเกม)
    this.playing = true;
    this.nextTime = ac.currentTime + 0.1;
    this.timer = setInterval(() => {
      while (this.nextTime < ac.currentTime + 0.2) {
        if (this.step === 0) this.loopCount++; // นับรอบลูป (ใช้เลือกจุด fill/แครช)
        this.scheduleStep(this.step, this.nextTime);
        this.nextTime += this.stepDur;
        this.step = (this.step + 1) % this.theme.melody.length;
        if (--this.stepsLeft <= 0) this.advanceSong();
      }
      // เก็บกวาดรายการเสียงที่จบไปแล้ว (ไม่ให้ voice list โตขึ้นเรื่อยๆ)
      if (this.voices.length) this.voices = this.voices.filter((v) => v.until > ac.currentTime);
    }, 30);
  },
  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.fadeVoices(); // เลิกเล่น/สลับโหมด: ตัดหางเสียงที่ค้างอยู่ทันที ไม่ให้ทับเพลงของโหมดถัดไป
  },
};

