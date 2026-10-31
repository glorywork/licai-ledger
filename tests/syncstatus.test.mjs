/* 同步状态显示口径（v46）：
     node --test tests/syncstatus.test.mjs
   界面文案本身不重要，重要的是「什么时候必须说没推上去」。这几条测试锁的是
   会骗人的那几种组合，而不是字数。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { relAge, ago, syncBadge, syncLine } from "../js/domain/syncstatus.js";

const NOW = 1_800_000_000_000;   /* 固定基准，避免测试跟着真实时钟漂 */

test("relAge 的量级边界", () => {
  assert.equal(relAge(0), "刚刚");
  assert.equal(relAge(3000), "刚刚");
  assert.equal(relAge(4000), "4 秒");
  assert.equal(relAge(59_999), "59 秒");
  assert.equal(relAge(60_000), "1 分");
  assert.equal(relAge(3_600_000), "1 小时");
  assert.equal(relAge(86_400_000), "1 天");
  assert.equal(relAge(-5000), "刚刚");   /* 时钟回拨不该显示「-5 秒」 */
});

test("ago：刚刚不加「前」，其余加", () => {
  assert.equal(ago(1000), "刚刚");
  assert.equal(ago(30_000), "30 秒前");
  assert.equal(ago(120_000), "2 分前");
});

test("顶栏：未配置就只说未连接", () => {
  assert.deepEqual(syncBadge({ cfgOk: false, now: NOW }), { text: "未连接", cls: "" });
  /* 没配置时哪怕有 dirtyAt 也不该报「待推送」——推不上去的原因是没连接，
     报待推送会让人去点一个必然失败的按钮 */
  assert.equal(syncBadge({ cfgOk: false, dirtyAt: NOW - 1000, now: NOW }).text, "未连接");
});

test("顶栏：有改动待推送时报 warn，并带上多久没推", () => {
  const b = syncBadge({ cfgOk: true, dirtyAt: NOW - 40_000, pushAt: NOW - 3_600_000, now: NOW });
  assert.deepEqual(b, { text: "待推送 · 40 秒前", cls: "warn" });
});

test("顶栏：dirtyAt 与 pushAt 同时存在时一律报未推送（安全口径）", () => {
  /* 正常时序是推成功后又改了一笔（dirtyAt 更新）；
     反常时序（pushAt 反而更新）也必须报未推送：把「已同步」显示错等于
     放用户去卸载，把「待推送」显示错只是多点一次按钮。 */
  assert.equal(syncBadge({ cfgOk: true, dirtyAt: NOW - 5000, pushAt: NOW - 1000, now: NOW }).cls, "warn");
  assert.match(syncBadge({ cfgOk: true, dirtyAt: NOW - 5000, pushAt: NOW - 1000, now: NOW }).text, /^待推送/);
});

test("顶栏：失败过就不报中性的待推送", () => {
  const b = syncBadge({ cfgOk: true, dirtyAt: NOW - 60_000, err: "HTTP 409", now: NOW });
  assert.deepEqual(b, { text: "推送失败", cls: "bad" });
});

test("顶栏：干净时报最近一次成功推送", () => {
  assert.deepEqual(syncBadge({ cfgOk: true, pushAt: NOW - 7_200_000, now: NOW }),
    { text: "已同步 · 2 小时前", cls: "ok" });
  /* 刚配好、一次都没推过：不要谎报「已同步」 */
  assert.deepEqual(syncBadge({ cfgOk: true, now: NOW }), { text: "已连接", cls: "" });
});

test("设置页：待推送且没失败 → 明确告诉用户不用管", () => {
  const s = syncLine({ cfgOk: true, dirtyAt: NOW - 30_000, now: NOW });
  assert.match(s, /还没推上去/);
  assert.match(s, /不用管/);
  assert.doesNotMatch(s, /失败/);
});

test("设置页：重试排期中要给出时间与第几次", () => {
  const s = syncLine({ cfgOk: true, dirtyAt: NOW - 20_000, err: "HTTP 502", nextAt: NOW + 15_000, retryN: 1, maxRetry: 3, now: NOW });
  assert.match(s, /HTTP 502/);
  assert.match(s, /15 秒后自动重试/);
  /* retryN 已经是「排期中这一发的序号」（scheduleRetry 先自增再排期），不许再 +1 */
  assert.match(s, /第 1\/3 次/);
});

test("设置页：自动重试用完必须交出主动权，不许继续演「马上就好」", () => {
  const s = syncLine({ cfgOk: true, dirtyAt: NOW - 600_000, err: "HTTP 401", retryN: 3, maxRetry: 3, now: NOW });
  assert.match(s, /自动重试已用完/);
  assert.match(s, /推送到云端/);
  assert.doesNotMatch(s, /后自动重试/);
});

test("设置页：本机已干净时说清最后一次成功推送", () => {
  assert.match(syncLine({ cfgOk: true, pushAt: NOW - 120_000, now: NOW }), /都已推上去了（最后一次推送：2 分前）/);
  assert.match(syncLine({ cfgOk: true, now: NOW }), /这次运行还没推过/);
});
