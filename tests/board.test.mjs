/* 产品收益表的口径与排序：
     node --test tests/board.test.mjs
   拆成纯函数模块（js/domain/board.js）的原因：app.js 里的渲染读 DOM、调 localStorage，
   node 进不去。而这张表最容易错的三处恰好都是「看了会拿错结论」的地方 ——
   月挂 0 数算错会让人以为某只产品在停息，排序把「—」顶到最前会让人以为它收益率最高。
   所以这三件事必须在 CI 里被执行一次，而不是靠肉眼看渲染结果。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_COLS, NO_INST, instKey, instLabel, boardFilter, boardInstChips,
  isZeroWan, monthZeroDays, boardSort } from "../js/domain/board.js";

const row = (o) => ({ name: "P", ikey: NO_INST, inst: "", code: "", prodCode: "",
  holdDays: 0, wan: null, a7: null, a14: null, a30: null, zero: 0, ...o });

/* ---- 列定义：顺序与文案就是产品页表头，改错了用户会读错口径 ---- */
test("表头顺序与列数不能漂", () => {
  assert.deepEqual(BOARD_COLS.map(c => c[0]),
    ["name", "holdDays", "wan", "a7", "a14", "a30", "zero"]);
  assert.deepEqual(BOARD_COLS.map(c => c[1]),
    ["产品名称", "持有天数", "万收", "近7日年化", "近14日年化", "近30日年化", "月挂0数"]);
  /* 每列都得有口径说明：万收/N 日年化这类折算口径不写清就会被当成官方数字 */
  for (const c of BOARD_COLS) assert.ok(c[2] && c[2].length > 8, `列 ${c[1]} 缺口径说明`);
});

/* ---- 机构键 ---- */
test("机构为空时落到哨兵键，显示为「未填机构」", () => {
  assert.equal(instKey(""), NO_INST);
  assert.equal(instKey("   "), NO_INST);
  assert.equal(instKey(undefined), NO_INST);
  assert.equal(instKey("  招银理财  "), "招银理财");
  assert.equal(instLabel(NO_INST), "未填机构");
  assert.equal(instLabel("招银理财"), "招银理财");
});

/* ---- 筛选 ---- */
test("按机构筛选：哨兵键能筛出未填机构的行", () => {
  const rows = [row({ name: "A", ikey: "招银理财", inst: "招银理财" }),
    row({ name: "B", ikey: NO_INST }),
    row({ name: "C", ikey: "兴银理财", inst: "兴银理财" })];
  assert.deepEqual(boardFilter(rows, "", "").map(r => r.name), ["A", "B", "C"]);
  assert.deepEqual(boardFilter(rows, NO_INST, "").map(r => r.name), ["B"]);
  assert.deepEqual(boardFilter(rows, "兴银理财", "").map(r => r.name), ["C"]);
});
test("关键字命中名称 / 登记编码 / 产品代码 / 机构，且不区分大小写", () => {
  const rows = [row({ name: "理财通1号", code: "Z00024S24ABC", prodCode: "25112035B", inst: "招银理财", ikey: "招银理财" }),
    row({ name: "现金管家", code: "", prodCode: "", inst: "兴银理财", ikey: "兴银理财" })];
  assert.deepEqual(boardFilter(rows, "", "现金").map(r => r.name), ["现金管家"]);
  assert.deepEqual(boardFilter(rows, "", "abc").map(r => r.name), ["理财通1号"]);
  assert.deepEqual(boardFilter(rows, "", "25112035b").map(r => r.name), ["理财通1号"]);
  assert.deepEqual(boardFilter(rows, "", "兴银").map(r => r.name), ["现金管家"]);
  assert.deepEqual(boardFilter(rows, "", "   ").map(r => r.name), ["理财通1号", "现金管家"], "空白搜索等于不过滤");
});
test("机构 chips 按行数降序，未填机构也在表里", () => {
  const rows = [row({ ikey: "招银理财" }), row({ ikey: "招银理财" }),
    row({ ikey: NO_INST }), row({ ikey: "兴银理财" }), row({ ikey: "兴银理财" }), row({ ikey: "兴银理财" })];
  const chips = boardInstChips(rows);
  assert.deepEqual(chips.map(c => c.n), [3, 2, 1]);
  assert.equal(chips[2].label, "未填机构");
});

