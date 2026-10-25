"use strict";

/* ================= State & DOM ================= */
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const menuEl = $("menu"), gameEl = $("game"), overEl = $("gameover");
const rocketBar = $("rocketBar");
const optBtns = Array.from(rocketBar.querySelectorAll(".rocket-opt"));

let W = 0, H = 0, DPR = 1;
let running = false, paused = false;
let meteors = [], missiles = [], particles = [], stars = [], rings = [], floaters = [];
let shakeT = 0;
let options = [];              // 4 words on rocket buttons
let lives = 3, score = 0, destroyed = 0, combo = 0;
let spawnTimer = 0, nextSpawn = 2.2;
let pool = [];                 // vocab pool for selected level
let currentLevel = null;
let stunUntil = 0;
let lastTime = 0;
let difficulty = "medium";
let gameMode = null;        // 'meteor' | 'vocab'
let quizMode = "pinyin";    // 'pinyin' | 'thai'
let quizLivesOn = true;     // พลังชีวิต: 3 ชีวิต หรือไม่จำกัด
let autoNext = true;        // เปลี่ยนคำถัดไปอัตโนมัติเมื่อตอบถูก
let quiz = null;
let sent = null;            // sentence-ordering game state
let sentQuiz = null;        // sentence translation multiple-choice quiz state
let sentQuizDirection = localStorage.getItem("cr_sentence_quiz_direction") === "th" ? "th" : "zh"; // 'zh' = Chinese prompt, 'th' = Thai prompt
let sentQuizShowPinyin = localStorage.getItem("cr_sentence_quiz_pinyin") === "on";
let fill = null;            // fill-in-the-blank game state
let zb = null;              // zombie shooter game state
let lis = null;             // listening practice state
const lisMediaAudio = new Audio(); // Native media playback can continue while the screen is locked
lisMediaAudio.preload = "none";
lisMediaAudio.setAttribute("playsinline", "");
lisMediaAudio.setAttribute("aria-hidden", "true");
lisMediaAudio.tabIndex = -1;
// Keep the native player attached to the document. Some browsers report play()
// as successful for a detached Audio object but never advance currentTime/fire ended.
lisMediaAudio.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
document.body.appendChild(lisMediaAudio);
let lisMediaSeq = 0;
let lisMediaWatchTimer = null;
// Native playback is used in listen mode so it survives screen lock. Skip the
// padding silence that WebAudio's audioBounds() already trims in other modes.
const LIS_EDGE_TTS_TRIM = { trimStart: 0.18, trimEnd: 0.62 };
const LIS_SENTENCE_ZH_TRIM = { trimStart: 0.18, trimEnd: 0 };
const LIS_VOICECLONE_TRIM = { trimStart: 0.18, trimEnd: 0.08 };
let cp = null;              // sentence copying practice state
let lisType = "word";       // 'word' | 'sent' — ฟังเป็นคำหรือประโยค
let lisGap = 1.2;           // วินาที — ช่วงห่างก่อนเปลี่ยนคำ/ประโยคถัดไป
let zDuration = 120;        // เวลาเล่นเกมยิงซอมบี้ (วินาที), 0 = ไม่จำกัดเวลา
const zDurLabel = () => zDuration ? `${zDuration} วิ` : "ไม่จำกัดเวลา";
let lastStarter = null;
let metDone = new Set();    // meteor: คำที่ยิงโดนสำเร็จในเซสชันนี้ (สำหรับแถบ % ความก้าวหน้า)
const SENT_OK = typeof SENTENCES !== "undefined";
// merge ประโยคเพิ่มเติมที่เขียนโดย LLM เข้ากับฐานประโยคหลัก — แยกไฟล์ไว้เพื่อให้
// re-generate sentences.js จาก xlsx ได้โดยไม่ลบประโยคพวกนี้ทิ้ง
if (SENT_OK && typeof SENTENCES_EXTRA !== "undefined") {
  for (const lvl in SENTENCES_EXTRA) {
    SENTENCES[lvl] = (SENTENCES[lvl] || []).concat(SENTENCES_EXTRA[lvl]);
  }
}
// merge ประโยคไวยากรณ์ HSK 6 + 7-9 (จาก 考试大纲 3.0) — สร้างระดับ 6/7-9 ให้โหมดประโยค
// ให้มีข้อมูลเหมือนกับโหมดคำศัพท์ ดู tools/build_grammar69.py สำหรับแหล่งที่มา
if (SENT_OK && typeof SENTENCES_HSK69 !== "undefined") {
  for (const lvl in SENTENCES_HSK69) {
    SENTENCES[lvl] = (SENTENCES[lvl] || []).concat(SENTENCES_HSK69[lvl]);
  }
}

