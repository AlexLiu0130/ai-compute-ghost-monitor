"use strict";

const LEVEL_ORDER = { alert: 0, watch: 1, log: 2 };
const SCORE_KEYS = [
  ["credibility", "来源可信度", "Source"],
  ["novelty", "新颖度", "Novelty"],
  ["theme_strength", "主题强度", "Theme"],
  ["contagion", "传染范围", "Contagion"],
  ["market_confirmation", "市场确认", "Market"],
];
const LEVEL_ZH = { alert: "警报", watch: "观察", log: "记录" };
const LEVEL_EN = { alert: "Alert", watch: "Watch", log: "Log" };
const DIR_ZH = { bullish: "利多", bearish: "利空", mixed: "混合", watch: "观察" };
const DIR_EN = { bullish: "Bullish", bearish: "Bearish", mixed: "Mixed", watch: "Watch" };
const TYPE_ZH = {
  compute_overcapacity: "算力过剩",
  capex_roi_doubt: "CapEx 回报质疑",
  order_inventory_weakness: "订单/库存走弱",
  hbm_shortage: "HBM/内存短缺",
  capacity_flood: "产能扩张/供给冲击",
  data_center_delay: "数据中心延期",
  financing_stress: "融资压力",
  export_regulatory: "出口/监管",
  capital_markets_memory: "内存资本市场事件",
  ordinary_ai_news: "普通 AI 新闻",
};
const TYPE_EN = {
  compute_overcapacity: "Compute Overcapacity",
  capex_roi_doubt: "CapEx ROI Doubt",
  order_inventory_weakness: "Order / Inventory Weakness",
  hbm_shortage: "HBM / Memory Shortage",
  capacity_flood: "Capacity Expansion",
  data_center_delay: "Data Center Delay",
  financing_stress: "Financing Stress",
  export_regulatory: "Export / Regulation",
  capital_markets_memory: "Memory Capital Markets",
  ordinary_ai_news: "Ordinary AI News",
};
// 品类色：类型/链条各占一个色相，颜色编码含义
const TYPE_COLOR = {
  compute_overcapacity: "#b18bf4",
  capex_roi_doubt: "#e58fb1",
  order_inventory_weakness: "#f0883e",
  hbm_shortage: "#67d4e0",
  capacity_flood: "#6cb6ff",
  data_center_delay: "#e3b341",
  financing_stress: "#ff8f7a",
  export_regulatory: "#9fb6c9",
  capital_markets_memory: "#58c8a5",
  ordinary_ai_news: "#8b949e",
};
const LAYER_COLOR = {
  accelerator: "#6cb6ff",
  basket: "#9fb6c9",
  compute_leasing: "#b18bf4",
  hyperscaler: "#67d4e0",
  power_cooling: "#58c8a5",
  server_infra: "#f0883e",
  foundry_equipment_eda: "#e58fb1",
  memory_storage: "#e3b341",
};

function typeColor(t) {
  return TYPE_COLOR[t] || "#9ba7b4";
}

const LAYER_ZH = {
  accelerator: "AI 芯片/网络",
  basket: "板块 ETF",
  compute_leasing: "算力租赁",
  hyperscaler: "云厂商",
  power_cooling: "电力/散热",
  server_infra: "服务器/机房设备",
  foundry_equipment_eda: "晶圆代工/设备/EDA",
  memory_storage: "内存/存储",
};
const LAYER_EN = {
  accelerator: "AI Chips / Networking",
  basket: "Sector ETF",
  compute_leasing: "Compute Leasing",
  hyperscaler: "Cloud",
  power_cooling: "Power / Cooling",
  server_infra: "Server / Data Center Infra",
  foundry_equipment_eda: "Foundry / Equipment / EDA",
  memory_storage: "Memory / Storage",
};

const state = { alerts: [], filter: "all", selected: null, lang: localStorage.getItem("ghost-lang") || "zh" };

const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function fmtType(t) {
  const map = state.lang === "en" ? { ...TYPE_EN, ...LAYER_EN } : { ...TYPE_ZH, ...LAYER_ZH };
  return map[t] || String(t || "").replace(/_/g, " ");
}

