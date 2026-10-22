/** FNV-1a 64-bit hash over the exact IEEE-754 bit patterns of a list of numbers. */
export function hashNumbers(values: readonly number[]): string {
  const buf = new DataView(new ArrayBuffer(8));
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const v of values) {
    buf.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) {
      h ^= BigInt(buf.getUint8(i));
      h = (h * prime) & mask;
    }
  }
  return h.toString(16).padStart(16, '0');
}
