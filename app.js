/* ============================================================
   个人理财台账 · 核心逻辑
   数据模型 / 收益计算 / 日历 / 交易录入 / GitHub 同步
   ============================================================ */
"use strict";

/* ---------- 常量 ---------- */
const LS_DATA = "licai_ledger_v1";
const LS_SYNC = "licai_ledger_sync_v1";
const NAV_API = "https://xinxipilu.chinawealth.com.cn/lcxp-platService";
const DETAIL_PAGE = "https://xinxipilu.chinawealth.com.cn/queryMenu/prodType/prodTypeDetail?prodRegCode=";

/* ---------- 机构识别 ----------
   与云端 fetch_nav.py 的 ORG_ALIAS / detect_org() 严格对齐：
   云端也是按「机构名 / 产品名 / 各类代码」里是否含简称来选抓取器，
   所以前端的「能否自动抓净值」判定必须用同一套规则，否则会跟云端结论不一致。 */
const ORG_ALIAS = [
  ["北银", "bob"], ["北京银行", "bob"], ["bob", "bob"],
  ["华夏", "hx"], ["hx", "hx"],
  ["浦银", "spdb"], ["浦发", "spdb"], ["上海浦东发展", "spdb"], ["spdb", "spdb"],
  /* 信银理财：云端 ORG_ALIAS 里「信银理财 / 信银 / 中信 / citic」四项，
     前端必须一字不差地同序排列，否则前后端对同一产品会给出不同结论。
     注意「中信」是或关系的子串匹配，机构栏写「中信银行」也会判为信银。 */
  ["信银理财", "citic"], ["信银", "citic"], ["中信", "citic"], ["citic", "citic"],
  /* 南银 / 民生：与云端 ORG_ALIAS 末尾四/三项同序同构（2026-09-12 接入）。 */
  ["南银理财", "nanyin"], ["南银", "nanyin"], ["nanyin", "nanyin"],
  ["民生理财", "cmbc"], ["民生", "cmbc"], ["cmbc", "cmbc"],
  /* 宁银（宁波银行理财）：官网净值表可服务端直抓（2026-09-13 接入），
     与云端 ORG_ALIAS 末尾三项同序同构。注意「宁银」≠「南银」。 */
  ["宁银理财", "wmbnb"], ["宁银", "wmbnb"], ["wmbnb", "wmbnb"]
];
const ORG_NAME = { bob: "北银理财", hx: "华夏理财", spdb: "浦银理财", citic: "信银理财",
                   nanyin: "南银理财", cmbc: "民生理财", wmbnb: "宁银理财",
                   chinawealth: "中国理财网" };
function detectOrg(p) {
  if (!p) return "";
  const hay = [p.inst, p.manager, p.name, p.prodCode, p.code]
    .map(v => String(v == null ? "" : v)).join(" ").toLowerCase();
  for (const [alias, code] of ORG_ALIAS) { if (hay.indexOf(alias) >= 0) return code; }
  /* 通用规则（与云端 detect_org 同构）：名称/机构含「理财」→ 中国理财网通用
     聚合源（覆盖招银/工银/中银/交银/宁银/苏银等全部 32 家发行方）。
     已接入机构在 ORG_ALIAS 里优先命中，走各自官网抓取器（历史更全）。 */
  if (hay.indexOf("理财") >= 0) return "chinawealth";
  /* 兜底（与云端同构）：机构未识别但登记编码 Z 开头（Z+12~14 位数字）。 */
  const reg = String(p.regCode || p.zcode || p.instCode || p.shareCode || p.code || "")
    .trim().toUpperCase();
  if (/^Z\d{12,14}$/.test(reg)) return "chinawealth";
  return "";
}
/* 仅凭「产品代码」形态推测机构——只用于输入时的实时提示。
   权威判定始终以 detectOrg()（机构名/产品名）为准。
   注：浦银官网接口实际按「登记编码」查询，未发现可靠的产品代码前缀规律，
       故此处不臆造规则，改为提示用户填登记编码。 */
const PRODCODE_RULES = [
  [/^YJ\d{6,}[A-Z]?$/i, "bob", "北银产品代码：YJ + 数字（可带份额后缀字母）"],
  [/^\d{12}$/, "hx", "华夏产品代码：12 位数字"],
  /* 信银份额代码 = 2 位前缀 + 6 位数字 + 1 位份额字母（共 9 位），如 AF251387C。
     前缀 AF / AM 为公募，BF / BB 为私募；私募净值披露受限，云端可能抓不到历史。
     7 位母产品代码（去掉末位份额字母）在信银官网查不到，故此处要求末位字母必填。 */
  [/^(?:AF|AM|BF|BB)\d{6}[0-9A-Z]$/i, "citic", "信银产品代码：AF/AM/BF/BB + 6 位数字 + 份额字母（如 AF251387C）"],
  /* 信银「母产品代码」：AF/AM/BF/BB + 6 位数字，缺了末位份额字母。
     信银官网只认 9 位份额代码，8 位母代码一律返回「未查询到该产品信息」，
     所以这里必须单独提醒补全，否则用户会以为云端抓取坏了。 */
  [/^(?:AF|AM|BF|BB)\d{6}$/i, "citic", "⚠️ 这像是信银的母产品代码（缺末位份额字母），必须补上份额字母才能查到净值"],
  /* 南银：10 位销售代码 NYYW + 6 位数字，如 NYYW000016。
     官网加密接口只认销售代码，登记编码（Z 开头）可由云端自动反查补齐。 */
  [/^NYYW\d{6}$/i, "nanyin", "南银销售代码：NYYW + 6 位数字（如 NYYW000016）"],
  /* 民生：10 位产品代码 F + 3 位字母 + 5 位数字 + 份额字母，如 FBAG65601C。
     实测全集前缀 FBAG/FBAE/FBAF/FSAE/FSAF/FSAG/FGAE/FGAG/FGAF；登记编码查询 0 命中。 */
  [/^F[A-Z]{3}\d{5}[A-Z]$/i, "cmbc", "民生产品代码：F + 3 位字母 + 5 位数字 + 份额字母（如 FBAG65601C）"],
  /* 宁银：Z + 2 位字母 + 7 位数字 + 份额字母，如 ZGN2360006C。官网净值表按此份额代码查询。 */
  [/^Z[A-Z]{2}\d{7}[A-Z]$/i, "wmbnb", "宁银产品代码：Z + 2 位字母 + 7 位数字 + 份额字母（如 ZGN2360006C）"]
];
function detectOrgByProdCode(code) {
  const s = String(code == null ? "" : code).trim();
  if (!s) return { org: "", tip: "" };
  for (const [re, org, tip] of PRODCODE_RULES) { if (re.test(s)) return { org, tip }; }
  if (/^Z\d{10,}$/i.test(s)) return { org: "", tip: "这看起来是「登记编码」——请填到上方登记编码栏；填好后云端会走中国理财网通用查询（覆盖全部发行方）" };
  return { org: "", tip: "" };
}
/* 云端抓取所需的产品代码（fetch_nav.py 的 get_prod_code：prodCode → code → shareCode） */
function prodCodeOf(p) {
  if (!p) return "";
  for (const k of ["prodCode", "code", "shareCode"]) {
    const v = String(p[k] == null ? "" : p[k]).trim();
    if (v) return v;
  }
  return "";
}
/* 云端抓取就绪状态（与云端逻辑对齐）：
   常规机构：必须填「产品代码」；中国理财网聚合源：凭登记编码（Z 开头）即可查询。 */
function fetchStatus(p) {
  const code = String(p && p.prodCode || "").trim();
  const org = detectOrg(p);
  if (org === "chinawealth") {
    const reg = String(p && p.regCode || p && p.code || "").trim().toUpperCase();
    const hasName = !!(p && p.name && String(p.name).trim());
    /* 云端 fetch_chinawealth 支持「登记编码 或 产品名称」两种查询键，
       名称含发行方全称（如广银理财…）时按名称搜索即可，不必强制 Z 编码。 */
    const hasReg = /^Z\d{12,14}$/.test(reg);
    if (!hasReg && !hasName) {
      return { ok: false, lv: "warn", txt: "⚠️ 中国理财网查询需填登记编码（Z 开头）或完整产品名称" };
    }
    const via = hasReg ? "按登记编码" : "按产品名称";
    return { ok: true, lv: "ok", txt: `✓ 云端可自动抓最新净值（中国理财网·${via}）` };
  }
  if (!code) return { ok: false, lv: "warn", txt: "⚠️ 缺产品代码，云端无法抓净值" };
  if (!org) return { ok: false, lv: "warn", txt: "⚠️ 机构未识别（机构栏填理财公司全名如「招银理财/工银理财」，或填 Z 开头登记编码走中国理财网）" };
  return { ok: true, lv: "ok", txt: `✓ 云端可自动抓净值（${ORG_NAME[org]}）` };
}

/* ---------- 数据 ---------- */
/*
 data = {
   products: [{
      id,
      code(产品登记编码，Z/C 开头，用于中国理财网信披平台查询),
      prodCode(产品代码，云端 fetch_nav.py 抓净值的依据),
      name, inst(发行机构),
      manager / riskLevel / orgName / estDate / benchmark(云端抓取后回填),
      navHistory: { "YYYY-MM-DD": navNumber },
      createdAt
   }],
   trades: [{
      id, prodId, type: "buy"|"sell",
      tradeDate, confirmDate, amount, confirmNavDate, confirmNav,
      shares,               // 买入=金额/确认净值；赎回=填份额
      realized,             // 赎回时结算的已实现收益
      note, createdAt
   }],
   settings:{ hideAmount:false }
 }
*/
let DATA = { products: [], trades: [], settings: { hideAmount: false } };
let SYNC = { owner: "", repo: "", path: "licai-data.json", token: "", sha: "", auto: true };
let UI = { range: "day", groupBy: "inst", calY: 0, calM: 0, selDate: "", activePick: "", viewProd: "", detTab: "active" };

