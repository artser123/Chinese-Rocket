"use strict";

/**
 * Chinese Rocket - Vocabulary Overview (เกมรวมคำศัพท์)
 * Displays all vocabulary and example sentences for the selected category
 * with Chinese characters, Pinyin, Thai translation, and audio pronunciation.
 */

let voCurrentCat = "hsk";
let voCurrentSubcat = "all";
let voSearchQuery = "";
let voFilteredItems = [];
let voRenderedCount = 0;
const VO_CHUNK_SIZE = 50;
const VO_HSK_LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"];

// หน่วงการค้นหาเล็กน้อย กันการกรอง/วาดการ์ดใหม่ทุกคีย์ (~11k คำ)
const VO_SEARCH_DELAY = 160;
let voSearchTimer = null;

// ปุ่มลำโพงที่กำลังเล่นอยู่ (wordAudio.stop() ไม่เรียก onDone ของตัวเก่า จึงต้องเคลียร์เอง)
let voActiveBtn = null;

// จำแท็บ HSK ล่าสุดที่ผู้ใช้เลือกในโหมดนี้ (ไม่ไปทับ selectedLevel ของหน้าเมนู)
let voLastHskSubcat = null;

// Scroll handling
// ใช้ throttle ตามเวลา ไม่ใช่ flag + requestAnimationFrame เพราะ rAF หยุดทำงาน
// เมื่อแท็บถูกซ่อน/ถูก WebView freeze — flag จะค้าง true แล้วเลื่อนโหลดการ์ดถัดไปไม่ได้อีกเลย
let voScrollLast = 0;
let voScrollTimer = null;
const VO_SCROLL_DELAY = 90;

// Cache รายการคำศัพท์ + คีย์ค้นหาที่ normalize แล้ว ต่อ (หมวด|หมวดย่อย)
const voItemsCache = new Map();
// Cache ประโยคตัวอย่างต่อ (หมวด|คำ)
const voSentCache = new Map();

// Sentence cache per category: Map<catId, { tokenMap: Map<string, Array>, allSents: Array }>
const voSentenceCache = new Map();

// Play all / random state
let voPlayAllActive = false;
let voPlayAllIndex = 0;
let voPlayAllTimeout = null;
let voPlayMode = "order";     // "order" = ตามลำดับ, "shuffle" = สุ่ม
let voPlayQueue = null;       // ลำดับ index แบบสุ่ม (null = เล่นตามลำดับในกอง)
let voLastPlayedIndex = -1;   // กันไม่ให้รอบใหม่เริ่มด้วยคำเดียวกับคำสุดท้ายของรอบก่อน

// Initialize on document ready / first call
let voInitialized = false;
let voStrokePopupWired = false;

// ปุ่มสลับการแสดงผล (จำสถานะไว้ใน localStorage เหมือนโหมดอื่น)
const VO_TOGGLES = [
  { btn: "voTogglePy", cls: "vo-hide-pinyin", key: "cr_vo_show_pinyin" },
  { btn: "voToggleTh", cls: "vo-hide-thai", key: "cr_vo_show_thai" },
  { btn: "voToggleSent", cls: "vo-hide-sentences", key: "cr_vo_show_sent" }
];

function voApplyToggle(cfg, show, save) {
  const list = $("voList");
  if (list) list.classList.toggle(cfg.cls, !show);
  const btn = $(cfg.btn);
  if (btn) {
    btn.classList.toggle("active", show);
    btn.setAttribute("aria-pressed", String(show));
    const check = btn.querySelector(".vo-toggle-check");
    if (check) check.textContent = show ? "✓" : "✗";
  }
  if (save) localStorage.setItem(cfg.key, show ? "1" : "0");
}

function initVocabOverview() {
  if (voInitialized) return;
  voInitialized = true;

  const backBtn = $("voBackBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      sfx.click();
      quitVocabOverview();
    });
  }

  const muteBtn = $("voMuteBtn");
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      toggleMute();
      voSyncMuteBtn();
    });
  }

  const catSelect = $("voCategorySelect");
  if (catSelect) {
    voPopulateCategorySelect();
    catSelect.addEventListener("change", (e) => {
      sfx.click();
      voSetCategory(e.target.value);
    });
  }

  const searchInput = $("voSearchInput");
  const searchClear = $("voSearchClear");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      voSearchQuery = e.target.value.trim();
      if (searchClear) searchClear.hidden = !voSearchQuery;
      // กรองแบบหน่วง: การกรองต้องสร้าง object/การ์ดใหม่ทั้งชุด (~11k คำ)
      clearTimeout(voSearchTimer);
      voSearchTimer = setTimeout(() => {
        voSearchTimer = null;
        voFilterAndRender(true);
      }, VO_SEARCH_DELAY);
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      sfx.click();
      clearTimeout(voSearchTimer);
      voSearchTimer = null;
      if (searchInput) searchInput.value = "";
      voSearchQuery = "";
      searchClear.hidden = true;
      voFilterAndRender(true);
      if (searchInput) searchInput.focus();
    });
  }

  // Toggles (มีสถานะจำใน localStorage)
  VO_TOGGLES.forEach((cfg) => {
    const saved = localStorage.getItem(cfg.key);
    voApplyToggle(cfg, saved === null ? true : saved === "1", false);
    const btn = $(cfg.btn);
    if (!btn) return;
    btn.addEventListener("click", () => {
      sfx.click();
      const list = $("voList");
      const hidden = list ? list.classList.contains(cfg.cls) : false;
      voApplyToggle(cfg, hidden, true);
      // ซ่อนประโยค/คำแปลแล้วการ์ดเตี้ยลงมาก ต้องเติม chunk ให้เต็มจอใหม่
      voFillViewport();
    });
  });

  const playAllBtn = $("voPlayAllBtn");
  if (playAllBtn) {
    playAllBtn.addEventListener("click", () => {
      sfx.click();
      voTogglePlayAll();
    });
  }

  const playRandomBtn = $("voPlayRandomBtn");
  if (playRandomBtn) {
    playRandomBtn.addEventListener("click", () => {
      sfx.click();
      voTogglePlayRandom();
    });
  }

  // Infinite scroll (throttle ตามเวลา + trailing call เพื่อไม่ให้ทิ้ง scroll สุดท้าย)
  const screen = $("vocaboverview");
  if (screen) {
    screen.addEventListener("scroll", voThrottleScroll, { passive: true });
  }

  const scrollTopBtn = $("voScrollTopBtn");
  if (scrollTopBtn) {
    scrollTopBtn.addEventListener("click", () => {
      sfx.click();
      voScrollToTop();
    });
  }

  // Popup วิธีเขียน — ต้อง wire แม้เปิดจากบับเบิ้ลของเกมอื่น ไม่ใช่เฉพาะโหมดนี้
  voEnsureStrokePopupWired();

  window.addEventListener("resize", () => {
    if (gameMode !== "vocaboverview") return;
    voFillViewport();
    const strokePopup = $("voStrokePopup");
    if (strokePopup && !strokePopup.hidden) voStrokeFit();
  });
}