/* ================= Vocabulary Categories ================= */
let currentCategory = localStorage.getItem("cr_vocab_category") || "hsk";

const IT_SUB_MAP = {
  hardware: "硬件设备",
  system: "系统与安装",
  software: "常用软件",
  trouble: "故障与问题",
  repair: "维修与工具",
  network: "网络与运维"
};

const HOTEL_SUB_MAP = {
  checkin: "入住与退房",
  room: "房型与设施",
  service: "酒店服务与设施",
  requests: "客房需求与问题",
  travel: "交通出行与结账"
};

const FACTORY_SUB_MAP = {
  production: "车间与生产",
  safety: "安全与劳保",
  operation: "设备与操作",
  quality: "质量与检验",
  warehouse: "物料与仓储"
};

const TRADE_SUB_MAP = {
  customs: "报关与海关",
  shipping: "国际物流与运输",
  payment: "结算与外汇",
  contract: "贸易合同与商务",
  documents: "单证与包装"
};

const OFFICE_SUB_MAP = {
  stationery: "文具与纸张",
  equipment: "办公设备与家具",
  workflow: "日常办公与流程",
  meeting: "会议与商务沟通",
  admin: "人事行政与福利"
};

const FOOD_SUB_MAP = {
  dishes: "经典名菜与主食",
  vegetables: "新鲜蔬菜与菌类",
  seasonings: "调料与香辛料",
  cooking: "烹饪方式与口感",
  dining: "餐厅点餐与习俗"
};

const MEDIA_SUB_MAP = {
  camera: "相机与镜头设备",
  shooting: "摄影参数与拍摄技巧",
  video: "视频拍摄与辅助器材",
  live: "直播运营与互动带货",
  editing: "后期剪辑与调色制作"
};

const BUSINESS_SUB_MAP = {
  company: "企业与公司架构",
  negotiation: "商务谈判与合同",
  finance: "财务投资与融资",
  marketing: "市场营销与销售",
  operations: "商务运营与人力"
};

const PHONE_SUB_MAP = {
  device: "手机硬件与配件",
  telecom: "通信网络与通话",
  system: "系统设置与安全",
  apps: "应用软件与社交",
  daily: "移动生活与便民"
};

const GYM_SUB_MAP = {
  equipment: "常用器械与力量设备",
  exercises: "健身动作与训练",
  muscles: "身体肌肉部位",
  facilities: "健身房设施与服务",
  nutrition_gear: "运动装备与营养补剂"
};

const CAR_SUB_MAP = {
  ev_types: "车型与新能源电车",
  interior: "内饰配件与车机配置",
  mechanical: "核心机械与外观部件",
  driving: "驾驶操作与交通规则",
  maintenance: "充电保养与应急救援"
};

// ทะเบียนแมปหมวดย่อยของแต่ละหมวด (คีย์ -> ชื่อภาษาจีน)
// หมายเหตุ: const ที่ประกาศระดับบนสุดไม่กลายเป็น property ของ window
// จึงต้องมีทะเบียนนี้ให้โค้ดข้ามไฟล์ (เช่น 15-vocaboverview.js) ใช้แทน window[mapName]
const CATEGORY_SUB_MAPS = {
  it: IT_SUB_MAP,
  hotel: HOTEL_SUB_MAP,
  factory: FACTORY_SUB_MAP,
  trade: TRADE_SUB_MAP,
  office: OFFICE_SUB_MAP,
  food: FOOD_SUB_MAP,
  media: MEDIA_SUB_MAP,
  business: BUSINESS_SUB_MAP,
  phone: PHONE_SUB_MAP,
  gym: GYM_SUB_MAP,
  car: CAR_SUB_MAP
};

