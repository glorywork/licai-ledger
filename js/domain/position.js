// @ts-check
/* 持仓计算：份额、成本（加权平均）、市值、浮盈、已实现、持有天数/年化。
   全部纯函数 —— 交易列表与「今天」由调用方传入，方便单测和跨天复用。 */

import { dayDiff } from "../core/util.js";
import { latestNav, navHit, navSeries as navSeriesOf } from "./nav.js";

/**
 * @typedef {{ id?: string, navHistory?: Record<string, number | string> }} PositionProduct
 * @typedef {{ prodId?: string, type?: string, tradeDate?: string, confirmDate?: string,
 *             confirmNavDate?: string, confirmNav?: number | string,
 *             amount?: number | string, shares?: number | string }} Trade
 * @typedef {{
 *   shares: number, cost: number, market: number, profit: number, realized: number,
 *   lastNav: number, lastDate: string, startDate: string,
 *   holdDays: number, holdAnnual: number, annualValid: boolean,
 *   pendingShares: number, pendingAmount: number, hasPending: boolean, inTransit: boolean,
 *   navSeries: [string, number][]
 * }} Position
 */

/**
 * 某交易发生的确认净值：优先用户填的，否则取确认日（或买入日）当天净值
 * @param {Trade} t
 * @param {PositionProduct} p
 * @returns {number}
 */
export function resolveTradeNav(t, p) {
  if (t.confirmNav) return Number(t.confirmNav);
  const d = t.confirmNavDate || t.confirmDate || t.tradeDate;
  const hit = navHit(p, d);
  return hit ? Number(hit[1]) : 0;
}

/**
 * 计算份额 & 成本
 * @param {Trade} t
 * @param {PositionProduct} p
 * @returns {number}
 */
export function tradeShares(t, p) {
  const nav = resolveTradeNav(t, p);
  if (t.type === "buy") {
    if (t.shares) return Number(t.shares);
    return nav > 0 ? Number(t.amount) / nav : 0;
  } else {
    return Number(t.shares || 0);
  }
}

/**
 * 截至 date 已确认的持仓份额（只累加确认日 <= date 的交易）
 * @param {PositionProduct} p
 * @param {ReadonlyArray<Trade>} trades
 * @param {string} date
 * @returns {number}
 */
export function sharesOn(p, trades, date) {
  let sh = 0;
  for (const t of trades) {
    if (t.prodId !== p.id) continue;
    const cd = t.confirmDate || t.tradeDate || "";
    if (!cd || cd > date) continue;              /* 未确认：份额还没到账 */
    if (t.type === "buy") sh += tradeShares(t, p);
    else sh = Math.max(0, sh - (Number(t.shares) || 0));
  }
  return sh;
}

/**
 * 该产品是否有过交易（用于区分「已清仓」与「从未建仓」）
 * @param {PositionProduct} p
 * @param {ReadonlyArray<Trade>} trades
 * @returns {boolean}
 */
export function hasAnyTrade(p, trades) { return trades.some(t => t.prodId === p.id); }

/* 某产品当前持仓：份额、成本（成本法：加权平均）
   确认口径：只有确认日 <= 今天的买入才计入 shares/cost；
   确认日 > 今天的买入进 pendingShares/pendingAmount（在途），不计息、不显示市值。 */
/**
 * @param {PositionProduct} p
 * @param {ReadonlyArray<Trade>} trades
 * @param {string} td 「今天」YYYY-MM-DD
 * @returns {Position}
 */
export function computePosition(p, trades, td) {
  const ts = trades.filter(t => t.prodId === p.id)
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
           pendingShares, pendingAmount, hasPending, inTransit, navSeries: navSeriesOf(p) };
}