function voSyncMuteBtn() {
  const muteBtn = $("voMuteBtn");
  if (!muteBtn) return;
  const isMute = typeof muted !== "undefined" && Boolean(muted);
  muteBtn.textContent = isMute ? "🔇" : "🔊";
}

function voPopulateCategorySelect() {
  const select = $("voCategorySelect");
  if (!select) return;
  select.innerHTML = "";
  for (const catId in CATEGORIES) {
    const cat = CATEGORIES[catId];
    const opt = document.createElement("option");
    opt.value = catId;
    opt.textContent = `${cat.icon} ${cat.name}`;
    select.appendChild(opt);
  }
}

function startVocabOverview(categoryOverride) {
  initVocabOverview();
  music.stop();
  stopSpeech();
  voStopPlayAll();

  gameMode = "vocaboverview";
  voCurrentCat = categoryOverride || currentCategory || "hsk";
  if (!CATEGORIES[voCurrentCat]) voCurrentCat = "hsk";

  // Sync หมวดหมู่กับหน้าเมนู แต่ "ไม่" เรียก setCategory()
  // เพราะ setCategory ตั้ง selectedLevel กลับเป็นค่า default ของหมวด
  // ทำให้ระดับ HSK ที่ผู้ใช้เลือกไว้ในเมนูหายไป (โหมดนี้เข้าไปดูอย่างเดียว)
  voSyncMenuCategory(voCurrentCat);

  const select = $("voCategorySelect");
  if (select) select.value = voCurrentCat;

  voSyncCatIcon();
  voSyncMuteBtn();

  // Reset filter & search
  voCurrentSubcat = voCurrentCat === "hsk" ? voPickHskSubcat() : "all";
  voSearchQuery = "";
  clearTimeout(voSearchTimer);
  voSearchTimer = null;
  const searchInput = $("voSearchInput");
  if (searchInput) searchInput.value = "";
  const searchClear = $("voSearchClear");
  if (searchClear) searchClear.hidden = true;

  // Render Subcategory Tabs & List
  voRenderSubcategoryTabs();
  voFilterAndRender(true);

  const scrollTopBtn = $("voScrollTopBtn");
  if (scrollTopBtn) scrollTopBtn.hidden = true;

  switchScreen($("vocaboverview"));

  const screen = $("vocaboverview");
  if (screen) screen.scrollTop = 0;
  // ตอนนี้จอแสดงแล้ว — เติมการ์ดถ้า chunk แรกสั้นกว่าหนึ่งจอ (เช่นผลค้นหาน้อยๆ)
  voFillViewport();
}

function quitVocabOverview() {
  voCloseStrokes();
  clearTimeout(voSearchTimer);
  voSearchTimer = null;
  voStopPlayAll();
  stopSpeech();
  switchScreen(menuEl);
  updateCategoryDropdownUI();
}

// เขียน currentCategory ลง localStorage + อัปเดต dropdown ของหน้าเมนู
// (ไม่แตะ selectedLevel ของเกม)
function voSyncMenuCategory(catId) {
  currentCategory = catId;
  try { localStorage.setItem("cr_vocab_category", catId); } catch (e) {}
  updateCategoryDropdownUI();
}

// เลือกแท็บ HSK: ใช้แท็บล่าสุดในโหมดนี้ ถ้าไม่มีค่อยใช้ระดับที่เลือกในเมนู
function voPickHskSubcat() {
  // เมนูเลือกได้หลายระดับ ("2+3") — แท็บของโหมดนี้รับได้ทีละระดับ จึงใช้ระดับแรก
  for (const candidate of [voLastHskSubcat, levelParts(selectedLevel)[0] || ""]) {
    if (!candidate) continue;
    if (candidate === "all" || VO_HSK_LEVELS.includes(candidate)) return candidate;
  }
  return "1";
}

function voSetCategory(newCatId) {
  if (!CATEGORIES[newCatId]) return;
  voStopPlayAll();
  voCurrentCat = newCatId;
  voSyncMenuCategory(newCatId);

  voSyncCatIcon();
  voCurrentSubcat = voCurrentCat === "hsk" ? voPickHskSubcat() : "all";
  voRenderSubcategoryTabs();
  voFilterAndRender(true);

  const screen = $("vocaboverview");
  if (screen) screen.scrollTop = 0;
}

function voSyncCatIcon() {
  const iconEl = $("voCatIcon");
  if (iconEl && CATEGORIES[voCurrentCat]) {
    iconEl.textContent = CATEGORIES[voCurrentCat].icon || "📂";
  }
}

// Subcategory / Level mapping for human friendly tag
function voGetSubcatLabel(catId, subcatKey) {
  if (!subcatKey) return "";
  const cat = CATEGORIES[catId];
  if (!cat) return subcatKey;

  // If HSK
  if (catId === "hsk") {
    return subcatKey.startsWith("HSK") ? subcatKey : `HSK ${subcatKey}`;
  }

  // Look up in cat.levels
  for (const lvl of cat.levels) {
    if (lvl.id === subcatKey) {
      return lvl.label.replace(/\s*\(.*\)/, "").trim();
    }
  }

  // Subcat map reverse lookup (Chinese subcategory string -> Thai title)
  const map = (typeof CATEGORY_SUB_MAPS !== "undefined" && CATEGORY_SUB_MAPS[catId]) || null;
  if (map) {
    for (const key in map) {
      if (map[key] === subcatKey) {
        const foundLvl = cat.levels.find((l) => l.id === key);
        if (foundLvl) return foundLvl.label.replace(/\s*\(.*\)/, "").trim();
      }
    }
  }

  return subcatKey;
}

