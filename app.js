/* ============================================================
   个人理财台账 · 核心逻辑
   数据模型 / 收益计算 / 日历 / 交易录入 / GitHub 同步
   ============================================================ */
"use strict";

/* ---------- 常量 ---------- */
const LS_DATA = "licai_ledger_v1";
const LS_SYNC = "licai_ledger_sync_v1";
/* 通知开关与「已忽略的告警」存本机，不进 licai-data.json：
   通知权限是「每台设备授权一次」的东西，同步过去没有意义；
   告警的「已读」同理只对当前设备成立 —— 放进 DATA 会被 autoPush 推给别的设备，
   反而让另一台设备漏掉该看到的提醒。 */
const LS_NOTIFY = "licai_ledger_notify_v1";
const LS_ALERT = "licai_ledger_alert_v1";
/* 前端版本号：与 sw.js 的 CACHE 后缀必须一致（_test_dom.js 有断言守住）。
   升版时三处一起改：这里 + sw.js 的 CACHE + _test_smoke.js 的预期值。
   页面上会显示出来 —— 之前「推了代码但页面没变」排查起来全靠猜，有了它一眼可判。 */
const APP_VER = "v33";
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
  ["宁银理财", "wmbnb"], ["宁银", "wmbnb"], ["wmbnb", "wmbnb"],
  /* 徽银（徽商银行理财）：官网 lccs.php 列表 + lccs_income_list.php 历史表直抓
     （2026-09-16 接入），与云端 ORG_ALIAS 末尾四项同序同构。 */
  ["徽银理财", "huiyin"], ["徽银", "huiyin"], ["hsbank", "huiyin"], ["huiyin", "huiyin"],
  /* 中银理财（bocwm.cn）：官网 webApi getNetWorthByCode 直抓全历史（2026-09-16 接入），
     与云端 ORG_ALIAS 末尾三项同序同构。
     注意「中银理财」≠「中国银行」—— 中行只是代销渠道，发行方是中银理财。 */
  ["中银理财", "bocwm"], ["中银", "bocwm"], ["bocwm", "bocwm"],
  /* 农银理财（abcwealth.com.cn）：官网 config.js 暴露 /awpsservice，净值接口可直抓全历史
     （2026-09-16 接入），与云端 ORG_ALIAS 末尾四项同序同构。 */
  ["农银理财", "nongyin"], ["农银", "nongyin"], ["abcwealth", "nongyin"], ["nongyin", "nongyin"],
  /* 杭银理财（hzbankwealth.com.cn）：eportal 静态 JSON 一次拿全量产品最新净值
     （2026-09-16 接入），与云端 ORG_ALIAS 末尾四项同序同构。 */
  ["杭银理财", "hangyin"], ["杭银", "hangyin"], ["hzbankwealth", "hangyin"], ["hangyin", "hangyin"],
  /* 兴银理财（cibwm.com.cn）：/api/public/pc/productVal/ 下拉全历史净值（2026-09-16 接入），
     与云端 ORG_ALIAS 末尾同序同构。 */
  ["兴银理财", "xingyin"], ["兴银", "xingyin"], ["cibwm", "xingyin"], ["xingyin", "xingyin"],
  /* 广银理财（cgbwmc.com.cn）：Rtp 框架 SPA，POST /wmpcext/noSessionServlet/{模块}/{动作}.fun
     整表翻页取最新净值（2026-09-16 接入）。产品代码形态极杂（1XFTLFB307A / LJR121 /
     HYGWCY0602A …）→ 不臆造正则，靠机构名判定。 */
  ["广银理财", "guangyin"], ["广银", "guangyin"], ["cgbwmc", "guangyin"], ["guangyin", "guangyin"],
  /* 工银理财（wm.icbc.com.cn）：自研 KitRequest 加密通道（主/工作密钥 + HMAC-MD5 签名 +
     AES-128-CBC 字段加密），走 clt/info/112901 列表 + 112902 明细取净值（2026-09-16 接入）。
     产品代码形态多样（26GS6464 主码 / 26G6464A 销售码）→ 不臆造正则。 */
  ["工银理财", "icbc"], ["工银", "icbc"], ["icbc", "icbc"]
];
const ORG_NAME = { bob: "北银理财", hx: "华夏理财", spdb: "浦银理财", citic: "信银理财",
                   nanyin: "南银理财", cmbc: "民生理财", wmbnb: "宁银理财",
                   huiyin: "徽银理财", bocwm: "中银理财", nongyin: "农银理财",
                   hangyin: "杭银理财", xingyin: "兴银理财", guangyin: "广银理财",
                   icbc: "工银理财", chinawealth: "中国理财网" };
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
  [/^Z[A-Z]{2}\d{7}[A-Z]$/i, "wmbnb", "宁银产品代码：Z + 2 位字母 + 7 位数字 + 份额字母（如 ZGN2360006C）"],
  /* 徽银：PNHY + 6 位数字 +（可带下划线）+ 份额字母，如 PNHY260367F / PNHY240108_B。
     官网 lccs.php 列表按此代码定位产品；比对时云端会忽略下划线。 */
  [/^PNHY\d{6}_?[A-Z]$/i, "huiyin", "徽银产品代码：PNHY + 6 位数字 +（可带 _）+ 份额字母（如 PNHY260367F）"]
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
  const reg = String((p && (p.regCode || p.code)) || "").trim().toUpperCase();
  const hasReg = /^Z\d{12,14}$/.test(reg);
  const nm = String((p && p.name) || "").trim();
  /* 按产品名称搜索只在名称足够完整时才有意义（"某产品"这类短名在信披平台搜不到），
     故要求 6 字以上 —— 与云端「按名搜索」的实际可用性对齐。 */
  const hasName = nm.length >= 6;
  /* 中国理财网信披平台：登记编码（精确）或完整产品名称（模糊）任一即可查，覆盖任意发行方 */
  const cwVia = hasReg ? "按登记编码" : (hasName ? "按产品名称" : "");
  /* 发行方官网抓取器：只认「产品代码」 */
  const official = org && org !== "chinawealth" && ORG_NAME[org];

  if (official && code) {
    /* 两条线都能跑 —— 云端会同时抓、自动择优（更新的胜，同日以官网为准） */
    return { ok: true, lv: "ok", txt: `✓ 双线自动抓取（${ORG_NAME[org]}官网 + 中国理财网）` };
  }
  if (official && !code) {
    return cwVia
      ? { ok: true, lv: "ok", txt: `✓ 中国理财网可抓（${cwVia}）—— 补填「产品代码」还能叠加 ${ORG_NAME[org]} 官网（历史更全）` }
      : { ok: false, lv: "warn", txt: `⚠️ 缺产品代码：${ORG_NAME[org]} 官网按产品代码查询；也可填登记编码（Z 开头）走中国理财网` };
  }
  if (cwVia) {
    return { ok: true, lv: "ok", txt: `✓ 中国理财网可自动抓最新净值（${cwVia}）` };
  }
  if (org === "chinawealth") {
    return { ok: false, lv: "warn", txt: "⚠️ 中国理财网查询需填登记编码（Z 开头）或完整产品名称" };
  }
  if (!org) return { ok: false, lv: "warn", txt: "⚠️ 机构未识别（机构栏填理财公司全名如「招银理财/工银理财」，或填 Z 开头登记编码走中国理财网）" };
  return { ok: false, lv: "warn", txt: "⚠️ 缺产品代码，云端无法抓净值" };
}

/* 本轮抓取「这条净值是从哪条线来的」——云端每次抓取都会对同一产品同时查
   【官网抓取器】与【中国理财网聚合源】，自动择优，结果写在
   settings.lastFetch.products[产品id]。这里读出来给用户看（来源 / 最新日期 /
   为什么选它 / 两源是否一致）。没有记录（如从未抓过）时返回 null。 */