const CATEGORIES = {
  hsk: {
    id: "hsk",
    name: "HSK (มาตรฐาน HSK 1–9)",
    icon: "🇨🇳",
    badge: "HSK 1–9",
    levelLabel: "ระดับ HSK",
    levels: [
      { id: "1", label: "HSK 1" },
      { id: "2", label: "HSK 2" },
      { id: "3", label: "HSK 3" },
      { id: "4", label: "HSK 4" },
      { id: "5", label: "HSK 5" },
      { id: "6", label: "HSK 6" },
      { id: "7-9", label: "HSK 7-9" }
    ],
    defaultLevel: "1",
    getVocabPool: (level) => {
      const lvlStr = String(level || "1");
      return (typeof VOCAB !== "undefined" && VOCAB[lvlStr]) ? VOCAB[lvlStr] : (typeof VOCAB !== "undefined" ? VOCAB["1"] : []);
    },
    getSentencePool: (level) => {
      const lvlStr = String(level || "1");
      return (SENT_OK && SENTENCES[lvlStr]) ? SENTENCES[lvlStr] : [];
    }
  },
  it: {
    id: "it",
    name: "คอมพิวเตอร์และงานไอที (IT & Computer)",
    icon: "💻",
    badge: "💻 IT & Computer",
    levelLabel: "หมวดย่อยไอที",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (293 คำ)" },
      { id: "hardware", label: "🖥️ ฮาร์ดแวร์ (66 คำ)" },
      { id: "system", label: "💿 ลง Windows (59 คำ)" },
      { id: "software", label: "🪟 ซอฟต์แวร์ใช้งานบ่อย (25 คำ)" },
      { id: "trouble", label: "⚠️ อาการเสีย (47 คำ)" },
      { id: "repair", label: "🔧 ซ่อม & เครื่องมือ (47 คำ)" },
      { id: "network", label: "🌐 เครือข่าย (49 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_IT === "undefined") return [];
      if (!level || level === "all") return VOCAB_IT;
      const cat = IT_SUB_MAP[level];
      if (!cat) return VOCAB_IT;
      const filtered = VOCAB_IT.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_IT;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_IT === "undefined") return [];
      if (!level || level === "all") return SENTENCES_IT;
      const cat = IT_SUB_MAP[level];
      if (!cat) return SENTENCES_IT;
      const words = typeof VOCAB_IT !== "undefined" ? VOCAB_IT.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_IT.filter((s) => words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_IT;
    }
  },
  hotel: {
    id: "hotel",
    name: "การโรงแรมและที่พัก (Hotel & Hospitality)",
    icon: "🏨",
    badge: "🏨 Hotel",
    levelLabel: "หมวดย่อยโรงแรม",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (195 คำ)" },
      { id: "checkin", label: "🛎️ เช็คอิน & เช็คเอาท์ (38 คำ)" },
      { id: "room", label: "🛏️ ประเภทห้อง & อุปกรณ์ (60 คำ)" },
      { id: "service", label: "🍽️ บริการ & สิ่งอำนวยความสะดวก (33 คำ)" },
      { id: "requests", label: "🧹 คำขอ & แจ้งปัญหา (39 คำ)" },
      { id: "travel", label: "🚕 การเดินทาง & ชำระเงิน (25 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_HOTEL === "undefined") return [];
      if (!level || level === "all") return VOCAB_HOTEL;
      const cat = HOTEL_SUB_MAP[level];
      if (!cat) return VOCAB_HOTEL;
      const filtered = VOCAB_HOTEL.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_HOTEL;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_HOTEL === "undefined") return [];
      if (!level || level === "all") return SENTENCES_HOTEL;
      const cat = HOTEL_SUB_MAP[level];
      if (!cat) return SENTENCES_HOTEL;
      const words = typeof VOCAB_HOTEL !== "undefined" ? VOCAB_HOTEL.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_HOTEL.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_HOTEL;
    }
  },
  factory: {
    id: "factory",
    name: "การทำงานในโรงงาน (Factory & Manufacturing)",
    icon: "🏭",
    badge: "🏭 Factory",
    levelLabel: "หมวดย่อยโรงงาน",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (265 คำ)" },
      { id: "production", label: "🏭 แผนกผลิต & สายพาน (55 คำ)" },
      { id: "safety", label: "🦺 ความปลอดภัย & PPE (52 คำ)" },
      { id: "operation", label: "⚙️ เครื่องจักร & การทำงาน (56 คำ)" },
      { id: "quality", label: "🔍 คุณภาพ & ตรวจสอบ (51 คำ)" },
      { id: "warehouse", label: "📦 คลังสินค้า & วัตถุดิบ (51 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_FACTORY === "undefined") return [];
      if (!level || level === "all") return VOCAB_FACTORY;
      const cat = FACTORY_SUB_MAP[level];
      if (!cat) return VOCAB_FACTORY;
      const filtered = VOCAB_FACTORY.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_FACTORY;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_FACTORY === "undefined") return [];
      if (!level || level === "all") return SENTENCES_FACTORY;
      const cat = FACTORY_SUB_MAP[level];
      if (!cat) return SENTENCES_FACTORY;
      const words = typeof VOCAB_FACTORY !== "undefined" ? VOCAB_FACTORY.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_FACTORY.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_FACTORY;
    }
  },
  trade: {
    id: "trade",
    name: "การนำเข้าและส่งออก (Import & Export)",
    icon: "🚢",
    badge: "🚢 Trade",
    levelLabel: "หมวดย่อยการค้า",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (265 คำ)" },
      { id: "customs", label: "🛃 พิธีการศุลกากร & ภาษี (54 คำ)" },
      { id: "shipping", label: "🚢 โลจิสติกส์ & ขนส่ง (56 คำ)" },
      { id: "payment", label: "💰 ชำระเงิน & แลกเปลี่ยน (53 คำ)" },
      { id: "contract", label: "🤝 สัญญาการค้า & เจรจา (51 คำ)" },
      { id: "documents", label: "📄 เอกสาร & หีบห่อ (51 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_TRADE === "undefined") return [];
      if (!level || level === "all") return VOCAB_TRADE;
      const cat = TRADE_SUB_MAP[level];
      if (!cat) return VOCAB_TRADE;
      const filtered = VOCAB_TRADE.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_TRADE;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_TRADE === "undefined") return [];
      if (!level || level === "all") return SENTENCES_TRADE;
      const cat = TRADE_SUB_MAP[level];
      if (!cat) return SENTENCES_TRADE;
      const words = typeof VOCAB_TRADE !== "undefined" ? VOCAB_TRADE.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_TRADE.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_TRADE;
    }
  },
  office: {
    id: "office",
    name: "อุปกรณ์สำนักงานและการทำงาน (Office & Workplace)",
    icon: "🏢",
    badge: "🏢 Office",
    levelLabel: "หมวดย่อยสำนักงาน",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (265 คำ)" },
      { id: "stationery", label: "✏️ เครื่องเขียน & กระดาษ (54 คำ)" },
      { id: "equipment", label: "🖨️ อุปกรณ์ & เฟอร์นิเจอร์ (54 คำ)" },
      { id: "workflow", label: "📋 งานประจำวัน & เอกสาร (54 คำ)" },
      { id: "meeting", label: "🤝 ประชุม & การสื่อสาร (51 คำ)" },
      { id: "admin", label: "💼 บุคคล ธุรการ & สวัสดิการ (52 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_OFFICE === "undefined") return [];
      if (!level || level === "all") return VOCAB_OFFICE;
      const cat = OFFICE_SUB_MAP[level];
      if (!cat) return VOCAB_OFFICE;
      const filtered = VOCAB_OFFICE.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_OFFICE;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_OFFICE === "undefined") return [];
      if (!level || level === "all") return SENTENCES_OFFICE;
      const cat = OFFICE_SUB_MAP[level];
      if (!cat) return SENTENCES_OFFICE;
      const words = typeof VOCAB_OFFICE !== "undefined" ? VOCAB_OFFICE.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_OFFICE.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_OFFICE;
    }
  },
  food: {
    id: "food",
    name: "อาหารจีน เครื่องปรุง และผัก (Chinese Food & Veggies)",
    icon: "🥢",
    badge: "🥢 Food",
    levelLabel: "หมวดย่อยอาหารและวัตถุดิบ",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (265 คำ)" },
      { id: "dishes", label: "🍲 เมนูเด็ด & จานหลัก (54 คำ)" },
      { id: "vegetables", label: "🥬 ผักสด & เห็ด (54 คำ)" },
      { id: "seasonings", label: "🧂 เครื่องปรุง & เครื่องเทศ (54 คำ)" },
      { id: "cooking", label: "🍳 วิธีปรุง & รสชาติ (51 คำ)" },
      { id: "dining", label: "🥢 สั่งอาหาร & วัฒนธรรม (52 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_FOOD === "undefined") return [];
      if (!level || level === "all") return VOCAB_FOOD;
      const cat = FOOD_SUB_MAP[level];
      if (!cat) return VOCAB_FOOD;
      const filtered = VOCAB_FOOD.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_FOOD;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_FOOD === "undefined") return [];
      if (!level || level === "all") return SENTENCES_FOOD;
      const cat = FOOD_SUB_MAP[level];
      if (!cat) return SENTENCES_FOOD;
      const words = typeof VOCAB_FOOD !== "undefined" ? VOCAB_FOOD.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_FOOD.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_FOOD;
    }
  },
  media: {
    id: "media",
    name: "การถ่ายภาพ วิดีโอ และไลฟ์สด (Photography, Video & Live Streaming)",
    icon: "📸",
    badge: "📸 Photo & Live",
    levelLabel: "หมวดย่อยการถ่ายภาพและไลฟ์",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (265 คำ)" },
      { id: "camera", label: "📷 ตัวกล้อง & เลนส์ (53 คำ)" },
      { id: "shooting", label: "⚙️ การตั้งค่า & เทคนิคถ่ายภาพ (53 คำ)" },
      { id: "video", label: "🎬 งานวิดีโอ & อุปกรณ์สตูดิโอ (53 คำ)" },
      { id: "live", label: "📡 ไลฟ์สด & ขายของออนไลน์ (53 คำ)" },
      { id: "editing", label: "✂️ ตัดต่อวิดีโอ & แต่งภาพ (53 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_MEDIA === "undefined") return [];
      if (!level || level === "all") return VOCAB_MEDIA;
      const cat = MEDIA_SUB_MAP[level];
      if (!cat) return VOCAB_MEDIA;
      const filtered = VOCAB_MEDIA.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_MEDIA;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_MEDIA === "undefined") return [];
      if (!level || level === "all") return SENTENCES_MEDIA;
      const cat = MEDIA_SUB_MAP[level];
      if (!cat) return SENTENCES_MEDIA;
      const words = typeof VOCAB_MEDIA !== "undefined" ? VOCAB_MEDIA.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_MEDIA.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_MEDIA;
    }
  },
  business: {
    id: "business",
    name: "ธุรกิจและการเจรจาการค้า (Business & Commerce)",
    icon: "💼",
    badge: "💼 Business",
    levelLabel: "หมวดย่อยธุรกิจและการค้า",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (265 คำ)" },
      { id: "company", label: "🏢 องค์กรและการบริหารธุรกิจ (53 คำ)" },
      { id: "negotiation", label: "🤝 การเจรจาธุรกิจและสัญญา (53 คำ)" },
      { id: "finance", label: "💰 การเงิน การลงทุนและระดมทุน (53 คำ)" },
      { id: "marketing", label: "📈 การตลาด การขายและขยายตลาด (53 คำ)" },
      { id: "operations", label: "⚙️ การดำเนินงานและบุคลากร (53 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_BUSINESS === "undefined") return [];
      if (!level || level === "all") return VOCAB_BUSINESS;
      const cat = BUSINESS_SUB_MAP[level];
      if (!cat) return VOCAB_BUSINESS;
      const filtered = VOCAB_BUSINESS.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_BUSINESS;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_BUSINESS === "undefined") return [];
      if (!level || level === "all") return SENTENCES_BUSINESS;
      const cat = BUSINESS_SUB_MAP[level];
      if (!cat) return SENTENCES_BUSINESS;
      const words = typeof VOCAB_BUSINESS !== "undefined" ? VOCAB_BUSINESS.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_BUSINESS.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_BUSINESS;
    }
  },
  phone: {
    id: "phone",
    name: "โทรศัพท์และสมาร์ตโฟน (Smartphones & Mobile Tech)",
    icon: "📱",
    badge: "📱 Phone",
    levelLabel: "หมวดย่อยโทรศัพท์มือถือ",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (265 คำ)" },
      { id: "device", label: "📱 ตัวเครื่อง ฮาร์ดแวร์ และอุปกรณ์เสริม (53 คำ)" },
      { id: "telecom", label: "📶 เครือข่าย สัญญาณ และการโทร (53 คำ)" },
      { id: "system", label: "⚙️ การตั้งค่าระบบและความปลอดภัย (53 คำ)" },
      { id: "apps", label: "📲 แอปพลิเคชันและการสื่อสารโซเชียล (53 คำ)" },
      { id: "daily", label: "💳 การใช้งานประจำวันและไลฟ์สไตล์มือถือ (53 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_PHONE === "undefined") return [];
      if (!level || level === "all") return VOCAB_PHONE;
      const cat = PHONE_SUB_MAP[level];
      if (!cat) return VOCAB_PHONE;
      const filtered = VOCAB_PHONE.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_PHONE;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_PHONE === "undefined") return [];
      if (!level || level === "all") return SENTENCES_PHONE;
      const cat = PHONE_SUB_MAP[level];
      if (!cat) return SENTENCES_PHONE;
      const words = typeof VOCAB_PHONE !== "undefined" ? VOCAB_PHONE.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_PHONE.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_PHONE;
    }
  },
  gym: {
    id: "gym",
    name: "ฟิตเนส ยิม และเครื่องออกกำลังกาย (Gym & Fitness)",
    icon: "🏋️",
    badge: "🏋️ Gym & Fitness",
    levelLabel: "หมวดย่อยฟิตเนส",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (170 คำ)" },
      { id: "equipment", label: "🏋️ เครื่องออกกำลังกาย & อุปกรณ์ (38 คำ)" },
      { id: "exercises", label: "🏃 ท่าออกกำลังกาย & การฝึก (39 คำ)" },
      { id: "muscles", label: "💪 กล้ามเนื้อ & ร่างกาย (30 คำ)" },
      { id: "facilities", label: "🏢 สิ่งอำนวยความสะดวก & บริการ (30 คำ)" },
      { id: "nutrition_gear", label: "🥤 อุปกรณ์ & อาหารเสริม (33 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_GYM === "undefined") return [];
      if (!level || level === "all") return VOCAB_GYM;
      const cat = GYM_SUB_MAP[level];
      if (!cat) return VOCAB_GYM;
      const filtered = VOCAB_GYM.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_GYM;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_GYM === "undefined") return [];
      if (!level || level === "all") return SENTENCES_GYM;
      const cat = GYM_SUB_MAP[level];
      if (!cat) return SENTENCES_GYM;
      const words = typeof VOCAB_GYM !== "undefined" ? VOCAB_GYM.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_GYM.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_GYM;
    }
  },
  car: {
    id: "car",
    name: "ยานยนต์ รถยนต์ EV และการขับขี่ (Automotive, EV & Driving)",
    icon: "🚗",
    badge: "🚗 Automotive & EV",
    levelLabel: "หมวดย่อยยานยนต์",
    levels: [
      { id: "all", label: "🌐 ทั้งหมด (194 คำ)" },
      { id: "ev_types", label: "⚡ รุ่นรถ & รถยนต์ EV (37 คำ)" },
      { id: "interior", label: "💺 อุปกรณ์ภายใน & หน้าจอรถ (40 คำ)" },
      { id: "mechanical", label: "⚙️ ชิ้นส่วนเครื่องยนต์ & ภายนอก (39 คำ)" },
      { id: "driving", label: "🚦 การขับขี่ & กฎจราจร (40 คำ)" },
      { id: "maintenance", label: "🔌 ชาร์จไฟ บำรุงรักษา & กู้ภัย (38 คำ)" }
    ],
    defaultLevel: "all",
    getVocabPool: (level) => {
      if (typeof VOCAB_CAR === "undefined") return [];
      if (!level || level === "all") return VOCAB_CAR;
      const cat = CAR_SUB_MAP[level];
      if (!cat) return VOCAB_CAR;
      const filtered = VOCAB_CAR.filter((w) => w[3] === cat);
      return filtered.length ? filtered : VOCAB_CAR;
    },
    getSentencePool: (level) => {
      if (typeof SENTENCES_CAR === "undefined") return [];
      if (!level || level === "all") return SENTENCES_CAR;
      const cat = CAR_SUB_MAP[level];
      if (!cat) return SENTENCES_CAR;
      const words = typeof VOCAB_CAR !== "undefined" ? VOCAB_CAR.filter((w) => w[3] === cat).map((w) => w[0]) : [];
      const filtered = SENTENCES_CAR.filter((s) => s[3] === cat || words.some((w) => s[0].includes(w)));
      return filtered.length ? filtered : SENTENCES_CAR;
    }
  }
};

