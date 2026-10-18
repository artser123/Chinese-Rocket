"use strict";
/* ================= Speaking practice mode (เกมฝึกพูด) ================= */
// ฝึกพูดตามประโยค SENTENCES (HSK 1-5) แล้วตรวจว่าพูดถูกไหม — จดจำเสียงด้วย
// Web Speech zh-CN + Whisper fallback เหมือนโหมดพจนานุกรม
let spk = null;
let spkRecognition = null;
let spkWRecord = null;

// ตัวจีนตัวเต็ม -> ตัวย่อ (Whisper บางครั้งถอดเสียงเป็นตัวเต็ม)
const TRAD2SIMP = {};
for (const p of ("們们 這这 個个 來来 時时 說说 學学 麼么 嗎吗 為为 會会 對对 點点 電电 話话 機机 見见 聽听 覺觉 現现 問问 題题 間间 開开 關关 門门 車车 飛飞 場场 國国 兒儿 醫医 院院 長长 髮发 發发 經经 過过 還还 進进 遠远 運运 動动 氣气 風风 雲云 鳥鸟 貓猫 魚鱼 飯饭 麵面 飲饮 書书 筆笔 紙纸 詞词 語语 課课 讀读 寫写 記记 認认 識识 習习 員员 銀银 錢钱 價价 買买 賣卖 東东 褲裤 襪袜 顏颜 紅红 藍蓝 綠绿 黃黄 歲岁 號号 幾几 樓楼 層层 裡里 後后 邊边 誰谁 樣样 謝谢 請请 沒没 係系 愛爱 歡欢 應应 該该 須须 興兴 傷伤 難难 緊紧 張张 擔担 餓饿 熱热 涼凉 陰阴 聲声 樂乐 畫画 視视 劇剧 戲戏 賽赛 遊游 騎骑 駕驾 駛驶 橋桥 圖图 館馆 誌志 報报 雜杂 貨货 廚厨 務务 護护 藥药 診诊 頭头 臉脸 腳脚 體体 腸肠 鏡镜 孫孙 爺爷 媽妈 親亲 戀恋 結结 離离 寶宝 貝贝 齡龄 漢汉 韓韩 亞亚 灣湾 邁迈 隻只 鐘钟 錄录 業业 數数 術术 藝艺 訊讯 資资 網网 頁页 郵邮 腦脑 標标 軟软 統统 線线 無无 費费 試试 帳账 碼码 種种 養养 讓让 幹干 與与 處处 條条 約约 廣广 慶庆 島岛 節节 慣惯 顧顾 蘇苏 寧宁 靜静 爭争 議议 論论 計计 較较 輕轻 輛辆 選选 鹽盐 醬酱 湯汤 餃饺 餅饼 飽饱 雞鸡 鴨鸭 豬猪 鮮鲜 蝦虾 廳厅 鍋锅 壺壶 區区 縣县 鎮镇 鄉乡 峽峡 灘滩 樹树 葉叶 實实 類类 態态 勢势 狀状 況况 質质 額额 幣币 單单 據据 證证 棟栋 廈厦 廁厕 衛卫 櫃柜 畢毕 業业").split(" ")) TRAD2SIMP[p[0]] = p[1];

// เก็บเฉพาะตัวอักษรจีน ตัดเว้นวรรคและเครื่องหมายวรรคตอนทิ้ง
function normZh(s) { return (s || "").replace(/[^一-鿿]/g, ""); }
// พินอินหนึ่งพยางค์ -> ตัวพิมพ์เล็ก ไม่มีวรรณยุกต์/เครื่องหมาย
function pyToken(t) { return normPinyin(t || "").replace(/[^a-z]/g, ""); }

// พินอินต่อตัวอักษรของประโยคเป้าหมาย: ใช้พินอินจากข้อมูลประโยคถ้าพยางค์ตรงกับตัวอักษร
// ไม่งั้น fallback เป็นตารางต่อตัวจาก VOCAB (dictPinyinIndex)
function spkTargetPinyin(s) {
  const chars = [...normZh(s[0])];
  const toks = (s[1] || "").split(/\s+/).map(pyToken).filter(Boolean);
  if (toks.length === chars.length) return toks;
  const { charPy } = dictPinyinIndex();
  return chars.map((c) => pyToken(charPy.get(c) || ""));
}