// Build Sentence Index for fast lookup
function voGetSentenceIndex(catId) {
  if (voSentenceCache.has(catId)) {
    return voSentenceCache.get(catId);
  }

  const tokenMap = new Map();
  let allSents = [];

  if (catId === "hsk") {
    if (SENT_OK) {
      for (const lvl of ["1", "2", "3", "4", "5", "6", "7-9"]) {
        if (SENTENCES[lvl]) allSents.push(...SENTENCES[lvl]);
      }
    }
  } else {
    const cat = CATEGORIES[catId];
    if (cat && typeof cat.getSentencePool === "function") {
      allSents = cat.getSentencePool("all") || [];
    }
  }

  for (const s of allSents) {
    const tokens = s[4] || [];
    for (const tk of tokens) {
      if (!tokenMap.has(tk)) tokenMap.set(tk, []);
      const arr = tokenMap.get(tk);
      if (!arr.includes(s)) arr.push(s);
    }
  }

  const index = { tokenMap, allSents };
  voSentenceCache.set(catId, index);
  return index;
}

// Find up to max sentences matching the Chinese word
function voFindSentencesForWord(catId, zhWord, max = 2) {
  const clean = (zhWord || "").split(/[｜|]/)[0].trim();
  if (!clean) return [];

  const cacheKey = `${catId}|${clean}|${max}`;
  const cached = voSentCache.get(cacheKey);
  if (cached) return cached;

  const index = voGetSentenceIndex(catId);
  const results = [];
  const seenZh = new Set();

  // แท็กประโยค: HSK เก็บ grammar focus ไว้แล้ว ส่วนหมวดอื่นเก็บ "คีย์" หมวดย่อย
  // (เช่น hardware) จึงต้องแปลงเป็นชื่อไทยก่อนแสดง
  const tagLabel = (meta) => {
    if (!meta) return "";
    return catId === "hsk" ? meta : (voGetSubcatLabel(catId, meta) || meta);
  };

  function addSent(s, meta) {
    if (!s || !s[0]) return;
    const szh = String(s[0]).trim();
    if (!szh || seenZh.has(szh)) return;
    seenZh.add(szh);
    results.push({
      zh: szh,
      py: s[1] || "",
      th: s[2] || "",
      tag: tagLabel(meta || s[3] || "")
    });
  }

  // 1) Match tokens
  const tokenMatches = index.tokenMap.get(clean) || [];
  for (const s of tokenMatches) {
    addSent(s);
    if (results.length >= max) {
      voSentCache.set(cacheKey, results);
      return results;
    }
  }

  // 2) Substring match in category sentences
  for (const s of index.allSents) {
    if (s[0] && s[0].includes(clean)) {
      addSent(s);
      if (results.length >= max) {
        voSentCache.set(cacheKey, results);
        return results;
      }
    }
  }

  // 3) For HSK, check VOCAB_EXTRA examples if available
  if (catId === "hsk" && typeof VOCAB_EXTRA !== "undefined") {
    const extra = VOCAB_EXTRA[clean];
    if (extra && extra.ex) {
      for (const e of extra.ex) {
        addSent([e[0], e[1] || "", e[3] || e[2] || "", "ตัวอย่าง"]);
        if (results.length >= max) break;
      }
    }
  }

  voSentCache.set(cacheKey, results);
  return results;
}

// Render Subcategory Tabs
function voRenderSubcategoryTabs() {
  const bar = $("voSubcatBar");
  if (!bar) return;
  bar.innerHTML = "";

  const cat = CATEGORIES[voCurrentCat];
  if (!cat) return;

  const levels = [];
  if (voCurrentCat === "hsk") {
    // Calculate total HSK words
    let totalHsk = 0;
    if (typeof VOCAB !== "undefined") {
      for (const k in VOCAB) totalHsk += VOCAB[k].length;
    }
    levels.push({ id: "all", label: `🌐 ทั้งหมด (${totalHsk} คำ)` });
    for (const lvl of cat.levels) {
      const count = typeof VOCAB !== "undefined" && VOCAB[lvl.id] ? VOCAB[lvl.id].length : 0;
      levels.push({ id: lvl.id, label: `${lvl.label} (${count} คำ)` });
    }
  } else {
    for (const lvl of cat.levels) {
      levels.push(lvl);
    }
  }

  levels.forEach((lvl) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vo-subcat-btn" + (voCurrentSubcat === lvl.id ? " active" : "");
    btn.textContent = lvl.label;
    btn.dataset.subcat = lvl.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(voCurrentSubcat === lvl.id));
    btn.addEventListener("click", () => {
      sfx.click();
      voCurrentSubcat = lvl.id;
      if (voCurrentCat === "hsk") voLastHskSubcat = lvl.id;
      bar.querySelectorAll(".vo-subcat-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      voFilterAndRender(true);
      const screen = $("vocaboverview");
      if (screen) screen.scrollTop = 0;
    });
    bar.appendChild(btn);
  });
}

