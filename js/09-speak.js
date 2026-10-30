"use strict";
/* ================= Speaking practice mode (เกมฝึกพูด) ================= */
// ฝึกพูดตามประโยค SENTENCES (HSK 1-5) แล้วตรวจว่าพูดถูกไหม — จดจำเสียงด้วย
// Web Speech zh-CN + Whisper fallback เหมือนโหมดพจนานุกรม
let spk = null;
let spkRecognition = null;
let spkWRecord = null;
let spkNativeActive = false;
let spkNativeRequestId = null;
let spkNativeSeq = 0;
let spkNativeListenersReady = null;

function spkNativePlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeSpeech;
}

function spkEnsureNativeListeners() {
  const native = spkNativePlugin();
  if (!native) return Promise.resolve(false);
  if (!spkNativeListenersReady) {
    spkNativeListenersReady = Promise.all([
      native.addListener("partial", ({ requestId, text }) => {
        if (!spk || requestId !== spkNativeRequestId || !text) return;
        const heard = $("spkHeard");
        heard.classList.add("listening");
        heard.innerHTML = '<div class="heard-label">กำลังฟัง…</div><div></div>';
        heard.lastChild.textContent = text;
      }),
      native.addListener("result", ({ requestId, text }) => {
        if (!spk || requestId !== spkNativeRequestId) return;
        spkNativeRequestId = null;
        spkNativeActive = false;
        $("spkMicBtn").classList.remove("listening");
        $("spkHeard").classList.remove("listening");
        if (text) spkEvaluate(text);
        else {
          spkSetStatus("🤔 ไม่ได้ยินเสียงพูด ลองกด 🎤 แล้วพูดภาษาจีนอีกครั้ง");
          spkRearm();
        }
      }),
      native.addListener("error", ({ requestId, code }) => {
        if (!spk || requestId !== spkNativeRequestId) return;
        spkNativeRequestId = null;
        spkNativeActive = false;
        $("spkMicBtn").classList.remove("listening");
        $("spkHeard").classList.remove("listening");
        if (code === "NO_MATCH" || code === "NO_SPEECH") {
          spkSetStatus("🤔 ไม่ได้ยินเสียงพูด ลองพูดอีกครั้ง");
          spkRearm();
        } else if (code === "CANCELLED") {
          spkSetStatus("ยกเลิกการรู้จำเสียงแล้ว — กด 🎤 เมื่อต้องการลองอีกครั้ง");
          spkRearm();
        } else if (code === "PERMISSION_DENIED") {
          spkSetStatus("🚫 ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน");
          spkRearm();
        } else {
          // Unsupported Chinese offline pack/service -> use the Whisper model bundled in the APK.
          spkSetStatus("ระบบเสียงออฟไลน์ของ Android ใช้ไม่ได้ — กำลังเปลี่ยนไปใช้ Whisper ในแอป…");
          spkStartMicWhisper();
        }
      }),
    ]).then(() => true).catch(() => false);
  }
  return spkNativeListenersReady;
}

async function spkStartMicNative() {
  const native = spkNativePlugin();
  if (!native) { spkStartMicWhisper(); return; }
  const micBtn = $("spkMicBtn");
  const requestId = String(++spkNativeSeq);
  spkNativeRequestId = requestId;
  spkNativeActive = true;
  micBtn.classList.add("listening");
  $("spkHeard").classList.add("listening");
  $("spkHeard").innerHTML = '<div class="heard-label">🎤 กำลังฟังด้วยระบบเสียงออฟไลน์ของ Android…</div>';
  spkSetStatus("กำลังใช้ระบบรู้จำเสียงออนไลน์ของ Android/Google — พูดประโยคได้เลย (เสียงจะถูกส่งไปถอดข้อความ)");
  try {
    if (!await spkEnsureNativeListeners()) throw new Error("native speech listener unavailable");
    if (!spk || spkNativeRequestId !== requestId) return;
    const availability = await native.isAvailable();
    if (!spk || spkNativeRequestId !== requestId) return;
    if (!availability || !availability.available) throw new Error("on-device recognition unavailable");
    await native.startListening({ language: "zh-CN", requestId, online: true });
    if (!spk || spkNativeRequestId !== requestId) native.cancelListening().catch(() => {});
  } catch (error) {
    if (spkNativeRequestId !== requestId) return;
    spkNativeRequestId = null;
    spkNativeActive = false;
    micBtn.classList.remove("listening");
    $("spkHeard").classList.remove("listening");
    if (error && error.code === "PERMISSION_DENIED") {
      spkSetStatus("🚫 ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน");
      spkRearm();
      return;
    }
    spkSetStatus("ระบบเสียงออฟไลน์ของ Android ใช้ไม่ได้ — กำลังเปลี่ยนไปใช้ Whisper ในแอป…");
    spkStartMicWhisper();
  }
}