function navSrcInfo(p) {
  const lf = lastFetchInfo();
  const all = (lf && lf.products) || {};
  let info = all[String((p && p.id) || "")];
  if (!info) {
    /* 兜底：产品 id 迁移过时，用登记编码 / 产品代码再找一次 */
    const keys = [p && p.code, p && p.prodCode, p && p.regCode]
      .map(x => String(x || "").trim().toUpperCase()).filter(Boolean);
    for (const k of Object.keys(all)) {
      if (keys.includes(String(k).toUpperCase())) { info = all[k]; break; }
    }
  }
  return info && info.latest ? info : null;
}
/* 来源摘要的一行文字（含择优理由），供详情页 / 说明页复用 */
function navSrcText(info) {
  if (!info) return "";
  const n = (info.sources || []).length;
  const base = `${info.via}·${info.label} ${info.latest}`;
  const why = info.why ? `（${info.why}）` : "";
  const both = n > 1 ? "｜双线已比对" : "｜另一条线本次未取到";
  const cf = info.conflicts && info.conflicts.length
    ? `｜⚠️ 与另一源有 ${info.conflicts.length} 处同日数值差异` : "";
  return base + why + both + cf;
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
/* 提醒状态（本机）：on = 用户是否开启了系统通知；lastCheck = 上次比对云端的时间戳 */
let NOTIFY = { on: false, lastCheck: 0 };
/* 用户已忽略的抓取告警签名（按「失败集合」生成，集合一变就重新提示） */
let ALERT_DISMISSED = "";
let UI = { range: "day", groupBy: "inst", calY: 0, calM: 0, selDate: "", activePick: "", viewProd: "", detTab: "active", prodRange: "3m", prodOv: "a7", detQ: "", detInst: "", detSort: "dayP", detAsc: false };

/* ---------- 工具 ---------- */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => fmtDate(new Date());
/* 金额格式化。
   ⚠️ 必须先把入参转成数字：历史数据或手工改过的 licai-data.json 里 amount 可能是
   undefined/null，直接 .toLocaleString 会抛异常并把整个列表渲染打断（页面白屏）。 */
const money = n => {
  const v = Number(n) || 0;
  return (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
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
/* ---------- 持久化 ---------- */
/* （workdaysBetween 已删除：定义后从未被调用，且容易让人误以为 T+1 用工作日口径 —— 2026-09-15 审查清理） */
let STORAGE_BAD = false;   /* 只提示一次，成功后自动复位 */
/* 数据版本号：每次 saveLocal（即任何对 DATA 的持久化改动）+1，
   position() 的结果缓存据此失效（v32 P1-3）。 */
let _POS_VER = 0;
/* 本地有改动尚未成功推送到云端时为 true（v32 P0-2）：
   静默拉取（启动 / 回前台 / online / 后台轮询）看到 dirty 会先推后拉，
   避免云端旧数据把本地还没推上去的编辑覆盖丢掉。 */
let DIRTY = false;
function dirtyPersist() { try { localStorage.setItem(LS_DATA + ".dirty", DIRTY ? "1" : "0"); } catch (e) { } }
function saveLocal() {
  _POS_VER++; DIRTY = true; dirtyPersist();
  try {
    localStorage.setItem(LS_DATA, JSON.stringify(DATA));
    if (STORAGE_BAD) { STORAGE_BAD = false; toast("本地存储已恢复", 2400); }
  } catch (e) {
    console.warn(e);
    if (!STORAGE_BAD) {
      STORAGE_BAD = true;
      toast("⚠️ 本地存储不可用（隐私模式或空间已满），本次修改未保存到本机", 4600);
    }
  }
}
function loadLocal() {
  try {
    const s = localStorage.getItem(LS_DATA);
    if (s) { const o = JSON.parse(s); DATA = Object.assign({ products: [], trades: [], settings: {} }, o); }
    const y = localStorage.getItem(LS_SYNC);
    if (y) SYNC = Object.assign(SYNC, JSON.parse(y));
    DIRTY = localStorage.getItem(LS_DATA + ".dirty") === "1";   /* v32 P0-2 */
  } catch (e) { console.warn(e); }
}
function saveSync() {
  try { localStorage.setItem(LS_SYNC, JSON.stringify(SYNC)); }
  catch (e) { console.warn(e); /* 同步配置存不进去只影响下次免输入，不弹窗打扰 */ }
}

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
  /* 产品代码都填了但不一致：不同份额/不同产品，同样禁止名称误合并（v32 P1-5） */
  if (pa && pb && pa.toUpperCase() !== pb.toUpperCase()) return false;
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
/* position 结果缓存（v32 P1-3）：渲染热路径每轮反复调 position/portfolio，
   全量重算 O(产品×交易)。以「数据版本号 + 当天日期」为键 ——
   任何 saveLocal 都会 bump _POS_VER；跨天由 day 比对自动失效。 */
const _posCache = new Map();
function position(p) {
  const td = today();
  const _ck = _posCache.get(p.id);
  if (_ck && _ck.ver === _POS_VER && _ck.day === td) return _ck.pos;
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
  const pos = { shares, cost, market, profit, realized, lastNav, lastDate, startDate, holdDays, holdAnnual, annualValid,
           pendingShares, pendingAmount, hasPending, inTransit, navSeries: navSeries(p) };
  _posCache.set(p.id, { ver: _POS_VER, day: td, pos: pos });
  return pos;
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

/* 区间收益（#19 口径，2026-09-15）：逐披露日加权 ——
   每个披露日用「截至当日已确认份额」× 当日净值差，与日历 dayProfit 完全同口径。
   旧实现用「区间末份额 × 整段净值差」：月中买入会把建仓前涨幅算给它（虚高）、
   月中卖出漏计已卖份额段（虚低），且与日历逐日加总不一致。
   区间边界：算 (fromDate, toDate] 内的披露日（fromDate 当日净值作基准不计入）。 */
function periodProfit(fromDate, toDate) {
  let s = 0;
  for (const p of DATA.products) {
    const s0 = navSeries(p);
    for (let i = 1; i < s0.length; i++) {
      const d = s0[i][0];
      if (d <= fromDate || d > toDate) continue;
      const sh = sharesOn(p, d);
      if (sh > 0) s += sh * (Number(s0[i][1]) - Number(s0[i - 1][1]));
    }
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
/* 某自然月收益（#19 口径，2026-09-15）：该月每个披露日的日收益加总
   （当日已确认份额 × 净值差），与日历逐日加总完全一致。
   产品序列首条披露日无前值，不产生收益（与 dayProfit 同规则）。 */
function monthProfit(y, m) {
  const first = `${y}-${pad(m)}-01`;
  const last = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
  let s = 0;
  for (const p of DATA.products) {
    const s0 = navSeries(p);
    for (let i = 0; i < s0.length; i++) {
      const d = s0[i][0];
      if (d < first || d > last || i === 0) continue;
      const sh = sharesOn(p, d);
      if (sh > 0) s += sh * (Number(s0[i][1]) - Number(s0[i - 1][1]));
    }
  }
  return s;
}

/* 某日的组合市值（截至该日已确认份额 × 该日最近净值）—— 年化分母用，
   不能拿今天的市值去折算历史月份（当月加仓会把上月年化压低） */
function marketOn(endDate) {
  let s = 0;
  for (const p of DATA.products) {
    const sh = sharesOn(p, endDate);
    if (sh <= 0) continue;
    const b = navOnOrBefore(p, endDate);
    if (!b) continue;
    s += sh * Number(b[1]);
  }
  return s;
}

/* 组合年化（本月/上月）：区间收益 / 该月末市值 × 365 / 在册天数 */
function annualize(profit, y, m) {
  const cur = new Date();
  const isCur = cur.getMonth() + 1 === m && cur.getFullYear() === y;
  const end = isCur ? today()
    : `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
  const denom = marketOn(end);
  const days = isCur ? Math.max(cur.getDate(), 1) : new Date(y, m, 0).getDate();
  if (denom <= 0 || days <= 0) return 0;
  return (profit / denom) * 365 / days;
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
  /* 口径透明化：把「这笔钱是怎么算出来的」写在数字旁边，避免误读成官方数字 */
  const sellsN = DATA.trades.filter(t => t.type === "sell").length;
  if ($("statRealCap")) $("statRealCap").textContent = `赎回结算 · 均价法扣减成本 · 已核算 ${sellsN} 笔赎回`;
  $("statCnt").textContent = pf.rows.length; $("statCnt").className = "v";
  if ($("appVer")) $("appVer").textContent = `版本 ${APP_VER}`;
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
/* 排序维度（默认「当日盈亏」，与改造前行为一致，避免默认视图突变） */
const DET_SORTS = [
  ["dayP", "当日盈亏"], ["mkt", "市值"], ["profit", "持仓收益"], ["annual", "年化"],
  ["a7", "近7日"], ["a30", "近1月"], ["wan", "万收"], ["upd", "更新"], ["days", "天数"],
];
/* 机构简称：把「XX理财有限责任公司」压成「XX理财」，筛选 chip 才放得下 */
function instShort(inst) {
  const s = String(inst || "").trim().replace(/(有限责任公司|股份有限公司|有限公司|公司)$/, "");
  return s || "未填机构";
}
/* 产品级净值指标（只在按 近7日/近14日/近1月/万收 排序时才需要，避免每次渲染都算） */
function prodMetrics(p) {
  const st = navStats(p);
  return { a7: lastNum(st.a7), a14: lastNum(st.a14), a30: lastNum(st.a30), wan: lastNum(st.wan), count: st.vals.length };
}
/* 取某行的排序值；无该指标时返回 null（null 永远排最后，不参与方向翻转） */
function detSortVal(x, key, m) {
  switch (key) {
    case "mkt": return x.pos.market;
    case "profit": return x.pos.profit;
    case "annual": return x.pos.annualValid ? x.pos.holdAnnual : null;
    case "a7": return m ? m.a7 : null;
    case "a30": return m ? m.a30 : null;
    case "wan": return m ? m.wan : null;
    case "upd": return x.pos.lastDate || null;
    case "days": return x.pos.holdDays;
    default: return x.dayP;
  }
}
function setDetSort(key) {
  if (UI.detSort === key) UI.detAsc = !UI.detAsc;      /* 再点一次翻转方向 */
  else { UI.detSort = key; UI.detAsc = false; }        /* 默认降序：大的在前 */
  renderDetail();
}
function setDetInst(v) { UI.detInst = v; renderDetail(); }
function onDetSearch() {
  const el = $("detSearch");
  UI.detQ = el ? el.value : "";
  renderDetailBody();                                   /* 只重画列表，输入框不被重建 → 不丢焦点 */
}
function clearDetSearch() {
  if ($("detSearch")) $("detSearch").value = "";
  UI.detQ = ""; renderDetail();
}

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
      <div class="nm">${esc(prodLabel(p))}<span class="state-chip">交易在途</span></div>
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
      <div class="nm">${esc(prodLabel(p))}<span class="state-chip closed">已清仓</span></div>
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

/* 当前 tab 的行集合 */
function detTabList(pf) {
  return UI.detTab === "pending" ? pf.pendingRows
    : UI.detTab === "closed" ? pf.closedRows : pf.rows;
}
/* 机构筛选 + 关键字搜索（三者都要过） */
function detFilter(list) {
  let out = list;
  if (UI.detInst) out = out.filter(r => (r.p.inst || "") === UI.detInst);
  const q = String(UI.detQ || "").trim().toLowerCase();
  if (q) {
    out = out.filter(r => [r.p.name, r.p.code, r.p.prodCode, r.p.inst, prodLabel(r.p)]
      .some(v => String(v == null ? "" : v).toLowerCase().indexOf(q) >= 0));
  }
  return out;
}
/* 排序（仅持仓中 tab 有意义；在途/已清仓不显示排序 chip） */
function detSort(list) {
  const key = UI.detSort, asc = !!UI.detAsc;
  const needM = ["a7", "a30", "wan"].indexOf(key) >= 0;
  const M = {};
  if (needM) for (const x of list) M[x.r.p.id] = prodMetrics(x.r.p);
  return [...list].sort((a, b) => {
    const va = detSortVal(a, key, M[a.r.p.id]);
    const vb = detSortVal(b, key, M[b.r.p.id]);
    const na = va === null || va === undefined || va === "", nb = vb === null || vb === undefined || vb === "";
    if (na && nb) return 0;
    if (na) return 1;                     /* 无数据的排最后，不随方向翻转 */
    if (nb) return -1;
    const d = typeof va === "string" ? String(va).localeCompare(String(vb)) : (va - vb);
    return asc ? d : -d;
  });
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
  const tabList = detTabList(pf);

  /* 机构筛选 chips（按该 tab 的实际机构生成，只有一家时不必占位） */
  if ($("detInstChips")) {
    const cnt = {};
    for (const r of tabList) { const k = r.p.inst || ""; cnt[k] = (cnt[k] || 0) + 1; }
    const keys = Object.keys(cnt);
    const multi = keys.length > 1;
    $("detInstChips").innerHTML = !multi ? "" : `<button class="chip${UI.detInst === "" ? " on" : ""}" onclick="setDetInst('')">全部 ${tabList.length}</button>`
      + keys.map(k => `<button class="chip${UI.detInst === k ? " on" : ""}" onclick="setDetInst(${JSON.stringify(k).replace(/"/g, "&quot;")})">${esc(instShort(k))} ${cnt[k]}</button>`).join("");
    /* 选中的机构已不在当前 tab 里（切 tab 后）→ 自动回到全部，避免空白页 */
    if (UI.detInst && keys.indexOf(UI.detInst) < 0) UI.detInst = "";
  }
  /* 排序 chips（仅持仓中；在途/已清仓排序无意义） */
  if ($("detSortChips")) {
    $("detSortChips").innerHTML = UI.detTab !== "active" ? "" :
      DET_SORTS.map(([k, lab]) =>
        `<button class="chip${UI.detSort === k ? " on" : ""}" onclick="setDetSort('${k}')">${lab}${UI.detSort === k ? (UI.detAsc ? " ↑" : " ↓") : ""}</button>`
      ).join("");
  }
  renderDetailBody();
}

function renderDetailBody() {
  const pf = portfolio();
  const date = UI.selDate || latestDateAll() || today();
  const tabList = detTabList(pf);
  const total = tabList.length;
  let list = detFilter(tabList);
  const filtered = UI.detInst || String(UI.detQ || "").trim();
  if (filtered) {
    $("detTitle").innerHTML = `收益明细 <span class="date">· ${date}</span> <span class="muted" style="font-size:11px">筛出 ${list.length}/${total}</span>`;
  }
  if (!list.length) {
    const tip = filtered ? "没有匹配的产品，点「清除」重置筛选"
      : UI.detTab === "pending" ? "没有在途交易。申购/赎回确认后会转入「持仓中」。"
        : UI.detTab === "closed" ? "还没有已清仓的产品。"
          : "还没有持仓，点「进入」交易中心添加第一笔买入";
    $("detBody").innerHTML = `<div class="empty">${tip}</div>`; return;
  }
  if (UI.detTab === "pending") { $("detBody").innerHTML = pendingHtml(list); return; }
  if (UI.detTab === "closed") { $("detBody").innerHTML = closedHtml(list); return; }

  /* 当日盈亏：仅当该日有净值更新时计入（见 dayProfit 的说明）。
     份额必须用「截至该日已确认」的 sharesOn(p, date) —— r.pos.shares 是今天的
     份额，选历史日期时会放大、清仓产品会错误显示 0（与 dayProfit 同口径）。 */
  const rows = list.map(r => {
    const s0 = navSeries(r.p);
    const idx = s0.findIndex(x => x[0] === date);
    return {
      r, pos: r.pos,
      dayP: idx > 0 ? sharesOn(r.p, date) * (Number(s0[idx][1]) - Number(s0[idx - 1][1])) : 0,
      dayNavChange: idx > 0 ? (Number(s0[idx][1]) - Number(s0[idx - 1][1])) : 0,
    };
  });
  const sorted = detSort(rows);

  const groups = {};
  const sortLab = (DET_SORTS.find(x => x[0] === UI.detSort) || DET_SORTS[0])[1];
  for (const x of sorted) {
    const key = UI.groupBy === "inst" ? (x.r.p.inst || "未分组") : `按${sortLab}排序`;
    (groups[key] = groups[key] || []).push(x);
  }
  let html = "";
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
        <div class="pn"><button class="link" onclick="openProdDetail('${x.r.p.id}')">${esc(prodLabel(x.r.p))}</button></div>
        <div class="pv ${cls(x.dayP)}">${signMoney(x.dayP)}</div>
        <div class="pk">
          <i>持有金额 <b>${DATA.settings.hideAmount ? "****" : money(x.pos.market)}</b></i>
          <i>当日盈亏 <b class="${cls(x.dayP)}">${signMoney(x.dayP)}</b></i>
          <i>持仓盈亏 <b class="${cls(x.pos.profit)}">${signMoney(x.pos.profit)}</b>（市值−成本）</i>
          <i>持有年化 ${annualTxt}（本金天数加权）</i>
          <i>持有 <b>${x.pos.holdDays}天</b></i>
          <i>净值 <b>${x.pos.lastNav.toFixed(4)}</b>${x.pos.lastDate ? "（" + esc(x.pos.lastDate.slice(5)) + "）" : ""}</i>
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
          <div style="font-weight:650;font-size:12.5px">${esc(p ? prodLabel(p) : "已删除产品")}
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
      return `<div class="sumline"><span class="k">${esc(p ? prodLabel(p) : "-")} <span class="muted" style="font-size:11px">${t.tradeDate}</span></span>
        <b class="${cls(t.realized)}">${signMoney(t.realized)}</b></div>`;
    }).join("") + `<div class="sumline"><span class="k">合计已实现 <span class="muted" style="font-size:10.5px">均价法扣减成本 · 已核算 ${sells.length} 笔赎回</span></span><b class="${cls(tot)}">${signMoney(tot)}</b></div>`;
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
        <div class="p1"><button class="link" onclick="openProdDetail('${p.id}')">${esc(prodLabel(p))}</button> <span class="wr" style="font-size:10.5px;color:var(--ink3)">${esc(p.inst || "")}</span></div>
        <div class="p2">登记编码 ${esc(p.code || "-")} · 产品代码 <b>${esc(p.prodCode || "-")}</b></div>
        <div class="p2" style="color:${st.ok ? "#0d7a52" : "#8a6300"}">${st.txt}</div>
        <div class="p3">份额 ${pos.shares.toFixed(2)} · 成本 ${money(pos.cost)} · 市值 ${money(pos.market)} · 浮盈 <b class="${cls(pos.profit)}">${signMoney(pos.profit)}</b> · 净值 ${l ? l[1].toFixed(4) + " (" + l[0] + ")" : "无数据"}</div>
        <div class="row-btn" style="margin-top:8px">
          <button class="mini" onclick="openProdDetail('${p.id}')">详情</button>
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
      <div style="font-size:12.5px;font-weight:650;margin-bottom:5px">${esc(prodLabel(p))} <span class="muted" style="font-size:11px">共 ${s.length} 条</span></div>
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
  renderNotify();
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
      <div class="p1">${esc(prodLabel(p))}</div>
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
    <div class="note b">当前操作产品：<b>${esc(prodLabel(p))}</b><br>${esc(p.inst || "")}${p.prodCode ? " · 产品代码 " + esc(p.prodCode) : ""}</div>
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
  /* 防快速双击：第一次保存已 closeSheet，第二次点击进不来 */
  if (!$("mask").classList.contains("show")) return;
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

/* ============================================================
   粘贴链接添加产品
   ------------------------------------------------------------
   为什么前端只做「抽键 + 判机构」、不抓页面：
     跨域会被 CORS 拦死（这正是当初把抓取挪到 GitHub Actions 的原因），
     而各行分享链接的 query 里基本都直接带着可用代码 ——
     中国理财网 prodRegCode、北银 PROD_CODE、宁银 projectcode …

   ★ 云端契约（勿改，改了这里会静默失效）：
     fetch_nav.py 的 detect_org() 只看 inst / name / prodCode / code …
     里的**关键词**，不看产品代码形态。所以用链接建产品时**必须把识别到的
     机构名写进 inst**（如「北银理财」），否则云端会因「机构未识别 + 无名称」
     直接跳过该产品，表现为「加了产品但永远抓不到净值」。
     另外名称**故意留空**：merge_nav 只在字段为空时回填，留空云端才能把
     真实产品名（来自中国理财网 productDetail）写上。
   ============================================================ */
const LINK_REG_KEYS = ["prodregcode", "regcode", "registercode", "zcode", "instcode",
  "financingregistercode", "cpdjbm", "cpdjjbm"];
const LINK_PROD_KEYS = ["prodcode", "productcode", "projectcode", "productid",
  "sharecode", "salescode", "fundcode", "cpbm", "code"];

/* 解析用户粘贴的链接/代码/文本 → { code, prodCode, org, ok, msg } */
function parseProductInput(raw) {
  const text = String(raw == null ? "" : raw).trim();
  const norm = s => String(s).toUpperCase().replace(/[\s"']/g, "");
  if (!text) return { code: "", prodCode: "", org: "", ok: false, msg: "请粘贴产品链接、产品代码或登记编码" };

  /* ① 收集参数：URL query、hash 路由里的 query，以及「名称=值」形式的参数串 */
  const params = {};
  const eatQuery = (s) => {
    const i = s.indexOf("?");
    if (i < 0) return;
    s.slice(i + 1).split("&").forEach(kv => {
      const j = kv.indexOf("=");
      if (j <= 0) return;
      const k = kv.slice(0, j).toLowerCase().trim();
      let v = kv.slice(j + 1).trim();
      try { v = decodeURIComponent(v); } catch (e) { /* 原样保留 */ }
      if (k && v) params[k] = v;
    });
  };
  eatQuery(text);
  const hi = text.indexOf("#");
  if (hi >= 0) eatQuery(text.slice(hi));
  text.replace(/([A-Za-z_]{3,24})\s*=\s*([^&\s]{4,40})/g, (m, k, v) => {
    const kk = k.toLowerCase();
    if (!params[kk]) params[kk] = v;
    return m;
  });
  const pickParam = (keys) => { for (const k of keys) if (params[k]) return norm(params[k]); return ""; };

  let code = pickParam(LINK_REG_KEYS);
  let prodCode = pickParam(LINK_PROD_KEYS);
  /* 参数值形态不对就不认（避免 ?code=weixin 之类被当成产品代码） */
  if (code && !/^[ZC]\d{12,14}$/.test(code)) code = "";
  if (prodCode && !detectOrgByProdCode(prodCode).org
    && !/^[ZC]\d{12,14}$/.test(prodCode) && !/^[A-Z0-9]{6,20}$/.test(prodCode)) prodCode = "";

  /* ② 全文候选兜底：切成「连续字母数字串」逐个用现有形态识别器归类 ——
        不能直接全文正则扫，否则 Z7008926000006 里的 12 位数字会被误当成华夏的 12 位产品代码 */
  const tokens = (text.match(/[A-Za-z0-9]{6,24}/g) || []).map(norm);
  for (const tk of tokens) {
    if (!code && /^[ZC]\d{12,14}$/.test(tk)) { code = tk; continue; }
    if (!prodCode && detectOrgByProdCode(tk).org) prodCode = tk;
  }

  /* ③ 判机构 */
  let org = prodCode ? detectOrgByProdCode(prodCode).org : "";
  if (!org && code) org = "chinawealth";
  const okay = !!(code || prodCode);
  let msg = "";
  if (!okay) {
    msg = "没从这段内容里认出产品代码或登记编码。若是银行代销产品的代码（如中行 EW4455D 这类），"
      + "请连同「登记编码」（Z 开头）一起贴上 —— 云端靠登记编码或产品名称查询，只有产品代码查不到";
  } else if (prodCode && !code && !org) {
    /* 银行代销链接的常见形态：能认出产品代码，但发行人不在已知名单里（2026-09-16 中行 EW4455D 实例）。
       此时云端既无登记编码也无名称 → 会以「无法识别机构」跳过，必须提前提示。 */
    msg = `已识别产品代码 ${prodCode}，但发行机构未识别：请补填「登记编码」（Z 开头，`
      + "产品说明书或中国理财网可查），否则云端抓不到该产品净值";
  }
  return { code, prodCode, org, ok: okay, msg };
}

/* 产品显示名：链接添加的骨架产品名称是空的（留给云端回填），列表要有兜底 */
function prodLabel(p) {
  if (!p) return "未命名产品";
  return p.name || p.code || p.prodCode || "未命名产品";
}
/* 同代码去重 */
function findDupProduct(r) {
  const c = String(r.code || "").toUpperCase(), pc = String(r.prodCode || "").toUpperCase();
  return DATA.products.find(p =>
    (c && String(p.code || "").toUpperCase() === c) ||
    (pc && String(p.prodCode || "").toUpperCase() === pc)) || null;
}

function openLinkAdd() {
  openSheet(`<div class="sheet-t"><h3>粘贴添加产品</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="note b" style="margin-bottom:12px">
      把<b>产品页面链接</b>（银行 App / 微信里复制的那条）粘进来即可。<b>一行一只，可以一次贴很多行。</b><br>
      链接里带产品代码或登记编码时自动识别；若贴的是公众号文章之类的链接，
      请把<b>登记编码</b>或<b>产品代码</b>一并贴上。
    </div>
    <div class="field"><label>粘贴链接 / 代码 / 含代码的文本（可多行）</label>
      <textarea id="lkInput" rows="5" oninput="previewLink()" placeholder="每行一只产品，例如：&#10;https://…?PROD_CODE=YJ01251204A&#10;https://…?prodRegCode=Z7008926000006&#10;ZGN2360006C"
        style="width:100%;padding:11px 12px;border:1.5px solid var(--line);border-radius:11px;font-size:13px;font-family:inherit;color:var(--ink);outline:none;resize:vertical"></textarea>
    </div>
    <div id="lkPreview"></div>
    <div class="field"><label>产品名称 <span class="muted">（可留空，云端抓到后自动补全；多行粘贴时不套用）</span></label>
      <input id="lkName" placeholder="留空即可">
    </div>
    <div class="field"><label>发行机构 <span class="muted">（识别不出机构的行靠它兜底）</span></label>
      <input id="lkInst" placeholder="如 北银理财有限责任公司">
      <div class="tip">云端靠这个字段选数据源：填理财公司全名（含「理财」即可），识别出代码时会自动补上</div>
    </div>
    <div class="row-btn">
      <button class="btn gh" style="flex:1" onclick="closeSheet()">取消</button>
      <button class="btn pri" style="flex:1" id="lkSave" onclick="saveFromLink()">确认添加</button>
    </div>`);
  UI.linkParsed = null; UI.linkRows = null;
  previewLink();
}

/* 多行粘贴：每行当一个产品解析，**每行都有结果**（不认识的不会被静默丢掉）。
   单行仍走原来那套更详细的说明，老用户看到的东西不变。 */
function parseProductLines(text) {
  const rows = [];
  String(text == null ? "" : text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const r = parseProductInput(line);
    if (!r.ok) { rows.push({ ln: i + 1, raw: line, r, status: "bad", key: "", note: r.msg }); return; }
    const dup = findDupProduct(r);
    rows.push({
      ln: i + 1, raw: line, r,
      status: dup ? "dup" : "add",
      key: r.prodCode || r.code,
      inst: ORG_NAME[r.org] || "",
      note: dup ? `已存在「${prodLabel(dup)}」`
        : (ORG_NAME[r.org] || (r.code ? "识别不出机构，需手填机构名"
          : "机构未识别 + 无登记编码：请手填发行机构，并补登记编码（Z 开头），否则云端抓不到")),
    });
  });
  return rows;
}

/* 按钮文案跟着预览走：写「确认添加 N 只」就只会加这 N 只 */
function setLinkSave(n) {
  const b = $("lkSave"); if (!b) return;
  b.textContent = n ? `确认添加 ${n} 只` : "没有可添加的产品";
  b.disabled = !n;
}

function previewLink() {
  const box = $("lkPreview"); if (!box) return;
  const text = $("lkInput") ? $("lkInput").value : "";
  const rows = parseProductLines(text);
  UI.linkRows = rows;
  const single = rows.length === 1 ? rows[0] : null;
  UI.linkParsed = single ? single.r : parseProductInput(text);
  const instEl = $("lkInst");
  /* 单行时把识别出的机构自动补上；多行不自动填 —— 各家机构不同，填一个是误导。
     ★ 机构必须落进 inst：云端 detect_org 靠它判机构（见本段顶部契约说明） */
  if (single && single.inst && instEl && !instEl.value.trim()) instEl.value = single.inst;

  if (!rows.length) {
    setLinkSave(0);
    box.innerHTML = `<div class="note" style="margin-bottom:12px">${esc(UI.linkParsed.msg || "请粘贴产品链接、产品代码或登记编码")}</div>`;
    return;
  }
  if (single) {
    const r = single.r;
    const dup = single.status === "dup" ? findDupProduct(r) : null;
    const parts = [];
    if (r.code) parts.push(`登记编码 <b>${esc(r.code)}</b>`);
    if (r.prodCode) parts.push(`产品代码 <b>${esc(r.prodCode)}</b>`);
    if (r.org) parts.push(`识别机构 <b>${esc(ORG_NAME[r.org] || r.org)}</b>`);
    box.innerHTML = `<div class="note${dup ? "" : " g"}" style="margin-bottom:12px">
      ${parts.join(" · ")}<br>
      ${dup ? `⚠️ 已存在同代码产品「${esc(prodLabel(dup))}」，无需重复添加`
        : (r.code ? "保存后同步到云端，下一次抓取自动补全产品名称与历史净值。"
          : "⚠️ 还缺<b>登记编码</b>（Z 开头）：云端要靠它或产品名称去查询，"
            + "请从产品说明书 / 中国理财网查到后填进「登记编码」栏（名称可留空，抓取后自动回填）。")}
    </div>`;
    setLinkSave(dup ? 0 : 1);
    return;
  }
  const c = { add: 0, dup: 0, bad: 0 };
  rows.forEach(x => { c[x.status] = (c[x.status] || 0) + 1; });
  box.innerHTML = `<div class="note${c.add ? " g" : ""}" style="margin-bottom:12px">
      <b style="color:var(--brand)">${c.add}</b> 只可添加&nbsp;&nbsp;
      <b style="color:var(--ink3)">${c.dup}</b> 只已存在&nbsp;&nbsp;
      <b style="color:var(--gold)">${c.bad}</b> 行无法识别
    </div>
    <div style="max-height:200px;overflow:auto"><table class="navtbl">
      <thead><tr><th>产品键</th><th style="text-align:left">机构 / 说明</th></tr></thead>
      <tbody>${rows.slice(0, 40).map(x => `<tr>
        <td>${esc(x.key || "—")}</td>
        <td style="text-align:left;font-size:11px;color:var(${x.status === "bad" ? "--gold" : "--ink3"})">${esc(x.note)}</td>
      </tr>`).join("")}</tbody></table></div>
    ${rows.length > 40 ? `<div class="muted" style="font-size:11px;padding:6px 0">只显示前 40 行（共 ${rows.length} 行）</div>` : ""}`;
  setLinkSave(c.add);
}

function saveFromLink() {
  if (!$("mask").classList.contains("show")) return;   /* 防快速双击重复添加 */
  /* 用预览时那份解析结果 —— 按钮上写多少只，就只加多少只 */
  const rows = UI.linkRows || parseProductLines($("lkInput") ? $("lkInput").value : "");
  const adds = rows.filter(x => x.status === "add");
  if (!adds.length) {
    const dupN = rows.filter(x => x.status === "dup").length;
    return toast(dupN ? `已存在的 ${dupN} 只无需重复添加` : "没有可添加的产品");
  }
  const manualInst = ($("lkInst").value || "").trim();
  const name = ($("lkName").value || "").trim();     /* 允许留空：留给云端 merge_nav 回填 */
  let ok = 0, noInst = 0;
  for (const x of adds) {
    const inst = x.inst || manualInst;
    if (!inst) { noInst++; continue; }               /* 没机构云端选不了数据源，加了也是废条 */
    if (findDupProduct(x.r)) continue;               /* 同一批里重复的代码，第二条在这里被挡下 */
    DATA.products.push({
      id: uid(), navHistory: {}, createdAt: Date.now(),
      code: x.r.code || "", prodCode: x.r.prodCode || "",
      name: rows.length === 1 ? name : "",           /* 多行粘贴不套用同一个名称 */
      inst, fromLink: true,
    });
    ok++;
  }
  if (!ok) {
    return toast(noInst
      ? `请填写发行机构（如 招银理财）—— 云端据此选择数据源（${noInst} 只缺机构）`
      : "没有可添加的产品", 4200);
  }
  saveLocal(); closeSheet();
  if (rows.length === 1 && ok === 1) {
    const st = fetchStatus(DATA.products[DATA.products.length - 1]);
    toast(`已添加${st.ok ? "，" + st.txt : "。" + st.txt}。云端抓取后会自动补全名称与净值`, st.ok ? 3200 : 4400);
  } else {
    const skipped = adds.length - ok;
    toast(`已添加 ${ok} 只` + (skipped ? `，跳过 ${skipped} 只（缺机构或已存在）` : "")
      + "。云端抓取后会自动补全名称与净值", 4400);
  }
  renderProd(); renderHome();
  autoPush();
}

/* ============================================================
   产品详情：单位净值曲线 + 叠加指标（7日年化 / 万份收益）
   ------------------------------------------------------------
   口径（与设置页「口径说明」一致，勿私下改）：
     · 万份收益(元) = (今日净值 − 昨日披露净值) × 10000 ÷ 相隔自然日数
       （周末/节假日净值为「几天累计」，按自然日均摊回每日）
     · N 日年化     = (nav[t] ÷ N 个自然日前最近净值 − 1) ÷ N × 365
     · 成立以来年化 = (末值 / 首值 − 1) / 持有天数 × 365
   全部即时计算、不落盘。图表为内联 SVG 自绘，不引任何库/CDN。
   ============================================================ */
const PROD_RANGES = [["1m", "近1月", 30], ["3m", "近3月", 90], ["6m", "近6月", 180], ["1y", "近1年", 365], ["all", "成立来", 0]];

/* YYYY-MM-DD ± days（自然日），返回同格式 */
function dateShift(ymd, days) {
  const d = parseDate(ymd);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/* N 日年化序列（与净值序列等长对齐；基准 = N 个自然日前最近的一条披露净值。
   旧实现按「前 N 条披露」回退，工作日披露下 7 条 ≈ 9-10 天再 ÷7，年化系统性高估
   约 30% —— 2026-09-15 审查修正为自然日锚定。样本不足处 null，绝不伪造。） */
function annualNArr(dates, vals, n) {
  return vals.map((v, i) => {
    if (i < n) return null;
    const bd = dateShift(dates[i], -n);
    let base = null;
    for (let j = i; j >= 0; j--) {
      if (dates[j] <= bd) { base = Number(vals[j]); break; }
    }
    return base > 0 ? (v / base - 1) / n * 365 : null;
  });
}
/* 一组净值指标（全部与 vals 等长对齐） */
function navStats(p) {
  const s = navSeries(p);
  const dates = s.map(x => x[0]);
  const vals = s.map(x => Number(x[1]));
  /* 万份收益：首日无前值；跨周末按自然日均摊（周一不再显示 3 天累计派息） */
  const wan = vals.map((v, i) => {
    if (i === 0) return null;
    const days = Math.max(dayDiff(dates[i - 1], dates[i]), 1);
    return (v - Number(vals[i - 1])) * 10000 / days;
  });
  return { dates, vals, wan, a7: annualNArr(dates, vals, 7), a14: annualNArr(dates, vals, 14), a30: annualNArr(dates, vals, 30) };
}
/* 成立以来年化（单一数值） */
function sinceAnnual(stats) {
  const { dates, vals } = stats;
  if (vals.length < 2) return null;
  const a = Number(vals[0]), b = Number(vals[vals.length - 1]);
  const days = dayDiff(dates[0], dates[dates.length - 1]);
  if (!(a > 0) || days <= 0) return null;
  return (b / a - 1) / days * 365;
}
/* 末位有效值（叠加指标可能末端为 null） */
function lastNum(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null && isFinite(arr[i])) return arr[i];
  return null;
}

/* 内联 SVG 双轴折线图：vals 走左轴（净值），ov 走右轴（叠加指标） */
function svgChart(dates, vals, ov) {
  const W = 640, H = 230, L = 50, R = 58, T = 16, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const n = vals.length;
  if (!n) return `<div class="empty">该区间内没有净值数据</div>`;
  let nMin = vals[0], nMax = vals[0];
  for (const v of vals) { if (v < nMin) nMin = v; if (v > nMax) nMax = v; }
  const span = (nMax - nMin) || Math.max(nMax * 0.004, 0.0008);
  const lo = nMin - span * 0.18, hi = nMax + span * 0.18;
  const Yn = v => T + (1 - (v - lo) / (hi - lo)) * ih;
  const X = i => (n === 1 ? L + iw / 2 : L + i / (n - 1) * iw);

  /* 叠加序列的右轴域（必须含 0，否则看不出正负） */
  let oLo = 0, oHi = 0, hasOv = false, Yo = () => T;
  if (ov) {
    let mn = Infinity, mx = -Infinity, cnt = 0;
    for (const v of ov) if (v !== null && isFinite(v)) { cnt++; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (cnt >= 2) {
      hasOv = true;
      oLo = Math.min(0, mn); oHi = Math.max(0, mx);
      if (oHi - oLo < 1e-9) oHi = oLo + 1;
      Yo = v => T + (1 - (v - oLo) / (oHi - oLo)) * ih;
    }
  }
  const navPts = [];
  for (let i = 0; i < n; i++) navPts.push(X(i).toFixed(1) + "," + Yn(vals[i]).toFixed(1));
  const area = `${L},${(T + ih).toFixed(1)} ` + navPts.join(" ") + ` ${(L + iw).toFixed(1)},${(T + ih).toFixed(1)}`;

  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block">`;
  g += `<polygon points="${area}" fill="rgba(91,91,214,.10)" stroke="none"/>`;
  if (hasOv) {
    const op = [];
    for (let i = 0; i < n; i++) {
      const v = ov[i];
      if (v === null || !isFinite(v)) continue;
      op.push(X(i).toFixed(1) + "," + Yo(v).toFixed(1));
    }
    if (oLo < 0 && oHi > 0) {
      const y0 = Yo(0).toFixed(1);
      g += `<line x1="${L}" y1="${y0}" x2="${L + iw}" y2="${y0}" stroke="#d9dbe6" stroke-width="0.8" stroke-dasharray="3 3"/>`;
    }
    g += `<polyline points="${op.join(" ")}" fill="none" stroke="#f0a020" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  g += `<polyline points="${navPts.join(" ")}" fill="none" stroke="#5b5bd6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  g += `<circle cx="${X(n - 1).toFixed(1)}" cy="${Yn(vals[n - 1]).toFixed(1)}" r="3" fill="#5b5bd6"/>`;
  /* 左轴：净值 */
  g += `<text x="${L - 8}" y="${T + 4}" text-anchor="end" font-size="10" fill="#9aa0bb">${nMax.toFixed(4)}</text>`;
  g += `<text x="${L - 8}" y="${T + ih}" text-anchor="end" font-size="10" fill="#9aa0bb">${nMin.toFixed(4)}</text>`;
  /* 右轴：叠加指标 */
  if (hasOv) {
    g += `<text x="${L + iw + 8}" y="${T + 4}" font-size="10" fill="#e08b00">${oHi.toFixed(2)}</text>`;
    g += `<text x="${L + iw + 8}" y="${T + ih}" font-size="10" fill="#e08b00">${oLo.toFixed(2)}</text>`;
  }
  /* 横轴日期 */
  g += `<text x="${L}" y="${H - 8}" font-size="10" fill="#9aa0bb">${esc(dates[0].slice(5))}</text>`;
  g += `<text x="${L + iw}" y="${H - 8}" text-anchor="end" font-size="10" fill="#9aa0bb">${esc(dates[n - 1].slice(5))}</text>`;
  g += `</svg>`;
  return g;
}

/* ---------- 详情页 ---------- */
const PROD_OVS = [["a7", "7日年化"], ["a14", "14日年化"], ["wan", "万份收益"], ["none", "不叠加"]];

function openProdDetail(pid) {
  const p = DATA.products.find(x => x.id === pid);
  if (!p) return toast("产品不存在");
  UI.viewProd = pid;
  if (!UI.prodRange) UI.prodRange = "3m";
  if (!UI.prodOv) UI.prodOv = "a7";
  renderProdDetail();
}
function setProdRange(btn, r) {
  if (btn) { btn.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("on")); btn.classList.add("on"); }
  UI.prodRange = r; renderProdDetail();
}
function setProdOv(btn, o) {
  if (btn) { btn.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("on")); btn.classList.add("on"); }
  UI.prodOv = o; renderProdDetail();
}
function renderProdDetail() {
  const p = DATA.products.find(x => x.id === UI.viewProd);
  if (!p) return;
  const st = navStats(p);
  const pos = position(p);
  const n = st.dates.length;

  /* 区间裁剪：先算完整序列（7日年化需要前 7 个点），再切区间 */
  const rng = PROD_RANGES.find(x => x[0] === UI.prodRange) || PROD_RANGES[1];
  const cut = rng[2] ? rangeStartDate(rng[2]) : "";
  let i0 = 0, inRange = true;
  if (cut) {
    const k = st.dates.findIndex(d => d >= cut);
    if (k < 0) { inRange = false; i0 = n - 1; } else i0 = k;
  }
  const ovKey = UI.prodOv;
  const ovArr = ovKey === "a7" ? st.a7 : ovKey === "a14" ? st.a14 : ovKey === "wan" ? st.wan : null;
  const ovName = (PROD_OVS.find(x => x[0] === ovKey) || [])[1] || "";
  const ovUnit = ovKey === "wan" ? "元/万份" : "%";

  const latest = n ? st.vals[n - 1] : null;
  const latestDate = n ? st.dates[n - 1] : "";
  const wan = lastNum(st.wan), a7 = lastNum(st.a7), a14 = lastNum(st.a14), a30 = lastNum(st.a30);
  const since = sinceAnnual(st);
  const src = navSrcInfo(p);                 /* 上次抓取的双源比对结果（官网 vs 中国理财网） */
  const navFmt = v => (v === null ? "—" : Number(v).toFixed(4));
  const pctFmt = v => (v === null ? "—" : `${v >= 0 ? "+" : ""}${pct(v)}`);

  /* 历史净值表：末 20 行 */
  const rows = [];
  for (let i = n - 1; i >= 0 && rows.length < 20; i--) {
    const chg = i > 0 ? (st.vals[i] - st.vals[i - 1]) / st.vals[i - 1] : null;
    rows.push(`<tr>
      <td>${esc(st.dates[i].slice(5))}</td>
      <td><b>${navFmt(st.vals[i])}</b></td>
      <td class="${cls(chg === null ? 0 : chg)}">${chg === null ? "—" : pct(chg)}</td>
      <td class="${cls(st.a7[i] === null ? 0 : st.a7[i])}">${st.a7[i] === null ? "—" : pct(st.a7[i])}</td>
    </tr>`);
  }

  const chartHtml = !n
    ? `<div class="empty">还没有净值数据。云端抓取后会自动补全，也可在「录入/查看净值」手工补录。</div>`
    : (!inRange
      ? `<div class="empty">所选的「${esc(rng[1])}」区间内没有净值</div>`
      : chartBlock(st, i0, ovArr, i0));

  openSheet(`<div class="sheet-t"><h3 style="font-size:15px">${esc(prodLabel(p))}</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="prow" style="border-top:0;padding-top:0">
      <div class="pn" style="font-size:12.5px">${esc(p.inst || "未填发行机构")}</div>
      <div class="pv"></div>
      <div class="pk">
        ${p.code ? `<i>登记编码 <b>${esc(p.code)}</b></i>` : ""}
        ${p.prodCode ? `<i>产品代码 <b>${esc(p.prodCode)}</b></i>` : ""}
        ${p.riskLevel ? `<i>风险等级 <b>${esc(p.riskLevel)}</b></i>` : ""}
        ${p.estDate ? `<i>成立日 <b>${esc(p.estDate)}</b></i>` : ""}
      </div>
    </div>
    ${src ? `<div class="tip" style="margin-top:8px">
      🔀 最新净值取自 <b>${esc(src.via)}·${esc(src.label)}</b>（${esc(src.latest)}）${esc(src.why ? "—— " + src.why : "")}
      ${(src.sources || []).length > 1
        ? `｜两条线已比对：${(src.sources || []).map(s => esc(`${s.label} ${s.latest || "—"}`)).join(" vs ")}`
        : "｜另一条线本次未取到，已用单源"}
      ${src.conflicts && src.conflicts.length
        ? `<br>⚠️ 与另一条线有 <b>${src.conflicts.length}</b> 处同日数值差异（已按上述来源取值），`
          + `如 ${esc(src.conflicts[0].d)}：采用 ${esc(String(src.conflicts[0].used))}`
        : ""}
    </div>` : ""}

    <div class="grid2" style="margin-top:12px">
      <div class="stat"><div class="l">最新净值${latestDate ? "（" + esc(latestDate.slice(5)) + "）" : ""}</div><div class="v" style="color:var(--brand)">${navFmt(latest)}</div><div class="cap">官方披露的份额净值</div></div>
      <div class="stat"><div class="l">万份收益（最新）</div><div class="v ${cls(wan === null ? 0 : wan)}">${wan === null ? "—" : signMoney(wan)}</div><div class="cap">(今 − 昨) × 10000</div></div>
      <div class="stat"><div class="l">近7日年化</div><div class="v ${cls(a7 === null ? 0 : a7)}">${pctFmt(a7)}</div><div class="cap">7 日净值变动折算年化</div></div>
      <div class="stat"><div class="l">近14日年化</div><div class="v ${cls(a14 === null ? 0 : a14)}">${pctFmt(a14)}</div><div class="cap">14 日折算</div></div>
      <div class="stat"><div class="l">近1月年化</div><div class="v ${cls(a30 === null ? 0 : a30)}">${pctFmt(a30)}</div><div class="cap">30 日折算</div></div>
      <div class="stat"><div class="l">成立以来年化</div><div class="v ${cls(since === null ? 0 : since)}">${pctFmt(since)}</div><div class="cap">首末净值折算 · 全周期</div></div>
    </div>
    <div class="cap" style="padding:6px 0 0">样本不足时显示「—」，不估算、不补齐；净值型产品官方不披露万份收益与年化，以上均为本工具折算口径。</div>

    ${pos.shares > 0 ? `<div class="card-t" style="margin:14px 0 8px"><h2 style="font-size:14px">我的持仓</h2></div>
    <div class="grid2">
      <div class="stat"><div class="l">持有金额</div><div class="v">${DATA.settings.hideAmount ? "****" : money(pos.market)}</div><div class="cap">已确认份额 × 最新净值</div></div>
      <div class="stat"><div class="l">持仓收益</div><div class="v ${cls(pos.profit)}">${signMoney(pos.profit)}</div><div class="cap">市值 − 持仓成本</div></div>
      <div class="stat"><div class="l">持仓份额</div><div class="v" style="font-size:15px">${pos.shares.toFixed(2)}</div><div class="cap">已确认份额，不含在途</div></div>
      <div class="stat"><div class="l">成本净值</div><div class="v" style="font-size:15px">${pos.shares > 0 ? (pos.cost / pos.shares).toFixed(4) : "—"}</div><div class="cap">买入金额合计 ÷ 份额</div></div>
    </div>` : ""}

    <div class="card-t" style="margin:16px 0 8px"><h2 style="font-size:14px">净值走势</h2></div>
    <div class="chips">
      ${PROD_RANGES.map(([k, lab]) => `<button class="chip${UI.prodRange === k ? " on" : ""}" onclick="setProdRange(this,'${k}')">${lab}</button>`).join("")}
    </div>
    <div class="chips">
      <span class="muted" style="font-size:11px;align-self:center;margin-right:2px">叠加</span>
      ${PROD_OVS.map(([k, lab]) => `<button class="chip${UI.prodOv === k ? " on" : ""}" onclick="setProdOv(this,'${k}')">${lab}</button>`).join("")}
    </div>
    <div class="chart-wrap">
      <div class="chart-legend">
        <span><i style="background:#5b5bd6"></i>单位净值（左轴）</span>
        ${ovArr && ovKey !== "none" ? `<span><i style="background:#f0a020"></i>${esc(ovName)}（右轴·${esc(ovUnit)}）</span>` : ""}
      </div>
      ${chartHtml}
    </div>

    <div class="card-t" style="margin:14px 0 8px"><h2 style="font-size:14px">历史净值</h2><span class="hint">最近 ${Math.min(20, n)} 条 / 共 ${n} 条</span></div>
    ${rows.length ? `<table class="navtbl">
      <thead><tr><th>日期</th><th>单位净值</th><th>日涨跌</th><th>7日年化</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>` : `<div class="empty">暂无净值</div>`}

    <div class="row-btn" style="margin-top:14px">
      <button class="btn gh" style="flex:1" onclick="closeSheet();editProd('${p.id}')">编辑产品</button>
      <button class="btn pri" style="flex:1" onclick="closeSheet();openNav('${p.id}')">录入净值</button>
    </div>`);
}
/* 区间起点日期 */
function rangeStartDate(days) {
  const t = new Date();
  t.setDate(t.getDate() - days);
  return fmtDate(t);
}
/* 图表块（含区间标题） */
function chartBlock(st, i0, ovArr, _i) {
  const dates = st.dates.slice(i0), vals = st.vals.slice(i0);
  const ov = ovArr ? ovArr.slice(i0) : null;
  return svgChart(dates, vals, ov);
}
/* ============================================================
   批量粘贴文本解析（净值 / 产品）
   ------------------------------------------------------------
   为什么要有这套：参考项目用「截图 OCR 记账」，但那需要服务端、且要把
   截图交给第三方，与本项目「数据不出设备 + 零后端」的前提冲突。
   替代方案：让用户把官网 / 银行 App / 表格里的**文字**复制进来，本地解析。

   四条铁律（都是被旧 bulkNav 的毛病逼出来的，改的时候别退回去）：
     1. **不静默丢行**。旧实现只报「已导入 N 条」，用户根本不知道还有
        M 行没进去。现在无法识别的行必须逐条列出原因。
     2. **不猜**。缺年份、含千分位逗号、百分数一律拒绝并说明 —— 净值写错
        比少写严重得多（错值会一直参与收益计算，且很难被发现）。
     3. **与云端「已有净值不覆盖」同口径**。旧实现直接覆盖同日已有值，
        与云端 merge_nav 的策略是矛盾的。现在默认跳过，覆盖需显式勾选。
     4. **预览里的数字就是将要写入的数字**，核对之后才落库。
   ============================================================ */

/* 一行里的日期：支持 2026-09-14 / 2026/9/14 / 2026.09.14 / 2026年9月14日 / 20260914 */
const NAV_DATE_RES = [
  /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/,
  /(?:^|\D)(\d{4})(\d{2})(\d{2})(?!\d)/,
];
function navDateAt(line) {
  for (const re of NAV_DATE_RES) {
    const m = String(line).match(re);
    if (!m) continue;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    /* 反向校验：挡掉「格式对但日期不存在」的假日期（如 2026-02-30） */
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) continue;
    return { end: m.index + m[0].length, date: `${y}-${pad(mo)}-${pad(d)}` };
  }
  return null;
}

/* 日期之后的第一个「干净数字」= 单位净值。
   含逗号 / 百分号 / 多个小数点的一律报错而不是凑一个数出来（旧实现的
   `[\d.]+` 会把 "1,0234" 吃成 1、把 "1.0.2" 变成 NaN 写进库）。 */
function navValueAfter(line, endIdx) {
  const toks = String(line).slice(endIdx).split(/[\s|│]+/).filter(Boolean);
  if (!toks.length) return { err: "只有日期，没找到净值" };
  for (const tk of toks) {
    if (/[，,]/.test(tk) && /^[\d,，.]+$/.test(tk))
      return { err: `「${tk}」含千分位逗号，无法确定真实数值（只贴「日期 + 单位净值」两列最稳）` };
    if (/%$/.test(tk)) return { err: `「${tk}」是百分数（年化或涨跌幅），不是单位净值` };
    const m = tk.match(/^[¥￥]?(\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const v = Number(m[1]);
    if (!Number.isFinite(v) || v <= 0) return { err: `净值「${tk}」不是正数` };
    if (v >= 1000) return { err: `净值「${tk}」明显不合理（≥1000）` };
    return { nav: v, tok: tk };
  }
  return { err: "日期后面没找到可当作单位净值的数字" };
}

/* 解析整段文本。返回 { rows, counts }：**每一行都在 rows 里**，一行都不会消失。 */
function parseNavText(text, existing) {
  const exist = existing || {};
  const rows = [], seenAt = {};
  String(text == null ? "" : text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;                                  /* 空行不占报告 */
    const ln = i + 1;
    /* 表头行（「净值日期 单位净值 日涨跌」之类）：没有日期也不是数据 */
    if (!navDateAt(line) && /(日期|净值|年化|涨跌)/.test(line) && !/\d{4}/.test(line)) return;
    const d = navDateAt(line);
    if (!d) { rows.push({ ln, raw: line, status: "bad", note: "没识别出日期（支持 2026-09-14 / 2026/9/14 / 2026年9月14日 / 20260914）" }); return; }
    const v = navValueAfter(line, d.end);
    if (v.err) { rows.push({ ln, raw: line, date: d.date, status: "bad", note: v.err }); return; }
    if (seenAt[d.date]) { rows.push({ ln, raw: line, date: d.date, nav: v.nav, status: "bad", note: `与第 ${seenAt[d.date]} 行日期重复` }); return; }
    seenAt[d.date] = ln;
    const old = exist[d.date];
    if (old !== undefined && old !== null && old !== "") {
      rows.push({
        ln, raw: line, date: d.date, nav: v.nav, old: Number(old), status: "exist",
        note: Number(old) === v.nav ? "该日期已有相同值" : `该日期已有 ${Number(old)}`,
      });
      return;
    }
    rows.push({ ln, raw: line, date: d.date, nav: v.nav, status: "new", note: "" });
  });

  /* 可疑值：与该产品最近一条已有净值、或同批的相邻条目相差 > 10%。
     理财产品单日净值波动几乎不可能到这个量级，出现基本就是**粘错了产品**。 */
  const keys = Object.keys(exist).sort();
  const ref = keys.length ? Number(exist[keys[keys.length - 1]]) : null;
  const ordered = rows.filter(r => r.date && (r.status === "new" || r.status === "exist"))
    .sort((a, b) => a.date.localeCompare(b.date));
  ordered.forEach((r, i) => {
    const prev = i > 0 ? ordered[i - 1].nav : ref;
    if (!prev) return;
    const diff = Math.abs(r.nav / prev - 1);
    if (diff > 0.10) {
      const txt = `与相邻净值 ${prev} 相差 ${(diff * 100).toFixed(1)}%`;
      if (r.status === "new") { r.status = "warn"; r.note = txt; }
      else r.note += `；${txt}`;
    }
  });

  const counts = { new: 0, exist: 0, warn: 0, bad: 0 };
  rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  return { rows, counts };
}

function openNav(pid) {
  const p = DATA.products.find(x => x.id === pid); if (!p) return;
  const s = navSeries(p).slice().reverse();
  /* 草稿留在一个模块级变量里：写入/删除一条净值会重画整个弹层，
     若每次都清空粘贴框，用户得把上百行重新贴一遍。 */
  const draft = UI.navDraft || "";
  openSheet(`<div class="sheet-t"><h3>${esc(prodLabel(p))} · 净值</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="field"><label>新增/修改净值</label>
      <div class="two">
        <input type="date" id="nDate" value="${today()}">
        <input type="number" step="0.0001" id="nVal" placeholder="份额净值">
      </div>
      <button class="btn pri full" style="margin-top:9px" onclick="addNav('${pid}')">保存净值</button>
    </div>
    <div class="field"><label>批量粘贴净值 <span class="muted">（每行：日期 + 单位净值）</span></label>
      <textarea id="nBulk" rows="5" oninput="bulkNav('${pid}')" placeholder="2026-09-10 1.0313&#10;2026-09-09 1.0312&#10;也支持 2026/9/9、2026年9月9日、20260909&#10;可直接整段复制官网的净值表">${esc(draft)}</textarea>
      <div class="chk-row">
        <label><input type="checkbox" id="nBulkOver" onchange="bulkNav('${pid}')"> 覆盖同日已有净值</label>
        <label><input type="checkbox" id="nBulkWarn" onchange="bulkNav('${pid}')"> 写入可疑行</label>
      </div>
      <div id="nBulkPrev"></div>
    </div>
    <div class="field"><label>已有净值（${s.length} 条）</label>
      <div style="max-height:200px;overflow:auto">${s.map(([d, v]) => `<div class="sumline"><span class="k">${d}</span><span style="display:flex;gap:10px;align-items:center"><b>${Number(v).toFixed(4)}</b><button class="mini" style="padding:2px 7px;font-size:10.5px" onclick="delNav('${pid}','${d}')">删</button></span></div>`).join("") || `<span class="muted" style="font-size:12px">暂无</span>`}</div>
    </div>`);
  /* 草稿非空时立刻把预览画出来：写入/删除后弹层会重画，预览不能跟着丢 */
  bulkNav(pid);
}
function addNav(pid) {
  const p = DATA.products.find(x => x.id === pid);
  const d = $("nDate").value, v = Number($("nVal").value);
  if (!d || !(v > 0)) return toast("请填写日期与净值");
  p.navHistory = p.navHistory || {}; p.navHistory[d] = v;
  saveLocal(); toast("净值已保存"); openNav(pid); renderHome(); renderProd(); autoPush();
}
/* 粘贴 → 解析 → 画预览。**不写库**；文本框 oninput 与两个开关都走这里。 */
function bulkNav(pid) {
  const p = DATA.products.find(x => x.id === pid); if (!p) return;
  if ($("nBulk")) UI.navDraft = $("nBulk").value;
  const st = parseNavText(UI.navDraft || "", p.navHistory || {});
  UI.navParsed = st;
  const over = !!($("nBulkOver") && $("nBulkOver").checked);
  const inclWarn = !!($("nBulkWarn") && $("nBulkWarn").checked);
  const box = $("nBulkPrev"); if (!box) return;
  const writable = st.rows.filter(r =>
    r.status === "new" || (r.status === "warn" && inclWarn) || (r.status === "exist" && over));
  if (!st.rows.length) { box.innerHTML = ""; return; }
  const c = st.counts;
  /* 颜色直接引用 CSS 变量，避免依赖可能不存在的类名 */
  const chip = (n, col, lab) => n ? `<b style="color:var(${col})">${n}</b> ${lab}&nbsp;&nbsp;` : "";
  box.innerHTML = `<div class="note${writable.length ? " g" : ""}" style="margin:9px 0 8px">
      ${chip(c["new"], "--brand", "条新增")}${chip(c.warn, "--gold", "条可疑")}
      ${chip(c.exist, "--ink3", "条已存在")}${chip(c.bad, "--gold", "行无法识别")}
      <div style="margin-top:4px">${writable.length
      ? `将写入 <b>${writable.length}</b> 条`
      : "没有可写入的内容"}</div>
      ${(c.exist && !over) ? "<div>· 已存在的日期默认跳过（勾上面的开关可覆盖）</div>" : ""}
      ${(c.warn && !inclWarn) ? "<div>· 可疑行默认不写入 —— 请先核对是不是粘错了产品</div>" : ""}
      ${c.bad ? "<div>· 无法识别的行会保留在输入框里，改完再点一次</div>" : ""}
    </div>
    <div style="max-height:230px;overflow:auto"><table class="navtbl">
      <thead><tr><th>日期</th><th>净值</th><th style="text-align:left">说明</th></tr></thead>
      <tbody>${st.rows.slice(0, 60).map(r => `<tr>
        <td>${esc(r.date || "—")}</td>
        <td>${r.nav === undefined ? "—" : Number(r.nav).toFixed(4)}</td>
        <td style="text-align:left;font-size:11px;color:var(${r.status === "bad" ? "--gold" : "--ink3"})">${esc(r.note || "")}</td>
      </tr>`).join("")}</tbody></table>
      ${st.rows.length > 60 ? `<div class="muted" style="font-size:11px;padding:6px 0">只显示前 60 行（共 ${st.rows.length} 行，写入时会全部处理）</div>` : ""}
    </div>
    <button id="nCommit" class="btn pri full" style="margin-top:9px" onclick="commitNav('${pid}')"${writable.length ? "" : " disabled"}>确认写入 ${writable.length} 条</button>`;
}

/* 预览确认后真正落库。写入条数必须等于按钮上写的那个数字。 */
function commitNav(pid) {
  /* 防快速双击：点下即禁用按钮；openNav() 重渲染会重建按钮自然恢复。
     （不要用时间窗守卫 —— 直接调用本函数连续写入多批净值是合法场景） */
  const btn = $("nCommit");
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  const p = DATA.products.find(x => x.id === pid); if (!p) return;
  const st = UI.navParsed || parseNavText(UI.navDraft || "", p.navHistory || {});
  const over = !!($("nBulkOver") && $("nBulkOver").checked);
  const inclWarn = !!($("nBulkWarn") && $("nBulkWarn").checked);
  const doRows = st.rows.filter(r =>
    r.status === "new" || (r.status === "warn" && inclWarn) || (r.status === "exist" && over));
  if (!doRows.length) return toast("没有可写入的净值");
  p.navHistory = p.navHistory || {};
  let add = 0, cov = 0;
  for (const r of doRows) {
    if (r.status === "exist") cov++; else add++;
    p.navHistory[r.date] = r.nav;          /* r.nav 已在解析阶段校验为「正的有限数」 */
  }
  /* 未识别的行留在草稿里 —— 别让用户回原文里再挑一遍 */
  const left = st.rows.filter(r => r.status === "bad").map(r => r.raw).join("\n");
  UI.navDraft = left;
  saveLocal(); autoPush();
  openNav(pid);                            /* 重画：净值列表已更新，框里只剩未识别的行 */
  renderHome(); renderProd();
  toast(`已写入 ${add + cov} 条` + (cov ? `（覆盖 ${cov}）` : "")
    + (left ? `，${st.counts.bad} 行未识别已留在框里` : ""), 3400);
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
  const hf = lastFetchInfo(), hfN = fetchFailCount(hf);
  const rows = DATA.products.map(p => {
    const st = fetchStatus(p);
    const srcTxt = navSrcText(navSrcInfo(p));
    return `<div class="sumline" style="align-items:flex-start">
      <span class="k" style="flex:1">${esc(prodLabel(p))}${srcTxt
        ? `<div class="tip" style="margin-top:2px">上次抓取来源：${esc(srcTxt)}</div>` : ""}</span>
      <b class="${st.ok ? "down" : "muted"}" style="font-size:10.5px;text-align:right;margin-left:8px">${esc(st.txt)}</b>
    </div>`;
  }).join("") || `<div class="empty">暂无产品</div>`;
  const ready = DATA.products.filter(p => fetchStatus(p).ok).length;
  openSheet(`<div class="sheet-t"><h3>净值更新说明</h3><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="note b" style="margin-bottom:12px">
      净值<b>不再由浏览器抓取</b>。北银 / 华夏 / 浦银 / 信银 / 南银 / 民生 官网均设置了跨域限制（CORS）或加密/风控，
      页面直连会被浏览器拦截 —— 这正是原「每日更新」按钮点了没反应的原因。<br><br>
      现在由云端 <b>GitHub Actions</b> 每天 <b>00:00 / 06:00 / 08:00</b> 自动抓取官方公开披露的净值，
      提交到你的私有仓库。<br><br>
      <b>每条净值都会同时查两条线</b>：<b>① 发行方官网</b>（历史全、多为原始披露）与
      <b>② 中国理财网信披平台</b>（覆盖任意发行方，部分产品反而更新更快）。云端自动比对后
      <b>采用更新的那条</b>；同一天两条线都有时用<b>官网</b>（原始披露方，避免转抄差），
      另一条线独有的历史日期会一并保留。<br><br>
      ⚠️ GitHub 的免费定时任务是「尽力而为」，实测常延迟数小时甚至跳过 ——
      <b>嫌慢就点下面的「⚡ 立即抓取」</b>，手动触发不受排队影响，1-2 分钟出结果。
    </div>
    <div class="field"><label>云端最近一次抓取</label>
      <div id="navSyncTime" class="note ${last ? "g" : ""}">${last ? esc(last) : "暂无记录（云端抓取任务尚未写入）"}</div>
    </div>
    <div class="field"><label>手动抓取（⚡ 立即抓取）结果</label>
      <div id="manFetchBox">${manStatusHtml()}</div>
    </div>
    <div class="field"><label>各产品抓取就绪状态（${ready} / ${DATA.products.length} 可自动抓取）</label>
      <div>${rows}<div class="tip" style="margin-top:6px">判定口径与云端抓取脚本一致：<b>机构可识别</b> + <b>已填产品代码</b>。标 ⚠️ 的产品请到「产品」页点「编辑」补填。</div></div>
    </div>
    <div class="row-btn" style="margin-top:14px">
      <button class="btn gh" style="flex:1" onclick="closeSheet();go('pg-prod')">去产品页</button>
      <button id="btnFetchNow" class="btn pri" style="flex:1" onclick="triggerFetch()">⚡ 立即抓取</button>
    </div>
    <div class="row-btn" style="margin-top:8px">
      <button class="btn" style="flex:1" onclick="closeSheet();syncPull(true)">↓ 从云端拉取</button>
    </div>`);
  ensureManualPolling();   /* 上次手动抓取还在跑就接着追踪 */
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
    <div class="note">Token 只保存在本机浏览器，不会上传到任何第三方。若泄露可随时在 GitHub 吊销。<br>
      需要两项仓库权限：<code>Contents: Read and write</code>（读写数据）+ <code>Actions: Read and write</code>（用「⚡ 立即抓取」手动触发云端任务）。</div>
    <div class="row-btn" style="margin-top:14px">
      <button class="btn gh" style="flex:1" onclick="saveSyncCfg()">保存配置</button>
      <button class="btn pri" style="flex:1" onclick="saveSyncCfg(true)">保存并测试</button>
    </div>
    <div class="row-btn" style="margin-top:9px">
      <button class="btn gh" style="flex:1" onclick="syncPull(true)">↓ 拉取云端数据</button>
      <button class="btn pri" style="flex:1" onclick="syncPush(true)">↑ 推送本地数据</button>
    </div>
    <div class="row-btn" style="margin-top:9px">
      <button id="btnFetchNow" class="btn" style="flex:1" onclick="triggerFetch()">⚡ 立即抓取最新净值</button>
    </div>
    <div class="field" style="margin-top:10px"><label>手动抓取结果</label>
      <div id="manFetchBox">${manStatusHtml()}</div>
    </div>
    <div id="syncMsg" style="margin-top:10px"></div>`);
  ensureManualPolling();
}
function saveSyncCfg(test) {
  SYNC.owner = ($("sOwner").value || "").trim();
  SYNC.repo = ($("sRepo").value || "").trim();
  SYNC.path = ($("sPath").value || "licai-data.json").trim();
  SYNC.token = ($("sToken").value || "").trim();
  saveSync(); renderSet(); renderHome();
  if (test) testConn();
}
/* base64 ⇄ UTF-8（escape/unescape 已废弃，2026-09-15 审查替换） */
function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function utf8ToB64(s) {
  const arr = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
async function ghReq(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: {
      "Authorization": "Bearer " + SYNC.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),   /* 网络卡死时 20s 放弃，不再永久挂起 */
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`); }
  return r.status === 204 ? null : r.json();
}
/* 手动触发云端抓取（#延时对策，2026-09-16）：
   GitHub 免费仓库的 schedule 是「尽力而为」，实测延迟 2-9.5 小时且可能被跳过 ——
   点这个按钮用 workflow_dispatch 立刻触发一次（官方接口，非定时任务、无排队延迟）。
   需要令牌具备 Actions: Read and write（Contents 权限不够，403）。 */
