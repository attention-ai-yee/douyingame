/** 大数显示：1.2万 / 3.5亿 / 7.4兆 / 1.6京 …… 第 30 天之后战力和金币会到亿、兆级别。 */
const UNITS: [number, string][] = [
  [1e20, '垓'],
  [1e16, '京'],
  [1e12, '兆'],
  [1e8, '亿'],
  [1e4, '万'],
];

export function formatNumber(n: number): string {
  if (!isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  for (const [base, unit] of UNITS) {
    if (a >= base) {
      const v = a / base;
      const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      return sign + trimZeros(v.toFixed(digits)) + unit;
    }
  }
  return sign + Math.floor(a).toString();
}

function trimZeros(s: string): string {
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}

/** 毫秒 → "3小时25分" */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}分`;
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}