// เทียบตัวอักษรที่ได้ยินกับประโยคเป้าหมาย (Levenshtein + backtrace)
// คู่ที่พินอินเดียวกัน (ตัวหน้าต่างกันแต่ออกเสียงเหมือน เช่น 他/她/它) นับว่าถูก
function spkAlign(heard, s, targetPy) {
  const { charPy } = dictPinyinIndex();
  const pyOf = (c) => pyToken(charPy.get(c) || "");
  const a = [...normZh(heard)].map((c) => TRAD2SIMP[c] || c);
  const b = [...normZh(s[0])];
  const n = a.length, m = b.length;
  const cost = (x, j) => {
    if (x === b[j]) return 0;
    const px = pyOf(x), pb = targetPy[j];
    return px && pb && px === pb ? 0.5 : 1;
  };
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j - 1] + cost(a[i - 1], j - 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost(a[i - 1], j - 1)) {
      const c = cost(a[i - 1], j - 1);
      ops.unshift({ t: b[j - 1], h: a[i - 1], ok: c < 1, hom: c === 0.5 });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.unshift({ t: null, h: a[i - 1], ok: false });
      i--;
    } else {
      ops.unshift({ t: b[j - 1], h: null, ok: false });
      j--;
    }
  }
  return ops;
}

function spkSetStatus(t) { $("spkStatus").textContent = t; }

// หยุดการจดจำเสียงทุกอย่างของโหมดนี้ (ใช้ตอนข้าม/ออก/ซ่อนหน้าจอ)
function spkStopAll() {
  if (spkRecognition) {
    const r = spkRecognition;
    r.onresult = r.onend = r.onerror = null;
    try { r.abort(); } catch (e) {}
    spkRecognition = null;
  }
  if (spkWRecord) spkStopMicWhisper(true);
  $("spkMicBtn").classList.remove("listening");
}

function startSpeakGame(level) {
  const sPool = getSentencePool(level);
  if (!sPool || !sPool.length) return;
  currentLevel = level;
  pool = sPool;
  lastStarter = () => startSpeakGame(level);
  spk = { lives: 3, score: 0, nextTimer: null, repeat: false, current: null, targetPy: [], done: new Set() };
  stopSpeech();
  music.stop(); // ไม่เล่นเพลงพื้นหลัง — เสียงเพลงจะเข้าไมค์ตอนอัดเสียงพูด
  switchScreen($("speak"));
  updateSpkHUD();
  // ซ่อนปุ่มไมค์ถ้าไม่มีทั้ง Web Speech และ mic (Whisper)
  const SR = window.CR_OFFLINE_APP ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
  $("spkMicBtn").hidden = !SR && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  nextSpkQuestion();
}

function updateSpkHUD() {
  $("spkScore").textContent = spk.score;
  $("spkLives").textContent = quizLivesOn
    ? "❤️".repeat(Math.max(0, spk.lives)) + "🖤".repeat(Math.max(0, 3 - spk.lives))
    : "♾️ ไม่จำกัด";
  $("spkProg").textContent = progPct(spk.done.size, pool.length);
}

function nextSpkQuestion() {
  if (!spk) return;
  clearTimeout(spk.nextTimer);
  const isRetry = !!(spk.repeat && spk.current);
  spk.repeat = false;
  if (!isRetry) spk.current = pick(pool);
  spk.targetPy = spkTargetPinyin(spk.current);
  $("spkNextBtn").classList.remove("show");
  $("spkCard").classList.remove("correct", "wrong");
  $("spkZh").textContent = spk.current[0];
  $("spkPy").textContent = spk.current[1] || "";
  $("spkTh").textContent = (isRetry ? "🔁 ลองพูดอีกครั้ง: " : "") + (spk.current[2] || "");
  const hd = $("spkHeard");
  hd.classList.remove("listening");
  hd.innerHTML = "";
  spkSetStatus($("spkMicBtn").hidden
    ? "⚠️ เบราว์เซอร์นี้ไม่รองรับการจดจำเสียง — กด 🔊 ฟังแล้วพูดตามได้เอง"
    : "กด 🎤 แล้วพูดประโยคด้านบน");
  speakSentence(spk.current);
}

