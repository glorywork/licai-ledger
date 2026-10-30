#!/usr/bin/env node
/* 交易日历门禁：node scripts/check-calendar.mjs
   守两件事：
     1. 当年（以及 90 天内会用到的那一年）必须已配置节假日 ——
        没配置时 isTradeDay 会静默按周一至周五估算，国庆/春节的确认日全错，
        而且界面上看不出来。
     2. 数据自洽：日期真实存在、同一天不能既放假又上班、
        「调休上班」必须落在周末（放在工作日多半是手误把日期写错）。

   跨年前后的安排发布节奏：国务院一般 11 月发下一年通知。若下一年还没配置，
   只警告不失败，但会明确提示「跨年交易会按估算推算」。 */
import {
  TRADE_CAL, CAL_META, calendarYears, isTradeDay, isYearConfigured,
} from "../js/domain/calendar.js";

const errors = [];
const warnings = [];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();   /* 0=周日 */
}

/* 真正的日历日校验：Date.parse 会把 2026-02-30 滚成 3 月 2 日，拦不住手误 */
function validDate(date) {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

for (const y of Object.keys(TRADE_CAL)) {
  const cal = TRADE_CAL[y];
  const seen = new Set();
  for (const key of ["holidays", "workdays"]) {
    for (const date of cal[key] || []) {
      if (!validDate(date)) {
        errors.push(`${y}.${key}: 不是合法日期 ${JSON.stringify(date)}`);
        continue;
      }
      if (date.slice(0, 4) !== y) errors.push(`${y}.${key}: ${date} 不属于 ${y} 年`);
      if (seen.has(date)) errors.push(`${y}: ${date} 重复出现`);
      seen.add(date);
      if (key === "workdays") {
        const w = weekday(date);
        if (w !== 0 && w !== 6) errors.push(`${y}.workdays: ${date} 是周${"日一二三四五六"[w]}，调休上班日应落在周末（日期可能写错）`);
      }
    }
  }
  if (!(cal.holidays || []).length) errors.push(`${y}: holidays 为空`);
}

const now = new Date();
const thisYear = now.getFullYear();
const nextYear = thisYear + 1;
if (!isYearConfigured(thisYear)) {
  errors.push(`当年 ${thisYear} 的节假日未配置：确认日会按周一至周五估算。请把国务院通知的放假/调休日期补进 js/domain/calendar.js（或 licai-data.json 的 settings.tradeCal）`);
}
if (!isYearConfigured(nextYear)) {
  warnings.push(`下一年 ${nextYear} 尚未配置（国务院通常 11 月发布）：跨年交易会按周一至周五估算，界面会提示「按估算推算」`);
}

/* 90 天覆盖：今天之后 90 天内如果跨到未配置年份，一定要警告 */
const horizon = new Date(now.getTime() + 90 * 86400000);
if (!isYearConfigured(horizon.getFullYear())) {
  warnings.push(`90 天内会用到 ${horizon.getFullYear()} 年的日历，目前未配置`);
}

const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const sample = isTradeDay(`${thisYear}-01-01`) ? "交易日" : "休市";
console.log(`日历覆盖：${calendarYears().join(" / ")}（来源：${CAL_META.source}，更新 ${CAL_META.updated}）`);
console.log(`当年元旦 ${thisYear}-01-01 判定：${sample}`);
console.log(`今天 ${todayIso} 判定：${isTradeDay(todayIso) ? "交易日" : "休市"}`);
for (const w of warnings) console.warn("⚠️ " + w);
if (errors.length) {
  console.error("❌ 交易日历校验失败：");
  for (const e of errors) console.error("   " + e);
  process.exit(1);
}
console.log("✅ 交易日历可用");
