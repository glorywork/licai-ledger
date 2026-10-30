/* 删除墓碑回归测试：node --test tests/tomb.test.mjs
   守的是「删了又被同步带回来」这条会让人反复删、还删不干净的路：
     · 产品 / 交易 / 净值日期都能被墓碑清掉
     · 多设备墓碑合并取较新时间，过期自动失效
     · 空 / 损坏的墓碑不误删 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normTomb, mergeTombs, purgeTombs, applyTombs } from "../js/domain/tomb.js";

const now = 1_800_000_000_000;

test("墓碑能删掉产品、交易与该产品的净值日期", () => {
  const data = {
    products: [
      { id: "p1", navHistory: { "2026-10-28": 1.01, "2026-10-29": 1.02 } },
      { id: "p2", navHistory: { "2026-10-28": 1.03 } },
    ],
    trades: [{ id: "t1", prodId: "p1" }, { id: "t2", prodId: "p2" }],
  };
  const tomb = {
    products: { p2: now },
    trades: { t2: now },
    navs: { "p1|2026-10-29": now },
  };
  const n = applyTombs(data, tomb);
  assert.equal(n, 3, "1 个产品 + 1 笔交易 + 1 条净值");
  assert.deepEqual(data.products.map(p => p.id), ["p1"]);
  assert.deepEqual(data.trades.map(t => t.id), ["t1"]);
  assert.deepEqual(Object.keys(data.products[0].navHistory), ["2026-10-28"], "只删墓碑点名的那一天");
});

test("没有墓碑 / 墓碑为空时不改数据", () => {
  const data = { products: [{ id: "p1", navHistory: {} }], trades: [] };
  assert.equal(applyTombs(data, {}), 0);
  assert.equal(applyTombs(data, { products: {}, trades: {}, navs: {} }), 0);
  assert.equal(applyTombs(data, null), 0);
  assert.equal(data.products.length, 1);
});

test("多设备墓碑并合：同一 key 取较新的时间戳", () => {
  const a = normTomb({ products: { p1: 100 }, navs: { "p1|2026-10-01": 500 } });
  mergeTombs(a, { products: { p1: 300, p2: 200 }, trades: { t1: 100 } });
  assert.equal(a.products.p1, 300);
  assert.equal(a.products.p2, 200);
  assert.equal(a.trades.t1, 100);
  assert.equal(a.navs["p1|2026-10-01"], 500);
  /* 反过来（旧墓碑）不能覆盖新时间 */
  mergeTombs(a, { products: { p1: 50 } });
  assert.equal(a.products.p1, 300);
});

test("过期墓碑自动清理，未过期的保留", () => {
  const tomb = normTomb({
    products: { fresh: now - 86400000, old: now - 40 * 86400000 },
    navs: { "p1|2026-10-01": now - 31 * 86400000 },
  });
  assert.equal(purgeTombs(tomb, now, 30), 2);
  assert.deepEqual(Object.keys(tomb.products), ["fresh"]);
  assert.deepEqual(Object.keys(tomb.navs), []);
});

test("损坏的墓碑（数组 / 字符串 / 非数字时间）不误删", () => {
  const data = { products: [{ id: "p1", navHistory: { "2026-10-28": 1 } }], trades: [] };
  const tomb = { products: [{ id: "p1" }], trades: "oops", navs: { "p1|2026-10-28": "昨天" } };
  assert.equal(applyTombs(data, tomb), 0, "非数字时间戳被忽略");
  assert.equal(data.products.length, 1);
});