function getVocabPool(level) {
  const cat = CATEGORIES[currentCategory] || CATEGORIES.hsk;
  return cat.getVocabPool(level || selectedLevel || currentLevel);
}

function getSentencePool(level) {
  const cat = CATEGORIES[currentCategory] || CATEGORIES.hsk;
  return cat.getSentencePool(level || selectedLevel || currentLevel);
}

// ทะเบียนคลังคำศัพท์ของทุกหมวดที่ไม่ใช่ HSK (ใช้ร่วมกันในพจนานุกรม 08-dict.js
// และโหมดเขียนประโยค 11-copy.js). เพิ่มหมวดใหม่ = เพิ่มบรรทัดที่นี่ที่เดียว
// หมายเหตุ: const ระดับบนสุดไม่กลายเป็น property ของ window จึงต้องอ้างชื่อตรงๆ
function categoryVocabSources() {
  const list = [];
  if (typeof VOCAB_IT !== "undefined") list.push({ id: "it", lvl: "IT", badge: "💻 IT", words: VOCAB_IT });
  if (typeof VOCAB_HOTEL !== "undefined") list.push({ id: "hotel", lvl: "HOTEL", badge: "🏨 Hotel", words: VOCAB_HOTEL });
  if (typeof VOCAB_FACTORY !== "undefined") list.push({ id: "factory", lvl: "FACTORY", badge: "🏭 Factory", words: VOCAB_FACTORY });
  if (typeof VOCAB_TRADE !== "undefined") list.push({ id: "trade", lvl: "TRADE", badge: "🚢 Trade", words: VOCAB_TRADE });
  if (typeof VOCAB_OFFICE !== "undefined") list.push({ id: "office", lvl: "OFFICE", badge: "🏢 Office", words: VOCAB_OFFICE });
  if (typeof VOCAB_FOOD !== "undefined") list.push({ id: "food", lvl: "FOOD", badge: "🥢 Food", words: VOCAB_FOOD });
  if (typeof VOCAB_MEDIA !== "undefined") list.push({ id: "media", lvl: "MEDIA", badge: "📸 Media", words: VOCAB_MEDIA });
  if (typeof VOCAB_BUSINESS !== "undefined") list.push({ id: "business", lvl: "BUSINESS", badge: "💼 Business", words: VOCAB_BUSINESS });
  if (typeof VOCAB_PHONE !== "undefined") list.push({ id: "phone", lvl: "PHONE", badge: "📱 Phone", words: VOCAB_PHONE });
  if (typeof VOCAB_GYM !== "undefined") list.push({ id: "gym", lvl: "GYM", badge: "🏋️ Gym", words: VOCAB_GYM });
  if (typeof VOCAB_CAR !== "undefined") list.push({ id: "car", lvl: "CAR", badge: "🚗 Car", words: VOCAB_CAR });
  return list;
}

