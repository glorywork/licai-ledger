// @ts-check
/* 净值序列的读取与「取某日净值」的统一口径。
   纯函数：不读全局 DATA，产品对象由调用方传入。 */

/**
 * @typedef {{ navHistory?: Record<string, number | string> } & Record<string, any>} NavProduct
 * @typedef {[string, number]} NavPoint
 */

/**
 * 产品按日期升序的净值序列。
 * @param {NavProduct} p
 * @returns {NavPoint[]}
 */
export function navSeries(p) {
  return Object.keys(p.navHistory || {}).sort().map(d => [d, Number(p.navHistory[d])]);
}

/**
 * 某日净值（原始值，可能 undefined）。
 * @param {NavProduct} p
 * @param {string} date
 */
export function navAt(p, date) { return p.navHistory ? p.navHistory[date] : undefined; }

/**
 * 取 <= date 的最近一个净值。
 * @param {NavProduct} p
 * @param {string} date
 * @returns {NavPoint | null}
 */
export function navOnOrBefore(p, date) {
  const s = navSeries(p);
  /** @type {NavPoint | null} */
  let r = null;
  for (const [d, v] of s) { if (d <= date) r = [d, v]; else break; }
  return r;
}

/**
 * 最新净值。
 * @param {NavProduct} p
 * @returns {NavPoint | null}
 */
export function latestNav(p) { const s = navSeries(p); return s.length ? s[s.length - 1] : null; }

/* 统一「当天命中 → 否则向前取最近」的取值：始终返回 [日期, 净值] 或 null。
   ⚠️ 不要写成 `navAt(p,d) || navOnOrBefore(p,d)`：navAt 命中时返回的是「数字」，
   navOnOrBefore 返回的是「数组」，|| 短路会让调用方拿到两种类型 ——
   命中路径下 hit[1] 取到 undefined，Number(undefined) = NaN，
   再被下游 `nav > 0` 之类的守卫静默退化成 0，表现为「净值栏被清空 / 份额算成 0」。 */
/**
 * @param {NavProduct} p
 * @param {string} date
 * @returns {NavPoint | null}
 */
export function navHit(p, date) {
  const v = navAt(p, date);
  if (v !== undefined && v !== null && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return [date, n];
  }
  return navOnOrBefore(p, date);
}