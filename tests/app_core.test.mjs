/* 核心逻辑回归测试（零依赖，Node 18+）：
     node --test tests/app_core.test.mjs
   被测对象是 js/ 下的纯函数模块 —— 拆模块之后不再需要 vm 造沙箱，
   直接用 ESM import 就能测，跨 realm 的 deepEqual 坑也一起没了。
   测的都是「算错了会让人看到假收益 / 写坏数据」的地方：
     · T+1 确认口径（份额什么时候算进持仓）
     · 净值序列取值（最新 / 指定日之前）
     · 机构识别（前端说能抓、云端才抓得到）
     · 截图 OCR 的「日期 + 净值」配对（错一行就是错一笔账） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDate } from "../js/core/util.js";
import { detectOrg } from "../js/core/orgs.js";
import { navSeries, latestNav, navOnOrBefore, navHit } from "../js/domain/nav.js";
import { sharesOn, hasAnyTrade, computePosition } from "../js/domain/position.js";
import { ocrNavLines } from "../js/domain/ocr.js";

const today = fmtDate(new Date());
const plusDays = n => fmtDate(new Date(Date.now() + n * 86400000));

/* ---- T+1 确认口径 ---- */
test("T+1：确认日在明天，今天不计份额、不计市值", () => {
  const p = { id: "p1", navHistory: { [today]: 1.01 } };
  const trades = [{ id: "t1", prodId: "p1", type: "buy", tradeDate: today,
    confirmDate: plusDays(1), amount: 10100, confirmNav: 1.01 }];
  assert.equal(sharesOn(p, trades, today), 0, "未确认的买入不应出现在今日份额");
  const pos = computePosition(p, trades, today);
  assert.equal(pos.shares, 0);
  assert.equal(Math.round(pos.pendingShares), 10000, "应进入在途份额");
  assert.ok(pos.inTransit, "一份都没确认时应标记为在途");
  assert.equal(sharesOn(p, trades, plusDays(1)), 10000, "确认日当天才有份额");
});

test("T+1：确认日是今天，份额 = 金额 / 确认净值", () => {
  const p = { id: "p2", navHistory: { [today]: 1.01 } };
  const trades = [{ id: "t2", prodId: "p2", type: "buy", tradeDate: today,
    confirmDate: today, amount: 1010, confirmNav: 1.01 }];
  const pos = computePosition(p, trades, today);
  assert.equal(Math.round(pos.shares * 100) / 100, 1000);
  assert.equal(Math.round(pos.cost * 100) / 100, 1010);
  assert.ok(!pos.inTransit, "已确认就不该显示在途");
  assert.ok(hasAnyTrade(p, trades));
});

test("历史份额按日期结算：不能用今天的份额算过去", () => {
  const p = { id: "p3", navHistory: {} };
  const trades = [
    { id: "a", prodId: "p3", type: "buy", tradeDate: plusDays(-10), confirmDate: plusDays(-9), amount: 1000, confirmNav: 1 },
    { id: "b", prodId: "p3", type: "buy", tradeDate: today, confirmDate: today, amount: 500, confirmNav: 1 },
  ];
  assert.equal(sharesOn(p, trades, plusDays(-5)), 1000);
  assert.equal(sharesOn(p, trades, today), 1500);
});

test("赎回：按均价扣减成本，差额计入已实现", () => {
  const p = { id: "p4", navHistory: { "2026-01-01": 1 } };
  const trades = [
    { id: "b1", prodId: "p4", type: "buy", tradeDate: "2026-01-01", confirmDate: "2026-01-01", amount: 1000, confirmNav: 1 },
    { id: "s1", prodId: "p4", type: "sell", tradeDate: "2026-01-02", confirmDate: "2026-01-02", shares: 400, confirmNav: 1.2 },
  ];
  const pos = computePosition(p, trades, "2026-01-03");
  assert.equal(Math.round(pos.shares), 600);
  assert.equal(Math.round(pos.cost), 600);
  assert.equal(Math.round(pos.realized), 80, "400 份 × (1.2-1.0)");
  assert.equal(Math.round(pos.market), 600, "按最新净值 1.0 计市值");
});

/* ---- 净值序列 ---- */
test("净值序列按日期升序，latestNav 取最后一条", () => {
  const p = { navHistory: { "2026-10-27": 1.01, "2026-10-28": 1.015553, "2026-10-26": 1.0 } };
  assert.deepEqual(navSeries(p).map(x => x[0]), ["2026-10-26", "2026-10-27", "2026-10-28"]);
  assert.deepEqual(latestNav(p), ["2026-10-28", 1.015553]);
  assert.deepEqual(navOnOrBefore(p, "2026-10-27"), ["2026-10-27", 1.01]);
  assert.deepEqual(navHit(p, "2026-10-28"), ["2026-10-28", 1.015553], "命中当天应返回数组");
  assert.equal(latestNav({ navHistory: {} }), null);
});

/* ---- 机构识别（与云端 detect_org 的契约） ---- */
test("机构识别：常见机构与易混对", () => {
  assert.equal(detectOrg({ inst: "北京银行" }), "bob");
  assert.equal(detectOrg({ inst: "华夏银行" }), "hx");
  assert.equal(detectOrg({ name: "宁银理财 某产品" }), "wmbnb", "宁银不能被南银抢走");
  assert.equal(detectOrg({ name: "南银理财 某产品" }), "nanyin");
  assert.equal(detectOrg({ name: "中信银行代销" }), "citic");
});

/* ---- 截图 OCR 的日期/净值配对 ---- */
test("OCR：日期与净值分处上下两行", () => {
  const rows = ocrNavLines(["净值日期", "2026-10-28", "单位净值", "1.015553", "日涨幅 0.01%"].join("\n"));
  assert.deepEqual(rows, ["2026-10-28 1.015553"]);
});

test("OCR：多行记录、中文日期、同行写法", () => {
  assert.deepEqual(ocrNavLines("2026-10-28  1.015553\n2026-10-27  1.015441"),
    ["2026-10-28 1.015553", "2026-10-27 1.015441"]);
  assert.deepEqual(ocrNavLines("2026年10月28日\n单位净值 1.0210"),
    ["2026-10-28 1.0210"]);
  assert.deepEqual(ocrNavLines("2026-10-28 单位净值 1.015553"),
    ["2026-10-28 1.015553"]);
});

test("OCR：两日期小数位不足的数字不误判为净值", () => {
  /* 0.01% 这种两位小数不该被当成净值；没有净值的那一行直接丢弃 */
  assert.deepEqual(ocrNavLines("2026-10-28\n日涨幅 0.01%"), []);
});