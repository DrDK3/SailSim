/** Piecewise-linear interpolation in a table of [x, y] rows sorted by x; linear extrapolation at both ends. */
export function interpTable(table: readonly (readonly [number, number])[], x: number): number {
  const n = table.length;
  if (n === 0) throw new Error('empty table');
  if (n === 1) return table[0]![1];
  let i = 0;
  if (x <= table[0]![0]) i = 0;
  else if (x >= table[n - 1]![0]) i = n - 2;
  else while (i < n - 2 && x > table[i + 1]![0]) i++;
  const [x0, y0] = table[i]!;
  const [x1, y1] = table[i + 1]!;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}