/* ---- 万收挂零判定 ---- */
test("挂零判定：容差与无效值", () => {
  assert.equal(isZeroWan(0), true);
  assert.equal(isZeroWan(1e-9), true, "浮点残差应视为 0");
  assert.equal(isZeroWan(0.01), false);
  assert.equal(isZeroWan(-0.01), false);
  assert.equal(isZeroWan(null), false, "没披露不是挂零");
  assert.equal(isZeroWan(undefined), false);
  assert.equal(isZeroWan(NaN), false);
});

/* ---- 月挂 0 数：只数本月有披露的日子 ---- */
test("月挂 0 数只统计本月披露日", () => {
  const dates = ["2026-09-30", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
  const wan = [null, 0, 0.45, 0, 0.52];
  assert.equal(monthZeroDays(dates, wan, "2026-10"), 2);
  assert.equal(monthZeroDays(dates, wan, "2026-09"), 0, "9/30 的 wan 是 null，不能算挂零");
});
test("月挂 0 数：跨年 12 月 / 1 月不串月", () => {
  const dates = ["2025-12-31", "2026-01-01", "2026-01-02"];
  const wan = [0, 0, 0.3];
  assert.equal(monthZeroDays(dates, wan, "2025-12"), 1);
  assert.equal(monthZeroDays(dates, wan, "2026-01"), 1);
});
test("月挂 0 数：脏入参不炸表", () => {
  assert.equal(monthZeroDays(null, null, "2026-10"), 0);
  assert.equal(monthZeroDays([], [], "2026-1"), 0, "月份格式不对返回 0");
  assert.equal(monthZeroDays(["2026-10-01"], [], "2026-10"), 0, "wan 比 dates 短也不越界");
});

/* ---- 排序：缺值永远垫底 ---- */
test("数值列降序：null 排最后，且不随升/降序翻转", () => {
  const rows = [row({ name: "有值", a7: 0.02 }), row({ name: "缺值", a7: null }), row({ name: "更高", a7: 0.05 })];
  assert.deepEqual(boardSort(rows, "a7", false).map(r => r.name), ["更高", "有值", "缺值"]);
  assert.deepEqual(boardSort(rows, "a7", true).map(r => r.name), ["有值", "更高", "缺值"],
    "升序时缺值仍然垫底，否则点一次排序就把一堆「—」顶到最前");
});
test("名称列用中文排序，产品名不会因大小写乱序", () => {
  const rows = [row({ name: "招银理财招睿" }), row({ name: "兴银理财稳添" }), row({ name: "现金管家" })];
  const out = boardSort(rows, "name", true).map(r => r.name);
  assert.equal(out.length, 3);
  assert.deepEqual(boardSort(rows, "name", false).map(r => r.name), [...out].reverse());
});
test("挂零列升序时 0 在前，同值按名称稳定", () => {
  const rows = [row({ name: "B", zero: 2 }), row({ name: "A", zero: 2 }), row({ name: "C", zero: 0 })];
  assert.deepEqual(boardSort(rows, "zero", true).map(r => r.name), ["C", "A", "B"]);
});
test("排序不改动入参数组（渲染会反复调，原地排会打乱上一轮结果）", () => {
  const rows = [row({ name: "A", holdDays: 1 }), row({ name: "B", holdDays: 9 })];
  boardSort(rows, "holdDays", false);
  assert.deepEqual(rows.map(r => r.name), ["A", "B"]);
});
test("缺列值按字符串比也不抛（holdDays 与 name 混型时）", () => {
  const rows = [row({ name: "A", holdDays: 3 }), row({ name: "B", holdDays: "10" })];
  const out = boardSort(rows, "holdDays", false);
  assert.equal(out.length, 2);
});
