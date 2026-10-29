// @ts-check
/* 通用工具：日期/金额格式化、转义、Toast。
   这里只放「不依赖 DATA/SYNC 等全局状态」的纯函数，方便单独测、也避免拆模块时成环。 */

/**
 * 取元素。找不到返回 null —— 调用方大多直接取属性，所以保留原来的宽松签名。
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export const $ = (id) => /** @type {HTMLElement | null} */ (document.getElementById(id));

/** @param {number} n */
export const pad = (n) => String(n).padStart(2, "0");

/**
 * Date → "YYYY-MM-DD"（本地时区，刻意不用 toISOString：那是 UTC，跨零点会差一天）
 * @param {Date} d
 */
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** @param {string} s */
export const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const today = () => fmtDate(new Date());

/**
 * 金额格式化。
 * ⚠️ 必须先把入参转成数字：历史数据或手工改过的 licai-data.json 里 amount 可能是
 * undefined/null，直接 .toLocaleString 会抛异常并把整个列表渲染打断（页面白屏）。
 * @param {unknown} n
 */
export const money = (n) => {
  const v = Number(n) || 0;
  return (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** @param {number} n */
export const signMoney = (n) => (n > 0 ? "+" : n < 0 ? "-" : "") + money(Math.abs(n));

/** @param {number} n */
export const pct = (n) => (n * 100).toFixed(2) + "%";

/** @param {number} n */
export const cls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "muted");

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** @param {unknown} s */
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[/** @type {keyof any} */ (c)]));

/**
 * 轻提示。
 * @param {string} msg
 * @param {number} [ms]
 */
export function toast(msg, ms = 2000) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  /* @ts-expect-error 自定义字段挂在 DOM 上，避免每次建对象 */
  clearTimeout(t._tm);
  /* @ts-expect-error 同上 */
  t._tm = setTimeout(() => t.classList.remove("show"), ms);
}

/**
 * 两个 "YYYY-MM-DD" 相差的自然日数。
 * @param {string} a
 * @param {string} b
 */
export function dayDiff(a, b) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}