// Fetch all vocab for current category & subcategory (cache + คีย์ค้นหาที่ normalize แล้ว)
function voGetVocabItems(catId, subcatId) {
  const cacheKey = `${catId}|${subcatId}`;
  const cached = voItemsCache.get(cacheKey);
  if (cached) return cached;

  const cat = CATEGORIES[catId];
  if (!cat) return [];

  const items = [];

  if (catId === "hsk") {
    if (typeof VOCAB === "undefined") return [];
    const levels = !subcatId || subcatId === "all" ? VO_HSK_LEVELS : [subcatId];
    for (const lvl of levels) {
      const list = VOCAB[lvl] || [];
      for (const w of list) {
        items.push({
          zh: w[0],
          py: w[1],
          th: w[2],
          subcat: `HSK ${lvl}`
        });
      }
    }
  } else {
    const rawList = cat.getVocabPool(subcatId) || [];
    for (const w of rawList) {
      items.push({
        zh: w[0],
        py: w[1],
        th: w[2],
        subcat: voGetSubcatLabel(catId, w[3])
      });
    }
  }

  // เตรียมสตริงสำหรับค้นหาครั้งเดียว (เดิมคำนวณ normPinyin ใหม่ทุกคีย์ที่พิมพ์)
  for (const item of items) {
    const py = String(item.py || "").toLowerCase();
    const pyNorm = voNormSearch(py);
    item._zh = String(item.zh || "").toLowerCase();
    item._py = py;
    item._pyNorm = pyNorm;
    item._pyTight = pyNorm.replace(/\s+/g, "");
    item._th = String(item.th || "").toLowerCase();
    item._sub = String(item.subcat || "").toLowerCase();
  }

  voItemsCache.set(cacheKey, items);
  return items;
}

// Normalize text for search
function voNormSearch(str) {
  if (!str) return "";
  const s = String(str).toLowerCase().trim();
  return typeof normPinyin === "function" ? normPinyin(s) : s;
}

// ตัวทดสอบการค้นหาต่อ 1 คำ (ใช้ทั้งกรองปกติและนับผลในระดับอื่น)
function voItemMatches(item, q, qNorm, qTight) {
  if (item._zh.includes(q) || item._py.includes(q) ||
      item._th.includes(q) || item._sub.includes(q)) {
    return true;
  }
  if (qNorm && item._pyNorm.includes(qNorm)) return true;
  // "nihao" ต้องเจอ "nǐ hǎo" ด้วย
  if (qTight.length > 1 && item._pyTight.includes(qTight)) return true;
  return false;
}

// Filter and render list
function voFilterAndRender(resetScroll = true) {
  voStopPlayAll();

  const allItems = voGetVocabItems(voCurrentCat, voCurrentSubcat);
  const q = voSearchQuery.trim().toLowerCase();
  // qNorm ว่างได้ (เช่นค้นหาเลข "5" หรือเฉพาะวรรณยุกต์) — includes("") เป็นจริงทุกคำ
  // จึงต้องเช็ค qNorm ก่อน ไม่งั้นผลค้นหาจะกลายเป็น "ทุกคำ"
  const qNorm = q && /[a-z]/i.test(q) ? voNormSearch(q) : "";
  const qTight = qNorm.replace(/\s+/g, "");

  if (!q) {
    voFilteredItems = allItems.slice();
  } else {
    voFilteredItems = allItems.filter((item) => voItemMatches(item, q, qNorm, qTight));
  }

  // Update stats
  const statsBadge = $("voStatsBadge");
  if (statsBadge) {
    if (voFilteredItems.length === allItems.length) {
      statsBadge.textContent = `${allItems.length} คำ`;
    } else {
      statsBadge.textContent = `พบ ${voFilteredItems.length} จาก ${allItems.length} คำ`;
    }
  }

  // Empty state
  const emptyNotice = $("voEmptyNotice");
  if (emptyNotice) {
    emptyNotice.hidden = voFilteredItems.length > 0;
    if (voFilteredItems.length === 0) {
      // ค้นหาในแท็บ HSK ระดับเดียวอาจไม่เจอ ทั้งที่คำนั้นอยู่ในระดับอื่น → บอกจำนวนให้ไปกด "ทั้งหมด"
      let otherLevels = 0;
      if (q && voCurrentCat === "hsk" && voCurrentSubcat !== "all") {
        const allHsk = voGetVocabItems("hsk", "all");
        for (const item of allHsk) {
          if (voItemMatches(item, q, qNorm, qTight)) otherLevels++;
        }
      }

      const emptyTitle = $("voEmptyTitle");
      const emptyDesc = $("voEmptyDesc");
      if (emptyTitle) {
        emptyTitle.textContent = otherLevels > 0
          ? `ไม่พบใน HSK ${voCurrentSubcat}`
          : (q ? "ไม่พบคำศัพท์ที่ตรงกับการค้นหา" : "ยังไม่มีคำศัพท์ในหมวดนี้");
      }
      if (emptyDesc) {
        if (otherLevels > 0) {
          emptyDesc.textContent = `พบ ${otherLevels} คำในระดับ HSK อื่น — กด "🌐 ทั้งหมด" ด้านบนเพื่อดู`;
        } else if (q) {
          emptyDesc.textContent = 'ลองค้นหาด้วยคำอื่น หรือกด "ทั้งหมด" เพื่อดูคำศัพท์ทั้งหมดในหมวดนี้';
        } else {
          emptyDesc.textContent = "ลองสลับหมวดหมู่หรือหมวดย่อยด้านบน";
        }
      }
    }
  }

  // Render cards
  const list = $("voList");
  if (list) list.innerHTML = "";
  voRenderedCount = 0;
  voActiveBtn = null;

  voRenderNextChunk();
  voFillViewport();

  if (resetScroll) {
    const screen = $("vocaboverview");
    if (screen) screen.scrollTop = 0;
  }
}

// เติมการ์ดเพิ่มถ้า chunk แรกยังไม่เต็มจอ (เช่นตอนซ่อนประโยค/คำแปล การ์ดจะเตี้ยมาก)
function voFillViewport() {
  const screen = $("vocaboverview");
  // clientHeight = 0 ตอนจอยังไม่ถูกแสดง (startVocabOverview เรียกก่อน switchScreen)
  // ถ้าไม่กันไว้จะ render ทุก chunk รวดเดียว
  if (!screen || !screen.clientHeight) return;
  let guard = 0;
  while (voRenderedCount < voFilteredItems.length &&
         screen.scrollHeight <= screen.clientHeight + 80 &&
         guard++ < 40) {
    voRenderNextChunk();
  }
}

// Render a batch of cards for performance
function voRenderNextChunk() {
  const list = $("voList");
  if (!list) return;

  const start = voRenderedCount;
  const end = Math.min(start + VO_CHUNK_SIZE, voFilteredItems.length);

  const fragment = document.createDocumentFragment();

  for (let i = start; i < end; i++) {
    const item = voFilteredItems[i];
    const card = voCreateCardElement(item, i + 1);
    fragment.appendChild(card);
  }

  list.appendChild(fragment);
  voRenderedCount = end;
}

