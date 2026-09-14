(() => {
  "use strict";

  const SHEET_ID = "1c5ds764deIdaK43Rt8xQiFPdazDHOf-Dyzo1B4Tb-c4";
  const SHEET_NAME = "Migration_DB";
  const CACHE_KEY = "s71200g2_migration_db_v2";
  const CACHE_TIME_KEY = "s71200g2_migration_db_time_v2";
  
  // Visitor statistics API.
  // Paste your deployed Google Apps Script Web App /exec URL between the quotes.
  // Leave empty to completely disable statistics without affecting search.
  const VISITOR_API_URL = "https://script.google.com/macros/s/AKfycbyl0-vuo1b9N1gtK4L22vmwJhE5CWRjDjwEL9W_HdJpWgFQRYou2MKqpiGT9DlbMLclbA/exec";

  

  let database = [];
  let products = [];
  let currentMode = "io";
  let lastIoResults = [];

  // 兩個搜尋頁面各自保存自己的結果，互不覆蓋。
  const resultViews = {
    io: null,
    mlfb: null
  };

  const $ = (s) => document.querySelector(s);

  const el = {
    tabIo: $("#tabIo"),
    tabMlfb: $("#tabMlfb"),
    panelIo: $("#panelIo"),
    panelMlfb: $("#panelMlfb"),
    ioForm: $("#ioForm"),
    mlfbForm: $("#mlfbForm"),
    mlfbInput: $("#mlfbInput"),
    ioDI: $("#ioDI"),
    ioDO: $("#ioDO"),
    ioAI: $("#ioAI"),
    ioAO: $("#ioAO"),
    results: $("#results"),
    resultCount: $("#resultCount"),
    messageBox: $("#messageBox"),
    sortWrap: $("#sortWrap"),
    sortSelect: $("#sortSelect"),
    statusDot: $("#statusDot"),
    statusText: $("#statusText"),
    footerUpdate: $("#footerUpdate"),
    reloadDataBtn: $("#reloadDataBtn"),
    switchSearchBtn: $("#switchSearchBtn"),
    bottomHelp: $("#help")
  };

  function clean(v) {
    return String(v ?? "").trim();
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizePart(v) {
    return clean(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function normalizeDescription(v) {
    return clean(v).toUpperCase();
  }

  function compactDescription(v) {
    return normalizeDescription(v).replace(/[^A-Z0-9]/g, "");
  }

  function escapeRegExp(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function descriptionMatches(description, query) {
    const text = normalizeDescription(description);
    const q = normalizeDescription(query);

    if (!q || q.length < 2) return false;

    const compactQ = compactDescription(q);

    // 純英文字母縮寫：
    // CP / CM / SB / SM / CB / CPU ... 都必須是獨立字詞。
    // 例如 CP 不會誤中 CPU；CPU 則會正常找到 CPU。
    if (/^[A-Z]+$/.test(compactQ)) {
      const re = new RegExp(
        `(^|[^A-Z0-9])${escapeRegExp(compactQ)}(?=$|[^A-Z0-9])`,
        "i"
      );
      return re.test(text);
    }

    // 英文縮寫 + 數字：
    // 忽略空格與符號，例如：
    // CM1、CM 1、CM-1 都可匹配 CM 1241
    // CP1 可匹配 CP 1243-1
    // SB1 可匹配 SB 1221
    if (/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]+$/.test(compactQ)) {
      return compactDescription(text).includes(compactQ);
    }

    // 一般文字仍採包含搜尋。
    return text.includes(q);
  }

  function containsTcOrRtd(...values) {
    const text = values.map(v => clean(v)).join(" ").toUpperCase();
    return /(^|[^A-Z0-9])(TC|RTD)(?=$|[^A-Z0-9])/.test(text);
  }

  function contains5Vdc(...values) {
    const text = values.map(v => clean(v)).join(" ").toUpperCase();
    return /(^|[^A-Z0-9])5\s*VDC(?=$|[^A-Z0-9])/.test(text);
  }

  function containsIoFailSafe(description) {
    const text = clean(description).toLowerCase();
    return text.includes("digital fail-safe") || text.includes("digital f-i/o");
  }

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function displayCategory(category) {
    const value = clean(category);
    const normalized = value.toLowerCase();

    if (
      normalized === "digital signal boards" ||
      normalized === "digital signal modules"
    ) {
      return "";
    }

    return value;
  }

  function fmtTime(d = new Date()) {
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
  }

  function setStatus(type, text) {
    el.statusDot.className = `status-dot ${type}`;
    el.statusText.textContent = text;
  }

  function getCacheTime() {
    const raw = localStorage.getItem(CACHE_TIME_KEY);
    if (!raw) return null;

    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function loadCachedDatabase() {
    try {
      const rows = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      if (!Array.isArray(rows) || !rows.length) return false;

      database = rows;
      products = uniqueProducts(database);
      return true;
    } catch (_) {
      database = [];
      products = [];
      return false;
    }
  }

  function showCachedStatus({ offline = false } = {}) {
    const saved = getCacheTime();
    const timeText = saved ? fmtTime(saved) : "時間不明";

    if (offline) {
      setStatus("offline", `離線模式・使用上次資料：${timeText}`);
      el.footerUpdate.textContent = `離線模式・使用上次資料：${timeText}`;
    } else {
      setStatus("error", `無法取得最新資料・使用上次資料：${timeText}`);
      el.footerUpdate.textContent = `目前使用上次資料：${timeText}`;
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;

    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          "./service-worker.js",
          { updateViaCache: "none" }
        );

        // 每次開啟網站都主動檢查 Service Worker 是否有新版。
        await registration.update();
      } catch (err) {
        console.warn("Service Worker 註冊或更新失敗：", err);
      }
    });
  }

  function showMessage(type, title, detail) {
    el.results.innerHTML = "";
    el.messageBox.hidden = false;
    el.messageBox.className = `info-box ${type || ""}`;
    el.messageBox.innerHTML = `
      <span class="info-icon">${type === "error" || type === "warning" ? "!" : "i"}</span>
      <div>
        <strong>${esc(title)}</strong>
        <p>${esc(detail)}</p>
      </div>
    `;
  }

  function hideMessage() {
    el.messageBox.hidden = true;
  }

  function showEmptyState(mode) {
    el.results.innerHTML = "";
    el.messageBox.hidden = false;
    el.messageBox.className = "info-box empty-state";

    const isIo = mode === "io";
    el.messageBox.innerHTML = `
      <span class="empty-search-icon">⌕</span>
      <div>
        <strong>尚未搜尋</strong>
        <p>${isIo
          ? "輸入 I/O 數量後按「搜尋」，即可查看符合條件的產品。"
          : "輸入 MLFB / 料號後按「搜尋」，即可查看對應產品。"}</p>
      </div>
    `;

    el.bottomHelp.hidden = true;
  }

  function buildSheetUrl(callbackName) {
    const tqx = `out:json;responseHandler:${callbackName}`;
    const qs = new URLSearchParams({
      sheet: SHEET_NAME,
      headers: "1",
      tq: "select *",
      tqx,
      _: String(Date.now())
    });

    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${qs.toString()}`;
  }

  function loadSheet() {
    return new Promise((resolve, reject) => {
      const cb = `__sheet_${Date.now()}_${Math.floor(Math.random() * 99999)}`;
      const script = document.createElement("script");
      let done = false;

      const cleanup = () => {
        try { delete window[cb]; } catch (_) {}
        script.remove();
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("讀取逾時"));
      }, 15000);

      window[cb] = (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();

        if (!response || response.status !== "ok" || !response.table) {
          reject(new Error("Google Sheet 回傳錯誤"));
          return;
        }

        const headers = response.table.cols.map((c, i) => clean(c.label) || `Column_${i+1}`);

        if (!headers.includes("Old_Part_No") || !headers.includes("New_Part_No")) {
          reject(new Error("Migration_DB 欄位格式不符"));
          return;
        }

        const rows = response.table.rows.map((r) => {
          const obj = {};
          headers.forEach((h, i) => {
            const cell = r.c?.[i];
            obj[h] = cell ? (cell.v ?? cell.f ?? "") : "";
          });
          return obj;
        }).filter(r => clean(r.Old_Part_No) || clean(r.New_Part_No));

        resolve(rows);
      };

      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error("無法連線到 Google Sheet"));
      };

      script.src = buildSheetUrl(cb);
      script.async = true;
      document.head.appendChild(script);
    });
  }

  function isEnabled(row) {
    const v = clean(row.Search_Enabled).toLowerCase();
    return !(v === "0" || v === "false" || v === "no");
  }

  async function loadDatabase({ manual = false } = {}) {
    setStatus("loading", manual ? "重新同步中..." : "正在取得最新資料...");
    el.reloadDataBtn.disabled = true;

    // 明確偵測到離線時，直接使用 localStorage，不等待 Google Sheet 逾時。
    if (!navigator.onLine) {
      if (loadCachedDatabase()) {
        showCachedStatus({ offline: true });
      } else {
        setStatus("error", "離線模式・尚無可用的快取資料");
        el.footerUpdate.textContent = "尚未建立離線資料";
        showMessage(
          "error",
          "目前沒有網路，也沒有快取資料",
          "請先在有網路時成功開啟網站一次，完成 Migration_DB 同步。"
        );
      }

      el.reloadDataBtn.disabled = false;
      return;
    }

    try {
      // 有網路時，每次開啟／重新同步都優先讀取最新 Google Sheet。
      database = (await loadSheet()).filter(isEnabled);
      products = uniqueProducts(database);

      const now = new Date();
      localStorage.setItem(CACHE_KEY, JSON.stringify(database));
      localStorage.setItem(CACHE_TIME_KEY, now.toISOString());

      setStatus("ok", `資料已更新：${fmtTime(now)}`);
      el.footerUpdate.textContent = `資料已更新：${fmtTime(now)}・${database.length} 筆`;
    } catch (err) {
      console.error(err);

      if (loadCachedDatabase()) {
        // 如果請求期間剛好斷線，顯示真正的離線模式；
        // 若瀏覽器仍判定在線，則顯示「最新資料讀取失敗」。
        const offline = !navigator.onLine;
        showCachedStatus({ offline });

        showMessage(
          "warning",
          offline ? "目前為離線模式" : "無法取得最新資料",
          "自動改用上一次下載的資料庫。"
        );
      } else {
        setStatus("error", "資料讀取失敗");
        el.footerUpdate.textContent = "目前沒有可用資料";
        showMessage(
          "error",
          "無法讀取 Migration_DB",
          "請確認網路連線後再試一次。"
        );
      }
    } finally {
      el.reloadDataBtn.disabled = false;
    }
  }

  function uniqueProducts(rows) {
    const map = new Map();

    rows.forEach((r) => {
      const part = clean(r.New_Part_No);
      if (!part) return;

      const key = clean(r.New_Part_Normalized) || normalizePart(part);

      const item = {
        partNo: part,
        description: clean(r.New_Description),
        category: clean(r.Category),
        di: num(r.New_DI),
        do: num(r.New_DO),
        ai: num(r.New_AI),
        ao: num(r.New_AO),
        priority: num(r.Priority) || 999,
        successorType: clean(r.Successor_Type),
        tcRtd: containsTcOrRtd(r.Old_Description, r.New_Description),
        has5Vdc: contains5Vdc(r.Old_Description, r.New_Description),
        ioFailSafe: containsIoFailSafe(r.New_Description)
      };

      const existing = map.get(key);

      if (!existing) {
        map.set(key, item);
      } else {
        // 同一個新料號可能由多筆 Migration 對應而來：
        // 只要任一列的 Old/New Description 含 TC/RTD 或 5VDC，就保留特殊排序標記。
        existing.tcRtd = existing.tcRtd || item.tcRtd;
        existing.has5Vdc = existing.has5Vdc || item.has5Vdc;
        existing.ioFailSafe = existing.ioFailSafe || item.ioFailSafe;

        if (item.priority < existing.priority) {
          map.set(key, {
            ...item,
            tcRtd: existing.tcRtd || item.tcRtd,
            has5Vdc: existing.has5Vdc || item.has5Vdc,
            ioFailSafe: existing.ioFailSafe || item.ioFailSafe
          });
        }
      }
    });

    return [...map.values()];
  }

  async function copyPartNumber(partNo, button) {
    const text = clean(partNo);
    if (!text) return;

    let copied = false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_) {
      copied = false;
    }

    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        copied = document.execCommand("copy");
      } catch (_) {
        copied = false;
      } finally {
        textarea.remove();
      }
    }

    if (button) {
      const original = button.textContent;
      button.textContent = copied ? "已複製" : "複製失敗";
      button.classList.toggle("copied", copied);
      window.setTimeout(() => {
        button.textContent = original;
        button.classList.remove("copied");
      }, 1400);
    }
  }

  function partNumberWithCopy(partNo, tag = "h3") {
    const safePart = esc(partNo);
    return `
      <div class="part-number-row">
        <${tag}>${safePart}</${tag}>
        <button
          class="copy-part-btn"
          type="button"
          data-copy-part="${safePart}"
          aria-label="複製料號 ${safePart}"
        >複製</button>
      </div>
    `;
  }

  function specGrid(data) {
    const items = [
      ["DI", num(data.di ?? data.New_DI ?? data.Old_DI)],
      ["DO", num(data.do ?? data.New_DO ?? data.Old_DO)],
      ["AI", num(data.ai ?? data.New_AI ?? data.Old_AI)],
      ["AO", num(data.ao ?? data.New_AO ?? data.Old_AO)]
    ];

    return `
      <div class="spec-grid">
        ${items.map(([label, value]) => `
          <div class="spec">
            <strong>${esc(value)}</strong>
            <span>${label}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function saveResultView(mode) {
    resultViews[mode] = {
      resultHtml: el.results.innerHTML,
      resultCount: el.resultCount.textContent,
      messageHidden: el.messageBox.hidden,
      messageClass: el.messageBox.className,
      messageHtml: el.messageBox.innerHTML,
      bottomHelpHidden: el.bottomHelp.hidden
    };
  }

  function restoreResultView(mode) {
    const saved = resultViews[mode];

    if (saved) {
      el.results.innerHTML = saved.resultHtml;
      el.resultCount.textContent = saved.resultCount;
      el.messageBox.hidden = saved.messageHidden;
      el.messageBox.className = saved.messageClass;
      el.messageBox.innerHTML = saved.messageHtml;
      el.bottomHelp.hidden = saved.bottomHelpHidden ?? true;
      return;
    }

    el.results.innerHTML = "";
    el.resultCount.textContent = "尚未搜尋";
    showEmptyState(mode);
  }

  function switchMode(mode) {
    currentMode = mode;
    const io = mode === "io";

    el.tabIo.classList.toggle("active", io);
    el.tabMlfb.classList.toggle("active", !io);
    el.tabIo.setAttribute("aria-selected", io ? "true" : "false");
    el.tabMlfb.setAttribute("aria-selected", io ? "false" : "true");

    el.panelIo.hidden = !io;
    el.panelMlfb.hidden = io;

    // 排序只屬於 I/O 搜尋頁面。
    el.sortWrap.style.display = io ? "" : "none";

    // 顯示該頁自己最後一次的搜尋結果。
    restoreResultView(mode);
  }

  // ----- Visitor statistics (non-blocking) -----
  const trackingCooldown = {};

  function getVisitorId() {
    const key = "s7_g2_visitor_id";

    try {
      let visitorId = localStorage.getItem(key);

      if (!visitorId) {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          visitorId = window.crypto.randomUUID();
        } else {
          visitorId =
            "visitor_" +
            Date.now() +
            "_" +
            Math.random().toString(36).slice(2);
        }

        localStorage.setItem(key, visitorId);
      }

      return visitorId;
    } catch (error) {
      console.warn("Visitor ID unavailable:", error);
      return null;
    }
  }

  function trackEvent(eventType) {
    try {
      // Statistics are optional. If URL is blank, do nothing.
      if (!VISITOR_API_URL) return;

      const allowedEvents = new Set([
        "visit",
        "io_search",
        "mlfb_search"
      ]);

      if (!allowedEvents.has(eventType)) return;

      const now = Date.now();

      // Prevent accidental double counting from rapid repeated clicks.
      if (
        trackingCooldown[eventType] &&
        now - trackingCooldown[eventType] < 500
      ) {
        return;
      }

      trackingCooldown[eventType] = now;

      const visitorId = getVisitorId();
      if (!visitorId) return;

      // Fire-and-forget: NEVER await this request.
      // Search and page initialization continue immediately even if
      // Apps Script / Google Sheet is slow or unavailable.
      fetch(VISITOR_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          visitorId,
          eventType
        }),
        keepalive: true
      }).catch((error) => {
        console.warn("Visitor tracking failed:", error);
      });
    } catch (error) {
      console.warn("Visitor tracking error:", error);
    }
  }

  function ioReq() {
    const get = (input) => input.value.trim() === "" ? null : Math.max(0, num(input.value));

    return {
      di: get(el.ioDI),
      do: get(el.ioDO),
      ai: get(el.ioAI),
      ao: get(el.ioAO)
    };
  }

  function ioScore(product, req, fields) {
    return fields.reduce((score, key) => {
      const diff = product[key] - req[key];
      if (req[key] > 0) return score + diff / req[key];
      return score + diff * 0.02;
    }, 0);
  }

  function searchIO() {
    if (!database.length) {
      el.bottomHelp.hidden = true;
      showMessage("warning", "資料尚未載入", "請稍候資料同步完成。");
      return;
    }

    const req = ioReq();
    const fields = ["di", "do", "ai", "ao"].filter(k => req[k] !== null);
    const hasPositive = fields.some(k => req[k] > 0);

    if (!fields.length || !hasPositive) {
      window.alert("請輸入至少一項 I/O 需求，例如 4DO、2AI 或 16DI / 16DO。");
      return;
    }

    trackEvent("io_search");

    lastIoResults = products
      // I/O 規格搜尋只找 G2 模組，不顯示 CPU。
      // Google Sheet 的 CPU 類別例如：
      // CPU modules "small"、CPU modules "failsafe" 等，
      // 因此只要 Category 內包含 "CPU modules" 就排除。
      .filter(p => !clean(p.category).toLowerCase().includes("cpu modules"))
      .filter(p => fields.every(k => p[k] >= req[k]))
      .map(p => ({ ...p, score: ioScore(p, req, fields) }));

    renderIO(lastIoResults);
  }

  function renderIO(rows) {
    hideMessage();

    const sorted = [...rows];
    if (el.sortSelect.value === "part") {
      sorted.sort((a,b) =>
        Number(Boolean(a.ioFailSafe)) - Number(Boolean(b.ioFailSafe)) ||
        Number(Boolean(a.has5Vdc)) - Number(Boolean(b.has5Vdc)) ||
        Number(Boolean(a.tcRtd)) - Number(Boolean(b.tcRtd)) ||
        a.partNo.localeCompare(b.partNo, "en")
      );
    } else {
      sorted.sort((a,b) =>
        Number(Boolean(a.ioFailSafe)) - Number(Boolean(b.ioFailSafe)) ||
        Number(Boolean(a.has5Vdc)) - Number(Boolean(b.has5Vdc)) ||
        Number(Boolean(a.tcRtd)) - Number(Boolean(b.tcRtd)) ||
        a.score - b.score ||
        a.priority - b.priority ||
        a.partNo.localeCompare(b.partNo, "en")
      );
    }

    if (!sorted.length) {
      el.resultCount.textContent = "找不到符合條件的產品";
      showMessage("warning", "找不到符合需求的 S7-1200 G2 產品", "請降低數量，只輸入單顆模組I/O 數量，非需求總數。");
      el.bottomHelp.hidden = false;
      saveResultView("io");
      return;
    }

    el.resultCount.textContent = `找到 ${sorted.length} 筆符合的產品`;
    el.bottomHelp.hidden = false;

    const recommendedCount = sorted.length > 3 ? 3 : 1;

    el.results.innerHTML = sorted.slice(0, 30).map((p, i) => {
      const isRecommended = i < recommendedCount;
      return `
      <article class="result-card ${isRecommended ? "recommended" : ""}">
        <div><span class="badge ${isRecommended ? "best" : ""}">${isRecommended ? "推薦" : "其他選項"}</span></div>
        <div class="product-main">
          ${partNumberWithCopy(p.partNo, "h3")}
          <p class="desc">${esc(p.description || "S7-1200 G2 產品")}</p>
        </div>
        ${specGrid(p)}
      </article>
    `;
    }).join("");

    saveResultView("io");
  }

  function searchMLFB() {
    if (!database.length) {
      el.bottomHelp.hidden = true;
      showMessage("warning", "資料尚未載入", "請稍候資料同步完成。");
      return;
    }

    const raw = clean(el.mlfbInput.value);
    if (!raw) {
      window.alert("請輸入舊 MLFB / 料號，例如 6ES7211-1AE40-0XB0。");
      return;
    }

    trackEvent("mlfb_search");

    const qNorm = normalizePart(raw);

    let rows = database.filter((r) => {
      const oldNorm = clean(r.Old_Part_Normalized) || normalizePart(r.Old_Part_No);
      const newNorm = clean(r.New_Part_Normalized) || normalizePart(r.New_Part_No);
      const desc = `${clean(r.Old_Description)} ${clean(r.New_Description)}`;

      return (qNorm.length >= 2 && (oldNorm.includes(qNorm) || newNorm.includes(qNorm)))
        || descriptionMatches(desc, raw);
    });

    const exact = rows.filter((r) => {
      const oldNorm = clean(r.Old_Part_Normalized) || normalizePart(r.Old_Part_No);
      return oldNorm === qNorm;
    });

    if (exact.length) rows = exact;

    renderMLFB(rows);
  }

  function groupRows(rows) {
    const map = new Map();

    rows.forEach((r) => {
      const key = clean(r.Old_Part_Normalized) || normalizePart(r.Old_Part_No) || clean(r.Old_Part_No);

      if (!map.has(key)) {
        map.set(key, {
          oldPart: clean(r.Old_Part_No),
          oldDesc: clean(r.Old_Description),
          oldDI: num(r.Old_DI),
          oldDO: num(r.Old_DO),
          oldAI: num(r.Old_AI),
          oldAO: num(r.Old_AO),
          tcRtd: containsTcOrRtd(r.Old_Description, r.New_Description),
          has5Vdc: contains5Vdc(r.Old_Description, r.New_Description),
          successors: []
        });
      }

      const group = map.get(key);
      group.tcRtd = group.tcRtd || containsTcOrRtd(r.Old_Description, r.New_Description);
      group.has5Vdc = group.has5Vdc || contains5Vdc(r.Old_Description, r.New_Description);
      group.successors.push(r);
    });

    const groups = [...map.values()];

    groups.forEach((g) => {
      g.successors.sort((a,b) => {
        const a5Vdc = contains5Vdc(a.Old_Description, a.New_Description) ? 1 : 0;
        const b5Vdc = contains5Vdc(b.Old_Description, b.New_Description) ? 1 : 0;
        const aTcRtd = containsTcOrRtd(a.Old_Description, a.New_Description) ? 1 : 0;
        const bTcRtd = containsTcOrRtd(b.Old_Description, b.New_Description) ? 1 : 0;
        const ar = clean(a.Successor_Type).toLowerCase() === "recommended" ? 0 : 1;
        const br = clean(b.Successor_Type).toLowerCase() === "recommended" ? 0 : 1;

        // 5VDC 絕對最後；其次是 TC / RTD；
        // 再看 Recommended / Alternative 與 Priority。
        return a5Vdc - b5Vdc ||
          aTcRtd - bTcRtd ||
          ar - br ||
          num(a.Priority) - num(b.Priority);
      });
    });

    // 若 MLFB / 關鍵字一次找到多組舊料號：
    // 5VDC 整組最後，其次 TC / RTD，最後才按舊料號排序。
    groups.sort((a,b) =>
      Number(Boolean(a.has5Vdc)) - Number(Boolean(b.has5Vdc)) ||
      Number(Boolean(a.tcRtd)) - Number(Boolean(b.tcRtd)) ||
      a.oldPart.localeCompare(b.oldPart, "en")
    );

    return groups;
  }

  function renderMLFB(rows) {
    hideMessage();

    if (!rows.length) {
      el.resultCount.textContent = "找不到對應資料";
      showMessage("warning", "找不到 Migration 資料", "請確認料號是否正確，也可以只輸入部分料號。");
      el.bottomHelp.hidden = false;
      saveResultView("mlfb");
      return;
    }

    const groups = groupRows(rows).slice(0, 25);
    el.resultCount.textContent = `找到 ${groups.length} 組舊料號對應資料`;
    el.bottomHelp.hidden = false;

    const cards = groups.flatMap((g) => {
      const successors = g.successors?.length ? g.successors : [{}];
      return successors.map((r) => `
        <article class="migration-card">
          <div class="migration-head migration-head-desktop">
            <div class="migration-side old-side">
              <small>舊版（S7-1200）</small>
              ${partNumberWithCopy(g.oldPart, "h3")}
              <p>${esc(g.oldDesc || "產品描述未提供")}</p>
            </div>

            <div class="arrow desktop-arrow">→</div>

            <div class="migration-side new new-side">
              <small>新版（S7-1200 G2）</small>
              ${partNumberWithCopy(r.New_Part_No || "", "h3")}
              <p>${esc(r.New_Description || "產品描述未提供")}</p>
            </div>
          </div>

          <div class="migration-bottom">
            <div class="migration-bottom-specs">
              ${specGrid({
                di: r.New_DI,
                do: r.New_DO,
                ai: r.New_AI,
                ao: r.New_AO
              })}
            </div>
          </div>
        </article>
      `);
    });

    el.results.innerHTML = cards.join("");

    saveResultView("mlfb");
  }

  el.results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-part]");
    if (!button) return;
    copyPartNumber(button.dataset.copyPart, button);
  });

  el.tabIo.addEventListener("click", () => switchMode("io"));
  el.tabMlfb.addEventListener("click", () => switchMode("mlfb"));

  el.ioForm.addEventListener("submit", (e) => {
    e.preventDefault();
    searchIO();
  });

  el.mlfbForm.addEventListener("submit", (e) => {
    e.preventDefault();
    searchMLFB();
  });

  el.sortSelect.addEventListener("change", () => {
    if (currentMode === "io" && lastIoResults.length) renderIO(lastIoResults);
  });

  el.reloadDataBtn.addEventListener("click", () => loadDatabase({ manual: true }));

  el.switchSearchBtn.addEventListener("click", () => {
    switchMode(currentMode === "io" ? "mlfb" : "io");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.querySelectorAll("[data-scroll]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.scroll);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  window.addEventListener("offline", () => {
    if (loadCachedDatabase()) {
      showCachedStatus({ offline: true });
    } else {
      setStatus("error", "離線模式・尚無可用的快取資料");
      el.footerUpdate.textContent = "尚未建立離線資料";
    }
  });

  window.addEventListener("online", () => {
    setStatus("loading", "網路已恢復・正在更新資料...");
    loadDatabase();
  });

  // ===== Mobile Pull-to-Refresh (safe / isolated) =====
  // 桌機版完全不執行此功能；即使手機端初始化失敗，也不影響原本功能。
  function initPullToRefresh() {
    // 第一行就先擋掉桌機版，避免任何 DOM / 狀態修改。
    const mobileMedia = window.matchMedia("(max-width: 760px)");
    if (!mobileMedia.matches) return;

    // 支援一般手機瀏覽器與「加入主畫面」standalone 模式。
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    if (document.getElementById("pullRefreshIndicator")) return;

    const style = document.createElement("style");
    style.id = "pullRefreshStyle";
    style.textContent = `
      #pullRefreshIndicator {
        position: fixed;
        left: 50%;
        top: calc(env(safe-area-inset-top, 0px) + 10px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-width: 126px;
        height: 38px;
        padding: 0 14px;
        border: 1px solid rgba(183, 199, 216, 0.9);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        color: #425b76;
        box-shadow: 0 4px 14px rgba(26, 50, 75, 0.10);
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        opacity: 0;
        pointer-events: none;
        transform: translate(-50%, -64px);
        transition: transform 160ms ease, opacity 160ms ease, color 160ms ease;
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
      }
      #pullRefreshIndicator.visible { opacity: 1; }
      #pullRefreshIndicator.ready { color: #087f5b; }
      #pullRefreshIndicator.refreshing .pull-refresh-icon {
        animation: pullRefreshSpin 0.75s linear infinite;
      }
      @keyframes pullRefreshSpin {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        #pullRefreshIndicator { transition: none; }
        #pullRefreshIndicator.refreshing .pull-refresh-icon { animation: none; }
      }
    `;
    document.head.appendChild(style);

    const indicator = document.createElement("div");
    indicator.id = "pullRefreshIndicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.setAttribute("data-display-mode", isStandalone ? "standalone" : "browser");
    indicator.innerHTML = `
      <span class="pull-refresh-icon" aria-hidden="true">↓</span>
      <span class="pull-refresh-text">下拉更新</span>
    `;
    document.body.appendChild(indicator);

    const icon = indicator.querySelector(".pull-refresh-icon");
    const text = indicator.querySelector(".pull-refresh-text");

    const THRESHOLD = 82;
    const SHOW_AFTER = 18;
    const MAX_PULL = 124;

    let startY = 0;
    let distance = 0;
    let pulling = false;
    let refreshing = false;

    function isInteractiveTarget(target) {
      if (!target || typeof target.closest !== "function") return false;
      return Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"));
    }

    function resetIndicator() {
      distance = 0;
      indicator.classList.remove("visible", "ready", "refreshing");
      indicator.style.transform = "translate(-50%, -64px)";
      icon.textContent = "↓";
      text.textContent = "下拉更新";
    }

    function updateIndicator() {
      const clamped = Math.min(Math.max(distance, 0), MAX_PULL);
      const eased = clamped * 0.58;
      indicator.style.transform = `translate(-50%, ${-54 + eased}px)`;

      if (distance >= SHOW_AFTER) indicator.classList.add("visible");
      else indicator.classList.remove("visible");

      if (distance >= THRESHOLD) {
        indicator.classList.add("ready");
        icon.textContent = "↻";
        text.textContent = "放開更新";
      } else {
        indicator.classList.remove("ready");
        icon.textContent = "↓";
        text.textContent = "下拉更新";
      }
    }

    document.addEventListener("touchstart", (event) => {
      if (refreshing || !mobileMedia.matches) return;
      if (!event.touches || event.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      if (isInteractiveTarget(event.target)) return;

      startY = event.touches[0].clientY;
      distance = 0;
      pulling = true;
    }, { passive: true });

    document.addEventListener("touchmove", (event) => {
      if (!pulling || refreshing) return;
      if (!event.touches || event.touches.length !== 1) return;

      distance = event.touches[0].clientY - startY;

      if (distance <= 0 || window.scrollY > 0) {
        pulling = false;
        resetIndicator();
        return;
      }

      if (event.cancelable) event.preventDefault();
      updateIndicator();
    }, { passive: false });

    document.addEventListener("touchend", () => {
      if (!pulling || refreshing) return;
      pulling = false;

      if (distance >= THRESHOLD) {
        refreshing = true;
        indicator.classList.remove("ready");
        indicator.classList.add("visible", "refreshing");
        indicator.style.transform = "translate(-50%, 0)";
        icon.textContent = "↻";
        text.textContent = "更新中…";

        window.setTimeout(() => {
          window.location.reload();
        }, 260);
        return;
      }

      resetIndicator();
    }, { passive: true });

    document.addEventListener("touchcancel", () => {
      if (refreshing) return;
      pulling = false;
      resetIndicator();
    }, { passive: true });

    // 不使用 optional method call，避免特定瀏覽器相容性問題。
    if (typeof mobileMedia.addEventListener === "function") {
      mobileMedia.addEventListener("change", (event) => {
        if (!event.matches) resetIndicator();
      });
    }
  }

  // Pull-to-Refresh 必須和原本初始化完全隔離。
  try {
    initPullToRefresh();
  } catch (err) {
    console.warn("Pull-to-Refresh 初始化失敗，已略過：", err);
  }

  registerServiceWorker();
  switchMode("io");
  loadDatabase();

  // One visit per actual page load / reload.
  // This request runs in the background and never blocks normal use.
  trackEvent("visit");
})();