// แสดงผลเทียบ: ประโยคเป้าหมายเป็นสีต่อตัว (เขียว=ถูก, เขียวอ่อนขีดจุด=พินอินเดียวกัน, แดง=ผิด)
// ส่วนสิ่งที่ผู้เล่นพูดแสดงด้านล่าง เขียว=ตรง แดงขีดฆ่า=เกิน/ผิด
function spkShowResult(ops) {
  const zh = $("spkZh");
  zh.innerHTML = "";
  let oi = 0;
  const nextT = () => { while (oi < ops.length && !ops[oi].t) oi++; return ops[oi++]; };
  for (const ch of spk.current[0]) {
    if (!/[一-鿿]/.test(ch)) { zh.appendChild(document.createTextNode(ch)); continue; }
    const o = nextT();
    if (!o) { zh.appendChild(document.createTextNode(ch)); continue; }
    const span = document.createElement("span");
    span.className = o.ok ? (o.hom ? "spk-hom" : "spk-ok") : "spk-bad";
    span.textContent = o.t;
    if (o.h && o.h !== o.t) span.title = `พูดว่า ${o.h}`;
    zh.appendChild(span);
  }
  const hd = $("spkHeard");
  hd.classList.remove("listening");
  hd.innerHTML = '<div class="heard-label">คุณพูดว่า</div>';
  const line = document.createElement("div");
  for (const o of ops) {
    if (!o.h) continue;
    const span = document.createElement("span");
    span.className = o.ok ? "spk-ok" : "spk-bad";
    span.textContent = o.h;
    line.appendChild(span);
  }
  hd.appendChild(line);
}

// ถ้ากดไมค์ค้างไว้ระหว่างรอ auto-next แล้วไม่มีเสียงเข้า ให้ต่อจับเวลาใหม่ตามผลเดิม
function spkRearm() {
  if (!spk) return;
  if ($("spkCard").classList.contains("correct")) spkAdvance(false);
  else if ($("spkCard").classList.contains("wrong")) spkAdvance(true);
}

// ตั้งเวลา/ปุ่มไปต่อหลังตัดสิน — over=true เมื่อชีวิตหมด
function spkAdvance(isWrong) {
  const over = quizLivesOn && spk.lives <= 0;
  if (autoNext) {
    spk.nextTimer = setTimeout(() => {
      if (!spk) return;
      if (over) spkGameOver();
      else nextSpkQuestion();
    }, isWrong ? 4200 : 3200);
  } else {
    $("spkNextBtn").textContent = over ? "ดูผลคะแนน ▶" : isWrong ? "🔁 ลองอีกครั้ง ▶" : "ประโยคถัดไป ▶";
    $("spkNextBtn").classList.add("show");
  }
}

function spkEvaluate(heardRaw) {
  if (!spk || !spk.current) return;
  const heard = normZh(heardRaw);
  if (!heard) { spkSetStatus("🤔 ไม่ได้ยินเสียงพูด กด 🎤 แล้วลองพูดอีกครั้ง"); return; }
  const ops = spkAlign(heard, spk.current, spk.targetPy);
  const ok = ops.every((o) => o.ok);
  $("spkCard").classList.remove("correct", "wrong");
  spkShowResult(ops);
  speakSentence(spk.current); // เล่นประโยคที่ถูกต้องให้ฟังทั้งตอนถูกและผิด
  if (ok) {
    spk.score++;
    spk.done.add(spk.current[0]);
    $("spkCard").classList.add("correct");
    sfx.correct();
    confettiBurst($("speak"), 26);
    spkSetStatus("✅ พูดถูกต้อง!");
    spkAdvance(false);
  } else {
    spk.repeat = true; // พูดผิด: ให้ลองประโยคเดิมอีกครั้งหลังฟังเสียงที่ถูก
    if (quizLivesOn) spk.lives--;
    $("spkCard").classList.add("wrong");
    sfx.wrong();
    spkSetStatus("❌ ยังไม่ตรง — ตัวสีแดงคือจุดที่ผิด ฟังเสียงที่ถูกแล้วลองใหม่");
    spkAdvance(true);
  }
  updateSpkHUD();
}