// Create Card DOM Element
function voCreateCardElement(item, index) {
  const card = document.createElement("div");
  card.className = "vo-item";
  card.dataset.index = String(index - 1);
  card.dataset.zh = item.zh;

  // Header row
  const header = document.createElement("div");
  header.className = "vo-item-header";

  const main = document.createElement("div");
  main.className = "vo-item-main";

  const idxSpan = document.createElement("span");
  idxSpan.className = "vo-item-index";
  idxSpan.textContent = `#${index}`;
  main.appendChild(idxSpan);

  const zhSpan = document.createElement("span");
  zhSpan.className = "vo-item-zh";
  zhSpan.setAttribute("lang", "zh");
  zhSpan.textContent = item.zh;
  main.appendChild(zhSpan);

  const pySpan = document.createElement("span");
  pySpan.className = "vo-item-py";
  pySpan.textContent = item.py;
  main.appendChild(pySpan);

  if (item.subcat) {
    const tagSpan = document.createElement("span");
    tagSpan.className = "vo-item-tag";
    tagSpan.textContent = item.subcat;
    main.appendChild(tagSpan);
  }
  header.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "vo-item-actions";

  const soundBtn = document.createElement("button");
  soundBtn.type = "button";
  soundBtn.className = "vo-item-sound-btn";
  soundBtn.title = `ฟังเสียงคำว่า ${item.zh}`;
  soundBtn.setAttribute("aria-label", `ฟังเสียงคำว่า ${item.zh}`);
  soundBtn.textContent = "🔊";
  soundBtn.addEventListener("click", () => {
    voPlayWord(item, soundBtn);
  });
  actions.appendChild(soundBtn);

  header.appendChild(actions);
  card.appendChild(header);

  // Meaning row
  const meaning = document.createElement("div");
  meaning.className = "vo-item-meaning";

  const label = document.createElement("span");
  label.className = "vo-meaning-label";
  label.textContent = "คำแปล:";
  meaning.appendChild(label);

  const text = document.createElement("span");
  text.className = "vo-meaning-text";
  text.textContent = item.th;
  meaning.appendChild(text);

  card.appendChild(meaning);

  // Sentences Section
  const sentences = voFindSentencesForWord(voCurrentCat, item.zh, 2);

  const sentWrap = document.createElement("div");
  sentWrap.className = "vo-item-sentences";

  if (sentences.length > 0) {
    const sHeader = document.createElement("div");
    sHeader.className = "vo-sentences-header";

    const sTitle = document.createElement("span");
    sTitle.className = "vo-sentences-title";
    sTitle.textContent = "📝 ประโยคตัวอย่าง";
    sHeader.appendChild(sTitle);

    const sCount = document.createElement("span");
    sCount.className = "vo-sentences-count";
    sCount.textContent = `${sentences.length} ประโยค`;
    sHeader.appendChild(sCount);

    sentWrap.appendChild(sHeader);

    const sList = document.createElement("div");
    sList.className = "vo-sentence-list";

    for (const sent of sentences) {
      const sCard = document.createElement("div");
      sCard.className = "vo-sentence-card";

      const zhLine = document.createElement("div");
      zhLine.className = "vo-sentence-zh-line";

      const sZh = document.createElement("span");
      sZh.className = "vo-sent-zh";
      sZh.setAttribute("lang", "zh");
      sZh.textContent = sent.zh;
      zhLine.appendChild(sZh);

      const sZhBtn = document.createElement("button");
      sZhBtn.type = "button";
      sZhBtn.className = "vo-sent-sound-btn";
      sZhBtn.title = "ฟังเสียงประโยคภาษาจีน";
      sZhBtn.setAttribute("aria-label", "ฟังเสียงประโยคภาษาจีน");
      sZhBtn.textContent = "🔊 จีน";
      sZhBtn.addEventListener("click", () => {
        voPlaySentence(sent, false, sZhBtn);
      });
      zhLine.appendChild(sZhBtn);

      if (sent.th) {
        const sThBtn = document.createElement("button");
        sThBtn.type = "button";
        sThBtn.className = "vo-sent-th-sound-btn";
        sThBtn.title = "ฟังเสียงคำแปลภาษาไทย";
        sThBtn.setAttribute("aria-label", "ฟังเสียงคำแปลภาษาไทย");
        sThBtn.textContent = "🇹🇭 ไทย";
        sThBtn.addEventListener("click", () => {
          voPlaySentence(sent, true, sThBtn);
        });
        zhLine.appendChild(sThBtn);
      }

      sCard.appendChild(zhLine);

      if (sent.py) {
        const sPy = document.createElement("div");
        sPy.className = "vo-sent-py";
        sPy.textContent = sent.py;
        sCard.appendChild(sPy);
      }

      if (sent.th) {
        const sTh = document.createElement("div");
        sTh.className = "vo-sent-th";
        sTh.textContent = sent.th;
        sCard.appendChild(sTh);
      }

      if (sent.tag) {
        const sMeta = document.createElement("div");
        sMeta.className = "vo-sent-meta";
        const sTag = document.createElement("span");
        sTag.className = "vo-sent-topic";
        sTag.textContent = sent.tag;
        sMeta.appendChild(sTag);
        sCard.appendChild(sMeta);
      }

      sList.appendChild(sCard);
    }

    sentWrap.appendChild(sList);
  } else {
    const noSent = document.createElement("div");
    noSent.className = "vo-no-sentence-note";
    noSent.innerHTML = '<span class="vo-no-sent-icon">💬</span> ยังไม่มีประโยคตัวอย่างเฉพาะคำนี้';
    sentWrap.appendChild(noSent);
  }

  card.appendChild(sentWrap);

  // แตะตัวการ์ด = เปิด popup วิธีเขียนเส้นขีด (ปุ่มเสียง/ประโยคในการ์ดไม่เปิด)
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.title = `แตะเพื่อดูวิธีเขียน ${zhSpan.textContent}`;
  card.setAttribute("aria-label", `ดูวิธีเขียนคำ ${item.zh}`);
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, select, textarea")) return;
    voOpenStrokes(item);
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      voOpenStrokes(item);
    }
  });

  return card;
}

