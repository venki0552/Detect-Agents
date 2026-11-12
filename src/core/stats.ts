/** Small, dependency-free statistics helpers. */

export function mean(a: number[]): number {
  if (!a.length) return NaN;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

export function std(a: number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

/** Coefficient of variation (std / mean). */
export function cv(a: number[]): number {
  const m = mean(a);
  return m > 0 ? std(a) / m : NaN;
}

export function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Sample skewness (Fisher-Pearson, adjusted). */
export function skewness(a: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const m = mean(a);
  let m2 = 0, m3 = 0;
  for (const v of a) { const d = v - m; m2 += d * d; m3 += d * d * d; }
  m2 /= n; m3 /= n;
  if (m2 === 0) return 0;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
}

/** Sample excess kurtosis (0 for normal, -1.2 for uniform). */
export function excessKurtosis(a: number[]): number {
  const n = a.length;
  if (n < 4) return NaN;
  const m = mean(a);
  let m2 = 0, m4 = 0;
  for (const v of a) { const d = v - m; m2 += d * d; m4 += d ** 4; }
  m2 /= n; m4 /= n;
  if (m2 === 0) return 0;
  const g2 = m4 / (m2 * m2) - 3;
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function round(v: number, d = 2): number {
  if (!Number.isFinite(v)) return v;
  const p = 10 ** d;
  return Math.round(v * p) / p;
}