/* ---------- 工具 ---------- */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => fmtDate(new Date());
const money = n => (Math.abs(n) < 0.005 ? 0 : n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signMoney = n => (n > 0 ? "+" : n < 0 ? "-" : "") + money(Math.abs(n));
const pct = n => (n * 100).toFixed(2) + "%";
const cls = n => n > 0 ? "up" : n < 0 ? "down" : "muted";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, ms = 2000) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove("show"), ms);
}
function dayDiff(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
/* 两个日期之间的工作日数（扣周末，不含节假日——已知限制） */
function workdaysBetween(a, b) {
  let n = 0; const d = parseDate(a); const end = parseDate(b);
  while (d < end) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

/* ---------- 持久化 ---------- */
function saveLocal() { try { localStorage.setItem(LS_DATA, JSON.stringify(DATA)); } catch (e) { } }
function loadLocal() {
  try {
    const s = localStorage.getItem(LS_DATA);
    if (s) { const o = JSON.parse(s); DATA = Object.assign({ products: [], trades: [], settings: {} }, o); }
    const y = localStorage.getItem(LS_SYNC);
    if (y) SYNC = Object.assign(SYNC, JSON.parse(y));
  } catch (e) { console.warn(e); }
}
function saveSync() { try { localStorage.setItem(LS_SYNC, JSON.stringify(SYNC)); } catch (e) { } }

/* ============================================================
   数据迁移与去重
   ------------------------------------------------------------
   背景（来自项目交接文档）：早期版本只有「销售代码」一栏，用户把云端抓
   净值要用的「产品代码」错填在了那里；同时同一只产品被拆成了两条记录
   （一条有交易记录、一条有云端净值），云端 fetch_nav.py 读到的是登记编码
   而非产品代码，于是报「未取到净值」。

   本函数做两件事：
     1) shareCode → prodCode 搬迁
     2) 同一产品的重复记录合并：净值取并集 / 交易改指 / 字段补全
   返回是否发生了变更。
   ============================================================ */
/* 净值并集遇到同一日期不同取值时的策略：
   true  = 取小数位更多的一方（更接近官方披露的精确值，如 1.011291 优于 1.0113）
   false = 保留「保留方」的原有值（与云端「已有净值不覆盖」同口径） */
const MIGRATE_PREFER_PRECISE_NAV = true;

const MERGE_FIELDS = ["name", "inst", "code", "prodCode", "riskLevel", "manager", "orgName", "estDate", "benchmark", "lastNavSync"];

function navCount(p) { return Object.keys((p && p.navHistory) || {}).length; }
function hasTrade(p) { return DATA.trades.some(t => t.prodId === p.id); }
/* 保留优先级：有交易 > 有净值 > 字段更全 > 创建更早（返回负值者胜出并被保留） */
function mergeRank(a, b) {
  const ta = hasTrade(a) ? 1 : 0, tb = hasTrade(b) ? 1 : 0;
  if (ta !== tb) return tb - ta;
  const na = navCount(a) > 0 ? 1 : 0, nb = navCount(b) > 0 ? 1 : 0;
  if (na !== nb) return nb - na;
  const fa = MERGE_FIELDS.filter(k => String(a[k] || "").trim()).length;
  const fb = MERGE_FIELDS.filter(k => String(b[k] || "").trim()).length;
  if (fa !== fb) return fb - fa;
  return (a.createdAt || 0) - (b.createdAt || 0);
}
/* 判定两条记录是否同一产品：机构一致，且（登记编码相同 / 产品代码相同 / 名称互相包含） */
function isSameProduct(a, b) {
  const oa = detectOrg(a), ob = detectOrg(b);
  if (!oa || oa !== ob) return false;
  const ca = String(a.code || "").trim(), cb = String(b.code || "").trim();
  if (ca && cb && ca.toUpperCase() === cb.toUpperCase()) return true;
  const pa = String(a.prodCode || "").trim(), pb = String(b.prodCode || "").trim();
  if (pa && pb && pa.toUpperCase() === pb.toUpperCase()) return true;
  const na = String(a.name || "").trim(), nb = String(b.name || "").trim();
  if (!na || !nb) return false;
  const s = na.length <= nb.length ? na : nb;
  const l = na.length <= nb.length ? nb : na;
  /* 短名至少 8 字符且被长名完整包含，避免「7天」这类短名误合并 */
  return s.length >= 8 && l.indexOf(s) >= 0;
}
/* 把 drop 并入 keep */
function absorbProduct(keep, drop) {
  keep.navHistory = keep.navHistory || {};
  const dn = drop.navHistory || {};
  for (const d of Object.keys(dn)) {
    const cur = keep.navHistory[d];
    if (cur === undefined || cur === null || cur === "") { keep.navHistory[d] = dn[d]; continue; }
    if (MIGRATE_PREFER_PRECISE_NAV) {
      const p1 = (String(cur).split(".")[1] || "").length;
      const p2 = (String(dn[d]).split(".")[1] || "").length;
      if (p2 > p1) keep.navHistory[d] = dn[d];
    }
  }
  for (const t of DATA.trades) { if (t.prodId === drop.id) t.prodId = keep.id; }
  for (const k of MERGE_FIELDS) {
    if (!String(keep[k] || "").trim() && String(drop[k] || "").trim()) keep[k] = drop[k];
  }
  if (!keep.createdAt || (drop.createdAt && drop.createdAt < keep.createdAt)) keep.createdAt = drop.createdAt;
}
function migrateData() {
  let changed = false; const logs = [];
  /* 1) 销售代码 → 产品代码；旧字段一律清掉（含历史遗留的空串） */
  for (const p of DATA.products) {
    if (p.shareCode === undefined) continue;
    const sc = String(p.shareCode || "").trim();
    if (!String(p.prodCode || "").trim() && sc) {
      p.prodCode = sc; changed = true;
      logs.push(`「${p.name || p.code || p.id}」：销售代码 ${sc} 已搬迁为产品代码`);
    }
    const pc = String(p.prodCode || "").trim().toUpperCase();
    if (!sc || pc === sc.toUpperCase()) { delete p.shareCode; changed = true; }
  }
  /* 2) 重复产品合并（列表在变，故命中后从头重扫，保证多对重复都能合并） */
  outer: for (let i = 0; i < DATA.products.length; i++) {
    for (let j = i + 1; j < DATA.products.length; j++) {
      const a = DATA.products[i], b = DATA.products[j];
      if (!a || !b || !isSameProduct(a, b)) continue;
      const keep = mergeRank(a, b) <= 0 ? a : b;
      const drop = keep === a ? b : a;
      absorbProduct(keep, drop);
      DATA.products = DATA.products.filter(x => x !== drop);
      changed = true;
      logs.push(`合并重复产品：「${drop.name || drop.id}」→「${keep.name || keep.id}」`);
      i = -1; continue outer;
    }
  }
  if (changed) { saveLocal(); UI.migrateLog = logs; }
  return changed;
}
/* 迁移结果提示（不打断操作，细节打到控制台） */
function notifyMigrate() {
  const logs = UI.migrateLog || [];
  if (!logs.length) return;
  try { console.log("[migrate]\n" + logs.join("\n")); } catch (e) { }
  const merged = logs.filter(s => s.indexOf("合并重复产品") === 0).length;
  const moved = logs.length - merged;
  const parts = [];
  if (merged) parts.push(`合并重复产品 ${merged} 组`);
  if (moved) parts.push(`搬迁产品代码 ${moved} 项`);
  if (parts.length) toast("数据已自动整理：" + parts.join("、"), 4200);
}

/* ============================================================
   收益计算核心
   ============================================================ */
/* 产品按日期升序的净值序列 */
function navSeries(p) {
  return Object.keys(p.navHistory || {}).sort().map(d => [d, Number(p.navHistory[d])]);
}
function navAt(p, date) { return p.navHistory ? p.navHistory[date] : undefined; }
/* 取 <= date 的最近一个净值 */
function navOnOrBefore(p, date) {
  const s = navSeries(p); let r = null;
  for (const [d, v] of s) { if (d <= date) r = [d, v]; else break; }
  return r;
}
/* 最新净值 */
function latestNav(p) { const s = navSeries(p); return s.length ? s[s.length - 1] : null; }
/* 统一「当天命中 → 否则向前取最近」的取值：始终返回 [日期, 净值] 或 null。
   ⚠️ 不要写成 `navAt(p,d) || navOnOrBefore(p,d)`：navAt 命中时返回的是「数字」，
   navOnOrBefore 返回的是「数组」，|| 短路会让调用方拿到两种类型 ——
   命中路径下 hit[1] 取到 undefined，Number(undefined) = NaN，
   再被下游 `nav > 0` 之类的守卫静默退化成 0，表现为「净值栏被清空 / 份额算成 0」。 */
function navHit(p, date) {
  const v = navAt(p, date);
  if (v !== undefined && v !== null && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return [date, n];
  }
  return navOnOrBefore(p, date);
}

/* ---------- 确认口径（T+1）----------
   理财产品申购/赎回都是「T 日申请、T+1 日确认」，确认日之前份额未到账：
     · 不计入持仓份额与市值
     · 不产生收益
   所以凡是要「结算到某一天为止」的地方，都不能直接用 position().shares（那是今天的），
   要用 sharesOn(p, date) —— 否则历史日历/区间收益会拿今天的份额去乘过去的净值差。 */

/* 截至 date 已确认的持仓份额（只累加确认日 <= date 的交易） */
function sharesOn(p, date) {
  let sh = 0;
  for (const t of DATA.trades) {
    if (t.prodId !== p.id) continue;
    const cd = t.confirmDate || t.tradeDate || "";
    if (!cd || cd > date) continue;              /* 未确认：份额还没到账 */
    if (t.type === "buy") sh += tradeShares(t, p);
    else sh = Math.max(0, sh - (Number(t.shares) || 0));
  }
  return sh;
}

/* 该产品是否有过交易（用于区分「已清仓」与「从未建仓」） */
function hasAnyTrade(p) { return DATA.trades.some(t => t.prodId === p.id); }

/* 该日是否有任一产品披露了净值。
   用来区分「未披露」（无数据，不该显示成 0）与「收益为 0」（有净值但持平）。 */
function dayDisclosed(date) {
  return DATA.products.some(p => {
    const v = navAt(p, date);
    return v !== undefined && v !== null && v !== "";
  });
}

/* 某交易发生的确认净值：优先用户填的，否则取确认日（或买入日）当天净值 */
function resolveTradeNav(t, p) {
  if (t.confirmNav) return Number(t.confirmNav);
  const d = t.confirmNavDate || t.confirmDate || t.tradeDate;
  const hit = navHit(p, d);
  return hit ? Number(hit[1]) : 0;
}

/* 计算份额 & 成本 */
function tradeShares(t, p) {
  const nav = resolveTradeNav(t, p);
  if (t.type === "buy") {
    if (t.shares) return Number(t.shares);
    return nav > 0 ? Number(t.amount) / nav : 0;
  } else {
    return Number(t.shares || 0);
  }
}

/* 某产品当前持仓：份额、成本（成本法：加权平均）
   确认口径：只有确认日 <= 今天的买入才计入 shares/cost；
   确认日 > 今天的买入进 pendingShares/pendingAmount（在途），不计息、不显示市值。 */
function position(p) {
  const td = today();
  const ts = DATA.trades.filter(t => t.prodId === p.id)
    .sort((a, b) => (a.confirmDate || a.tradeDate || "").localeCompare(b.confirmDate || b.tradeDate || ""));
  let shares = 0, cost = 0, realized = 0;
  let pendingShares = 0, pendingAmount = 0, startDate = "";
  for (const t of ts) {
    const cd = t.confirmDate || t.tradeDate || "";
    const confirmed = !cd || cd <= td;
    if (t.type === "buy") {
      const sh = tradeShares(t, p); const amt = Number(t.amount) || 0;
      if (!confirmed) { pendingShares += sh; pendingAmount += amt; continue; }
      if (!startDate) startDate = cd;
      shares += sh; cost += amt;
    } else {
      if (!confirmed) continue;                /* 赎回确认前，持仓不动 */
      /* 赎回：按当前均价成本扣减，差额计入已实现 */
      const sh = Math.min(Number(t.shares) || 0, shares);
      const nav = Number(t.confirmNav) || resolveTradeNav(t, p) || 0;
      const avg = shares > 0 ? cost / shares : 0;
      const proceeds = sh * nav;
      const costOut = avg * sh;
      realized += (proceeds - costOut);
      shares -= sh; cost -= costOut;
      if (shares < 1e-9) { shares = 0; cost = 0; }
    }
  }
  const last = latestNav(p);
  const lastNav = last ? last[1] : 0;
  const lastDate = last ? last[0] : "";
  /* 在途：有买入但一份都没确认 → 不显示市值/收益（由 UI 显示 "-"） */
  const hasPending = pendingShares > 0;
  const inTransit = shares <= 0 && hasPending;
  const market = inTransit ? 0 : shares * lastNav;
  const profit = market - cost;               /* 持仓浮盈 */
  /* 持有天数与年化 */
  const holdDays = startDate ? Math.max(dayDiff(startDate, lastDate || td), 1) : 0;
  let holdAnnual = (cost > 0 && holdDays > 0) ? (profit / cost) * 365 / holdDays : 0;
  /* 持有不足 7 天时，年化会把短期波动放大成极端值（如 2 天 3% → 571%），
     横截面上会误导用户。低于 7 天不给年化，改由页面展示"持有不足"提示。 */
  const annualValid = holdDays >= 7;
  if (!annualValid) holdAnnual = 0;
  return { shares, cost, market, profit, realized, lastNav, lastDate, startDate, holdDays, holdAnnual, annualValid,
           pendingShares, pendingAmount, hasPending, inTransit, navSeries: navSeries(p) };
}

/* 全仓汇总（三态）
   持仓中：已有确认份额（或已产生已实现收益）
   在途：  有买入但一份都未确认（T+1），不计入总额
   已清仓：份额归零但留下过交易 —— 单独归档，别让它从账本里消失 */
function portfolio() {
  const all = DATA.products.map(p => ({ p, pos: position(p) }));
  const rows = all.filter(r => r.pos.shares > 0);
  const pendingRows = all.filter(r => r.pos.inTransit);
  const closedRows = all.filter(r => r.pos.shares <= 0 && !r.pos.inTransit && hasAnyTrade(r.p));
  const totalAsset = rows.reduce((s, r) => s + r.pos.market, 0);
  const totalCost = rows.reduce((s, r) => s + r.pos.cost, 0);
  const totalPending = pendingRows.reduce((s, r) => s + r.pos.pendingAmount, 0);
  const totalRealized = DATA.trades.filter(t => t.type === "sell").reduce((s, t) => s + (Number(t.realized) || 0), 0);
  return { rows, pendingRows, closedRows, totalAsset, totalCost, totalPending, totalRealized };
}

/* 两个日期区间内整体收益（按各产品净值变动 × 区间末的已确认份额） */
function periodProfit(fromDate, toDate) {
  let s = 0;
  for (const p of DATA.products) {
    const sh = sharesOn(p, toDate);
    if (sh <= 0) continue;
    const a = navOnOrBefore(p, fromDate), b = navOnOrBefore(p, toDate);
    if (!a || !b) continue;
    s += sh * (Number(b[1]) - Number(a[1]));
  }
  return s;
}
/* 某一天的收益：仅当该日「有净值更新」时才计入（以净值日期为准）。
   避免周末/节假日把上一个交易日的收益重复显示。
   份额取「截至该日已确认的份额」—— 申购确认前不该凭空生息。 */
function dayProfit(date) {
  let s = 0;
  for (const p of DATA.products) {
    const sh = sharesOn(p, date);
    if (sh <= 0) continue;
    const s0 = navSeries(p);
    /* 找到净值日期恰好等于 date 的那条；没有则该日无收益 */
    const idx = s0.findIndex(x => x[0] === date);
    if (idx <= 0) continue;
    s += sh * (Number(s0[idx][1]) - Number(s0[idx - 1][1]));
  }
  return s;
}
/* 某自然月收益
   基准取法：优先取「月初或之前最近净值」；若月初尚无净值（如产品月中才成立/才开始记录），
   退而取「该月内第一条净值」作基准，避免首月恒为 0。 */
function monthProfit(y, m) {
  const first = `${y}-${pad(m)}-01`;
  const lastD = new Date(y, m, 0).getDate();
  const last = `${y}-${pad(m)}-${pad(lastD)}`;
  let s = 0;
  for (const p of DATA.products) {
    const sh = sharesOn(p, last);
    if (sh <= 0) continue;
    let a = navOnOrBefore(p, first);
    const b = navOnOrBefore(p, last);
    if (!b) continue;
    if (!a) {
      /* 月初无净值：取该月内第一条净值作为基准 */
      const s0 = navSeries(p);
      a = s0.find(x => x[0] >= first && x[0] <= last) || null;
      if (!a || a[0] === b[0]) continue; /* 该月只有一条净值，无变动 */
    }
    s += sh * (Number(b[1]) - Number(a[1]));
  }
  return s;
}

/* 组合年化（本月）：月收益 / 当前市值 × 365 / 当月在册天数 */
function annualize(profit, y, m) {
  const { totalAsset } = portfolio();
  const days = new Date().getMonth() + 1 === m && new Date().getFullYear() === y ? Math.max(new Date().getDate(), 1) : new Date(y, m, 0).getDate();
  if (totalAsset <= 0 || days <= 0) return 0;
  return (profit / totalAsset) * 365 / days;
}

/* ============================================================
   渲染：首页
   ============================================================ */
function renderHome() {
  const pf = portfolio();
  $("totalAsset").textContent = DATA.settings.hideAmount ? "****" : money(pf.totalAsset);
  $("tradeHint").textContent = `共 ${DATA.trades.length} 笔交易 · ${pf.rows.length} 只持仓`
    + (pf.pendingRows.length ? ` · ${pf.pendingRows.length} 只在途` : "");
  /* 今日/区间收益 */
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth() + 1;
  let val = 0, lab = "";
  if (UI.range === "day") { val = dayProfit(today()); lab = "今日收益"; }
  else if (UI.range === "week") {
    const d = new Date(now); const w = d.getDay(); const off = (w === 0 ? 6 : w - 1);
    const mon = new Date(d); mon.setDate(d.getDate() - off);
    val = periodProfit(fmtDate(mon), today()); lab = "本周收益";
  } else { val = monthProfit(y, m); lab = "本月收益"; }
  const rate = pf.totalAsset > 0 ? val / pf.totalAsset : 0;
  const big = $("sumBig");
  big.textContent = signMoney(val); big.className = "big " + cls(val);
  $("sumRate").textContent = `(${val >= 0 ? "+" : ""}${pct(rate)})`; $("sumRate").className = "rate " + cls(val);
  $("sumDate").textContent = `${lab} · ${latestDateAll() || today()}`;
  /* 月度统计 */
  const mNow = monthProfit(y, m), mPrevMonth = (m === 1 ? 12 : m - 1), mPrevYear = (m === 1 ? y - 1 : y), mPrev = monthProfit(mPrevYear, mPrevMonth);
  setStat("statM1", mNow, true); setStat("statM0", mPrev, true);
  setStat("statM1r", annualize(mNow, y, m), false, true);
  setStat("statM0r", annualize(mPrev, mPrevYear, mPrevMonth), false, true);
  setStat("statReal", pf.totalRealized, true);
  $("statCnt").textContent = pf.rows.length; $("statCnt").className = "v";
  renderCal(); renderDetail();
}
function setStat(id, v, isMoney, isPct) {
  const e = $(id);
  if (isMoney) { e.textContent = DATA.settings.hideAmount ? "****" : signMoney(v); e.className = "v " + cls(v); }
  else { e.textContent = (v >= 0 ? "+" : "") + pct(v); e.className = "v " + cls(v); }
}
function latestDateAll() {
  let d = "";
  for (const p of DATA.products) { const l = latestNav(p); if (l && l[0] > d) d = l[0]; }
  return d;
}

/* ---------- 日历 ---------- */
function renderCal() {
  const now = new Date();
  if (!UI.calY) { UI.calY = now.getFullYear(); UI.calM = now.getMonth() + 1; }
  const y = UI.calY, m = UI.calM;
  $("calTitle").textContent = `${y}年${m}月`;
  /* 每日收益映射。
     关键：区分「未披露」与「收益为 0」——
     没有净值的那天不是「没赚钱」，而是「还没披露」，显示成空白会误导。 */
  const dm = {};                 /* 已披露：日期 -> 当日收益（含 0） */
  const undis = {};              /* 已过去但没有净值披露 */
  const days = new Date(y, m, 0).getDate();
  for (let dd = 1; dd <= days; dd++) {
    const ds = `${y}-${pad(m)}-${pad(dd)}`;
    if (ds > today()) continue;
    if (!dayDisclosed(ds)) { undis[dd] = true; continue; }
    dm[dd] = dayProfit(ds);
  }
  const first = new Date(y, m - 1, 1).getDay();
  let h = "";
  ["日", "一", "二", "三", "四", "五", "六"].forEach(w => h += `<div class="wd">${w}</div>`);
  for (let i = 0; i < first; i++) h += `<div></div>`;
  const tds = today();
  for (let dd = 1; dd <= days; dd++) {
    const ds = `${y}-${pad(m)}-${pad(dd)}`;
    const has = dm[dd] !== undefined;
    const v = dm[dd];
    const isUnd = !!undis[dd];
    const selc = (UI.selDate === ds) ? " sel" : "";
    const todayc = (ds === tds) ? " today" : "";
    const negc = (has && v < 0) ? " neg" : "";
    const undiscls = isUnd ? " undis" : "";
    h += `<div class="d${has ? " has" : ""}${negc}${undiscls}${selc}${todayc}" ${has ? `onclick="pickDay('${ds}')"` : ""}>
            <span class="dd">${dd}</span>
            ${has ? `<span class="val">${signMoney(v)}</span>` : (isUnd ? `<span class="und">未披露</span>` : "")}
          </div>`;
  }
  $("calGrid").innerHTML = h;
  $("calTip").innerHTML =
    `<div class="legend">
       <span><i style="background:var(--up)"></i>正收益</span>
       <span><i style="background:var(--down)"></i>负收益</span>
       <span><i style="background:#d9dbe6"></i>未披露</span>
     </div>
     收益归「净值披露日」归属，未披露日不做均摊；点选有数值的方格可看当日明细。`;
}
function calMove(d) {
  let m = UI.calM + d, y = UI.calY;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  UI.calY = y; UI.calM = m; renderCal();
}
function pickDay(ds) { UI.selDate = (UI.selDate === ds ? "" : ds); renderCal(); renderDetail(); }

/* ---------- 明细（三态：持仓中 / 在途 / 已清仓）---------- */
function setDetTab(btn, tab) {
  btn.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  UI.detTab = tab; renderDetail();
}
/* 在途卡片：确认前不显示市值与收益，只显示在途金额与预估份额 */
function pendingHtml(list) {
  return list.map(({ p, pos }) => `<div class="grp">
    <div class="grp-h">
      <div class="av">${esc(String(p.inst || p.name || "?").slice(0, 1))}</div>
      <div class="nm">${esc(p.name)}<span class="state-chip">交易在途</span></div>
      <div class="amt muted">待确认</div>
    </div>
    <div class="prow transit">
      <div class="pn">${esc(p.inst || "")}</div>
      <div class="pv muted">-</div>
      <div class="pk">
        <i>在途金额 <b>${DATA.settings.hideAmount ? "****" : money(pos.pendingAmount)}</b></i>
        <i>预估份额 <b>${pos.pendingShares.toFixed(2)}</b></i>
        <i>市值 <b class="muted">-</b></i>
        <i>持仓收益 <b class="muted">-</b></i>
        <i>确认后自动计入持仓</i>
      </div>
    </div>
  </div>`).join("");
}
/* 已清仓卡片：份额归零但保留历史已实现收益，避免产品凭空消失 */
function closedHtml(list) {
  return list.map(({ p, pos }) => {
    const n = DATA.trades.filter(t => t.prodId === p.id && t.type === "sell").length;
    return `<div class="grp">
    <div class="grp-h">
      <div class="av">${esc(String(p.inst || p.name || "?").slice(0, 1))}</div>
      <div class="nm">${esc(p.name)}<span class="state-chip closed">已清仓</span></div>
      <div class="amt ${cls(pos.realized)}">${signMoney(pos.realized)}</div>
    </div>
    <div class="prow">
      <div class="pn">已实现收益</div>
      <div class="pv ${cls(pos.realized)}">${signMoney(pos.realized)}</div>
      <div class="pk">
        <i>已核算赎回 <b>${n} 笔</b></i>
        <i>持仓份额 <b>0.00</b></i>
        <i>最新净值 <b>${pos.lastNav.toFixed(4)}</b></i>
      </div>
    </div>
  </div>`;
  }).join("");
}
function renderDetail() {
  const date = UI.selDate || latestDateAll() || today();
  $("detTitle").innerHTML = `收益明细 <span class="date">· ${date}</span>`;
  const pf = portfolio();
  /* 三态 tab（带计数；在途非零时用金色提示，避免漏看未确认的交易） */
  const tabs = [["active", "持仓中", pf.rows.length, false],
                ["pending", "在途", pf.pendingRows.length, true],
                ["closed", "已清仓", pf.closedRows.length, false]];
  if ($("detTabs")) {
    $("detTabs").innerHTML = tabs.map(([k, lab, n, warn]) =>
      `<button class="${UI.detTab === k ? "on" : ""}" onclick="setDetTab(this,'${k}')">${lab}<span class="n${(warn && n) ? " warn" : ""}"> ${n}</span></button>`
    ).join("");
  }
  const list = UI.detTab === "pending" ? pf.pendingRows
    : UI.detTab === "closed" ? pf.closedRows : pf.rows;
  if (!list.length) {
    const tip = UI.detTab === "pending" ? "没有在途交易。申购/赎回确认后会转入「持仓中」。"
      : UI.detTab === "closed" ? "还没有已清仓的产品。"
        : "还没有持仓，点「进入」交易中心添加第一笔买入";
    $("detBody").innerHTML = `<div class="empty">${tip}</div>`; return;
  }
  if (UI.detTab === "pending") { $("detBody").innerHTML = pendingHtml(list); return; }
  if (UI.detTab === "closed") { $("detBody").innerHTML = closedHtml(list); return; }

  const groups = {};
  for (const r of list) {
    const pos = r.pos;
    /* 当日盈亏：仅当该日有净值更新时计入（见 dayProfit 的说明） */
    const s0 = navSeries(r.p);
    const idx = s0.findIndex(x => x[0] === date);
    const dayP = idx > 0 ? pos.shares * (Number(s0[idx][1]) - Number(s0[idx - 1][1])) : 0;
    const dayNavChange = idx > 0 ? (Number(s0[idx][1]) - Number(s0[idx - 1][1])) : 0;
    const key = UI.groupBy === "inst" ? (r.p.inst || "未分组") : "全部产品";
    (groups[key] = groups[key] || []).push({ r, pos, dayP, dayNavChange });
  }
  let html = "";
  const keys = Object.keys(groups);
  if (UI.groupBy === "sort") {
    /* 排序：按当日盈亏降序 */
    const all = keys.flatMap(k => groups[k]).sort((a, b) => b.dayP - a.dayP);
    groups["按当日盈亏排序"] = all; delete groups["全部产品"];
  }
  for (const k of Object.keys(groups)) {
    const arr = groups[k];
    const sum = arr.reduce((s, x) => s + x.dayP, 0);
    html += `<div class="grp">
      <div class="grp-h">
        <div class="av">${esc(k.slice(0, 1))}</div>
        <div class="nm">${esc(k)}<span class="wr"> ${arr.length} 只</span></div>
        <div class="amt ${cls(sum)}">${signMoney(sum)} <span class="wr">万收(${sum !== 0 ? (sum / Math.max(arr.reduce((s, x) => s + x.pos.market, 0), 1) * 10000).toFixed(2) : "0.00"})</span></div>
      </div>`;
    for (const x of arr) {
      const annualTxt = x.pos.annualValid
        ? `<b class="${cls(x.pos.holdAnnual)}">${pct(x.pos.holdAnnual)}</b>`
        : `<b class="muted">持有不足7天</b>`;
      html += `<div class="prow">
        <div class="pn">${esc(x.r.p.name)}</div>
        <div class="pv ${cls(x.dayP)}">${signMoney(x.dayP)}</div>
        <div class="pk">
          <i>持有金额 <b>${DATA.settings.hideAmount ? "****" : money(x.pos.market)}</b></i>
          <i>当日盈亏 <b class="${cls(x.dayP)}">${signMoney(x.dayP)}</b></i>
          <i>持仓盈亏 <b class="${cls(x.pos.profit)}">${signMoney(x.pos.profit)}</b></i>
          <i>持有年化 ${annualTxt}</i>
          <i>持有 <b>${x.pos.holdDays}天</b></i>
          <i>净值 <b>${x.pos.lastNav.toFixed(4)}</b></i>
        </div>
      </div>`;
    }
    html += `</div>`;
  }
  $("detBody").innerHTML = html;
}

/* ============================================================
   渲染：交易 / 产品 / 设置
   ============================================================ */
function renderTrade() {
  const ts = [...DATA.trades].sort((a, b) => (b.tradeDate || "").localeCompare(a.tradeDate || ""));
  if (!ts.length) { $("tradeList").innerHTML = `<div class="empty">暂无交易记录</div>`; }
  else {
    $("tradeList").innerHTML = ts.map(t => {
      const p = DATA.products.find(x => x.id === t.prodId);
      const isBuy = t.type === "buy";
      return `<div class="sumline" style="align-items:flex-start">
        <div style="flex:1">
          <div style="font-weight:650;font-size:12.5px">${esc(p ? p.name : "已删除产品")}
            <span class="wr" style="font-size:10.5px;padding:2px 6px;border-radius:5px;background:${isBuy ? '#e9f7f1' : '#fdeff0'};color:${isBuy ? '#0d7a52' : '#c02a34'};margin-left:4px">${isBuy ? "买入" : "赎回"}</span>
          </div>
          <div style="font-size:11px;color:var(--ink2);margin-top:3px">
            ${t.tradeDate} · 确认 ${t.confirmNavDate || "-"} · 净值 ${Number(t.confirmNav || 0).toFixed(4)} · ${(Number(t.shares) || 0).toFixed(2)}份
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;font-size:13px">${isBuy ? "-" : "+"}${money(t.amount)}</div>
          ${t.realized ? `<div style="font-size:11px" class="${cls(t.realized)}">实现 ${signMoney(t.realized)}</div>` : ""}
          <button class="mini" style="margin-top:4px;padding:2px 8px;font-size:10.5px" onclick="delTrade('${t.id}')">删除</button>
        </div>
      </div>`;
    }).join("");
  }
  /* 已实现 */
  const sells = DATA.trades.filter(t => t.type === "sell");
  if (!sells.length) $("realList").innerHTML = `<div class="empty">暂无赎回结算</div>`;
  else {
    const tot = sells.reduce((s, t) => s + (Number(t.realized) || 0), 0);
    $("realList").innerHTML = sells.map(t => {
      const p = DATA.products.find(x => x.id === t.prodId);
      return `<div class="sumline"><span class="k">${esc(p ? p.name : "-")} <span class="muted" style="font-size:11px">${t.tradeDate}</span></span>
        <b class="${cls(t.realized)}">${signMoney(t.realized)}</b></div>`;
    }).join("") + `<div class="sumline"><span class="k">合计已实现</span><b class="${cls(tot)}">${signMoney(tot)}</b></div>`;
  }
}

function renderProd() {
  if (!DATA.products.length) $("prodList").innerHTML = `<div class="empty">还没有产品，点「添加产品」按登记编码查询或手动录入</div>`;
  else {
    $("prodList").innerHTML = DATA.products.map(p => {
      const pos = position(p);
      const l = latestNav(p);
      const st = fetchStatus(p);
      return `<div class="pick" style="cursor:default">
        <div class="p1">${esc(p.name)} <span class="wr" style="font-size:10.5px;color:var(--ink3)">${esc(p.inst || "")}</span></div>
        <div class="p2">登记编码 ${esc(p.code || "-")} · 产品代码 <b>${esc(p.prodCode || "-")}</b></div>
        <div class="p2" style="color:${st.ok ? "#0d7a52" : "#8a6300"}">${st.txt}</div>
        <div class="p3">份额 ${pos.shares.toFixed(2)} · 成本 ${money(pos.cost)} · 市值 ${money(pos.market)} · 浮盈 <b class="${cls(pos.profit)}">${signMoney(pos.profit)}</b> · 净值 ${l ? l[1].toFixed(4) + " (" + l[0] + ")" : "无数据"}</div>
        <div class="row-btn" style="margin-top:8px">
          <button class="mini" onclick="editProd('${p.id}')">编辑</button>
          <button class="mini" onclick="openNav('${p.id}')">录入/查看净值</button>
          <button class="mini" onclick="delProd('${p.id}')">删除</button>
        </div>
      </div>`;
    }).join("");
  }
  $("navList").innerHTML = DATA.products.map(p => {
    const s = navSeries(p);
    const recent = s.slice(-5).reverse();
    return `<div style="margin-bottom:12px">
      <div style="font-size:12.5px;font-weight:650;margin-bottom:5px">${esc(p.name)} <span class="muted" style="font-size:11px">共 ${s.length} 条</span></div>
      ${recent.length ? recent.map(([d, v]) => `<span style="display:inline-block;font-size:11px;background:var(--bg);border-radius:6px;padding:3px 8px;margin:0 5px 5px 0">${d.slice(5)} <b>${Number(v).toFixed(4)}</b></span>`).join("") : `<span class="muted" style="font-size:11px">暂无净值</span>`}
    </div>`;
  }).join("") || `<div class="empty">暂无产品</div>`;
}

/* ---------- 设置页同步状态 ---------- */
function renderSet() {
  const ok = SYNC.owner && SYNC.repo && SYNC.token;
  $("setSyncBox").innerHTML = ok
    ? `<div class="note g">已连接：<b>${esc(SYNC.owner)}/${esc(SYNC.repo)}</b><br>数据文件：${esc(SYNC.path)}${SYNC.sha ? "<br>远端版本：" + esc(SYNC.sha.slice(0, 7)) : ""}</div>
       <div class="row-btn" style="margin-top:10px">
         <button class="btn gh" style="flex:1" onclick="syncPull(true)">↓ 从云端拉取</button>
         <button class="btn pri" style="flex:1" onclick="syncPush(true)">↑ 推送到云端</button>
       </div>`
    : `<div class="note">尚未连接云端。配置后即可多设备共享同一份台账数据。</div>`;
  $("syncState").textContent = ok ? "已连接" : "未连接";
}

/* ============================================================
   弹层基础
   ============================================================ */
function openSheet(html) { $("sheet").innerHTML = html; $("mask").classList.add("show"); }
function closeSheet() { $("mask").classList.remove("show"); }
function go(pid) {
  document.querySelectorAll(".page").forEach(e => e.classList.remove("on"));
  $(pid).classList.add("on");
  document.querySelectorAll(".tabbar .tb").forEach(b => b.classList.toggle("on", b.dataset.p === pid));
  window.scrollTo(0, 0);
  if (pid === "pg-trade") renderTrade();
  if (pid === "pg-prod") renderProd();
  if (pid === "pg-set") renderSet();
}
function setRange(btn) {
  document.querySelectorAll("#pg-home .tabs button").forEach(b => b.classList.remove("on"));
  btn.classList.add("on"); UI.range = btn.dataset.range; renderHome();
}
function setGroup(btn, mode) {
  btn.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("on"));
  btn.classList.add("on"); UI.groupBy = mode; renderDetail();
}
function toggleHide() {
  DATA.settings.hideAmount = !DATA.settings.hideAmount;
  $("btnHide").textContent = DATA.settings.hideAmount ? "显示" : "隐藏";
  saveLocal(); renderHome();
}

/* ============================================================
   交易录入
   ============================================================ */
function openTrade(pickId) {
  UI.activePick = pickId || "";
  let html = `<div class="sheet-t"><h3>新增交易</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="note b" style="margin-bottom:12px">选择产品或手动录入 → 填写交易 → 保存后收益中心自动按净值历史计算。</div>
    <div class="field"><label>选择产品</label>
      <div class="actin">
        <input id="tSearch" placeholder="搜索产品名称或代码" oninput="renderPick()">
      </div>
      <div id="pickBox" style="margin-top:8px;max-height:220px;overflow:auto"></div>
      <button class="btn gh full" style="margin-top:8px" onclick="openProd()">+ 查不到？手动新增产品</button>
    </div>
    <div id="tFormBox"></div>`;
  openSheet(html);
  renderPick();
}
function renderPick() {
  const kw = ($("tSearch") ? $("tSearch").value : "").trim().toLowerCase();
  const list = DATA.products.filter(p => !kw || (p.name + p.code + (p.prodCode || "")).toLowerCase().includes(kw));
  const box = $("pickBox");
  if (!list.length) { box.innerHTML = `<div class="empty" style="padding:14px">没有匹配的产品</div>`; $("tFormBox").innerHTML = ""; return; }
  box.innerHTML = list.map(p => {
    const l = latestNav(p);
    return `<div class="pick ${UI.activePick === p.id ? "on" : ""}" onclick="pickProduct('${p.id}')">
      <div class="p1">${esc(p.name)}</div>
      <div class="p2">${esc(p.inst || "")}${p.prodCode ? " · 产品代码 " + esc(p.prodCode) : ""}</div>
      <div class="p3">登记编码 ${esc(p.code || "-")} · 最新净值 ${l ? l[1].toFixed(4) + "（" + l[0] + "）" : "无"}</div>
    </div>`;
  }).join("");
  if (!UI.activePick && list.length) UI.activePick = list[0].id;
  renderTradeForm();
}
function pickProduct(id) { UI.activePick = id; renderPick(); }
function renderTradeForm() {
  const p = DATA.products.find(x => x.id === UI.activePick);
  if (!p) { $("tFormBox").innerHTML = ""; return; }
  const t = today();
  const lastNav = latestNav(p);
  const defNav = lastNav ? lastNav[1] : "";
  $("tFormBox").innerHTML = `
    <div class="note b">当前操作产品：<b>${esc(p.name)}</b><br>${esc(p.inst || "")}${p.prodCode ? " · 产品代码 " + esc(p.prodCode) : ""}</div>
    <div class="field" style="margin-top:12px"><label>交易类型</label>
      <select id="tType" onchange="renderTradeForm2()">
        <option value="buy">买入</option><option value="sell">赎回</option>
      </select>
    </div>
    <div class="field"><label>交易日期</label>
      <div class="actin"><input type="date" id="tDate" value="${t}"><button class="mini" onclick="document.getElementById('tDate').value=''">清空</button></div>
    </div>
    <div class="field"><label>交易确认日期</label><div class="actin"><input type="date" id="tConfirm" value="${t}"></div></div>
    <div id="tTypeBox"></div>
    <div class="field"><label>确认净值日期</label><input type="date" id="tNavDate" value="${lastNav ? lastNav[0] : t}" onchange="autoFillNav()"></div>
    <div class="field"><label>确认净值</label><input type="number" step="0.0001" id="tNav" value="${defNav}" placeholder="留空则自动取该日净值" oninput="calcShares()"></div>
    <div id="tShareBox"></div>
    <div class="row-btn" style="margin-top:14px">
      <button class="btn gh" style="flex:1" onclick="closeSheet()">取消</button>
      <button class="btn pri" style="flex:1" onclick="saveTrade()">保存交易</button>
    </div>`;
  renderTradeForm2();
}
function renderTradeForm2() {
  const type = $("tType").value;
  const p = DATA.products.find(x => x.id === UI.activePick);
  const pos = p ? position(p) : { shares: 0 };
  if (type === "buy") {
    $("tTypeBox").innerHTML = `<div class="field"><label>买入金额（元）</label><input type="number" step="0.01" id="tAmount" placeholder="请输入交易金额" oninput="calcShares()"></div>`;
    $("tShareBox").innerHTML = `<div class="field"><label>份额（自动计算）</label><input id="tShare" value="自动计算" readonly style="background:#fafbfe;color:var(--ink2)"></div>`;
  } else {
    $("tTypeBox").innerHTML = `<div class="field"><label>赎回份额</label><input type="number" step="0.01" id="tShares" placeholder="当前可赎回 ${pos.shares.toFixed(2)} 份" oninput="calcShares()"><div class="tip">可赎回 ${pos.shares.toFixed(2)} 份</div></div>`;
    $("tShareBox").innerHTML = `<div class="field"><label>预计到账（元）</label><input id="tAmountShow" value="自动计算" readonly style="background:#fafbfe;color:var(--ink2)"></div>`;
  }
  calcShares();
}
function autoFillNav() {
  const p = DATA.products.find(x => x.id === UI.activePick); if (!p) return;
  const d = $("tNavDate").value;
  const hit = navHit(p, d);
  if (hit) $("tNav").value = Number(hit[1]).toFixed(4);
}
function calcShares() {
  const p = DATA.products.find(x => x.id === UI.activePick); if (!p) return;
  const type = $("tType").value;
  const nav = Number($("tNav").value) || 0;
  if (type === "buy") {
    const amt = Number($("tAmount").value) || 0;
    $("tShare").value = (nav > 0 && amt > 0) ? (amt / nav).toFixed(4) + " 份" : "自动计算";
  } else {
    const sh = Number($("tShares").value) || 0;
    $("tAmountShow").value = nav > 0 ? money(sh * nav) + " 元" : "自动计算";
  }
}
function saveTrade() {
  const p = DATA.products.find(x => x.id === UI.activePick);
  if (!p) return toast("请先选择产品");
  const type = $("tType").value;
  const tradeDate = $("tDate").value || today();
  const confirmDate = $("tConfirm").value || tradeDate;
  const navDate = $("tNavDate").value || tradeDate;
  let nav = Number($("tNav").value) || 0;
  if (nav <= 0) return toast("请填写有效的确认净值");
  /* 净值历史保护：该日期若已有净值，以已披露净值为准（防止交易录入覆盖真实净值）。
     若没有，则把本次填写值补进历史，便于后续计算。 */
  if (!p.navHistory) p.navHistory = {};
  const existing = p.navHistory[navDate];
  let warned = false;
  if (existing !== undefined && existing !== null && existing !== "") {
    if (Math.abs(Number(existing) - nav) > 1e-9) { nav = Number(existing); warned = true; }
  } else {
    p.navHistory[navDate] = nav;
  }
  let t = { id: uid(), prodId: p.id, type, tradeDate, confirmDate, confirmNavDate: navDate, confirmNav: nav, createdAt: Date.now() };
  if (type === "buy") {
    const amt = Number($("tAmount").value) || 0;
    if (amt <= 0) return toast("请输入买入金额");
    t.amount = amt; t.shares = Number((amt / nav).toFixed(4));
  } else {
    const sh = Number($("tShares").value) || 0;
    const pos = position(p);
    if (sh <= 0) return toast("请输入赎回份额");
    if (sh > pos.shares + 1e-6) return toast("赎回份额超过持仓 " + pos.shares.toFixed(2));
    t.shares = sh; t.amount = Number((sh * nav).toFixed(2));
    const avg = pos.shares > 0 ? pos.cost / pos.shares : 0;
    t.realized = Number((sh * nav - avg * sh).toFixed(2));
  }
  DATA.trades.push(t);
  saveLocal(); closeSheet();
  toast(warned ? `已保存。${navDate} 按已披露净值 ${nav.toFixed(4)} 计算` : "交易已保存", warned ? 3200 : 2000);
  renderHome(); renderTrade(); renderProd(); autoPush();
}

/* ============================================================
   产品新增 / 净值录入
   ============================================================ */
/* 产品表单：新增与编辑共用（pid 为空 = 新增） */
function prodForm(pid) {
  const p = pid ? DATA.products.find(x => x.id === pid) : null;
  UI.editProdId = pid || "";
  UI.queriedNav = null;
  const meta = p && (p.manager || p.riskLevel)
    ? `<div class="note" style="margin-bottom:12px">云端回填：${p.manager ? "管理人 " + esc(p.manager) : ""}${p.riskLevel ? " · 风险等级 " + esc(p.riskLevel) : ""}</div>` : "";
  openSheet(`<div class="sheet-t"><h3>${p ? "编辑产品" : "添加产品"}</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="note b" style="margin-bottom:12px">
      净值由云端自动抓取，需要两个代码配合：<br>
      ① <b>产品登记编码</b>（Z / C 开头）— 中国理财网信披平台查询用；<br>
      ② <b>产品代码</b> — 云端抓净值的依据（北银如 <code>YJ01251204A</code>，华夏如 <code>208212400701</code>，信银如 <code>AF251387C</code>，南银如 <code>NYYW000016</code>，民生如 <code>FBAG65601C</code>）。信银要填<b>完整的份额代码</b>（含末位份额字母），去掉末位字母查不到。
    </div>
    <div class="field"><label>① 产品登记编码</label>
      <div class="actin"><input id="pCode" placeholder="如 Z7008926000006" value="${esc(p && p.code || "")}"><button class="btn pri" onclick="queryProduct()">查询</button></div>
      <div class="tip">中国理财网信披平台的登记编码，形如 Z / C 开头</div>
    </div>
    <div id="qResult"></div>
    <div class="field"><label>② 产品代码 <span class="muted">（云端抓净值依据，必填才能自动抓）</span></label>
      <input id="pProd" placeholder="如 YJ01251204A" value="${esc(p && p.prodCode || "")}" oninput="onProdCodeInput()">
      <div id="pProdTip" class="tip"></div>
    </div>
    <div class="field"><label>③ 产品名称 *（建议带机构简称）</label>
      <input id="pName" placeholder="如 北银理财京华远见春系列诚享7天持有期29号理财产品" value="${esc(p && p.name || "")}" oninput="onProdCodeInput()">
    </div>
    <div class="field"><label>④ 发行机构</label>
      <input id="pInst" placeholder="如 北银理财有限责任公司" value="${esc(p && p.inst || "")}" oninput="onProdCodeInput()">
      <div class="tip">发行方（如「广银理财」「北银理财」）或完整产品名含「理财」即可自动识别；代销银行（微众/招行等）不影响，识别依据是发行方与产品名</div>
    </div>
    ${meta}
    <div class="note" style="margin-bottom:12px">历史净值可不填，保存后由云端抓取自动补全；也可在「产品」页用「录入/查看净值」手工补录。</div>
    <div class="row-btn">
      <button class="btn gh" style="flex:1" onclick="closeSheet()">取消</button>
      <button class="btn pri" style="flex:1" onclick="saveProduct('${pid || ""}')">${p ? "保存修改" : "保存产品"}</button>
    </div>`);
  onProdCodeInput();
}
function openProd() { prodForm(""); }
function editProd(pid) { prodForm(pid); }
/* 产品代码输入时的实时机构识别提示 */
function onProdCodeInput() {
  const el = $("pProd"), tip = $("pProdTip");
  if (!el || !tip) return;
  const code = (el.value || "").trim();
  const explicit = detectOrg({ inst: $("pInst") ? $("pInst").value : "", name: $("pName") ? $("pName").value : "" });
  if (!code) {
    tip.className = "tip";
    tip.textContent = explicit ? `已按「${ORG_NAME[explicit]}」抓取，请补填产品代码` : "填产品代码后自动识别机构";
    return;
  }
  const d = detectOrgByProdCode(code);
  tip.className = "tip";
  if (d.org) {
    const clash = explicit && explicit !== d.org
      ? ` <span style="color:var(--up)">⚠️ 但名称/机构指向 ${ORG_NAME[explicit]}，请核对</span>` : "";
    tip.innerHTML = `识别为 <b>${ORG_NAME[d.org]}</b> ✓ · ${esc(d.tip)}${clash}`;
  } else if (d.tip) {
    tip.textContent = d.tip;
  } else {
    tip.textContent = explicit
      ? `代码形态未识别，将按名称/机构判定的「${ORG_NAME[explicit]}」抓取`
      : "代码形态未识别，请填完整产品名（含发行方，如「广银理财…」）或 Z 开头登记编码";
  }
}
async function queryProduct() {
  const code = ($("pCode").value || "").trim();
  if (!code) return toast("请输入登记编码");
  $("qResult").innerHTML = `<div class="note b">查询中，请稍候…（平台有概率验证码，可能需要重试）</div>`;
  try {
    const r = await fetch(DETAIL_PAGE + encodeURIComponent(code));
    const txt = await r.text();
    const dom = new DOMParser().parseFromString(txt, "text/html");
    /* 尝试从页面提取产品名 / 机构 / 净值表 */
    let name = "", inst = "";
    const descs = dom.querySelectorAll(".el-descriptions__item");
    descs.forEach(it => {
      const l = it.querySelector(".el-descriptions__label"), c = it.querySelector(".el-descriptions__content");
      if (l && c) { const k = l.textContent.trim(); if (k.includes("产品名称")) name = c.textContent.trim(); if (k.includes("发行机构")) inst = c.textContent.trim(); }
    });
    /* 净值表 */
    let navs = {};
    dom.querySelectorAll("table").forEach(tb => {
      const ths = [...tb.querySelectorAll("th")].map(x => x.textContent.trim());
      const di = ths.findIndex(x => x.includes("日期")), ni = ths.findIndex(x => x.includes("净值"));
      if (di >= 0 && ni >= 0) {
        tb.querySelectorAll("tbody tr").forEach(tr => {
          const tds = tr.querySelectorAll("td");
          if (tds.length > Math.max(di, ni)) {
            const d = tds[di].textContent.trim().replace(/\//g, "-");
            const v = Number(tds[ni].textContent.trim().replace(/,/g, ""));
            if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0) navs[d] = v;
          }
        });
      }
    });
    if (!name) {
      $("qResult").innerHTML = `<div class="note">未解析到产品信息（可能命中验证码或该页为动态加载）。请手动填写下方字段。</div>`;
      return;
    }
    $("pName").value = name; $("pInst").value = inst || "";
    UI.queriedNav = navs;
    const n = Object.keys(navs).length;
    $("qResult").innerHTML = `<div class="note g">已识别：<b>${esc(name)}</b><br>净值 ${n} 条${n ? "（" + Object.keys(navs).sort()[0] + " ~ " + Object.keys(navs).sort().pop() + "）" : ""}
      <br><span style="font-size:11px">注意：信披平台只提供登记编码，云端自动抓净值还需另填 <b>产品代码</b>。</span></div>`;
    onProdCodeInput();
  } catch (e) {
    $("qResult").innerHTML = `<div class="note">查询失败：${esc(String(e).slice(0, 80))}<br>可能是跨域限制或验证码。请手动填写。</div>`;
  }
}
function saveProduct(pid) {
  const name = ($("pName").value || "").trim();
  if (!name) return toast("产品名称必填");
  const patch = {
    code: ($("pCode").value || "").trim(),
    prodCode: ($("pProd").value || "").trim(),
    name,
    inst: ($("pInst").value || "").trim()
  };
  let target;
  if (pid) {
    target = DATA.products.find(x => x.id === pid);
    if (!target) return toast("产品不存在，请刷新后重试");
    Object.assign(target, patch);
    if (UI.queriedNav) target.navHistory = Object.assign(target.navHistory || {}, UI.queriedNav);
  } else {
    target = Object.assign({ id: uid(), navHistory: UI.queriedNav || {}, createdAt: Date.now() }, patch);
    DATA.products.push(target);
    if (UI.activePick !== undefined) UI.activePick = target.id;
  }
  const st = fetchStatus(target);
  UI.queriedNav = null; UI.editProdId = "";
  saveLocal(); closeSheet();
  toast((pid ? "产品已更新。" : "产品已保存。") + st.txt, st.ok ? 2200 : 3600);
  renderProd(); renderHome();
  autoPush();
}
function openNav(pid) {
  const p = DATA.products.find(x => x.id === pid); if (!p) return;
  const s = navSeries(p).slice().reverse();
  openSheet(`<div class="sheet-t"><h3>${esc(p.name)} · 净值</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="field"><label>新增/修改净值</label>
      <div class="two">
        <input type="date" id="nDate" value="${today()}">
        <input type="number" step="0.0001" id="nVal" placeholder="份额净值">
      </div>
      <button class="btn pri full" style="margin-top:9px" onclick="addNav('${pid}')">保存净值</button>
    </div>
    <div class="field"><label>批量粘贴净值（每行：日期 净值）</label>
      <textarea id="nBulk" rows="4" style="width:100%;padding:10px;border:1.5px solid var(--line);border-radius:11px;font-family:inherit;font-size:13px" placeholder="2026-09-10 1.0313&#10;2026-09-09 1.0312"></textarea>
      <button class="btn gh full" style="margin-top:9px" onclick="bulkNav('${pid}')">批量导入</button>
    </div>
    <div class="field"><label>已有净值（${s.length} 条）</label>
      <div style="max-height:200px;overflow:auto">${s.map(([d, v]) => `<div class="sumline"><span class="k">${d}</span><span style="display:flex;gap:10px;align-items:center"><b>${Number(v).toFixed(4)}</b><button class="mini" style="padding:2px 7px;font-size:10.5px" onclick="delNav('${pid}','${d}')">删</button></span></div>`).join("") || `<span class="muted" style="font-size:12px">暂无</span>`}</div>
    </div>`);
}
function addNav(pid) {
  const p = DATA.products.find(x => x.id === pid);
  const d = $("nDate").value, v = Number($("nVal").value);
  if (!d || !(v > 0)) return toast("请填写日期与净值");
  p.navHistory = p.navHistory || {}; p.navHistory[d] = v;
  saveLocal(); toast("净值已保存"); openNav(pid); renderHome(); renderProd(); autoPush();
}
function bulkNav(pid) {
  const p = DATA.products.find(x => x.id === pid);
  const lines = $("nBulk").value.split("\n"); let n = 0;
  p.navHistory = p.navHistory || {};
  for (const ln of lines) {
    const m = ln.trim().match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})\D+([\d.]+)/);
    if (m) { const d = m[1].replace(/\//g, "-").replace(/-(\d)\b/g, "-0$1").replace(/\b(\d)-/g, "0$1-"); p.navHistory[d] = Number(m[2]); n++; }
  }
  saveLocal(); toast(`已导入 ${n} 条`); openNav(pid); renderHome(); renderProd(); autoPush();
}
function delNav(pid, d) {
  const p = DATA.products.find(x => x.id === pid); delete p.navHistory[d];
  saveLocal(); openNav(pid); renderHome(); renderProd(); autoPush();
}
function delProd(pid) {
  if (!confirm("删除该产品及其所有交易记录？")) return;
  DATA.products = DATA.products.filter(x => x.id !== pid);
  DATA.trades = DATA.trades.filter(t => t.prodId !== pid);
  saveLocal(); renderProd(); renderHome(); autoPush();
}
function delTrade(tid) {
  if (!confirm("删除这笔交易？")) return;
  DATA.trades = DATA.trades.filter(t => t.id !== tid);
  saveLocal(); renderTrade(); renderHome(); autoPush();
}

