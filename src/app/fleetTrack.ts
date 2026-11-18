/**
 * The whole fleet's tracks through a race, for the replay from above in the debrief (owner, 18 Nov 2026: "the whole
 * fleet's tracks on the map; a replay of the race from above"). Positions recorded once a second from the simulation
 * as it ran: a record, not a re-simulation. Kept in memory for the race only.
 */

export interface TrackBoat {
  id: string;
  label: string;
  colour: number;
  you: boolean;
}

export interface FleetPose {
  id: string;
  n: number;
  e: number;
  /** Compass heading (rad). */
  heading: number;
}

/** Samples kept at most: 90 minutes at one a second. Past it, every other sample is dropped and the spacing doubles. */
export const MAX_SAMPLES = 5400;

export class FleetTrack {
  private boatList: TrackBoat[] = [];
  private times: number[] = [];
  /** Per boat (in `boats` order): n, e, heading for each sample. */
  private n: number[][] = [];
  private e: number[][] = [];
  private h: number[][] = [];
  /** Take every `stride`-th sample offered (doubles each time the record is thinned). */
  private stride = 1;
  private offered = 0;

  constructor(private readonly max = MAX_SAMPLES) {}

  clear(): void {
    this.boatList = [];
    this.times = [];
    this.n = [];
    this.e = [];
    this.h = [];
    this.stride = 1;
    this.offered = 0;
  }

  /** The fleet at time `t` (s). The boats of the first sample are the fleet: a boat missing later keeps her last place. */
  add(t: number, boats: readonly (TrackBoat & FleetPose)[]): void {
    if (!this.boatList.length) {
      this.boatList = boats.map(({ id, label, colour, you }) => ({ id, label, colour, you }));
      this.n = boats.map(() => []);
      this.e = boats.map(() => []);
      this.h = boats.map(() => []);
    }
    if (this.offered++ % this.stride !== 0) return;
    this.times.push(t);
    this.boatList.forEach((b, i) => {
      const p = boats.find((x) => x.id === b.id);
      const last = this.n[i]!.length - 1;
      this.n[i]!.push(p ? p.n : (this.n[i]![last] ?? 0));
      this.e[i]!.push(p ? p.e : (this.e[i]![last] ?? 0));
      this.h[i]!.push(p ? p.heading : (this.h[i]![last] ?? 0));
    });
    if (this.times.length > this.max) this.thin();
  }

  private thin(): void {
    const keep = <T,>(a: T[]) => a.filter((_, i) => i % 2 === 0);
    this.times = keep(this.times);
    this.n = this.n.map(keep);
    this.e = this.e.map(keep);
    this.h = this.h.map(keep);
    this.stride *= 2;
  }

  get boats(): readonly TrackBoat[] {
    return this.boatList;
  }

  get length(): number {
    return this.times.length;
  }

  /** The first and last times recorded (s), or undefined when empty. */
  get span(): { from: number; to: number } | undefined {
    return this.times.length ? { from: this.times[0]!, to: this.times[this.times.length - 1]! } : undefined;
  }

  /** A boat's track as points [n, e], oldest first (the arrays are the record's own: do not change them). */
  track(i: number): { n: readonly number[]; e: readonly number[] } {
    return { n: this.n[i] ?? [], e: this.e[i] ?? [] };
  }

  /** Index of the last sample at or before `t` (0 when `t` is before the first). */
  indexAt(t: number): number {
    let lo = 0;
    let hi = this.times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.times[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Where every boat was at time `t`, between the samples either side (headings by the shorter way round). */
  at(t: number): FleetPose[] {
    if (!this.times.length) return [];
    const i = this.indexAt(t);
    const j = Math.min(this.times.length - 1, i + 1);
    const t0 = this.times[i]!;
    const t1 = this.times[j]!;
    const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
    return this.boatList.map((b, k) => {
      const h0 = this.h[k]![i]!;
      const dh = Math.atan2(Math.sin(this.h[k]![j]! - h0), Math.cos(this.h[k]![j]! - h0));
      return { id: b.id, n: this.n[k]![i]! + (this.n[k]![j]! - this.n[k]![i]!) * f, e: this.e[k]![i]! + (this.e[k]![j]! - this.e[k]![i]!) * f, heading: h0 + dh * f };
    });
  }
}
