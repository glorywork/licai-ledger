// @ts-check
/* 截图 OCR 的「日期 + 净值」配对。
   输入是识别出来的纯文本（本机处理，图片不上传），输出 "YYYY-MM-DD 净值" 行数组，
   由调用方再解析入库。放成纯函数是为了能脱离 DOM 单测。 */

/**
 * 从 OCR 文本里配对日期与净值。
 * @param {string} text
 * @returns {string[]} 形如 "2026-10-28 1.015553"
 */
export function ocrNavLines(text) {
  const lines = String(text || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  const dateRe = /(20\d{2})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})/;
  const dOf = s => {
    const m = s.match(dateRe);
    return m ? m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0") : "";
  };
  const nOf = s => {
    const a = [], re = /(?:^|[^\d.])(\d\.\d{3,8})(?![\d])/g; let m;
    while ((m = re.exec(s))) a.push(m[1]);
    return a;
  };
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const d = dOf(lines[i]);
    if (d) {
      let ns = nOf(lines[i]);
      if (!ns.length) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          if (dOf(lines[j])) break;
          ns = nOf(lines[j]);
          if (ns.length) break;
        }
      }
      if (ns.length) out.push(d + " " + ns[0]);
      continue;
    }
    const ns = nOf(lines[i]);
    if (ns.length && i > 0) {
      const pd = dOf(lines[i - 1]);
      if (pd) out.push(pd + " " + ns[0]);
    }
  }
  const seen = {};
  return out.filter(x => { if (seen[x]) return false; seen[x] = 1; return true; });
}