/* ============================================================
   净值更新：改为「云端更新说明」弹层
   ------------------------------------------------------------
   原先这里的浏览器端 fetch 实际不可用 —— 中国理财网信披平台被 CORS 拦截，
   点击后没有任何反应。净值改由云端 GitHub Actions 每天 08:00 / 12:00 抓取
   并提交到私有仓库，浏览器端只需「从云端拉取」。
   ============================================================ */
function refreshNav() {
  const last = (DATA.settings && DATA.settings.lastNavSync) || "";
  const rows = DATA.products.map(p => {
    const st = fetchStatus(p);
    return `<div class="sumline" style="align-items:flex-start">
      <span class="k" style="flex:1">${esc(p.name || p.id)}</span>
      <b class="${st.ok ? "down" : "muted"}" style="font-size:10.5px;text-align:right;margin-left:8px">${esc(st.txt)}</b>
    </div>`;
  }).join("") || `<div class="empty">暂无产品</div>`;
  const ready = DATA.products.filter(p => fetchStatus(p).ok).length;
  openSheet(`<div class="sheet-t"><h3>净值更新说明</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="note b" style="margin-bottom:12px">
      净值<b>不再由浏览器抓取</b>。北银 / 华夏 / 浦银 / 信银 / 南银 / 民生 官网均设置了跨域限制（CORS）或加密/风控，
      页面直连会被浏览器拦截 —— 这正是原「每日更新」按钮点了没反应的原因。<br><br>
      现在由云端 <b>GitHub Actions</b> 每天 <b>08:00 / 12:00</b> 自动抓取官方公开披露的净值，
      提交到你的私有仓库；本页点「从云端拉取」即可同步到手机 / 电脑。
    </div>
    <div class="field"><label>云端最近一次抓取</label>
      <div class="note ${last ? "g" : ""}">${last ? esc(last) : "暂无记录（云端抓取任务尚未写入）"}</div>
    </div>
    <div class="field"><label>各产品抓取就绪状态（${ready} / ${DATA.products.length} 可自动抓取）</label>
      <div>${rows}<div class="tip" style="margin-top:6px">判定口径与云端抓取脚本一致：<b>机构可识别</b> + <b>已填产品代码</b>。标 ⚠️ 的产品请到「产品」页点「编辑」补填。</div></div>
    </div>
    <div class="row-btn" style="margin-top:14px">
      <button class="btn gh" style="flex:1" onclick="closeSheet();go('pg-prod')">去产品页</button>
      <button class="btn pri" style="flex:1" onclick="closeSheet();syncPull(true)">↓ 从云端拉取</button>
    </div>`);
}