function parseTime(value) {
  const raw = String(value || "");
  if (/^\d{8}T\d{0,6}/.test(raw)) {
    const digits = raw.slice(9).replace(/\D/g, "").slice(0, 6).padEnd(6, "0");
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}Z`);
  }
  if (/^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`);
  }
  return new Date(raw);
}

function relTime(iso) {
  if (!iso) return "";
  const ms = Date.now() - parseTime(iso).getTime();
  if (!isFinite(ms)) return "";
  const min = Math.round(ms / 60000);
  if (state.lang === "en") {
    if (min < 1) return "now";
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  }
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function sortAlerts(rows) {
  return [...rows].sort((a, b) =>
    parseTime(b.published_at).getTime() - parseTime(a.published_at).getTime() ||
    (LEVEL_ORDER[a.alert_level] ?? 9) - (LEVEL_ORDER[b.alert_level] ?? 9) ||
    b.ghost_score - a.ghost_score
  );
}

function newsTitle(a) {
  return state.lang === "en" ? (a.title || a.title_zh || "") : (a.title_zh || a.title || "");
}

function newsSummary(a) {
  return state.lang === "en" ? (a.summary || a.summary_zh || "") : (a.summary_zh || a.summary || "");
}

function titleHtml(a) {
  return `<div class="title-zh">${esc(newsTitle(a))}</div>`;
}

function englishRaw(a) {
  if (!a.title && !a.summary) return "";
  return `<details class="english-raw">
    <summary>英文原文</summary>
    ${a.title ? `<p>${esc(a.title)}</p>` : ""}
    ${a.summary ? `<p>${esc(a.summary)}</p>` : ""}
  </details>`;
}

const DIR_ORDER = ["bearish", "mixed", "bullish", "watch"];
const DIR_GLYPH = { bearish: "▼", mixed: "◆", bullish: "▲", watch: "○" };

function dirCounts(a) {
  const counts = {};
  for (const d of Object.values(a.ticker_directions || {})) {
    counts[d] = (counts[d] || 0) + 1;
  }
  return counts;
}

function dominantDir(counts) {
  return Object.entries(counts)
    .filter(([d]) => d !== "watch")
    .sort((x, y) => y[1] - x[1])[0] || null;
}

// feed 卡片底部的迷你方向分布条：一眼看出信号偏向
function miniDist(a) {
  const counts = dirCounts(a);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (!total) return "";
  const segs = DIR_ORDER.filter((d) => counts[d])
    .map((d) => `<span class="dist-seg d-${d}" style="width:${(counts[d] / total) * 100}%"></span>`)
    .join("");
  const dom = dominantDir(counts);
  const label = dom
    ? `<span class="mini-label dir-${esc(dom[0])}">${esc((state.lang === "en" ? DIR_EN : DIR_ZH)[dom[0]])} ${dom[1]}/${total}</span>`
    : "";
  return `<span class="mini-dist">${segs}</span>${label}`;
}

function impactFor(a, ticker) {
  return (a.market_impact || []).find((x) => x.symbol === ticker) || null;
}

function ui(zh, en) {
  return state.lang === "en" ? en : zh;
}

/* ---------- 标的影响：聚合重复、突出例外 ---------- */

function probText(p) {
  if (!p || !p.sample_size) return "";
  const up = Math.round(p.p_up * 100);
  const conf = p.confidence == null ? "" : `${state.lang === "en" ? ", confidence " : "，置信 "}${Math.round(p.confidence * 100)}%`;
  const move = p.expected_reaction_pct == null ? "" : `${state.lang === "en" ? ", avg " : "，均值 "}${p.expected_reaction_pct > 0 ? "+" : ""}${p.expected_reaction_pct}%`;
  return state.lang === "en" ? `Overall: up ${up}% / down ${100 - up}%${conf}${move}` : `总体预测：反应涨 ${up}% / 跌 ${100 - up}%${conf}${move}`;
}

function groupProb(a, tickers) {
  const rows = tickers.map((t) => a.ml_predictions?.[t]).filter((p) => p && p.sample_size > 0);
  if (!rows.length) return null;
  const weight = (p) => Math.max(1, Math.min(50, p.sample_size || 1));
  const total = rows.reduce((s, p) => s + weight(p), 0);
  return {
    p_up: rows.reduce((s, p) => s + p.p_up * weight(p), 0) / total,
    confidence: rows.reduce((s, p) => s + (p.confidence || 0) * weight(p), 0) / total,
    expected_reaction_pct: rows.reduce((s, p) => s + (p.expected_reaction_pct || 0) * weight(p), 0) / total,
    sample_size: Math.max(...rows.map((p) => p.sample_size || 0)),
  };
}

function dirCardHtml(a, t, d) {
  const q = a.current_prices?.[t] || {};
  const price = q.price != null ? `<span class="px">${ui("现价", "Price")} ${esc(q.price)}</span>` : "";
  const whyRaw = a.direction_reasons?.[t] || "";
  const why = state.lang === "en" && hasCjk(whyRaw) ? "" : whyRaw;
  return `<div class="dir-card tint-${esc(d)}">
    <div class="dir-card-head">
      <span class="ticker">${esc(t)}</span>
      ${price}
      <span class="glyph dir-${esc(d)}">${DIR_GLYPH[d] || ""}</span>
    </div>
    ${why ? `<div class="why">${esc(why)}</div>` : ""}
    ${impactHtml(a, t)}
  </div>`;
}

const MAX_CORE = 18;
const MAX_PILLS = 24;

function tickerRank(a, t) {
  const direct = (a.symbols || []).includes(t) ? 100 : 0;
  const storage = ["MU", "WDC", "SNDK", "STX", "005930.KS", "000660.KS"].includes(t) ? 35 : 0;
  const foundry = ["TSM", "ASML", "AMAT", "LRCX", "KLAC", "SNPS", "CDNS"].includes(t) ? 25 : 0;
  const accelerator = ["NVDA", "AMD", "AVGO", "MRVL", "INTC", "QCOM", "ANET"].includes(t) ? 20 : 0;
  const etf = ["SMH", "SOXX", "QQQ", "XLK"].includes(t) ? 10 : 0;
  const price = a.current_prices?.[t]?.price != null ? 4 : 0;
  const impact = impactFor(a, t) && !impactFor(a, t).error ? 3 : 0;
  return direct + storage + foundry + accelerator + etf + price + impact;
}

function dirSectionHtml(a) {
  const dirs = a.ticker_directions || {};
  const total = Object.keys(dirs).length;
  if (!total) return "";

  const groups = {};
  for (const [t, d] of Object.entries(dirs)) (groups[d] ||= []).push(t);
  const counts = dirCounts(a);
  const dom = dominantDir(counts);
  const verdict = dom
    ? (state.lang === "en"
      ? { bearish: "Bearish Bias", bullish: "Bullish Bias", mixed: "Mixed Bias" }[dom[0]]
      : { bearish: "方向偏空", bullish: "方向偏多", mixed: "方向分歧" }[dom[0]])
    : ui("方向观望", "Watch");
  const verdictDir = dom ? dom[0] : "watch";
  const domProb = dom ? probText(groupProb(a, groups[dom[0]] || [])) : "";

  const bar = DIR_ORDER.filter((d) => counts[d])
    .map((d) => `<span class="dist-seg d-${d}" style="width:${(counts[d] / total) * 100}%"></span>`)
    .join("");
  const legend = DIR_ORDER.filter((d) => counts[d])
    .map((d) => `<span class="dir-${d}">${DIR_GLYPH[d]} ${esc((state.lang === "en" ? DIR_EN : DIR_ZH)[d] || d)} ${counts[d]}</span>`)
    .join("");

  // 卡片入场券：有解释、现价或事件表现；否则只折叠成标签
  const hasImpact = (t) => {
    const x = impactFor(a, t);
    return x && !x.error;
  };
  const isCore = (t) => (a.symbols || []).includes(t) || !!a.direction_reasons?.[t] || a.current_prices?.[t]?.price != null || hasImpact(t);

  const groupsHtml = DIR_ORDER.filter((d) => groups[d]?.length)
    .map((d) => {
      const tickers = [...groups[d]].sort((x, y) => {
        const w = (t) =>
          (a.direction_reasons?.[t] ? 4 : 0) +
          (a.current_prices?.[t]?.price != null ? 2 : 0) +
          ((a.symbols || []).includes(t) ? 1 : 0);
        return tickerRank(a, y) - tickerRank(a, x) || w(y) - w(x) || x.localeCompare(y);
      });
      const core = tickers.filter(isCore).slice(0, MAX_CORE);
      const rest = tickers.filter((t) => !core.includes(t));
      const prob = probText(groupProb(a, groups[d]));

      const cards = core.map((t) => dirCardHtml(a, t, d)).join("");
      const pills = rest
        .map((t, i) => `<span class="pill${i >= MAX_PILLS ? " pill-extra" : ""}">${esc(t)}</span>`)
        .join("");
      const more = rest.length > MAX_PILLS
        ? `<button type="button" class="pill pill-more">+${rest.length - MAX_PILLS} 更多</button>`
        : "";

      return `<div class="dir-group">
        <div class="dir-group-head">
          <span class="g-name dir-${esc(d)}">${DIR_GLYPH[d]} ${esc((state.lang === "en" ? DIR_EN : DIR_ZH)[d] || d)} · ${tickers.length}</span>
          ${prob ? `<span class="g-prob">${esc(prob)}</span>` : ""}
          <span class="g-line"></span>
        </div>
        ${cards ? `<div class="core-grid">${cards}</div>` : ""}
        ${pills ? `<div class="pill-wall">${pills}${more}</div>` : ""}
      </div>`;
    })
    .join("");

  return `
    <div class="dir-overview">
      <span class="dir-verdict dir-${esc(verdictDir)}">${esc(verdict)}</span>
      <span class="dir-sub">${dom ? ui(`${total} 个标的中 ${dom[1]} 个${esc(DIR_ZH[dom[0]])}`, `${dom[1]} of ${total} tickers ${esc(DIR_EN[dom[0]])}`) : ui(`${total} 个标的均为观察`, `${total} tickers on watch`)}</span>
      ${domProb ? `<span class="dir-prob">${esc(domProb)}</span>` : ""}
    </div>
    <div class="dist-bar">${bar}</div>
    <div class="dist-legend">${legend}</div>
    ${groupsHtml}
    <div class="score-note dim">${ui("方向由语义模型判断；概率为历史反应窗口校准的实验值，非交易建议。", "Direction is model-assisted; probabilities are experimental historical calibrations, not trading advice.")}</div>`;
}

function impactHtml(a, ticker) {
  const impact = impactFor(a, ticker);
  if (!impact) return `<span class="event-impact muted">${ui("暂无事件后价格", "No post-event price")}</span>`;
  if (impact.error) return `<span class="event-impact muted">${ui("暂无事件后价格", "No post-event price")}</span>`;
  if (impact.pending) {
    const day = impact.expected_reaction_date ? `：${impact.expected_reaction_date}` : "";
    return `<span class="event-impact muted">${ui("等待反应交易日收盘", "Waiting for reaction close")}${esc(day)}</span>`;
  }
  const close = impact.reaction_close ?? impact.event_close;
  const pct = impact.reaction_pct ?? impact.event_day_pct;
  if (close == null && pct == null) return "";
  const label = ui("反应收盘", "Reaction close");
  const pctLabel = ui("反应", "Reaction");
  const pctText = pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`;
  const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
  return `<span class="event-impact">${label} ${esc(close ?? "—")} · ${pctLabel} <b class="${cls}">${esc(pctText)}</b></span>`;
}

/* ---------- feed ---------- */

function dayBucket(iso) {
  if (!iso) return ui("更早", "Earlier");
  const days = Math.floor((Date.now() - parseTime(iso).getTime()) / 86400000);
  if (days <= 0) return ui("今天", "Today");
  if (days === 1) return ui("昨天", "Yesterday");
  if (days < 7) return ui("本周", "This Week");
  if (days < 30) return ui("本月", "This Month");
  return ui("更早", "Earlier");
}

function renderFeed() {
  const rows = sortAlerts(state.alerts).filter(
    (a) => state.filter === "all" || a.alert_level === state.filter
  );
  const feed = $("#feed");
  if (!rows.length) {
    feed.innerHTML = `<div class="feed-empty">${ui("暂无信号", "No signals")}</div>`;
    return;
  }
  let bucket = null;
  feed.innerHTML = rows
    .map((a, i) => {
      const b = dayBucket(a.published_at);
      const sep = b !== bucket ? `<div class="feed-sep">${esc(b)}</div>` : "";
      bucket = b;
      const idx = state.alerts.indexOf(a);
      const topTickers = Object.keys(a.ticker_directions || {})
        .sort((x, y) => tickerRank(a, y) - tickerRank(a, x) || x.localeCompare(y))
        .slice(0, 12).map(esc).join(" · ");
      return `${sep}<button class="row lvl-${esc(a.alert_level)}${idx === state.selected ? " selected" : ""}"
        data-idx="${idx}" style="--i:${i}">
        <div class="row-head">
          <span class="badge lvl-${esc(a.alert_level)}">${esc((state.lang === "en" ? LEVEL_EN : LEVEL_ZH)[a.alert_level] || a.alert_level)}</span>
          <span class="ghost-type" style="--tc:${esc(typeColor(a.ghost_type))}">${esc(fmtType(a.ghost_type))}</span>
          <span class="row-time">${relTime(a.published_at)}</span>
          <span class="score row-score lvl-${esc(a.alert_level)}" title="${ui("鬼故事分：100分制，越高越值得提醒", "Ghost score: 0-100, higher means stronger signal")}"><small>${ui("鬼分", "Score")}</small>${esc(a.ghost_score)}</span>
        </div>
        <div class="row-title">${titleHtml(a)}</div>
        <div class="row-foot">
          ${miniDist(a)}
          ${topTickers ? `<span class="tickers">${topTickers}</span>` : ""}
          <span class="src">${esc(a.source)}</span>
        </div>
      </button>`;
    })
    .join("");
}

/* ---------- detail ---------- */

function segBar(n, rowIdx) {
  const val = Math.max(0, Math.min(3, Number(n) || 0));
  let cells = "";
  for (let i = 1; i <= 3; i++) {
    cells += `<span class="seg${i <= val ? ` on-${val}` : ""}" style="--d:${rowIdx * 3 + i}"></span>`;
  }
  return `<span class="seg-bar">${cells}</span>`;
}

function renderDetail(a, container) {
  const scoreRows = SCORE_KEYS.map(
    ([key, zh, en], i) =>
      `<span class="k">${ui(zh, en)}</span>${segBar(a[key], i)}<span class="v">${esc(a[key] ?? "—")}</span>`
  ).join("");

  const layers = (a.affected_layers || [])
    .map((l) => `<span class="layer-chip" style="--tc:${esc(LAYER_COLOR[l] || "#9fb6c9")}">${esc(fmtType(l))}</span>`)
    .join("");

  const rationale = (a.rationale || [])
    .map(formatRationale)
    .filter((r) => state.lang === "zh" || !hasCjk(r))
    .map((r) => `<li>${esc(r)}</li>`)
    .join("");

  const published = a.published_at
    ? parseTime(a.published_at).toLocaleString()
    : "";
  const url = safeUrl(a.url);

  container.innerHTML = `
    <div class="detail-inner">
    <div class="detail-head">
      <div class="detail-badges">
        <span class="detail-score score lvl-${esc(a.alert_level)}">${esc(a.ghost_score)}</span>
        <span class="badge lvl-${esc(a.alert_level)}">${esc((state.lang === "en" ? LEVEL_EN : LEVEL_ZH)[a.alert_level] || a.alert_level)}</span>
        <span class="dir-tag type-tag" style="--tc:${esc(typeColor(a.ghost_type))}">${esc(fmtType(a.ghost_type))}</span>
        <span class="dir-tag">${a.analysis_method === "llm" ? ui("大模型分析", "LLM") : ui("规则兜底", "Rules")}</span>
        <span class="row-time">${relTime(a.published_at)}</span>
      </div>
      <h2 class="detail-title">${titleHtml(a)}</h2>
      ${newsSummary(a) ? `<div class="detail-summary" style="--tc:${esc(typeColor(a.ghost_type))}"><p>${esc(newsSummary(a))}</p></div>` : ""}
      <div class="detail-meta">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(a.source)} ↗</a>` : `<span>${esc(a.source)}</span>`}
        ${published ? `<span>${esc(published)}</span>` : ""}
      </div>
    </div>

    <div class="section-label">${ui("评分拆解", "Score")}</div>
    <div class="score-note">${ui("鬼分为 100 分制：20 以下影响较小，20-59 进入观察，60 以上警报。", "Ghost score is 0-100: below 20 is minor, 20-59 is watch, 60+ is alert.")}</div>
    <div class="score-grid">${scoreRows}</div>

    <div class="section-label">${ui("影响链条", "Impact Chain")}</div>
    <div class="layer-chips">${layers || "—"}</div>

    <div class="section-label">${ui("标的影响", "Ticker Impact")}</div>
    ${dirSectionHtml(a) || `<div class="score-note">${ui("无标的方向数据", "No ticker direction data")}</div>`}

    <div class="section-label">${ui("判断依据", "Rationale")}</div>
    <ul class="rationale-list">${rationale || "<li>—</li>"}</ul>

    <details class="raw">
      <summary>${ui("原始 JSON", "Raw JSON")}</summary>
      <pre>${esc(JSON.stringify(a, null, 2))}</pre>
    </details>
    </div>`;

  countUp(container.querySelector(".detail-score"), Number(a.ghost_score) || 0);
  container.scrollTop = 0;
}

function countUp(el, target, dur = 500) {
  if (!el || !target) return;
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

function formatRationale(text) {
  if (state.lang === "en") return String(text || "");
  return String(text || "")
    .replace(/^type=/, "类型：")
    .replace(/^source_credibility=/, "来源可信度：")
    .replace(/^matched_keywords=/, "命中关键词：")
    .replace(/^affected_layers=/, "影响链条：")
    .replace("market confirmation weak or missing", "市场确认较弱或缺失")
    .replaceAll("ordinary_ai_news", "普通 AI 新闻")
    .replaceAll("compute_overcapacity", "算力过剩")
    .replaceAll("capex_roi_doubt", "CapEx 回报质疑")
    .replaceAll("order_inventory_weakness", "订单/库存走弱")
    .replaceAll("hbm_shortage", "HBM/内存短缺")
    .replaceAll("capacity_flood", "产能扩张/供给冲击")
    .replaceAll("data_center_delay", "数据中心延期")
    .replaceAll("financing_stress", "融资压力")
    .replaceAll("export_regulatory", "出口/监管")
    .replaceAll("capital_markets_memory", "内存资本市场事件")
    .replaceAll("accelerator", "AI 芯片/网络")
    .replaceAll("basket", "板块 ETF")
    .replaceAll("compute_leasing", "算力租赁")
    .replaceAll("hyperscaler", "云厂商")
    .replaceAll("power_cooling", "电力/散热")
    .replaceAll("server_infra", "服务器/机房设备")
    .replaceAll("foundry_equipment_eda", "晶圆代工/设备/EDA")
    .replaceAll("memory_storage", "内存/存储");
}

/* ---------- topbar ---------- */

function renderStats() {
  const counts = { alert: 0, watch: 0, log: 0 };
  for (const a of state.alerts) counts[a.alert_level] = (counts[a.alert_level] || 0) + 1;
  $("#count-total").textContent = state.alerts.length;
  $("#count-alert").textContent = counts.alert;
  $("#count-watch").textContent = counts.watch;
  $("#count-log").textContent = counts.log;
  document.querySelector(".brand h1").innerHTML = state.lang === "en"
    ? "AI&nbsp;Compute&nbsp;<em>Ghost</em>&nbsp;Monitor"
    : "AI&nbsp;算力&nbsp;<em>鬼故事</em>&nbsp;监控";
  $("#count-total").parentElement.lastChild.textContent = ` ${ui("信号", "Signals")}`;
  $("#count-alert").parentElement.lastChild.textContent = ` ${ui("警报", "Alerts")}`;
  $("#count-watch").parentElement.lastChild.textContent = ` ${ui("观察", "Watch")}`;
  $("#count-log").parentElement.lastChild.textContent = ` ${ui("记录", "Logs")}`;
  $("#updated-at").textContent = `${ui("更新", "Updated")} ${new Date().toLocaleTimeString()}`;
  $("#lang-btn").textContent = state.lang === "zh" ? "中文" : "EN";
  const chipCounts = { all: state.alerts.length, alert: counts.alert, watch: counts.watch, log: counts.log };
  const chipNames = { all: ui("全部", "All"), alert: ui("警报", "Alert"), watch: ui("观察", "Watch"), log: ui("记录", "Log") };
  for (const key of Object.keys(chipCounts)) {
    document.querySelector(`[data-level="${key}"]`).innerHTML = `${chipNames[key]} <span class="n">${chipCounts[key]}</span>`;
  }
  document.querySelector('[data-view="monitor"]').textContent = ui("监控", "Monitor");
  document.querySelector('[data-view="analyze"]').textContent = ui("分析", "Analyze");
  $("#capture-btn").textContent = ui("自动抓取中", "Auto Capture");
}

/* ---------- data ---------- */

async function loadAlerts() {
  const btn = $("#refresh-btn");
  btn.classList.add("spinning");
  if (!state.alerts.length) {
    $("#feed").innerHTML = Array.from({ length: 7 }, (_, i) =>
      `<div class="row skeleton" style="--i:${i}">
        <span class="sk" style="width:55%"></span>
        <span class="sk sk-lg" style="width:88%"></span>
        <span class="sk" style="width:70%"></span>
      </div>`).join("");
  }
  try {
    const res = await fetch(`alerts.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    state.alerts = await res.json();
    $("#live-dot").classList.remove("dead");
    if ((state.selected === null || !state.alerts[state.selected]) && state.alerts.length) {
      state.selected = state.alerts.indexOf(sortAlerts(state.alerts)[0]);
    }
    renderStats();
    renderFeed();
    if (state.selected !== null && state.alerts[state.selected]) {
      renderDetail(state.alerts[state.selected], $("#detail"));
    }
  } catch (err) {
    $("#live-dot").classList.add("dead");
    $("#updated-at").textContent = "API 离线";
  } finally {
    btn.classList.remove("spinning");
  }
}