// หมวดที่เลือกอยู่มีข้อมูลประโยคให้เล่นหรือไม่ (แทนเชน if ของแต่ละหมวด)
function categoryHasSentences(level) {
  if (currentCategory === "hsk") return !!SENT_OK;
  const pool = getSentencePool(level || selectedLevel || currentLevel);
  return !!(pool && pool.length);
}

function levelDisplayName(level) {
  if (!level) return "";
  const cat = CATEGORIES[currentCategory] || CATEGORIES.hsk;
  const found = cat.levels.find((l) => String(l.id) === String(level));
  if (found) {
    return currentCategory === "hsk" ? `HSK ${found.id}` : found.label.replace(/\s*\(.*\)/, "");
  }
  return `ระดับ ${level}`;
}

const catPrefix = () => (currentCategory === "hsk" ? "hsk" : `${currentCategory}_`);

function setCategory(catId) {
  if (!CATEGORIES[catId]) return;
  currentCategory = catId;
  localStorage.setItem("cr_vocab_category", currentCategory);
  const cat = CATEGORIES[currentCategory];
  selectedLevel = cat.defaultLevel;
  renderLevelSelect();
  updateCategoryDropdownUI();
}

function updateCategoryDropdownUI() {
  const sel = $("categorySelect");
  if (sel && sel.value !== currentCategory) sel.value = currentCategory;
  const tag = $("setupCategoryTag");
  if (tag) {
    const cat = CATEGORIES[currentCategory] || CATEGORIES.hsk;
    tag.textContent = `หมวดหมู่: ${cat.icon} ${cat.name}`;
  }
}