/* ---------- 手动抓取结果跟踪（v31） ----------
   workflow_dispatch 成功只返回 204、**不带 run id**，所以「到底成没成」必须触发后
   主动去查最近一次 workflow_dispatch 运行。状态写进 localStorage：弹层关掉重开、
   或 PWA 被系统回收再打开，都还能看到上次结果（12 分钟上限自动收口，不会一直转圈）。 */
const LS_MANUAL = "licai.manualFetch";
let MANUAL = loadManual();
let _manPollTimer = null, _manPolling = false;
function loadManual() { try { return JSON.parse(localStorage.getItem(LS_MANUAL)) || {}; } catch (e) { return {}; } }
function saveManual() { try { localStorage.setItem(LS_MANUAL, JSON.stringify(MANUAL)); } catch (e) { } }
function stampOf(ms) {
  const d = new Date(ms || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function durTxt(ms) {
  ms = Math.max(0, Number(ms) || 0);
  return ms >= 60000 ? `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒` : `${Math.round(ms / 1000)} 秒`;
}
/* 状态条：一眼回答「手动抓取到底成没成、数据到没到」。
   workflow_dispatch 是异步的 —— 用户点完只看得到一个 toast，所以这里把
   触发时间 / 运行号 / 耗时 / 云端回报的抓取时间 / 新增条数都摊开写清楚。 */
function manStatusHtml() {
  const m = MANUAL || {};
  if (!m.t0) return `<div class="note">还没有手动抓取记录。点下面的「⚡ 立即抓取」可立刻触发一次云端抓取，不受定时排队影响。</div>`;
  const at = stampOf(m.t0);
  const run = m.runNo ? ` ｜ 运行 <b>#${esc(m.runNo)}</b>` : "";
  const clear = `<div style="margin-top:6px"><span class="more" onclick="resetManualFetch()">清除这条记录 ›</span></div>`;
  if (m.state === "running")
    return `<div class="note b"><b>⏳ 手动抓取进行中…</b>
      <div class="tip" style="color:inherit;margin-top:4px">触发时间 <b>${esc(at)}</b>${run}${m.dur ? " ｜ 已等 " + durTxt(m.dur) : ""}<br>
      ${m.runNo ? "云端正在抓取，通常 1-4 分钟。" : "已提交，等待云端接单…"}本页可继续使用，出结果后这里会自动更新。</div></div>`;
  if (m.state === "ok") {
    const extra = m.navTime
      ? `<br>云端回报的抓取时间 <b>${esc(m.navTime)}</b>` + (m.added ? ` ｜ 本次新增净值 <b>${m.added}</b> 条` : " ｜ 暂无新增（披露源还没更新）")
      : "";
    const late = m.lateWait ? `<br>ℹ️ 本结果在触发后 ${durTxt(m.lateWait)} 才被本机确认到（期间 App 离线或挂后台），并非云端实际耗时。` : "";
    const warn = m.fail ? `<br>⚠️ 但仍有 <b>${m.fail}</b> 只产品没拿到净值（见下方状态）` : "";
    return `<div class="note g"><b>✅ 手动抓取成功</b>
      <div class="tip" style="color:inherit;margin-top:4px">触发时间 <b>${esc(at)}</b>${run} ｜ 耗时 <b>${durTxt(m.dur)}</b>${extra}${late}${warn}</div>${clear}</div>`;
  }
  if (m.state === "fail")
    return `<div class="note"><b>❌ 手动抓取失败</b>（云端结论：${esc(m.conclusion || "failure")}）
      <div class="tip" style="color:inherit;margin-top:4px">触发时间 <b>${esc(at)}</b>${run} ｜ 耗时 <b>${durTxt(m.dur)}</b>${m.lateWait ? `<br>ℹ️ 本结果在触发后 ${durTxt(m.lateWait)} 才被本机确认到（期间 App 离线或挂后台）。` : ""}<br>
      到 GitHub 仓库的 Actions 页可看运行日志；整轮失败会自动建 Issue。</div>${clear}</div>`;
  if (m.state === "timeout")
    return `<div class="note"><b>⚠️ 手动抓取未在预期时间内完成</b>
      <div class="tip" style="color:inherit;margin-top:4px">触发时间 <b>${esc(at)}</b>${run}<br>
      已等超过 12 分钟仍未拿到结论（GitHub 免费账号偶发排队）。可点「↓ 从云端拉取」直接看数据到没到。</div>${clear}</div>`;
  return `<div class="note"><b>⚠️ 手动抓取未能确认结果</b>
    <div class="tip" style="color:inherit;margin-top:4px">触发时间 <b>${esc(at)}</b>${run}<br>${esc(m.msg || "")}<br>请点「↓ 从云端拉取」核对数据是否已更新。</div>${clear}</div>`;
}
/* 就地刷新状态条与「云端最近一次抓取」——不整页重画，避免弹层滚动位置被重置 */
function renderManBox() {
  const box = $("manFetchBox"); if (box) box.innerHTML = manStatusHtml();
  const t = $("navSyncTime");
  if (t) {
    const last = (DATA.settings && DATA.settings.lastNavSync) || "";
    t.className = "note " + (last ? "g" : "");
    t.textContent = last || "暂无记录（云端抓取任务尚未写入）";
  }
}
function resetManualFetch(silent) {
  clearTimeout(_manPollTimer); _manPolling = false;
  MANUAL = {}; saveManual(); renderManBox();
  if (!silent) toast("已清除手动抓取记录");
}
/* 触发后追踪运行结果；重开弹层 / App 重启都会接着追 */
function ensureManualPolling() {
  if (_manPolling || !MANUAL || MANUAL.state !== "running") return;
  if (Date.now() > (MANUAL.t0 || 0) + 12 * 60000) {          /* 陈旧记录直接收口，别一直转圈 */
    MANUAL.state = "timeout"; MANUAL.dur = Date.now() - (MANUAL.t0 || Date.now());
    saveManual(); renderManBox(); return;
  }
  _manPolling = true;
  _manPollTimer = setTimeout(pollManualRun, 4000);           /* 稍等一下：云端接单本身有几秒延迟 */
}
async function pollManualRun() {
  clearTimeout(_manPollTimer);
  if (!MANUAL || MANUAL.state !== "running") { _manPolling = false; return; }
  const started = MANUAL.t0, deadline = started + 12 * 60000;
  try {
    if (!MANUAL.runApiId) {
      /* 取「本次触发前后 90 秒内创建」的最新一次手动运行 */
      const r = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/actions/workflows/update_nav.yml/runs?event=workflow_dispatch&per_page=10`);
      const cand = (r.workflow_runs || [])
        .filter(x => new Date(x.created_at).getTime() >= started - 90000)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (cand) { MANUAL.runApiId = cand.id; MANUAL.runNo = cand.run_number || ""; }
    } else {
      const x = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/actions/runs/${MANUAL.runApiId}`);
      if (x.status === "completed") {
        /* v33：耗时改用 GitHub 记录的 run_started_at→updated_at（真实运行时长）。
           App 挂后台/离线时轮询被冻结，Date.now()-t0 会把「确认延迟」算进耗时
           （实测出现过「耗时 120 分 52 秒」），误导用户以为云端跑了 2 小时。 */
        const rs = x.run_started_at ? new Date(x.run_started_at).getTime() : 0;
        const up = x.updated_at ? new Date(x.updated_at).getTime() : 0;
        MANUAL.dur = (rs && up && up > rs) ? (up - rs) : Math.max(0, Date.now() - started);
        const late = Date.now() - started - MANUAL.dur;
        MANUAL.lateWait = late > 90000 ? late : 0;   /* 确认延迟超 90 秒才提示 */
        MANUAL.conclusion = x.conclusion || "unknown";
        MANUAL.state = x.conclusion === "success" ? "ok" : "fail";
        if (MANUAL.state === "ok") await collectManualResult();
        saveManual(); _manPolling = false; renderManBox(); return;
      }
    }
    MANUAL.dur = Date.now() - started;
  } catch (e) {
    const s = String(e);
    if (/403/.test(s)) {   /* 令牌只有 Contents 权限时查不了运行：如实说明，别无限转圈 */
      MANUAL.state = "unknown"; MANUAL.dur = Date.now() - started;
      MANUAL.msg = "令牌缺少 Actions 读取权限，无法自动确认结果。";
      saveManual(); _manPolling = false; renderManBox(); return;
    }
    /* 其余多为网络抖动：不算失败，下一轮再试 */
  }
  renderManBox();
  if (Date.now() > deadline) {
    MANUAL.state = "timeout"; MANUAL.dur = Date.now() - started;
    saveManual(); _manPolling = false; renderManBox(); return;
  }
  _manPollTimer = setTimeout(pollManualRun, 8000);
}
/* 云端跑完后拉一次数据，顺便把「云端回报的抓取时间 / 新增条数」记进状态 */
async function collectManualResult() {
  const before = navFingerprint();
  await syncPull(false);
  const after = navFingerprint();
  const lf = lastFetchInfo();
  MANUAL.navTime = (lf && lf.time) || "";
  MANUAL.fail = lf ? (Number(lf.fail) || 0) : 0;
  MANUAL.added = Math.max(0, after.count - before.count);
  saveManual();
}
async function triggerFetch() {
  if (!SYNC.owner || !SYNC.repo || !SYNC.token) { toast("请先在「数据同步设置」里配置仓库与 Token"); return; }
  const btn = $("btnFetchNow");
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = "触发中…"; }
  MANUAL = { state: "running", t0: Date.now(), runNo: "", runApiId: 0, dur: 0 };
  saveManual(); renderManBox();
  const dispatch = () => ghReq("POST",
    `${GH}/repos/${SYNC.owner}/${SYNC.repo}/actions/workflows/update_nav.yml/dispatches`,
    { ref: SYNC.branch || "main" });
  try {
    try {
      await dispatch();
    } catch (e) {
      /* v32 P1-4：ref 不写死 main —— 仓库默认分支不是 main 时 dispatch 会 404，
         此时探一次 default_branch 缓存下来并重试（平时零额外请求）。 */
      if (!/404/.test(String(e))) throw e;
      const repo = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}`);
      SYNC.branch = (repo && repo.default_branch) || "main"; saveSync();
      await dispatch();
    }
    toast("已触发云端抓取，结果会自动出现在弹层里（约 1-4 分钟）", 4800);
    _manPolling = false; ensureManualPolling();      /* 触发成功即开始追踪运行结果 */
  } catch (e) {
    const s = String(e);
    MANUAL.state = "unknown"; MANUAL.dur = Date.now() - MANUAL.t0;
    if (/403/.test(s)) {
      MANUAL.msg = "令牌缺少 Actions 权限：GitHub → 令牌设置 → Repository permissions 里 Actions 勾 Read and write（改权限不换令牌值）。";
      toast("令牌缺少 Actions 权限：GitHub → 令牌设置 → Repository permissions 里 Actions 勾 Read and write（改权限不换令牌值）", 7000);
    } else if (/404/.test(s)) {
      MANUAL.msg = "触发失败：仓库里没有 update_nav.yml，或 Token 无权访问该仓库。";
      toast("触发失败：仓库里没有 update_nav.yml，或 Token 无权访问该仓库", 5200);
    } else {
      MANUAL.msg = "触发失败：" + s.slice(0, 120);
      toast("触发失败：" + s.slice(0, 90), 4200);
    }
    saveManual(); renderManBox();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⚡ 立即抓取"; }
  }
}
function syncMsg(html) { const e = $("syncMsg"); if (e) e.innerHTML = html; else toast(html.replace(/<[^>]+>/g, "")); }
async function testConn() {
  if (!SYNC.owner || !SYNC.repo || !SYNC.token) return toast("请先填完整配置");
  syncMsg("测试连接中…");
  try {
    const repo = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}`);
    if (repo && repo.default_branch) { SYNC.branch = repo.default_branch; saveSync(); }   /* v32 P1-4：缓存默认分支 */
    let exists = false;
    try { await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`); exists = true; } catch (e) { }
    syncMsg(`<div class="note g">连接成功：<b>${esc(repo.full_name)}</b>（${repo.private ? "私有" : "⚠️ 公开！"}）<br>数据文件${exists ? "已存在" : "尚不存在，首次推送会自动创建"}</div>`);
  } catch (e) { syncMsg(`<div class="note">连接失败：${esc(String(e).slice(0, 140))}</div>`); }
}
async function syncPull(manual) {
  if (!SYNC.owner || !SYNC.repo || !SYNC.token) { if (manual) toast("请先配置同步"); return; }
  /* v32 P0-2：本地还有没推上去的改动时，静默拉取一律先推后拉（拉回自己的改动+云端独有净值）；
     推送失败就放弃本次拉取 —— 绝不能用云端旧数据覆盖本地新编辑。
     手动拉取本身有「本地未同步的改动将丢失」确认弹窗，直接放行。 */
  if (!manual && DIRTY) {
    await syncPush(false);
    if (DIRTY) return;
  }
  try {
    const info = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`);
    SYNC.sha = info.sha; saveSync();
    const remote = JSON.parse(b64ToUtf8(info.content));
    if (manual && !confirm("用云端数据覆盖本地？本地未同步的改动将丢失。\n建议：先在另一台设备推送，或先导出本地备份。")) return;
    /* 覆盖前留一份净值指纹，用来判断云端是不是真有新净值（见 notifyNewNav） */
    const before = navFingerprint();
    DATA = Object.assign({ products: [], trades: [], settings: {} }, remote);
    saveLocal();
    const pullVer = _POS_VER;
    /* 云端数据同样要过一遍迁移：合并重复产品、搬迁销售代码。
       若发生变更则回写云端 —— 抓取脚本读到正确的产品代码后才会抓到净值。 */
    const migratedRemote = migrateData();
    renderHome(); renderTrade(); renderProd(); renderSet();
    if (migratedRemote) { notifyMigrate(); autoPush(); }
    else if (_POS_VER === pullVer) { DIRTY = false; dirtyPersist(); }   /* 拉下来的就是云端现势，本地没有未推送改动 */
    const after = navFingerprint();
    /* before.count 为 0 说明本机还没有任何净值（首次拉取 / 换设备），
       拿它当基准会算出「云端有 200 条新净值」这种荒唐提示，故跳过。 */
    if (before.count > 0) notifyNewNav(navDeltaSince(before.latest), after.latest);
    renderAlert();
    if (manual) toast(migratedRemote ? "已从云端拉取，并自动整理数据" : "已从云端拉取");
  } catch (e) {
    if (manual) toast("拉取失败：" + String(e).slice(0, 80), 3000);
  }
}
async function syncPush(manual) {
  if (!SYNC.owner || !SYNC.repo || !SYNC.token) { if (manual) toast("请先配置同步"); return; }
  const body = { message: `update ledger ${new Date().toISOString().slice(0, 16)}` };
  try {
    /* 推之前先读一次远端。两个原因，都跟「整文件替换」有关：
       ① GitHub Contents PUT 是整文件替换，而 settings 里的 lastNavSync / lastFetch
          是**抓取脚本的**字段。如果本机副本比云端旧（Action 在我们打开页面之后
          刚写过），直接推就把云端刚写的抓取结果覆盖回旧值 —— 表现为「云端明明
          抓取失败了，App 的告警条却不出现」，而且不会有任何报错。
       ② 顺手拿到最新 sha，避免用陈旧 sha 提交导致 409 冲突。 */
    let rs = {}, rpArr = null;
    try {
      const cur = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`);
      if (cur && cur.sha) {
        body.sha = cur.sha;
        const robj = JSON.parse(b64ToUtf8(cur.content)) || {};
        rs = robj.settings || {};
        rpArr = Array.isArray(robj.products) ? robj.products : null;
      }
    } catch (e) { /* 读不到远端就按本地推，不阻断正常保存 */ }
    if (!body.sha) {
      try { const info = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`); body.sha = info.sha; } catch (e) { }
    }
    /* payload 在 PUT 前才生成：网络往返期间的用户编辑不会丢出本次推送 */
    const payload = JSON.parse(JSON.stringify(DATA));
    const _pushVer = _POS_VER;   /* payload 快照对应的数据版本（推送成功后据此决定是否清 dirty） */
    payload.settings = payload.settings || {};
    for (const k of ["lastNavSync", "lastFetch"]) {
      const a = rs[k], b = payload.settings[k];
      /* 用 time 比较新旧；云端没有就保留本地，都没写就跳过 */
      const ta = a ? String(a.time || a) : "";
      const tb = b ? String(b.time || b) : "";
      if (ta && ta > tb) payload.settings[k] = a;
    }
    /* v32 P0-1：云端独有净值并入 payload。
       PUT 是整文件替换，payload 里的 navHistory 是打开页面时的旧快照 ——
       不合并的话，App 开着期间云端 Actions 刚抓到的新净值会被这次推送抹掉。
       只并入「本地没有的日期」；同日冲突保留本地值（用户显式补录优先）。
       按 id 匹配；云端有而本地没有的产品不回填 —— 那可能是本机刚删除的，回填会复活。 */
    if (rpArr) {
      const byId = new Map((payload.products || []).map(x => [String(x.id), x]));
      for (const rp of rpArr) {
        const lp = byId.get(String(rp.id));
        if (!lp || !rp.navHistory) continue;
        const lh = lp.navHistory || (lp.navHistory = {});
        for (const d in rp.navHistory)
          if (lh[d] === undefined || lh[d] === null || lh[d] === "") lh[d] = rp.navHistory[d];
      }
    }
    body.content = utf8ToB64(JSON.stringify(payload, null, 1));
    /* 只把合并后的两个抓取脚本字段留在本地，不整段覆盖 settings
       （旧写法 DATA.settings = payload.settings 会用网络往返前的旧快照回写） */
    DATA.settings = DATA.settings || {};
    for (const k of ["lastNavSync", "lastFetch"])
      if (payload.settings[k] !== undefined) DATA.settings[k] = payload.settings[k];
    const res = await ghReq("PUT", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`, body);
    SYNC.sha = res && res.content ? res.content.sha : ""; saveSync();
    /* 推送成功：payload 生成后没有新的本地改动才清 dirty（有的话说明网络期间又编辑了，
       新一轮 autoPush 会接着推） */
    if (_pushVer === _POS_VER) { DIRTY = false; dirtyPersist(); }
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
   提醒：新净值通知 + 抓取异常告警
   ------------------------------------------------------------
   为什么没有「真正的后台推送」：
     本项目零后端，云端只有定时抓取的 GitHub Actions。
     真后台推送需要 Web Push（VAPID 密钥对 + 一台常驻服务端来投递），
     那会立刻打破「数据不出设备 + 零服务器成本」这两个前提，故不做。
     所以提醒做成两级：
       ① App 打开 / 切回前台时：自动比对云端文件 sha，有新净值直接提示；
       ② 页面挂在后台（装了主屏、或留着一个标签页）时：每 60 分钟轮询一次，
          发现新净值才发系统通知。
     iOS：Safari 里不上主屏会直接拒绝通知权限，必须「分享 → 添加到主屏幕」
          后从桌面图标打开（iOS 16.4+）。renderNotify 里会按环境给出提示。
   ============================================================ */
function loadNotify() {
  try { const s = localStorage.getItem(LS_NOTIFY); if (s) NOTIFY = Object.assign(NOTIFY, JSON.parse(s)); } catch (e) { }
  try { ALERT_DISMISSED = localStorage.getItem(LS_ALERT) || ""; } catch (e) { }
}
function saveNotify() {
  try { localStorage.setItem(LS_NOTIFY, JSON.stringify({ on: !!NOTIFY.on, lastCheck: NOTIFY.lastCheck || 0 })); } catch (e) { }
}
function saveAlertDismiss() { try { localStorage.setItem(LS_ALERT, ALERT_DISMISSED); } catch (e) { } }

function notifySupported() { return typeof Notification !== "undefined" && !!Notification; }
function notifyPermission() { return notifySupported() ? Notification.permission : "unsupported"; }
function isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent || ""); }
function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || navigator.standalone === true;
  } catch (e) { return false; }
}
function canNotify() { return NOTIFY.on && notifyPermission() === "granted"; }

/* 发系统通知。
   优先走 SW 的 showNotification —— iOS(16.4+) 只认这条路径，
   `new Notification()` 在移动端 Safari 根本不存在，只作桌面浏览器的回退。
   tag 固定：同一条提醒重复发只替换，不会在通知中心堆一串。 */
async function pushNotify(title, body) {
  if (!canNotify()) return false;
  const opts = { body: body, icon: "./icon-192.png", badge: "./icon-192.png", tag: "licai-nav", lang: "zh-CN" };
  try {
    const reg = (navigator.serviceWorker && navigator.serviceWorker.getRegistration)
      ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
    new Notification(title, opts);            /* 回退：桌面浏览器 */
    return true;
  } catch (e) { return false; }
}

async function toggleNotify() {
  if (NOTIFY.on) {
    NOTIFY.on = false; saveNotify(); renderNotify();
    toast("已关闭新净值提醒"); return;
  }
  if (!notifySupported()) {
    toast("此环境不支持通知。iPhone 请先「分享 → 添加到主屏幕」，再从桌面图标打开", 4600);
    renderNotify(); return;
  }
  let perm = Notification.permission;
  if (perm === "default") {
    try { perm = await Notification.requestPermission(); } catch (e) { perm = "denied"; }
  }
  if (perm !== "granted") {
    toast("通知权限被拒绝。请到浏览器/系统设置里允许本站通知，再回来开启", 4200);
    renderNotify(); return;
  }
  NOTIFY.on = true; saveNotify(); renderNotify();
  toast("已开启提醒：" + (isStandalone() ? "退到后台也能收到通知" : "页面在后台时会有通知"), 3200);
  pushNotify("提醒已开启", "抓到新净值、或云端抓取失败时会在这里告诉你。");
}

function renderNotify() {
  const box = $("notifyBox"); if (!box) return;
  const btn = $("btnNotify"), tip = $("notifyTip");
  const supported = notifySupported(), perm = notifyPermission();
  if (btn) btn.textContent = NOTIFY.on ? "关闭通知" : "开启通知";
  let html = "", t = "";
  if (!supported) {
    html = `<div class="note">当前环境不支持系统通知（可能是 <code>file://</code> 打开、或 App 内嵌浏览器）。<br>
            抓取异常仍会在首页顶部显示<b>告警条</b>。</div>`;
    t = isIOS() ? "iPhone / iPad：需先用 Safari「分享 → 添加到主屏幕」，再从桌面图标打开本页，通知才会生效。" : "";
  } else if (perm === "denied") {
    html = `<div class="note">通知权限已被拒绝。<br>需到浏览器设置里手动允许本站通知，再回来开启。</div>`;
  } else if (NOTIFY.on) {
    html = `<div class="note g">已开启。${isStandalone() ? "本页已装到桌面，退到后台也能收到通知。" : "本页留在后台（或装到桌面）时能收到通知。"}</div>`;
    t = "零后端设计：靠本页定时比对云端数据，<b>完全关闭浏览器后收不到推送</b>（那需要一台常驻服务器）。";
  } else {
    html = `<div class="note">开启后：抓到<b>新净值</b>、或云端<b>抓取失败</b>时会收到系统通知。<br>
            不开启也不影响使用 —— 首页顶部仍有告警条。</div>`;
    t = (isIOS() && !isStandalone())
      ? "iPhone / iPad：请先「分享 → 添加到主屏幕」，再从桌面图标打开，才能开启通知。" : "";
  }
  box.innerHTML = html;
  if (tip) tip.innerHTML = t;
}

/* ---------- 云端抓取健康度（云端写进 licai-data.json 的 settings.lastFetch） ---------- */
function lastFetchInfo() {
  const lf = DATA.settings && DATA.settings.lastFetch;
  return (lf && typeof lf === "object") ? lf : null;
}
/* 告警签名只取「失败集合」，不含时间戳：
   这样用户点掉之后不会因为下一轮抓取（时间变了）又冒出来，
   但只要失败的产品变了、或有新的产品开始失败，就会重新提示。 */
function fetchFailSig(lf) { return lf ? ("fetch:" + (lf.sig || "") + ":" + (Number(lf.fail) || 0)) : ""; }
function fetchFailCount(lf) { return lf ? (Number(lf.fail) || 0) : 0; }

function renderAlert() {
  const bar = $("alertBar"); if (!bar) return;
  const lf = lastFetchInfo();
  const n = fetchFailCount(lf);
  if (!n || fetchFailSig(lf) === ALERT_DISMISSED) {
    bar.className = "alert"; bar.innerHTML = ""; return;
  }
  const items = (lf.items || []).slice(0, 3)
    .map(s => `<div class="sm">· ${esc(s)}</div>`).join("");
  const more = n > 3 ? `<div class="sm">…另有 ${n - 3} 只，点「详情」看全部</div>` : "";
  bar.className = "alert warn show";
  bar.innerHTML = `<div class="tx">
      <b>云端抓取有 ${n} 只产品没拿到净值</b>${lf.time ? `<span class="sm"> · ${esc(lf.time)}</span>` : ""}
      ${items}${more}
      <div style="margin-top:4px"><span class="more" onclick="refreshNav()">详情与处理办法 ›</span></div>
    </div>
    <button class="x" title="本次不再提示" onclick="dismissAlert()">✕</button>`;
}
function dismissAlert() {
  ALERT_DISMISSED = fetchFailSig(lastFetchInfo());
  saveAlertDismiss(); renderAlert();
  toast("已忽略本次告警。失败的产品有变化时会重新提示", 3200);
}

/* ---------- 新净值检测 ---------- */
/* 净值指纹：最新披露日 + 净值总条数。
   只认「条数增长」不认减少 —— 云端抓取只增不删，减少说明是别的问题（比如换了账号）。 */
function navFingerprint() {
  let count = 0;
  for (const p of DATA.products) count += navCount(p);
  return { count: count, latest: latestDateAll() || "" };
}
/* 比上次同步更新的净值条数（披露日 > latestDate）。
   不能用总条数差：新增产品回填 122 条历史会被误报成「122 条新净值」。 */
function navDeltaSince(latestDate) {
  let n = 0;
  for (const p of DATA.products)
    for (const d in (p.navHistory || {}))
      if (d > latestDate) n++;
  return n;
}
/* 拉到新净值后的提醒。
   用户正盯着屏幕看的时候不再弹系统通知去打断他 —— 前台只给 toast。 */
function notifyNewNav(delta, latest) {
  if (!(delta > 0)) return;
  if (document.visibilityState === "visible") {
    toast(`云端有 ${delta} 条新净值（最近 ${latest}），已同步`, 3600);
  } else {
    pushNotify("净值已更新", `${delta} 条新净值 · 最近披露 ${latest}`);
  }
}
/* 后台轮询：只比对远端 sha，变了才真拉全量。
   15 分钟内不重复请求（GitHub API 有速率限制，而云端抓取本身一天只有两次）。 */
async function checkCloudUpdate() {
  if (!(SYNC.owner && SYNC.repo && SYNC.token)) return;
  if (!NOTIFY.on) return;
  if (Date.now() - (NOTIFY.lastCheck || 0) < 15 * 60000) return;
  NOTIFY.lastCheck = Date.now(); saveNotify();
  try {
    const info = await ghReq("GET", `${GH}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`);
    if (!info || !info.sha || info.sha === SYNC.sha) return;   /* 云端没变 */
    await syncPull(false);                                    /* 变了才拉 */
  } catch (e) { /* 静默：网络抖动不该打扰用户 */ }
}

/* ============================================================
   备份 / 恢复 / 清空
   ============================================================ */
function exportJSON() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `理财台账备份_${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);   /* v32 P2：下载启动后再回收，防内存滞留 */
  toast("已导出备份");
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
  loadNotify();
  /* 启动即做一次数据迁移：销售代码→产品代码、重复产品合并 */
  const migrated = migrateData();
  $("btnHide").textContent = DATA.settings.hideAmount ? "显示" : "隐藏";
  renderHome(); renderSet();
  renderAlert();
  if (migrated) notifyMigrate();
  /* 上次手动抓取若在系统回收时还没跑完，启动后接着追踪（12 分钟上限自动兜底） */
  ensureManualPolling();
  if (SYNC.owner && SYNC.repo && SYNC.token) syncPull(false);
  window.addEventListener("online", () => { if (SYNC.owner) syncPull(false); });

  /* 提醒的两条触发路径（详见「提醒」章节的说明）：
     ① 页面在后台时每 60 分钟比对一次云端版本，有新净值就发系统通知；
     ② 从后台切回前台时立刻核对一次，并重画告警条/提醒状态（可能是在别处改过数据）。 */
  setInterval(checkCloudUpdate, 60 * 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkCloudUpdate(); renderAlert(); renderNotify();
    }
  });
  /* 注册 Service Worker（仅 https / localhost 生效，file:// 下自动跳过）
     SW 是「外壳缓存优先」，新版本必须等新 SW 装上并接管才生效 ——
     否则用户会一直看到旧的 index.html / app.js，表现为「推了代码但页面没变」。
     所以这里主动监听更新：updatefound 只在真的发现新版本时触发，
     新 SW 一装好（installed）且当前有旧 SW 在控制页面，就提示并自动刷新一次
     （sessionStorage 里记一下，确保每个版本最多刷一次，杜绝循环刷新）。 */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const FLAG = "licai_sw_reloaded";
    const reloadOnce = () => {
      try {
        if (sessionStorage.getItem(FLAG) === APP_VER) return;
        sessionStorage.setItem(FLAG, APP_VER);
      } catch (e) { /* 隐私模式下可能不可用，忽略 */ }
      toast(`已更新到 ${APP_VER}，即将刷新…`);
      setTimeout(() => location.reload(), 1000);
    };
    navigator.serviceWorker.register("./sw.js").then(reg => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          /* 首次安装时还没有 controller，不需要刷新，只有「替换旧版本」才刷 */
          if (nw.state === "installed" && navigator.serviceWorker.controller) reloadOnce();
        });
      });
    }).catch(() => { });
  }
})();