async function loadCaptureStatus() {
  $("#capture-btn").textContent = ui("每 15 分钟更新", "Updates every 15m");
  $("#capture-btn").title = ui("GitHub Actions 自动刷新最新信号", "GitHub Actions refreshes live signals");
}

/* ---------- events ---------- */

$("#feed").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const idx = Number(row.dataset.idx);
  if (!state.alerts[idx]) return;
  state.selected = idx;
  document.querySelectorAll("#feed .row").forEach((r) =>
    r.classList.toggle("selected", r === row)
  );
  renderDetail(state.alerts[state.selected], $("#detail"));
});

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.filter = chip.dataset.level;
  document.querySelectorAll("#filters .chip").forEach((c) =>
    c.classList.toggle("active", c === chip)
  );
  renderFeed();
});

$("#refresh-btn").addEventListener("click", loadAlerts);

// “+N 更多”展开折叠的标的（详情区每次重渲染，用委托监听）
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".pill-more");
  if (!btn) return;
  btn.closest(".pill-wall").classList.add("expanded");
  btn.remove();
});

// ↑/↓ 键在信号列表中移动选择
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if ($("#view-monitor").hidden) return;
  if (e.target instanceof Element && e.target.matches("input, textarea, select")) return;
  const rows = [...document.querySelectorAll("#feed .row[data-idx]")];
  if (!rows.length) return;
  e.preventDefault();
  const cur = rows.findIndex((r) => r.classList.contains("selected"));
  const next = rows[Math.max(0, Math.min(rows.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)))];
  if (next && !next.classList.contains("selected")) {
    next.click();
    next.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
});