function spkSkip() {
  if (!spk || !spk.current) return;
  // มีผลตัดสินแสดงอยู่แล้ว -> ข้ามทำหน้าที่เหมือนปุ่ม "ถัดไป" ไม่หักชีวิตซ้ำ
  if ($("spkCard").classList.contains("correct") || $("spkCard").classList.contains("wrong")) {
    clearTimeout(spk.nextTimer);
    if (quizLivesOn && spk.lives <= 0) spkGameOver();
    else nextSpkQuestion();
    return;
  }
  spkStopAll();
  spk.repeat = false; // ข้าม = ไปประโยคใหม่ ไม่ต้องลองซ้ำ
  if (quizLivesOn) spk.lives--;
  $("spkCard").classList.add("wrong");
  $("spkHeard").classList.remove("listening");
  $("spkHeard").innerHTML = "";
  sfx.wrong();
  speakSentence(spk.current);
  spkSetStatus("⏭ ข้ามประโยคนี้ — ฟังเสียงประโยคที่ถูกต้อง");
  updateSpkHUD();
  spkAdvance(false);
}

function spkGameOver() {
  spkStopAll();
  clearTimeout(spk && spk.nextTimer);
  const finalScore = spk ? spk.score : 0;
  spk = null;
  stopSpeech();
  sfx.over();
  showGameOver("🎤 จบเกม!", finalScore,
    `${levelDisplayName(currentLevel)} • เกมฝึกพูด`,
    `cr_best_${catPrefix()}${currentLevel}_speak`);
}

