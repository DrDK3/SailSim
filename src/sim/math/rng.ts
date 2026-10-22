/**
 * Seeded PRNG (mulberry32). All randomness in the simulation must come from here so that the same
 * seed and inputs always reproduce the same run.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Current internal state, for snapshots and replays. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state: () => s,
  };
}