// ปุ่มลำโพง: wordAudio.play() เรียก stop() ตัวเก่าก่อน — onDone ของตัวเก่าจะไม่ถูกเรียก
// ดังนั้นต้องเคลียร์ .playing ของปุ่มก่อนหน้าเอง ไม่งั้นปุ่มค้างสถานะ "กำลังเล่น"
function voSetPlayingBtn(btn) {
  if (voActiveBtn && voActiveBtn !== btn) voActiveBtn.classList.remove("playing");
  voActiveBtn = btn || null;
  if (btn) btn.classList.add("playing");
}

function voClearPlayingBtn(btn) {
  if (btn) btn.classList.remove("playing");
  if (voActiveBtn === btn) voActiveBtn = null;
}

// Play single word
function voPlayWord(item, btn) {
  if (voPlayAllActive) voStopPlayAll();

  const zh = item.zh.split(/[｜|]/)[0].trim();
  const audioKey = wordAudioKey(item.zh, item.py);
  const spokenZh = audioKey === "了-le" ? "le" : zh;

  voSetPlayingBtn(btn);

  wordAudio.play([{ url: `audio/zh/${audioKey}.mp3`, tts: [spokenZh, "zh-CN"] }], () => {
    voClearPlayingBtn(btn);
  });
}

// Play sentence (Chinese or Thai)
function voPlaySentence(sent, isThai, btn) {
  if (voPlayAllActive) voStopPlayAll();

  const zh = (sent.zh || "").split(/[｜|]/)[0].trim();
  const th = (sent.th || "").trim();
  if (!zh) return;

  voSetPlayingBtn(btn);

  if (isThai) {
    wordAudio.play([{ url: `audio/th/${zh}.mp3`, tts: [th, "th-TH"] }], () => {
      voClearPlayingBtn(btn);
    });
  } else {
    wordAudio.play([{ url: `audio/zh/${zh}.mp3`, tts: [zh, "zh-CN"] }], () => {
      voClearPlayingBtn(btn);
    });
  }
}

// Auto-play hands-free review (ตามลำดับในกอง)
function voTogglePlayAll() {
  if (voPlayAllActive && voPlayMode === "order") {
    voStopPlayAll();
  } else {
    voStartPlayAll("order");
  }
}

// เล่นเสียงแบบสุ่ม ไม่เรียงตามลำดับคำในหมวด
function voTogglePlayRandom() {
  if (voPlayAllActive && voPlayMode === "shuffle") {
    voStopPlayAll();
  } else {
    voStartPlayAll("shuffle");
  }
}

function voStartPlayAll(mode) {
  if (voFilteredItems.length === 0) return;
  voPlayMode = mode === "shuffle" ? "shuffle" : "order";
  voPlayAllActive = true;
  voPlayAllIndex = 0;
  voPlayQueue = voPlayMode === "shuffle" ? voBuildShuffleQueue() : null;
  voSetPlayingBtn(null);
  voSyncPlayButtons();
  voPlayNextItem();
}

// สลับลำดับทั้งกองแบบ Fisher–Yates (ไม่ซ้ำจนครบ แล้วค่อยเริ่มรอบใหม่)
function voBuildShuffleQueue() {
  const n = voFilteredItems.length;
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  // อย่าเริ่มรอบใหม่ด้วยคำเดียวกับคำสุดท้ายของรอบก่อน
  if (n > 1 && order[0] === voLastPlayedIndex) {
    const tmp = order[0];
    order[0] = order[1];
    order[1] = tmp;
  }
  return order;
}

function voSyncPlayButtons() {
  const allBtn = $("voPlayAllBtn");
  if (allBtn) {
    const on = voPlayAllActive && voPlayMode === "order";
    allBtn.textContent = on ? "⏹ หยุดเล่นเสียง" : "▶ เล่นเสียงวน";
    allBtn.classList.toggle("playing", on);
    allBtn.setAttribute("aria-pressed", String(on));
  }
  const rndBtn = $("voPlayRandomBtn");
  if (rndBtn) {
    const on = voPlayAllActive && voPlayMode === "shuffle";
    rndBtn.textContent = on ? "⏹ หยุดสุ่ม" : "🔀 เล่นเสียงสุ่มคำ";
    rndBtn.classList.toggle("playing", on);
    rndBtn.setAttribute("aria-pressed", String(on));
  }
}

function voShowNowPlaying(item) {
  const box = $("voNowPlaying");
  if (!box || !item) return;
  const zh = $("voNpZh");
  const py = $("voNpPy");
  const th = $("voNpTh");
  if (zh) zh.textContent = String(item.zh || "").split(/[｜|]/)[0].trim();
  if (py) py.textContent = item.py || "";
  if (th) th.textContent = item.th || "";
  box.hidden = false;
}

function voHideNowPlaying() {
  const box = $("voNowPlaying");
  if (box) box.hidden = true;
}

function voStopPlayAll() {
  voPlayAllActive = false;
  clearTimeout(voPlayAllTimeout);
  voPlayAllTimeout = null;
  voPlayQueue = null;
  voSyncPlayButtons();
  voHideNowPlaying();

  // Remove active highlight
  const activeEl = document.querySelector(".vo-item.active-speaking");
  if (activeEl) activeEl.classList.remove("active-speaking");
}

// เลื่อนการ์ดที่กำลังเล่นมาไว้ "ใต้แถบ sticky" — scrollIntoView ไม่รู้จักแถบที่ทับอยู่
// (ถ้าใช้ scrollIntoView การ์ดจะไปอยู่ใต้แถบค้นหา มองไม่เห็น)
function voScrollCardUnderBar(card) {
  const screen = $("vocaboverview");
  if (!screen || !card) return;
  const bar = document.querySelector(".vo-topbar");
  const barH = (bar ? bar.offsetHeight : 0) + 10;
  const sRect = screen.getBoundingClientRect();
  const cRect = card.getBoundingClientRect();
  const top = cRect.top - sRect.top;
  const bottom = cRect.bottom - sRect.top;
  const viewH = screen.clientHeight;

  if (top < barH) {
    screen.scrollTop -= (barH - top);
  } else if (bottom > viewH - 10) {
    let delta = bottom - (viewH - 10);
    const roomDown = top - barH;   // เลื่อนลงได้อีกแค่ไหนก่อนหัวการ์ดจะมุดใต้แถบ
    if (roomDown > 0) delta = Math.min(delta, roomDown);
    screen.scrollTop += delta;
  }
}