function renderLevelSelect() {
  const cat = CATEGORIES[currentCategory] || CATEGORIES.hsk;
  const container = $("levelSelect");
  if (!container) return;

  const labelEl = $("setupLevelLabel");
  if (labelEl) labelEl.textContent = cat.levelLabel;

  const tagEl = $("setupCategoryTag");
  if (tagEl) tagEl.textContent = `หมวดหมู่: ${cat.icon} ${cat.name}`;

  const usesVocab = ["meteor", "zombie", "vocab", "matching", "bomb", "trace"].includes(gameMode)
    || (gameMode === "listen" && lisType === "word");

  container.innerHTML = "";
  cat.levels.forEach((lvl) => {
    if (lvl.vocabOnly && !usesVocab) return;
    const btn = document.createElement("button");
    btn.className = "level-btn" + (lvl.vocabOnly ? " vocab-level" : "");
    btn.dataset.level = lvl.id;
    btn.textContent = lvl.label;
    if (String(selectedLevel) === String(lvl.id)) {
      btn.classList.add("selected");
    }
    container.appendChild(btn);
  });

  const validLevels = cat.levels.filter((l) => !l.vocabOnly || usesVocab);
  const isValid = validLevels.some((l) => String(l.id) === String(selectedLevel));
  if (!isValid) {
    if (validLevels.length) {
      selectedLevel = validLevels[0].id;
      const b = container.querySelector(`.level-btn[data-level="${selectedLevel}"]`);
      if (b) b.classList.add("selected");
    } else {
      selectedLevel = null;
    }
  }
  updateStartBtn();
}
const DIFF = {
  // ต.ค. 2026: ลดความเร็วการตกลง ~30% ทุกระดับ (base/ramp/cap ปรับตามสัดส่วน) ให้เล่นได้นานขึ้น
  easy:   { label: "ง่าย",     base: 5,  cap: 20, ramp: 0.3,  spawn0: 3.0, spawnDecay: 0.008, spawnMin: 1.6  },
  medium: { label: "ปานกลาง", base: 13, cap: 34, ramp: 0.75, spawn0: 2.7, spawnDecay: 0.016, spawnMin: 1.05 },
  hard:   { label: "ยากมาก",  base: 21, cap: 55, ramp: 1.25, spawn0: 2.3, spawnDecay: 0.028, spawnMin: 0.75 },
};