function spkStartMic() {
  const SR = window.CR_OFFLINE_APP ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
  const micBtn = $("spkMicBtn");
  if (spkRecognition) { spkRecognition.stop(); return; }
  if (spkWRecord) { spkStopMicWhisper(); return; }
  if (!spk || !spk.current) return;
  // มีผลตัดสินค้างอยู่: ถูกแล้วกดพูด = ไปข้อถัดไป / ผิดแล้วกดพูด = ขอลองใหม่ทันที
  const card = $("spkCard");
  if (card.classList.contains("correct")) {
    clearTimeout(spk.nextTimer);
    if (quizLivesOn && spk.lives <= 0) spkGameOver();
    else nextSpkQuestion();
    return;
  }
  clearTimeout(spk.nextTimer);
  $("spkNextBtn").classList.remove("show");
  if (card.classList.contains("wrong")) {
    card.classList.remove("wrong");
    $("spkZh").textContent = spk.current[0];
    $("spkHeard").innerHTML = "";
  }
  if (!SR) {
    if (dictMicEngine === "google") {
      spkSetStatus("🌐 เบราว์เซอร์นี้ไม่มี Google Speech — สลับ engine ได้ที่หน้าพจนานุกรม");
      spkRearm();
      return;
    }
    spkStartMicWhisper();
    return;
  }
  if (dictMicEngine === "whisper") { spkStartMicWhisper(); return; }

  const rec = new SR();
  spkRecognition = rec;
  rec.lang = "zh-CN";
  rec.continuous = false;
  rec.interimResults = true;

  let finalText = "";
  // ถ้า service เงียบไป (เน็ตบล็อก) ให้สลับไปใช้ Whisper ในเครื่องเหมือนโหมดพจนานุกรม
  const stallTimer = setTimeout(() => {
    if (spkRecognition === rec && !finalText) {
      try { rec.abort(); } catch (e) {}
      spkRecognition = null;
      if (dictMicEngine === "google") {
        micBtn.classList.remove("listening");
        spkSetStatus("🌐 Google Speech ไม่ตอบสนอง — สลับเป็น 🤖 Whisper ได้ที่หน้าพจนานุกรม");
        spkRearm();
      } else spkStartMicWhisper();
    }
  }, 7000);
  const stopUi = () => {
    clearTimeout(stallTimer);
    spkRecognition = null;
    micBtn.classList.remove("listening");
  };

  rec.onresult = (e) => {
    clearTimeout(stallTimer);
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    const hd = $("spkHeard");
    hd.classList.add("listening");
    hd.innerHTML = '<div class="heard-label">กำลังฟัง…</div><div></div>';
    hd.lastChild.textContent = (finalText + interim).trim();
  };
  rec.onend = () => {
    const heard = finalText.trim();
    const hadError = rec.__errored;
    stopUi();
    if (heard) spkEvaluate(heard);
    else if (!hadError) {
      spkSetStatus("🤔 ไม่ได้ยินเสียงพูด ลองกด 🎤 แล้วพูดภาษาจีนอีกครั้ง");
      spkRearm();
    }
  };
  rec.onerror = (e) => {
    rec.__errored = true;
    stopUi();
    // Google speech service unreachable -> on-device Whisper
    if (e.error === "network") {
      if (dictMicEngine === "google") {
        spkSetStatus("🌐 เชื่อม Google Speech ไม่ได้ — สลับเป็น 🤖 Whisper ได้ที่หน้าพจนานุกรม");
        spkRearm();
      } else spkStartMicWhisper();
      return;
    }
    const msgs = {
      "not-allowed": "🚫 เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน — กดอนุญาตไมค์ที่แถบที่อยู่แล้วลองใหม่",
      "service-not-allowed": "🚫 เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน",
      "no-speech": "🤔 ไม่ได้ยินเสียงพูด ลองกด 🎤 แล้วพูดอีกครั้ง",
      "audio-capture": "🎙️ ไม่พบไมโครโฟนในเครื่องนี้",
    };
    if (e.error !== "aborted") {
      spkSetStatus(msgs[e.error] || "⚠️ จดจำเสียงผิดพลาด ลองใหม่อีกครั้ง");
      spkRearm();
    }
  };

  micBtn.classList.add("listening");
  const hd = $("spkHeard");
  hd.classList.add("listening");
  hd.innerHTML = '<div class="heard-label">🎤 กำลังฟัง… พูดประโยคภาษาจีนได้เลย</div>';
  spkSetStatus("พูดประโยคด้านบนให้ชัดๆ");
  try { rec.start(); } catch (err) { stopUi(); }
}