function voPlayNextItem() {
  if (!voPlayAllActive) return;

  const total = voPlayQueue ? voPlayQueue.length : voFilteredItems.length;
  if (voPlayAllIndex >= total) {
    // เล่นครบทุกคำในกองแล้ว
    voStopPlayAll();
    return;
  }

  const itemIndex = voPlayQueue ? voPlayQueue[voPlayAllIndex] : voPlayAllIndex;
  const item = voFilteredItems[itemIndex];
  if (!item) {
    voStopPlayAll();
    return;
  }
  voLastPlayedIndex = itemIndex;

  voShowNowPlaying(item);

  // ไฮไลต์/เลื่อนจอเฉพาะโหมดตามลำดับ — โหมดสุ่มห้าม render กองเพิ่ม
  // ไม่งั้นการ์ดทั้ง 11,000 ใบจะถูกสร้างจนเปลืองหน่วยความจำ
  if (voPlayMode === "order") {
    while (itemIndex >= voRenderedCount && voRenderedCount < voFilteredItems.length) {
      voRenderNextChunk();
    }
    const list = $("voList");
    const card = list ? list.querySelector(`.vo-item[data-index="${itemIndex}"]`) : null;
    const prevActive = document.querySelector(".vo-item.active-speaking");
    if (prevActive) prevActive.classList.remove("active-speaking");
    if (card) {
      card.classList.add("active-speaking");
      voScrollCardUnderBar(card);
    }
  }

  const zh = item.zh.split(/[｜|]/)[0].trim();
  const audioKey = wordAudioKey(item.zh, item.py);
  const spokenZh = audioKey === "了-le" ? "le" : zh;

  const items = [{ url: `audio/zh/${audioKey}.mp3`, tts: [spokenZh, "zh-CN"] }];
  if (item.th && String(item.th).trim()) {
    items.push({ url: `audio/th/${audioKey}.mp3`, tts: [String(item.th).trim(), "th-TH"] });
  }

  wordAudio.play(items, () => {
    if (!voPlayAllActive) return;
    voPlayAllIndex++;
    voPlayAllTimeout = setTimeout(voPlayNextItem, 1200);
  });
}

// ขึ้นบนสุด: ระยะไกลๆ กระโดดทันที (smooth scroll เกินหลายจอช้าและค้างได้
// ถ้าแท็บถูกซ่อน/WebView หยุด animation) ระยะสั้นๆ ค่อยเลื่อนนุ่ม
function voScrollToTop() {
  const screen = $("vocaboverview");
  if (!screen || screen.scrollTop <= 0) return;
  if (screen.scrollTop > screen.clientHeight * 3) {
    screen.scrollTop = 0;
  } else {
    const start = screen.scrollTop;
    screen.scrollTo({ top: 0, behavior: "smooth" });
    // กันกรณี smooth scroll ไม่ขยับเลย (แท็บถูกซ่อน/WebView freeze animation)
    setTimeout(() => {
      if (screen.scrollTop > start * 0.5) screen.scrollTop = 0;
    }, 300);
  }
}

// throttle แบบ time-based: เรียกทันทีถ้าผ่านมานานพอ ไม่งั้นตั้ง timeout ไว้เรียกครั้งเดียว
// (ถ้าใช้ flag ธรรมดาแล้ว callback ไม่ถูกเรียก ระบบจะค้างถาวร)
function voRunScroll() {
  voScrollTimer = null;
  voScrollLast = Date.now();
  voHandleScroll();
}

function voThrottleScroll() {
  const elapsed = Date.now() - voScrollLast;
  if (elapsed >= VO_SCROLL_DELAY) {
    clearTimeout(voScrollTimer);
    voRunScroll();
    return;
  }
  if (voScrollTimer === null) {
    voScrollTimer = setTimeout(voRunScroll, VO_SCROLL_DELAY - elapsed);
  }
}

// Scroll handler for infinite scroll & Scroll-to-Top button
function voHandleScroll() {
  const screen = $("vocaboverview");
  if (!screen) return;

  const scrollTop = screen.scrollTop;
  const scrollHeight = screen.scrollHeight;
  const clientHeight = screen.clientHeight;

  // Show/hide scroll to top button
  const scrollTopBtn = $("voScrollTopBtn");
  if (scrollTopBtn) {
    scrollTopBtn.hidden = scrollTop < 350;
  }

  // If scrolled near bottom, render next chunk
  if (scrollTop + clientHeight >= scrollHeight - 400) {
    if (voRenderedCount < voFilteredItems.length) {
      voRenderNextChunk();
    }
  }
}

/* ---- popup วิธีเขียนตัวอักษร (แตะการ์ดคำศัพท์) ----
   ใช้ระบบเดียวกับตัวดูเส้นขีดของโหมดพจนานุกรม: loadBombLibrary() +
   แคช bombCharData (สลับ path vendor3/ ให้เอพีเคเอง), สร้าง writer "ครั้งเดียว"
   แล้วสลับตัวอักษรด้วย setCharacter เพราะ HanziWriter ผูก listener
   ระดับ document — ทำแบบ animation ล้วน ไม่มี listener ของโหมดทดสอบ */
let voStrokeWriter = null;
let voStrokeCurItem = null;
let voStrokeChars = [];
let voStrokeCharIndex = 0;
let voStrokeSeq = 0; // เพิ่มทุกครั้งที่เปิด/เล่น/ปิด — ยกเลิก chain async ที่ค้างอยู่

function voStrokeSize(box) {
  return Math.min(320, Math.max(160, (box && box.clientWidth) || 280));
}

