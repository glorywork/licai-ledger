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
import { ORG_ALIAS, ORG_NAME, detectOrg, detectOrgByProdCode } from "../js/core/orgs.js";
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

test("机构识别：建信理财（jxwm，走建行在售清单渠道）", () => {
  assert.equal(detectOrg({ inst: "建信理财" }), "jxwm");
  assert.equal(detectOrg({ inst: "建信理财有限责任公司" }), "jxwm");
  assert.equal(detectOrg({ name: "惠众日申季赎第8期", manager: "建信理财" }), "jxwm");
  // 别名表按声明顺序匹配，已有发行方必须优先于「建行」这条渠道别名
  assert.equal(detectOrg({ inst: "中国建设银行", name: "中银理财-稳富" }), "bocwm");
});

test("机构识别：浙银 / 青银 / 招银（2026-10-30 三家新直连源）", () => {
  assert.equal(detectOrg({ inst: "浙银理财" }), "czbwm");
  assert.equal(detectOrg({ name: "浙银理财琮融九曜添利90天" }), "czbwm");
  assert.equal(detectOrg({ inst: "青银理财" }), "qdccb");
  assert.equal(detectOrg({ inst: "招银理财" }), "cmbwm");
  // 新别名追加在表尾：先声明的发行方不能被抢走
  assert.equal(detectOrg({ inst: "宁银理财" }), "wmbnb", "宁银 ≠ 青银 / 浙银");
  assert.equal(detectOrg({ inst: "杭银理财" }), "hangyin");
  assert.equal(detectOrg({ inst: "中银理财" }), "bocwm");
  assert.equal(detectOrg({ inst: "信银理财" }), "citic");
  // 代销渠道名（微众/网商）仍然认不出发行方 —— 那类产品由云端货架反查负责
  assert.equal(detectOrg({ inst: "微众银行", name: "阳光橙安盈季开9号D" }), "");
  // 代码形态提示：浙银份额码可判；母代码要明确提醒补份额字母
  assert.equal(detectOrgByProdCode("ZYJYG0044A").org, "czbwm");
  assert.equal(detectOrgByProdCode("ZYFCG0044B").org, "czbwm", "浙银不止 ZYJYG 一个家族");
  assert.equal(detectOrgByProdCode("ZYJYG00440").org, "czbwm");
  assert.match(detectOrgByProdCode("ZYJYG00440").tip, /母代码/);
  // 宁银的 Z+2 字母+7 位数字代码不能被浙银的 ZY… 规则抢走
  assert.equal(detectOrgByProdCode("ZGN2360006C").org, "wmbnb");
  // 招银 cfweb 用的是纯数字码，别家也可能是纯数字 → 故意不写规则，免误判
  assert.equal(detectOrgByProdCode("132031D").org, "");
});

test("机构识别：交银理财（bocom，补前端漏掉的别名）", () => {
  // 云端早就有 bocom 官网源，前端这张表 2026-10-30 之前漏了 → 同一个产品两边结论不同
  assert.equal(detectOrg({ inst: "交银理财" }), "bocom");
  assert.equal(detectOrg({ name: "交银理财纯固收" }), "bocom");
  assert.equal(ORG_NAME.bocom, "交银理财", "fetchStatus 要认它是直连源（官网+中国理财网双线）");
  // 「交通银行」不含「交银」，不会被这条别名带走
  assert.equal(detectOrg({ inst: "交通银行", name: "稳健理财" }), "chinawealth");
});

test("机构识别：光大理财（cebwm，走母公司光大银行的披露页）", () => {
  assert.equal(detectOrg({ inst: "光大理财" }), "cebwm");
  assert.equal(detectOrg({ inst: "光大理财有限责任公司" }), "cebwm");
  assert.equal(detectOrg({ name: "阳光金日添利1号", manager: "光大理财" }), "cebwm");
  // 在光大银行买的，机构栏常只写「光大银行」
  assert.equal(detectOrg({ inst: "光大银行" }), "cebwm");
  // 别名表按声明顺序匹配：光大银行代销的别家产品仍归发行方，不能被「光大」带走
  assert.equal(detectOrg({ inst: "光大银行", name: "宁银理财晶瑞固定5号" }), "wmbnb");
  assert.equal(detectOrg({ inst: "光大银行", name: "徽银理财徽享稳利" }), "huiyin");
  // EW… 形态故意不写规则：中国银行代销码同为 EW + 4 位数字 + 份额字母（EW4455D），
  // 按形态判机构会把中行代销的产品错认成光大理财
  assert.equal(detectOrgByProdCode("EW2999A").org, "");
  assert.equal(detectOrgByProdCode("EW4455D").org, "");
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
/* ---- 前后端机构识别一致性（把两边逐字比对，以前只靠人肉核对）----
   navsources/base.py 在 licai-data 仓库里，Web CI 的检出没有这一份 →
   文件不在就跳过（本地两边同树，跑得到）。 */
test("ORG_ALIAS：前端这张表必须与云端逐字同序", async () => {
  const fs = await import("node:fs");
  const path = "../navsources/base.py";
  if (!fs.existsSync(path)) return;              // licai-ledger 单独检出时无此文件
  const src = fs.readFileSync(path, "utf8");
  const block = src.split("ORG_ALIAS = {")[1].split("\n}")[0];
  const py = [...block.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",/gm)].map(m => [m[1], m[2]]);
  assert.equal(ORG_ALIAS.length, py.length,
    `云端 ${py.length} 条 / 前端 ${ORG_ALIAS.length} 条，哪家漏了`);
  for (let i = 0; i < py.length; i++) {
    assert.deepEqual([...ORG_ALIAS[i]], py[i],
      `第 ${i + 1} 条不一致（云端 ${py[i]} / 前端 ${ORG_ALIAS[i]}）：别名表按声明顺序命中，顺序也要一致`);
  }
});