// Whisper on-device fallback — ใช้โมเดลเดียวกับโหมดพจนานุกรม (loadDictWhisper)
async function spkStartMicWhisper() {
  const micBtn = $("spkMicBtn");
  if (spkWRecord) { spkStopMicWhisper(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    spkSetStatus("🚫 เบราว์เซอร์นี้ไม่รองรับการจดจำเสียง");
    return;
  }
  micBtn.classList.add("listening");
  spkSetStatus("⏳ กำลังโหลดโมเดลจดจำเสียงในเครื่อง (ครั้งแรก ~40MB)...");
  let lastShown = 0;
  let asr;
  try {
    asr = await Promise.race([
      loadDictWhisper((p) => {
        if (p.status === "progress" && p.total && Date.now() - lastShown > 150) {
          lastShown = Date.now();
          const mb = (p.loaded / 1048576).toFixed(1) + "/" + (p.total / 1048576).toFixed(1) + "MB";
          spkSetStatus(`⏳ กำลังโหลดโมเดลเสียง ${Math.round(p.loaded / p.total * 100)}% (${mb})`);
        } else if (p.status === "initiate") {
          spkSetStatus("⏳ เริ่มโหลดโมเดลเสียง...");
        }
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 120000)),
    ]);
  } catch (e) {
    micBtn.classList.remove("listening");
    spkSetStatus("โหลดโมเดลเสียงไม่สำเร็จ (ช้าหรือขาดกลางคัน) ตรวจสอบอินเทอร์เน็ตแล้วกด 🎤 ลองใหม่");
    return;
  }
  if (!spk) { micBtn.classList.remove("listening"); return; }
  spkSetStatus("✅ โมเดลพร้อมแล้ว กำลังเปิดไมโครโฟน...");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) {
    micBtn.classList.remove("listening");
    spkSetStatus("🚫 เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน");
    return;
  }
  if (!spk) { stream.getTracks().forEach((t) => t.stop()); micBtn.classList.remove("listening"); return; }
  const ac = AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
  if (ac.state === "suspended") ac.resume();
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const gain = ac.createGain(); // silence tap
  gain.gain.value = 0;
  const chunks = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc); proc.connect(gain); gain.connect(ac.destination);
  spkWRecord = { stream, src, proc, gain, chunks, asr, rate: ac.sampleRate,
    timer: setTimeout(() => spkStopMicWhisper(), 12000) };
  const hd = $("spkHeard");
  hd.classList.add("listening");
  hd.innerHTML = '<div class="heard-label">🎤 กำลังฟัง (โมเดลในเครื่อง)… พูดแล้วกด 🎤 อีกครั้งเพื่อตรวจ</div>';
  spkSetStatus("พูดประโยคด้านบนให้ชัดๆ แล้วกด 🎤 เพื่อตรวจ (หยุดเองใน 12 วิ)");
}

async function spkStopMicWhisper(cancel) {
  const r = spkWRecord; spkWRecord = null;
  if (!r) return;
  clearTimeout(r.timer);
  try { r.proc.disconnect(); r.src.disconnect(); r.gain.disconnect(); } catch (e) {}
  r.stream.getTracks().forEach((t) => t.stop());
  $("spkMicBtn").classList.remove("listening");
  $("spkHeard").classList.remove("listening");
  if (cancel) return;
  const total = r.chunks.reduce((n, c) => n + c.length, 0);
  if (total < r.rate * 0.3) {
    spkSetStatus("🤔 เสียงสั้นเกินไป กด 🎤 แล้วพูดอีกครั้ง");
    spkRearm();
    return;
  }
  const audio = new Float32Array(total);
  let o = 0;
  for (const c of r.chunks) { audio.set(c, o); o += c.length; }
  spkSetStatus("⏳ กำลังถอดเสียงเป็นข้อความ...");
  try {
    const out = await r.asr(dictResample16k(audio, r.rate), { language: "chinese", task: "transcribe" });
    const text = (out && out.text ? out.text : "").trim();
    if (text) spkEvaluate(text);
    else { spkSetStatus("🤔 ไม่ได้ยินชัด กด 🎤 แล้วพูดอีกครั้ง"); spkRearm(); }
  } catch (e) {
    spkSetStatus("ถอดเสียงไม่สำเร็จ ลองใหม่อีกครั้ง");
    spkRearm();
  }
}

$("spkListenBtn").addEventListener("click", () => {
  sfx.click();
  if (spk && spk.current) speakSentence(spk.current);
});
$("spkMicBtn").addEventListener("click", () => { sfx.click(); spkStartMic(); });
$("spkSkipBtn").addEventListener("click", () => { sfx.click(); spkSkip(); });
$("spkNextBtn").addEventListener("click", () => {
  sfx.click();
  $("spkNextBtn").classList.remove("show");
  if (!spk) return;
  if (quizLivesOn && spk.lives <= 0) spkGameOver();
  else nextSpkQuestion();
});
$("spkMuteBtn").addEventListener("click", toggleMute);
$("spkQuitBtn").addEventListener("click", () => {
  sfx.click();
  saveBest(`cr_best_${catPrefix()}${currentLevel}_speak`, spk ? spk.score : 0);
  spkStopAll();
  clearTimeout(spk && spk.nextTimer);
  spk = null;
  stopSpeech();
  switchScreen(menuEl);
  updateBestLine();
});