/* ============================================================
   GitHub 同步（1a：Token 直连私有仓库）
   ============================================================ */
const GH = "https://api.github.com";
function openSync() {
  openSheet(`<div class="sheet-t"><h3>数据同步设置</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="note b" style="margin-bottom:12px">
      数据存到你<b>自己的 GitHub 私有仓库</b>的一个 JSON 文件里，多设备打开即共享。
      请用<b>细粒度 Token</b>（Fine-grained PAT），仅授权该仓库的 <code>Contents: Read and write</code>。
    </div>
    <div class="field"><label>GitHub 用户名</label><input id="sOwner" value="${esc(SYNC.owner)}" placeholder="如 zhangsan"></div>
    <div class="field"><label>仓库名</label><input id="sRepo" value="${esc(SYNC.repo)}" placeholder="如 licai-data"></div>
    <div class="field"><label>数据文件路径</label><input id="sPath" value="${esc(SYNC.path)}" placeholder="licai-data.json"></div>
    <div class="field"><label>细粒度 Token</label><input id="sToken" type="password" value="${esc(SYNC.token)}" placeholder="github_pat_..."></div>
    <div class="note">Token 只保存在本机浏览器，不会上传到任何第三方。若泄露可随时在 GitHub 吊销。</div>
    <div class="row-btn" style="margin-top:14px">
      <button class="btn gh" style="flex:1" onclick="saveSyncCfg()">保存配置</button>
      <button class="btn pri" style="flex:1" onclick="saveSyncCfg(true)">保存并测试</button>
    </div>
    <div class="row-btn" style="margin-top:9px">
      <button class="btn gh" style="flex:1" onclick="syncPull(true)">↓ 拉取云端数据</button>
      <button class="btn pri" style="flex:1" onclick="syncPush(true)">↑ 推送本地数据</button>
    </div>
    <div id="syncMsg" style="margin-top:10px"></div>`);
}
function saveSyncCfg(test) {
  SYNC.owner = ($("sOwner").value || "").trim();
  SYNC.repo = ($("sRepo").value || "").trim();
  SYNC.path = ($("sPath").value || "licai-data.json").trim();
  SYNC.token = ($("sToken").value || "").trim();
  saveSync(); renderSet(); renderHome();
  if (test) testConn();
}
async function ghReq(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: {
      "Authorization": "Bearer " + SYNC.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`); }
  return r.status === 204 ? null : r.json();
}
function syncMsg(html) { const e = $("syncMsg"); if (e) e.innerHTML = html; else toast(html.replace(/<[^>]+>/g, "")); }
async function testConn() {
  if (!SYNC.owner || !SYNC.repo || !SYNC.token) return toast("请先填完整配置");
  syncMsg("测试连接中…");
  try {
    const repo = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}`);
    let exists = false;
    try { await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`); exists = true; } catch (e) { }
    syncMsg(`<div class="note g">连接成功：<b>${esc(repo.full_name)}</b>（${repo.private ? "私有" : "⚠️ 公开！"}）<br>数据文件${exists ? "已存在" : "尚不存在，首次推送会自动创建"}</div>`);
  } catch (e) { syncMsg(`<div class="note">连接失败：${esc(String(e).slice(0, 140))}</div>`); }
}
async function syncPull(manual) {
  if (!SYNC.owner || !SYNC.repo || !SYNC.token) { if (manual) toast("请先配置同步"); return; }
  try {
    const info = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`);
    SYNC.sha = info.sha; saveSync();
    const remote = JSON.parse(decodeURIComponent(escape(atob(info.content.replace(/\n/g, "")))));
    if (manual && !confirm("用云端数据覆盖本地？本地未同步的改动将丢失。\n建议：先在另一台设备推送，或先导出本地备份。")) return;
    DATA = Object.assign({ products: [], trades: [], settings: {} }, remote);
    saveLocal();
    /* 云端数据同样要过一遍迁移：合并重复产品、搬迁销售代码。
       若发生变更则回写云端 —— 抓取脚本读到正确的产品代码后才会抓到净值。 */
    const migratedRemote = migrateData();
    renderHome(); renderTrade(); renderProd(); renderSet();
    if (migratedRemote) { notifyMigrate(); autoPush(); }
    if (manual) toast(migratedRemote ? "已从云端拉取，并自动整理数据" : "已从云端拉取");
  } catch (e) {
    if (manual) toast("拉取失败：" + String(e).slice(0, 80), 3000);
  }
}
async function syncPush(manual) {
  if (!SYNC.owner || !SYNC.repo || !SYNC.token) { if (manual) toast("请先配置同步"); return; }
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(DATA, null, 1))));
  const body = { message: `update ledger ${new Date().toISOString().slice(0, 16)}`, content };
  try {
    if (SYNC.sha) body.sha = SYNC.sha;
    else {
      try { const info = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`); body.sha = info.sha; } catch (e) { }
    }
    const res = await ghReq("PUT", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`, body);
    SYNC.sha = res && res.content ? res.content.sha : ""; saveSync();
    $("syncState").textContent = "已同步";
    if (manual) toast("已推送到云端");
  } catch (e) {
    if (manual) toast("推送失败：" + String(e).slice(0, 90), 3200);
    console.warn(e);
  }
}
/* 自动推送（静默，失败不打扰） */
let _pushTimer;
function autoPush() {
  if (!(SYNC.owner && SYNC.repo && SYNC.token)) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => syncPush(false), 1500);
}

