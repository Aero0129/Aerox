(() => {
  "use strict";

  const SHEET_ID = "1c5ds764deIdaK43Rt8xQiFPdazDHOf-Dyzo1B4Tb-c4";
  const SHEET_NAME = "Migration_DB";
  const CACHE_KEY = "s71200g2_migration_db_v2";
  const CACHE_TIME_KEY = "s71200g2_migration_db_time_v2";

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
    switchSearchBtn: $("#switchSearchBtn")
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

  function containsTcOrRtd(...values) {
    const text = values.map(v => clean(v)).join(" ").toUpperCase();
    return /(^|[^A-Z0-9])(TC|RTD)(?=$|[^A-Z0-9])/.test(text);
  }

  function contains5Vdc(...values) {
    const text = values.map(v => clean(v)).join(" ").toUpperCase();
    return /(^|[^A-Z0-9])5\s*VDC(?=$|[^A-Z0-9])/.test(text);
  }

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./service-worker.js")
        .catch((err) => console.warn("Service Worker 註冊失敗：", err));
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
          "請確認網路連線，以及 Google Sheet 已允許知道連結者檢視，工作表名稱為 Migration_DB。"
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
        has5Vdc: contains5Vdc(r.Old_Description, r.New_Description)
      };

      const existing = map.get(key);

      if (!existing) {
        map.set(key, item);
      } else {
        // 同一個新料號可能由多筆 Migration 對應而來：
        // 只要任一列的 Old/New Description 含 TC/RTD 或 5VDC，就保留特殊排序標記。
        existing.tcRtd = existing.tcRtd || item.tcRtd;
        existing.has5Vdc = existing.has5Vdc || item.has5Vdc;

        if (item.priority < existing.priority) {
          map.set(key, {
            ...item,
            tcRtd: existing.tcRtd || item.tcRtd,
            has5Vdc: existing.has5Vdc || item.has5Vdc
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
      messageHtml: el.messageBox.innerHTML
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
      return;
    }

    el.results.innerHTML = "";
    el.resultCount.textContent = "尚未搜尋";

    showMessage(
      "",
      mode === "io" ? "依 I/O 規格查詢" : "依 MLFB / 料號查詢",
      mode === "io"
        ? "輸入需要的 DI / DO / AI / AO 數量後按搜尋。"
        : "輸入舊料號或部分料號後按搜尋。"
    );
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
        Number(Boolean(a.has5Vdc)) - Number(Boolean(b.has5Vdc)) ||
        Number(Boolean(a.tcRtd)) - Number(Boolean(b.tcRtd)) ||
        a.partNo.localeCompare(b.partNo, "en")
      );
    } else {
      sorted.sort((a,b) =>
        Number(Boolean(a.has5Vdc)) - Number(Boolean(b.has5Vdc)) ||
        Number(Boolean(a.tcRtd)) - Number(Boolean(b.tcRtd)) ||
        a.score - b.score ||
        a.priority - b.priority ||
        a.partNo.localeCompare(b.partNo, "en")
      );
    }

    if (!sorted.length) {
      el.resultCount.textContent = "找不到符合條件的產品";
      showMessage("warning", "找不到符合需求的 S7-1200 G2 產品", "請降低部分 I/O 數量、將不限制的欄位留白，或改用 MLFB / 料號查詢。");
      saveResultView("io");
      return;
    }

    el.resultCount.textContent = `找到 ${sorted.length} 筆符合的產品`;

    el.results.innerHTML = sorted.slice(0, 30).map((p, i) => `
      <article class="result-card ${i === 0 ? "recommended" : ""}">
        <div><span class="badge ${i === 0 ? "best" : ""}">${i === 0 ? "推薦" : "其他選項"}</span></div>
        <div class="product-main">
          ${partNumberWithCopy(p.partNo, "h3")}
          <p class="desc">${esc(p.description || "S7-1200 G2 產品")}</p>
          ${p.category ? `<div class="category">${esc(p.category)}</div>` : ""}
        </div>
        ${specGrid(p)}
      </article>
    `).join("");

    saveResultView("io");
  }

  function searchMLFB() {
    if (!database.length) {
      showMessage("warning", "資料尚未載入", "請稍候資料同步完成。");
      return;
    }

    const raw = clean(el.mlfbInput.value);
    if (!raw) {
      window.alert("請輸入舊 MLFB / 料號，例如 6ES7211-1AE40-0XB0。");
      return;
    }

    const qNorm = normalizePart(raw);
    const qText = raw.toLowerCase();

    let rows = database.filter((r) => {
      const oldNorm = clean(r.Old_Part_Normalized) || normalizePart(r.Old_Part_No);
      const newNorm = clean(r.New_Part_Normalized) || normalizePart(r.New_Part_No);
      const desc = `${clean(r.Old_Description)} ${clean(r.New_Description)}`.toLowerCase();

      return (qNorm.length >= 2 && (oldNorm.includes(qNorm) || newNorm.includes(qNorm)))
        || (qText.length >= 2 && desc.includes(qText));
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
      saveResultView("mlfb");
      return;
    }

    const groups = groupRows(rows).slice(0, 25);
    el.resultCount.textContent = `找到 ${groups.length} 組舊料號對應資料`;

    el.results.innerHTML = groups.map((g) => {
      const first = g.successors[0] || {};
      return `
        <article class="migration-card">
          <div class="migration-head">
            <div class="migration-side">
              <small>舊版（S7-1200）</small>
              ${partNumberWithCopy(g.oldPart, "h3")}
              <p>${esc(g.oldDesc || "產品描述未提供")}</p>
            </div>

            <div class="arrow">→</div>

            <div class="migration-side new">
              <small>新版（S7-1200 G2）</small>
              ${partNumberWithCopy(first.New_Part_No || "", "h3")}
              <p>${esc(first.New_Description || "產品描述未提供")}</p>
            </div>
          </div>

          <div class="successor-list">
            ${g.successors.map((r) => {
              const type = clean(r.Successor_Type).toLowerCase();
              const rec = type === "recommended";
              const alt = type === "alternative";
              const typeText = rec ? "建議替代（Recommended）"
                : alt ? "替代方案（Alternative）"
                : (clean(r.Successor_Type) || "替代產品");

              return `
                <div class="successor ${rec ? "recommended" : ""}">
                  <span class="successor-type ${rec ? "recommended" : alt ? "alternative" : ""}">${esc(typeText)}</span>

                  <div class="successor-main">
                    ${partNumberWithCopy(r.New_Part_No, "h4")}
                    <p>${esc(r.New_Description || "產品描述未提供")}</p>
                  </div>

                  ${specGrid({
                    di: r.New_DI,
                    do: r.New_DO,
                    ai: r.New_AI,
                    ao: r.New_AO
                  })}
                </div>
              `;
            }).join("")}
          </div>
        </article>
      `;
    }).join("");

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

  registerServiceWorker();
  switchMode("io");
  loadDatabase();
})();
