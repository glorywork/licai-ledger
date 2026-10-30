// @ts-check
/* 删除墓碑：记录「谁在什么时候删了什么」，让整文件同步不会把已删数据带回来。
   纯函数，数据对象由调用方传入。

   为什么需要：
     云端同步是整文件 PUT。设备 A 删除产品后，设备 B 若还拿着旧快照推送，
     这次 PUT 就会把产品原样写回；同理 syncPush 的「云端独有净值并入」会把
     刚删掉的那天净值补回来。墓碑随 payload 上传，推送前先并合、再执行删除。

   为什么有有效期：
     墓碑 30 天后自动过期。用户删掉的可能是当时误录的净值，但官网日后也可能
     真正披露同一天的数据 —— 永久屏蔽会让这条真值永远收不进来。 */

/** @typedef {{ products?: Record<string, number>, trades?: Record<string, number>,
 *              navs?: Record<string, number> }} Tomb */
/** @typedef {{ products?: any[], trades?: any[], navHistory?: Record<string, any> }} TombData */

export const TOMB_KINDS = ["products", "trades", "navs"];

/**
 * 补齐三个字典，容忍缺字段 / 错误类型。直接在传入对象上补（调用方多半是 DATA）。
 * @param {any} o
 * @returns {Tomb}
 */
export function normTomb(o) {
  const t = (o && typeof o === "object") ? o : {};
  for (const k of TOMB_KINDS)
    if (!t[k] || typeof t[k] !== "object" || Array.isArray(t[k])) t[k] = {};
  return t;
}

/**
 * 把 from 并入 into，同一 key 取较新的时间戳（时钟不同的设备也能收敛）。
 * @param {Tomb} into
 * @param {any} from
 * @returns {Tomb}
 */
export function mergeTombs(into, from) {
  const a = normTomb(into), b = normTomb(from);
  for (const k of TOMB_KINDS) {
    const dst = a[k], src = b[k];
    for (const key of Object.keys(src)) {
      const ts = Number(src[key]);
      if (!Number.isFinite(ts)) continue;
      if (!(Number(dst[key]) >= ts)) dst[key] = ts;
    }
  }
  return a;
}

/**
 * 清理过期墓碑，返回清理条数。
 * @param {Tomb} tomb
 * @param {number} now 当前时间戳（ms）
 * @param {number} days 有效期天数
 */
export function purgeTombs(tomb, now, days) {
  const t = normTomb(tomb);
  const cut = now - days * 86400000;
  let n = 0;
  for (const k of TOMB_KINDS)
    for (const key of Object.keys(t[k]))
      if (!(Number(t[k][key]) >= cut)) { delete t[k][key]; n++; }
  return n;
}

/**
 * 按墓碑从 data 里删除产品 / 交易 / 净值日期，返回删除条数。
 * 净值墓碑的 key 是 "产品id|YYYY-MM-DD"。
 * @param {any} data
 * @param {any} tomb
 */
export function applyTombs(data, tomb) {
  if (!data) return 0;
  const t = normTomb(tomb);
  /* 只认有效时间戳：云端数据被手改坏（比如写成字符串）时不能顺着它删数据 */
  /** @param {Record<string, number>} m @param {string} k */
  const hit = (m, k) => {
    const v = m[k];
    return v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0;
  };
  let n = 0;

  if (Object.keys(t.products).length) {
    const before = (data.products || []).length;
    data.products = (data.products || []).filter((/** @type {any} */ p) => !hit(t.products, String(p.id)));
    n += before - data.products.length;
  }
  if (Object.keys(t.trades).length) {
    const before = (data.trades || []).length;
    data.trades = (data.trades || []).filter((/** @type {any} */ x) => !hit(t.trades, String(x.id)));
    n += before - data.trades.length;
  }
  if (Object.keys(t.navs).length) {
    /** @type {Map<string, Set<string>>} */
    const byPid = new Map();
    for (const key of Object.keys(t.navs)) {
      if (!hit(t.navs, key)) continue;
      const i = key.lastIndexOf("|");
      if (i < 0) continue;
      const pid = key.slice(0, i), date = key.slice(i + 1);
      if (!byPid.has(pid)) byPid.set(pid, new Set());
      byPid.get(pid).add(date);
    }
    for (const p of data.products || []) {
      const dates = byPid.get(String(p.id));
      if (!dates || !p.navHistory) continue;
      for (const date of dates)
        if (p.navHistory[date] !== undefined) { delete p.navHistory[date]; n++; }
    }
  }
  return n;
}