function voEnsureStrokePopupWired() {
  if (voStrokePopupWired) return;
  const strokePopup = $("voStrokePopup");
  if (!strokePopup) return;
  voStrokePopupWired = true;
  $("voStrokeClose").addEventListener("click", () => {
    sfx.click();
    voCloseStrokes();
  });
  $("voStrokeReplay").addEventListener("click", () => {
    sfx.click();
    voStrokePlayChar();
  });
  $("voStrokeSound").addEventListener("click", () => {
    sfx.click();
    if (voStrokeCurItem) voPlayWord(voStrokeCurItem, null);
  });
  // แตะพื้นหลังนอกการ์ด = ปิด (เหมือน lightbox)
  strokePopup.addEventListener("click", (e) => {
    if (e.target === strokePopup) voCloseStrokes();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !strokePopup.hidden) voCloseStrokes();
  });
}

function voStrokeFit() {
  const box = $("voStrokeWriter");
  if (!box || !voStrokeWriter) return;
  const size = voStrokeSize(box);
  voStrokeWriter.updateDimensions({ width: size, height: size, padding: 10 });
}

async function voOpenStrokes(item) {
  const popup = $("voStrokePopup");
  if (!popup) return;
  voEnsureStrokePopupWired();
  if (voPlayAllActive) voStopPlayAll(); // กำลังจะดูเส้นขีดคำนี้ หยุดเล่นเสียงวนก่อน
  sfx.click();
  voStrokeCurItem = item;
  const zh = String(item.zh || "").split(/[｜|]/)[0].trim();
  voStrokeChars = [...zh].filter((c) => /[㐀-鿿豈-﫿]/.test(c));
  voStrokeCharIndex = 0;
  const zhEl = $("voStrokeZh"), pyEl = $("voStrokePy"), thEl = $("voStrokeTh");
  if (zhEl) zhEl.textContent = zh;
  if (pyEl) pyEl.textContent = item.py || "";
  if (thEl) thEl.textContent = item.th || "";
  const status = $("voStrokeStatus");
  popup.hidden = false;
  const closeBtn = $("voStrokeClose");
  if (closeBtn) closeBtn.focus({ preventScroll: true });

  const seq = ++voStrokeSeq;
  voStrokeBuildChips();
  if (!voStrokeChars.length) {
    if (status) status.textContent = "คำนี้ไม่มีตัวอักษรจีนให้ดูเส้นขีด";
    return;
  }
  if (status) status.textContent = "กำลังโหลดข้อมูลเส้นขีด…";
  try {
    await loadBombLibrary();
    await Promise.all([...new Set(voStrokeChars)].map(async (char) => {
      if (bombCharData.has(char)) return;
      try {
        const dataUrl = window.CR_OFFLINE_APP
          ? `vendor3/hanzi-writer-data/${encodeURIComponent(char)}.json`
          : `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`;
        const res = await fetch(dataUrl);
        const data = res.ok ? await res.json() : null;
        bombCharData.set(char, data && data.strokes && data.strokes.length ? data : null);
      } catch (e) { /* network error — leave uncached so the next open retries */ }
    }));
    if (popup.hidden || seq !== voStrokeSeq) return;
    if (!voStrokeChars.some((c) => bombCharData.get(c))) throw new Error("no stroke data");
    if (!voStrokeWriter) {
      const box = $("voStrokeWriter");
      const size = voStrokeSize(box);
      voStrokeWriter = new window.HanziWriter(box, {
        width: size, height: size, padding: 10,
        showCharacter: false, showOutline: true,
        strokeColor: "#203954", outlineColor: "#b8c4d0",
        charDataLoader: (char) => bombCharData.get(char),
      });
    } else {
      voStrokeFit(); // เปิดใหม่: viewport อาจถูก resize ไปแล้ว
    }
    if (status) status.textContent = "";
    voStrokePlayChar();
  } catch (e) {
    if (!popup.hidden && seq === voStrokeSeq && status) {
      status.textContent = "โหลดข้อมูลเส้นขีดไม่สำเร็จ — ต้องใช้อินเทอร์เน็ตครั้งแรก ลองปิดแล้วเปิดใหม่อีกครั้ง";
    }
  }
}

function voCloseStrokes() {
  const popup = $("voStrokePopup");
  if (!popup || popup.hidden) return;
  popup.hidden = true;
  voStrokeSeq++; // chain async ที่กำลังโหลด/เล่นอยู่ต้องยอมแพ้
  voStrokeCurItem = null;
}

function voStrokeBuildChips() {
  const wrap = $("voStrokeChars");
  if (!wrap) return;
  wrap.replaceChildren();
  voStrokeChars.forEach((char, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "vo-stroke-chip";
    chip.textContent = char;
    chip.lang = "zh";
    chip.title = `ดูเส้นขีดของตัว "${char}"`;
    chip.addEventListener("click", () => { sfx.click(); voStrokePlayChar(i); });
    wrap.appendChild(chip);
  });
  wrap.hidden = voStrokeChars.length < 2;
}

async function voStrokePlayChar(index = null) {
  if (!voStrokeWriter) return;
  if (index !== null) voStrokeCharIndex = index;
  const char = voStrokeChars[voStrokeCharIndex];
  if (char === undefined) return;
  const seq = ++voStrokeSeq;
  const status = $("voStrokeStatus");
  document.querySelectorAll("#voStrokeChars .vo-stroke-chip").forEach((c, i) => {
    c.classList.toggle("current", i === voStrokeCharIndex);
  });
  if (!bombCharData.get(char)) {
    if (status) status.textContent = `ไม่มีข้อมูลเส้นขีดของ "${char}"`;
    return;
  }
  if (status) status.textContent = "";
  try {
    await voStrokeWriter.setCharacter(char);
    if ($("voStrokePopup").hidden || seq !== voStrokeSeq) return;
    voStrokeWriter.loopCharacterAnimation();
  } catch (e) {
    const popup = $("voStrokePopup");
    if (!popup.hidden && seq === voStrokeSeq && status) {
      status.textContent = `โหลดเส้นขีดของ "${char}" ไม่สำเร็จ`;
    }
  }
}