function spkStopNativeMic() {
  const native = spkNativePlugin();
  if (!native || !spkNativeActive) return;
  spkSetStatus("กำลังประมวลผลเสียง…");
  native.stopListening().catch(() => {
    if (spkNativeRequestId) {
      spkNativeRequestId = null;
      spkNativeActive = false;
      $("spkMicBtn").classList.remove("listening");
      spkStartMicWhisper();
    }
  });
}

// ตัวจีนตัวเต็ม -> ตัวย่อ (Whisper บางครั้งถอดเสียงเป็นตัวเต็ม)
const TRAD2SIMP = {};
for (const p of ("們们 這这 個个 來来 時时 說说 學学 麼么 嗎吗 為为 會会 對对 點点 電电 話话 機机 見见 聽听 覺觉 現现 問问 題题 間间 開开 關关 門门 車车 飛飞 場场 國国 兒儿 醫医 院院 長长 髮发 發发 經经 過过 還还 進进 遠远 運运 動动 氣气 風风 雲云 鳥鸟 貓猫 魚鱼 飯饭 麵面 飲饮 書书 筆笔 紙纸 詞词 語语 課课 讀读 寫写 記记 認认 識识 習习 員员 銀银 錢钱 價价 買买 賣卖 東东 褲裤 襪袜 顏颜 紅红 藍蓝 綠绿 黃黄 歲岁 號号 幾几 樓楼 層层 裡里 後后 邊边 誰谁 樣样 謝谢 請请 沒没 係系 愛爱 歡欢 應应 該该 須须 興兴 傷伤 難难 緊紧 張张 擔担 餓饿 熱热 涼凉 陰阴 聲声 樂乐 畫画 視视 劇剧 戲戏 賽赛 遊游 騎骑 駕驾 駛驶 橋桥 圖图 館馆 誌志 報报 雜杂 貨货 廚厨 務务 護护 藥药 診诊 頭头 臉脸 腳脚 體体 腸肠 鏡镜 孫孙 爺爷 媽妈 親亲 戀恋 結结 離离 寶宝 貝贝 齡龄 漢汉 韓韩 亞亚 灣湾 邁迈 隻只 鐘钟 錄录 業业 數数 術术 藝艺 訊讯 資资 網网 頁页 郵邮 腦脑 標标 軟软 統统 線线 無无 費费 試试 帳账 碼码 種种 養养 讓让 幹干 與与 處处 條条 約约 廣广 慶庆 島岛 節节 慣惯 顧顾 蘇苏 寧宁 靜静 爭争 議议 論论 計计 較较 輕轻 輛辆 選选 鹽盐 醬酱 湯汤 餃饺 餅饼 飽饱 雞鸡 鴨鸭 豬猪 鮮鲜 蝦虾 廳厅 鍋锅 壺壶 區区 縣县 鎮镇 鄉乡 峽峡 灘滩 樹树 葉叶 實实 類类 態态 勢势 狀状 況况 質质 額额 幣币 單单 據据 證证 棟栋 廈厦 廁厕 衛卫 櫃柜 畢毕 業业").split(" ")) TRAD2SIMP[p[0]] = p[1];