/* ============================================================
   备份 / 恢复 / 清空
   ============================================================ */
function exportJSON() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `理财台账备份_${today()}.json`;
  a.click(); toast("已导出备份");
}
function importJSON() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const o = JSON.parse(rd.result);
        if (!o.products) throw new Error("格式不对");
        if (!confirm("导入将覆盖当前本地数据，确定？")) return;
        DATA = Object.assign({ products: [], trades: [], settings: {} }, o);
        saveLocal(); renderHome(); renderTrade(); renderProd(); renderSet(); toast("已导入");
      } catch (e) { toast("导入失败：" + e.message); }
    };
    rd.readAsText(f);
  };
  inp.click();
}
function clearAll() {
  if (!confirm("将清空本机全部产品与交易数据（云端不受影响），确定？")) return;
  DATA = { products: [], trades: [], settings: { hideAmount: false } };
  saveLocal(); renderHome(); renderTrade(); renderProd(); toast("已清空本地数据");
}

/* ============================================================
   启动
   ============================================================ */
(function init() {
  loadLocal();
  /* 启动即做一次数据迁移：销售代码→产品代码、重复产品合并 */
  const migrated = migrateData();
  $("btnHide").textContent = DATA.settings.hideAmount ? "显示" : "隐藏";
  renderHome(); renderSet();
  if (migrated) notifyMigrate();
  if (SYNC.owner && SYNC.repo && SYNC.token) syncPull(false);
  window.addEventListener("online", () => { if (SYNC.owner) syncPull(false); });
  /* 注册 Service Worker（仅 https / localhost 生效，file:// 下自动跳过） */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => { });
  }
})();