// NOTE: toggleMute() lives here (early) instead of with the other bottom-of-file UI
// wiring, because later files pass it by reference while wiring click handlers at load
// time. Classic scripts share one global scope, but only function *declarations* are
// hoisted within their own file — a reference from an earlier file would not see it.
function toggleMute() {
  muted = !muted;
  music.setMuted(muted); // ปิดเฉพาะเพลงพื้นหลัง เสียงพูดภาษาจีนและเสียงเอฟเฟกต์/เสียงเขียนยังเล่นต่อ
  $("matchMuteBtn").textContent = muted ? "เปิดเสียง" : "ปิดเสียง";
  $("matchMuteBtn").setAttribute("aria-pressed", String(muted));
  $("bombMuteBtn").textContent = muted ? "เปิดเสียง" : "ปิดเสียง";
  $("bombMuteBtn").setAttribute("aria-pressed", String(muted));
  $("muteBtn").textContent = muted ? "🔇" : "🔊";
  $("quizMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("sentMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("fillMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("zMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("spkMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("lisMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("cpMuteBtn").textContent = muted ? "🔇" : "🔊";
  $("tcMuteBtn").textContent = muted ? "🔇" : "🔊";
  if ($("voMuteBtn")) $("voMuteBtn").textContent = muted ? "🔇" : "🔊";
}