$("#lang-btn").addEventListener("click", () => {
  state.lang = state.lang === "zh" ? "en" : "zh";
  localStorage.setItem("ghost-lang", state.lang);
  renderStats();
  renderFeed();
  if (state.selected !== null && state.alerts[state.selected]) {
    renderDetail(state.alerts[state.selected], $("#detail"));
  }
});

$("#capture-btn").addEventListener("click", async () => {
  await loadAlerts();
  await loadCaptureStatus();
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t === tab)
    );
    $("#view-monitor").hidden = tab.dataset.view !== "monitor";
    $("#view-analyze").hidden = tab.dataset.view !== "analyze";
  });
});

function analyzeLocal(payload) {
  const text = `${payload.title} ${payload.summary}`.toLowerCase();
  const rules = {
    compute_overcapacity: ["excess compute", "excess ai compute", "excess capacity", "overcapacity", "算力过剩", "过度建设"],
    capex_roi_doubt: ["roi", "overspending", "ai spending", "capex", "回报", "支出"],
    order_inventory_weakness: ["order cut", "inventory", "backlog", "selloff", "订单", "库存"],
    hbm_shortage: ["hbm shortage", "sold out", "memory shortage", "供不应求", "短缺"],
    capacity_flood: ["capacity expansion", "supply flood", "price war", "扩产", "价格战"],
    data_center_delay: ["data center delay", "power constraint", "permitting delay", "数据中心延期", "电力约束"],
    financing_stress: ["debt financing", "equity raise", "refinancing", "融资", "债务"],
    export_regulatory: ["export control", "restriction", "sanction", "出口管制", "制裁"],
  };
  const ranked = Object.entries(rules).map(([type, words]) => [type, words.filter((word) => text.includes(word))]).sort((a, b) => b[1].length - a[1].length);
  const [ghostType, hits] = ranked[0][1].length ? ranked[0] : ["ordinary_ai_news", []];
  const credibility = /reuters|bloomberg|sec|公司公告|company ir/i.test(payload.source) ? 3 : /yahoo|cnbc|fortune|wsj|ft/i.test(payload.source) ? 2 : 1;
  const novelty = /new|first|announced|reportedly|plans to|最新|首次|宣布/i.test(text) ? 3 : 2;
  const theme = hits.length ? 3 : /ai|chip|gpu|hbm|compute|semiconductor|芯片|算力|内存/i.test(text) ? 2 : 1;
  const ghostScore = Math.max(0, Math.min(100, Math.round((((credibility * novelty * theme * 2) - 1) / 242) ** .45 * 100)));
  const symbols = payload.symbols.map((x) => x.toUpperCase());
  const defaultDirection = ["hbm_shortage", "capacity_flood"].includes(ghostType) ? "bullish" : ghostType === "ordinary_ai_news" ? "watch" : "bearish";
  const tickerDirections = Object.fromEntries(symbols.map((symbol) => [symbol, defaultDirection]));
  return {
    ...payload, ghost_type: ghostType, credibility, novelty, theme_strength: theme,
    contagion: 2, market_confirmation: payload.market ? 2 : 1, ghost_score: ghostScore,
    alert_level: ghostScore >= 60 ? "alert" : ghostScore >= 20 ? "watch" : "log",
    affected_layers: [], ticker_directions: tickerDirections, direction_reasons: {}, ml_predictions: {},
    rationale: [`type=${ghostType}`, `source_credibility=${credibility}`, `matched_keywords=${hits.join(", ") || "none"}`, "browser rules analysis"],
    analysis_method: "rules", published_at: new Date().toISOString(), url: "",
  };
}

$("#analyze-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $("#analyze-status");
  const payload = {
    title: form.title.value.trim(),
    summary: form.summary.value.trim(),
    source: form.source.value.trim(),
    symbols: form.symbols.value.split(",").map((s) => s.trim()).filter(Boolean),
  };
  if (form.market.value.trim()) {
    try {
      payload.market = JSON.parse(form.market.value);
    } catch {
      status.textContent = ui("市场 JSON 无效", "Invalid market JSON");
      status.className = "err";
      return;
    }
  }
  $("#analyze-btn").disabled = true;
  status.textContent = ui("分析中…", "Analyzing...");
  status.className = "";
  try {
    renderDetail(analyzeLocal(payload), $("#analyze-result"));
    status.textContent = ui("完成", "Done");
  } catch (err) {
    status.textContent = `${ui("失败", "Failed")}: ${err.message}`;
    status.className = "err";
  } finally {
    $("#analyze-btn").disabled = false;
  }
});

loadAlerts();
loadCaptureStatus();
setInterval(loadAlerts, 60000);
setInterval(loadCaptureStatus, 60000);
