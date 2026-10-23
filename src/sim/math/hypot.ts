/**
 * √(x² + y²), computed exactly as V8 computes Math.hypot(x, y) (scaled by the larger magnitude), so results
 * are bit-identical to Math.hypot in Node and Chromium (checked against it in tests/sim/units.test.ts).
 * Unlike the variadic builtin it allocates nothing, which matters in the physics inner loop.
 */
export function hypot2(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (ax !== ax || ay !== ay) return NaN;
  const max = ax > ay ? ax : ay;
  if (max === 0) return 0;
  const a = ax / max;
  const b = ay / max;
  // V8 Kahan-sums the squares; with two terms the compensation after the first is exactly zero.
  return Math.sqrt(a * a + b * b) * max;
}
