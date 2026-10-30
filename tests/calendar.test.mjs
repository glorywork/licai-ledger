/* 交易日历回归测试（零依赖）：node --test tests/calendar.test.mjs
   测的是「确认日期算错 = 份额早到/晚到 = 收益算错」的路径：
     · 周末 / 法定假日 / 调休上班日
     · 春节、国庆这种超长休市前后的 T+1
     · 15:00 截止时间后的顺延
     · 净值滞后按交易日计（长假里不该误报）
     · 未配置年份的降级与提示 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTradeDay, nextTradeDay, prevTradeDay, addTradeDays, tradeDaysBetween,
  suggestTradeDates, navLagTradingDays, navIsStale,
  isYearConfigured, calendarYears, configureCalendar, resetCalendar,
} from "../js/domain/calendar.js";

/* 2026 年国庆：10-01~10-07 休市，10-08（周四）复市；10-10（周六）调休上班 */
test("交易日判定：周末 / 假日 / 调休补班", () => {
  assert.equal(isTradeDay("2026-10-09"), true, "周五");
  assert.equal(isTradeDay("2026-10-10"), true, "10-10 周六调休上班");
  assert.equal(isTradeDay("2026-10-31"), false, "普通周六");
  assert.equal(isTradeDay("2026-10-01"), false, "国庆");
  assert.equal(isTradeDay("2026-09-25"), false, "中秋");
  assert.equal(isTradeDay("2026-02-17"), false, "春节");
  assert.equal(isTradeDay("2026-02-14"), true, "2-14 周六调休上班");
  assert.equal(isTradeDay("2026-02-24"), true, "春节后首个工作日");
});

test("下一交易日：跨国庆 / 跨春节", () => {
  assert.equal(nextTradeDay("2026-09-30"), "2026-10-08");
  assert.equal(prevTradeDay("2026-10-08"), "2026-09-30");
  assert.equal(nextTradeDay("2026-02-13"), "2026-02-14", "调休的周六也算交易日");
  assert.equal(nextTradeDay("2026-02-14"), "2026-02-24", "春节连休 2-15~2-23");
  assert.equal(nextTradeDay("2026-02-13", true), "2026-02-13", "includeSelf 时当天是交易日");
  assert.equal(addTradeDays("2026-09-30", 2), "2026-10-09");
  assert.equal(addTradeDays("2026-10-09", -2), "2026-09-30");
});

test("交易日间隔只数交易日", () => {
  assert.equal(tradeDaysBetween("2026-09-30", "2026-10-09"), 2);
  assert.equal(tradeDaysBetween("2026-10-03", "2026-10-07"), 0, "整段都在假期里");
  assert.equal(tradeDaysBetween("2026-10-09", "2026-10-09"), 0);
  assert.equal(tradeDaysBetween("2026-10-09", "2026-09-30"), 0, "反向不计");
});

/* T+1：受理日之后的第 1 个交易日 */
function settle(date) {
  const apply = isTradeDay(date) ? date : nextTradeDay(date);
  return { apply, confirm: addTradeDays(apply, 1) };
}

test("T+1 确认日：节前买入顺延到节后", () => {
  assert.deepEqual(settle("2026-09-30"), { apply: "2026-09-30", confirm: "2026-10-08" });
  assert.deepEqual(settle("2026-10-01"), { apply: "2026-10-08", confirm: "2026-10-09" });
  assert.deepEqual(settle("2026-10-09"), { apply: "2026-10-09", confirm: "2026-10-10" }, "10-10 周六调休上班，T+1 落在调休日");
  assert.deepEqual(settle("2026-10-10"), { apply: "2026-10-10", confirm: "2026-10-12" }, "调休周六买");
});

test("截止时间：15:00 前按当日，之后顺延到下一交易日", () => {
  const before = new Date(2026, 9, 30, 14, 0);   /* 2026-10-30 周五 14:00 */
  const after = new Date(2026, 9, 30, 16, 0);    /* 同一天 16:00 */
  const weekend = new Date(2026, 9, 31, 10, 0);  /* 2026-10-31 周六 */

  const a = suggestTradeDates("2026-10-30", before);
  assert.equal(a.applyDate, "2026-10-30");
  assert.equal(a.confirmDate, "2026-11-02");
  assert.equal(a.navDate, "2026-10-30");
  assert.equal(a.deferred, false);
  assert.equal(a.rolled, false);

  const b = suggestTradeDates("2026-10-30", after);
  assert.equal(b.applyDate, "2026-11-02", "过了截止时间按下一个交易日受理");
  assert.equal(b.confirmDate, "2026-11-03");
  assert.equal(b.deferred, true);
  assert.equal(b.rolled, true);

  const c = suggestTradeDates("2026-10-31", weekend);
  assert.equal(c.applyDate, "2026-11-02");
  assert.equal(c.confirmDate, "2026-11-03");
});

test("净值滞后按交易日计，长假不误报", () => {
  assert.equal(navLagTradingDays("2026-09-30", "2026-10-07"), 0, "国庆休市期间不算滞后");
  assert.equal(navLagTradingDays("2026-09-30", "2026-10-08"), 1);
  assert.equal(navLagTradingDays("2026-09-30", "2026-10-09"), 2);
  assert.equal(navIsStale("2026-09-30", "2026-10-09"), true);
  assert.equal(navIsStale("2026-09-30", "2026-10-08"), false, "只差 1 天属于正常等待披露");
  assert.equal(navLagTradingDays("2026-10-12", "2026-10-09"), 0, "未来日期不倒扣");
});

test("未配置年份：降级为周一至周五，并在结果里标出来", () => {
  resetCalendar();
  assert.equal(isYearConfigured(2027), false);
  assert.deepEqual(calendarYears(), [2025, 2026]);
  const r = suggestTradeDates("2027-01-01", new Date(2026, 11, 20, 10, 0));
  assert.deepEqual(r.unknownYears, ["2027"], "界面据此提示「按估算推算」");
  assert.equal(isTradeDay("2027-01-01"), true, "未配置时 1 月 1 日按周五估算（会提示补充日历）");
});

test("日历与截止时间可被数据文件覆盖", () => {
  resetCalendar();
  const ok = configureCalendar({
    years: { "2027": { holidays: ["2027-01-01"], workdays: ["2027-01-09"] } },
    cutoffs: { _default: "16:00", bob: "15:30" },
  });
  assert.equal(ok, true);
  assert.equal(isTradeDay("2027-01-01"), false, "2027-01-01 配置为假日");
  assert.equal(isTradeDay("2027-01-09"), true, "周六调休");
  assert.equal(isYearConfigured(2027), true);

  const at1540 = new Date(2026, 9, 30, 15, 40);
  const other = suggestTradeDates("2026-10-30", at1540, "xyz");
  assert.equal(other.applyDate, "2026-10-30", "默认截止改为 16:00 后 15:40 仍算当日");
  const bob = suggestTradeDates("2026-10-30", new Date(2026, 9, 30, 16, 30), "bob");
  assert.equal(bob.applyDate, "2026-11-02", "16:30 已到北银截止，顺延");

  resetCalendar();
  assert.equal(isYearConfigured(2027), false);
});

/* 上面最后一个断言反过来验证「默认 15:00」：16:00 覆盖下 15:30 不该顺延 */
test("默认截止时间是 15:00", () => {
  resetCalendar();
  const at1530 = new Date(2026, 9, 30, 15, 30);
  const r = suggestTradeDates("2026-10-30", at1530, "xyz");
  assert.equal(r.applyDate, "2026-11-02");
});