// เก็บเฉพาะตัวอักษรจีน (+ 〇 และเลขอารบิก — ตัวเลขเป็น "ตัวอักษร" ที่ต้องพูดด้วย) ตัดเว้นวรรค/วรรคตอนทิ้ง
// เดิมตัดเลขอารบิกทิ้ง: ระบบถอดเสียงได้ "3个" จะเหลือแค่ "个" แล้วถูกนับว่าพูดผิด
const SPK_CHAR_RE = /[一-鿿〇0-9]/;
function normZh(s) {
  return (s || "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/[^一-鿿〇0-9]/g, "");
}
// พินอินหนึ่งพยางค์ -> ตัวพิมพ์เล็ก ไม่มีวรรณยุกต์/เครื่องหมาย
function pyToken(t) { return normPinyin(t || "").replace(/[^a-z]/g, ""); }

/* ---------- ตัวเลข: อารบิก ↔ ตัวเลขจีน ----------
   ตัวอักษรตัวเดียว: เลขอารบิก 1 หลัก = ตัวเลขจีนหลักนั้น, 〇 = 零 (spkCanon)
   ทั้งก้อน: ระบบถอดเสียงมักให้ "25" / "3:30" / "50%" ทั้งที่ประโยคเขียน 二十五 / 三点半 / 百分之五十
   → spkHeardVariants สร้างคำอ่านจีนหลายแบบของแต่ละก้อนเลข แล้ว spkEvaluate เลือกแบบที่ตรงประโยคที่สุด */
const ZH_DIGITS = "零一二三四五六七八九";
function spkCanon(c) {
  if (c >= "0" && c <= "9") return ZH_DIGITS[+c];
  if (c === "〇") return "零";
  return TRAD2SIMP[c] || c;
}
function zhInt(n) {
  if (n === 0) return "零";
  if (!(n > 0 && n < 1e8)) return null;
  const four = (x) => {
    const ds = [Math.floor(x / 1000) % 10, Math.floor(x / 100) % 10, Math.floor(x / 10) % 10, x % 10];
    const units = ["千", "百", "十", ""];
    let s = "", gap = false;
    ds.forEach((d, i) => {
      if (!d) { if (s) gap = true; return; }
      if (gap) { s += "零"; gap = false; }
      s += ZH_DIGITS[d] + units[i];
    });
    return s;
  };
  const wan = Math.floor(n / 1e4), rest = n % 1e4;
  let s = wan ? four(wan) + "万" : "";
  if (rest) s += (wan && rest < 1000 ? "零" : "") + four(rest);
  return s.replace(/^一十/, "十"); // 10–19 พูดว่า 十X ไม่ใช่ 一十X
}
const zhDigitByDigit = (str) => [...str].map((d) => ZH_DIGITS[+d]).join("");
// คำอ่านจีนที่เป็นไปได้ของตัวเลขหนึ่งก้อน (เรียงจากที่พบบ่อย)
function spkNumberReadings(m, intStr, minStr, decStr, pct) {
  const out = new Set();
  const n = parseInt(intStr, 10);
  const card = zhInt(n);
  if (minStr != null) { // เวลา 3:30
    const mm = parseInt(minStr, 10);
    const h = card + "点";
    if (mm === 0) { out.add(h); out.add(h + "整"); }
    else {
      if (mm === 30) out.add(h + "半");
      if (mm === 15) out.add(h + "一刻");
      if (mm === 45) out.add(h + "三刻");
      const ms = (mm < 10 ? "零" : "") + zhInt(mm);
      out.add(h + ms + "分"); out.add(h + ms);
    }
  } else if (pct) {
    out.add("百分之" + card + (decStr ? "点" + zhDigitByDigit(decStr) : ""));
  } else if (decStr) {
    out.add(card + "点" + zhDigitByDigit(decStr));
  } else {
    if (card) out.add(card);
    if (intStr.length >= 3 || /^0/.test(intStr)) out.add(zhDigitByDigit(intStr)); // ปี / เบอร์ / ห้อง / สายรถเมล์
    // 2 = 两 เวลานับจำนวน (两个, 两百, 两千, 两万)
    if (card && /^二(百|千|万|$)/.test(card)) out.add(card.replace(/^二/, "两"));
    out.add(m); // คงเลขอารบิกไว้ — ประโยคที่เขียนเป็นเลขอารบิก (เช่น 302路) จะเทียบได้ตรง
  }
  return [...out].filter(Boolean);
}
// ประโยคที่ได้ยินในหลายรูปแบบตามคำอ่านของก้อนตัวเลข (จำกัดจำนวนชุดค่าผสมไม่ให้ช้า)
function spkHeardVariants(heardRaw) {
  const raw = (heardRaw || "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/：/g, ":");
  const re = /(\d+)(?::(\d{2}))?(?:\.(\d+))?\s*(%|％)?/g;
  const parts = [], slots = [];
  let last = 0, mt;
  while ((mt = re.exec(raw))) {
    parts.push(raw.slice(last, mt.index));
    slots.push(slots.length < 4 ? spkNumberReadings(mt[0].trim(), mt[1], mt[2], mt[3], !!mt[4]) : [mt[0]]);
    parts.push(null);
    last = re.lastIndex;
  }
  parts.push(raw.slice(last));
  if (!slots.length) return [raw];
  let combos = [[]];
  for (const opts of slots) combos = combos.flatMap((c) => opts.map((o) => c.concat(o))).slice(0, 96);
  return combos.map((c) => { let k = 0; return parts.map((p) => (p === null ? c[k++] : p)).join(""); });
}

/* ---------- ความเข้มการตรวจ (เลือกในหน้าตั้งค่า, จำไว้ใน localStorage) ----------
   easy/normal: ผ่านเมื่อคะแนนความตรง ≥ เกณฑ์ และนับเสียงที่คนไทยมักสับสน (zh/z ch/c sh/s n/l -ng/-n) ว่าถูก
   strict: แบบเดิม — ทุกตัวต้องถูก (ยอมแค่คำพ้องเสียงที่พินอินเดียวกัน เช่น 他/她) */
const SPK_STRICT = {
  easy:   { pass: 0.65, fuzzy: true,  label: "ผ่อนปรน" },
  normal: { pass: 0.8,  fuzzy: true,  label: "ปกติ" },
  strict: { pass: 1,    fuzzy: false, label: "เข้ม" },
};
let spkStrict = SPK_STRICT[localStorage.getItem("cr_speak_strict")] ? localStorage.getItem("cr_speak_strict") : "normal";
const pyFuzzy = (p) => p.replace(/^([zcs])h/, "$1").replace(/^n(?=[aeiouv])/, "l").replace(/ng$/, "n");

// พินอินต่อตัวอักษรของประโยคเป้าหมาย: ใช้พินอินจากข้อมูลประโยคถ้าพยางค์ตรงกับตัวอักษร
// ไม่งั้น fallback เป็นตารางต่อตัวจาก VOCAB (dictPinyinIndex) — ตัวเลขใช้พินอินของตัวเลขจีน
function spkTargetPinyin(s) {
  const chars = [...normZh(s[0])];
  const toks = (s[1] || "").split(/\s+/).map(pyToken).filter(Boolean);
  if (toks.length === chars.length) return toks;
  const { charPy } = dictPinyinIndex();
  return chars.map((c) => pyToken(charPy.get(spkCanon(c)) || ""));
}

// เทียบตัวอักษรที่ได้ยินกับประโยคเป้าหมาย (Levenshtein + backtrace)
// คู่ที่พินอินเดียวกัน (ตัวหน้าต่างกันแต่ออกเสียงเหมือน เช่น 他/她/它) นับว่าถูก
// โหมดไม่เข้ม: พินอินใกล้เคียง (pyFuzzy) ก็นับว่าถูก ต้นทุนสูงกว่าเล็กน้อย
function spkAlign(heard, s, targetPy) {
  const { charPy } = dictPinyinIndex();
  const fuzzy = SPK_STRICT[spkStrict].fuzzy;
  const pyOf = (c) => pyToken(charPy.get(c) || "");
  const a = [...normZh(heard)].map(spkCanon);
  const bRaw = [...normZh(s[0])];
  const b = bRaw.map(spkCanon);
  const n = a.length, m = b.length;
  const cost = (x, j) => {
    if (x === b[j]) return 0;
    if ((x === "二" && b[j] === "两") || (x === "两" && b[j] === "二")) return 0.5;
    const px = pyOf(x), pb = targetPy[j];
    if (px && pb && px === pb) return 0.5;
    if (fuzzy && px && pb && pyFuzzy(px) === pyFuzzy(pb)) return 0.75;
    return 1;
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
      ops.unshift({ t: bRaw[j - 1], h: a[i - 1], ok: c < 1, hom: c > 0 && c < 1 });
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
  const native = spkNativePlugin();
  if (native && spkNativeRequestId) native.cancelListening().catch(() => {});
  spkNativeRequestId = null;
  spkNativeActive = false;
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
  if (window.CR_OFFLINE_APP) spkEnsureNativeListeners();
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
  spkCancelAdvance();
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
    if (!SPK_CHAR_RE.test(ch)) { zh.appendChild(document.createTextNode(ch)); continue; }
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

// ยกเลิกการไปต่อที่ค้างอยู่ทั้งหมด (ตัวตั้งเวลา + รอเสียงเฉลยจบ) — เรียกทุกครั้งที่ผู้เล่นทำอะไรเอง
function spkCancelAdvance() {
  if (!spk) return;
  clearTimeout(spk.nextTimer);
  clearTimeout(spk.audioGuard);
  spk.afterAnswerAudio = null;
}

// เล่นประโยคที่ถูกต้องหลังตัดสิน แล้วค่อยไปต่อ "หลังเสียงจบ"
// เดิมตั้งเวลาตายตัว 3.2/4.2 วินาทีนับจากเริ่มเล่น ประโยคยาวจึงโดนตัดกลางคันแล้วข้ามข้อไปเลย
// • wordAudio.play ไม่เรียก onDone ถ้าเสียงถูกขัด → ปุ่ม 🔊 ฟังซ้ำส่ง callback เดิมต่อ (afterAnswerAudio)
//   และมี audioGuard สำรองกันค้าง • โหมดกดเองแสดงปุ่ม "ถัดไป" ทันทีเหมือนเดิม
function spkPlayAnswerThenAdvance(isWrong) {
  const cur = spk;
  spkCancelAdvance();
  if (!autoNext) {
    speakSentence(cur.current);
    spkAdvance(isWrong);
    return;
  }
  const go = () => {
    if (spk !== cur || cur.afterAnswerAudio !== go) return;
    spkCancelAdvance();
    spkAdvance(isWrong);
  };
  cur.afterAnswerAudio = go;
  speakSentence(cur.current, false, go);
  cur.audioGuard = setTimeout(go, 30000);
}

// ตั้งเวลา/ปุ่มไปต่อหลังตัดสิน — over=true เมื่อชีวิตหมด (โหมดอัตโนมัติ: เรียกหลังเสียงเฉลยจบแล้ว)
function spkAdvance(isWrong) {
  const over = quizLivesOn && spk.lives <= 0;
  if (autoNext) {
    spk.nextTimer = setTimeout(() => {
      if (!spk) return;
      if (over) spkGameOver();
      else nextSpkQuestion();
    }, isWrong ? 1500 : 900);
  } else {
    $("spkNextBtn").textContent = over ? "ดูผลคะแนน ▶" : isWrong ? "🔁 ลองอีกครั้ง ▶" : "ประโยคถัดไป ▶";
    $("spkNextBtn").classList.add("show");
  }
}

// คะแนนความตรง 0–1: ตัวในประโยคที่พูดถูก ÷ (ความยาวประโยค + ครึ่งหนึ่งของตัวที่พูดเกินมา)
function spkScore(ops) {
  let target = 0, good = 0, extra = 0;
  for (const o of ops) {
    if (o.t) { target++; if (o.ok) good++; }
    else extra++;
  }
  return target ? good / (target + extra * 0.5) : 0;
}

function spkEvaluate(heardRaw) {
  if (!spk || !spk.current) return;
  if (!normZh(heardRaw)) { spkSetStatus("🤔 ไม่ได้ยินเสียงพูด กด 🎤 แล้วลองพูดอีกครั้ง"); return; }
  // ตัวเลขที่ถอดเสียงเป็นเลขอารบิกมีหลายคำอ่าน → ลองทุกแบบแล้วใช้แบบที่ตรงประโยคที่สุด
  let ops = null, score = -1;
  for (const v of spkHeardVariants(heardRaw)) {
    if (!normZh(v)) continue;
    const o = spkAlign(v, spk.current, spk.targetPy), sc = spkScore(o);
    if (sc > score) { ops = o; score = sc; }
  }
  const rule = SPK_STRICT[spkStrict];
  const ok = rule.pass >= 1 ? ops.every((o) => o.ok) : score >= rule.pass;
  const pct = Math.round(score * 100);
  $("spkCard").classList.remove("correct", "wrong");
  spkShowResult(ops);
  if (ok) {
    spk.score++;
    spk.done.add(spk.current[0]);
    $("spkCard").classList.add("correct");
    sfx.correct();
    confettiBurst($("speak"), 26);
    spkSetStatus(pct >= 100 || ops.every((o) => o.ok) ? "✅ พูดถูกต้อง!" : `✅ ผ่าน! ตรง ${pct}% — ตัวสีแดงคือจุดที่ยังพูดไม่ชัด`);
    spkPlayAnswerThenAdvance(false); // เล่นประโยคที่ถูกต้องให้ฟังทั้งตอนถูกและผิด
  } else {
    spk.repeat = true; // พูดผิด: ให้ลองประโยคเดิมอีกครั้งหลังฟังเสียงที่ถูก
    if (quizLivesOn) spk.lives--;
    $("spkCard").classList.add("wrong");
    sfx.wrong();
    spkSetStatus(rule.pass >= 1
      ? "❌ ยังไม่ตรง — ตัวสีแดงคือจุดที่ผิด ฟังเสียงที่ถูกแล้วลองใหม่"
      : `❌ ตรง ${pct}% (ต้อง ${Math.round(rule.pass * 100)}%) — ตัวสีแดงคือจุดที่ผิด ฟังเสียงที่ถูกแล้วลองใหม่`);
    spkPlayAnswerThenAdvance(true);
  }
  updateSpkHUD();
}

function spkSkip() {
  if (!spk || !spk.current) return;
  // มีผลตัดสินแสดงอยู่แล้ว -> ข้ามทำหน้าที่เหมือนปุ่ม "ถัดไป" ไม่หักชีวิตซ้ำ
  if ($("spkCard").classList.contains("correct") || $("spkCard").classList.contains("wrong")) {
    spkCancelAdvance();
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
  spkSetStatus("⏭ ข้ามประโยคนี้ — ฟังเสียงประโยคที่ถูกต้อง");
  updateSpkHUD();
  spkPlayAnswerThenAdvance(false);
}

function spkGameOver() {
  spkStopAll();
  spkCancelAdvance();
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
  if (spkNativeActive) { spkStopNativeMic(); return; }
  if (!spk || !spk.current) return;
  // มีผลตัดสินค้างอยู่: ถูกแล้วกดพูด = ไปข้อถัดไป / ผิดแล้วกดพูด = ขอลองใหม่ทันที
  const card = $("spkCard");
  if (card.classList.contains("correct")) {
    spkCancelAdvance();
    if (quizLivesOn && spk.lives <= 0) spkGameOver();
    else nextSpkQuestion();
    return;
  }
  spkCancelAdvance();
  $("spkNextBtn").classList.remove("show");
  if (card.classList.contains("wrong")) {
    card.classList.remove("wrong");
    $("spkZh").textContent = spk.current[0];
    $("spkHeard").innerHTML = "";
  }
  // The APK uses Android's local recognition service first; browser/PWA behavior is unchanged.
  if (window.CR_OFFLINE_APP) {
    spkStartMicNative();
    return;
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
  // ระหว่างรอเสียงเฉลยจบ: ฟังซ้ำแล้วค่อยไปต่อหลังเสียงรอบนี้จบ
  if (spk && spk.current) speakSentence(spk.current, false, spk.afterAnswerAudio || undefined);
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
  spkCancelAdvance();
  spk = null;
  stopSpeech();
  exitToSetup("speak");
  updateBestLine();
});

