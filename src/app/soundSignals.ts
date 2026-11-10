import type { VesselState } from '../sim/env/traffic';

/**
 * The river traffic's sound signals after the COLREGs (red team, 10 Nov 2026). A teaching aid, not an authoritative
 * statement of the rules; the rule text was checked against secondary copies (docs/SOURCES.md C1–C8).
 *
 *  - Rule 32: a short blast is about 1 s, a prolonged blast 4–6 s (here 1 s and 5 s).
 *  - Rule 35, in or near restricted visibility, at intervals of not more than 2 minutes (here 110 s):
 *    (a) a power-driven vessel making way: one prolonged blast;
 *    (b) a power-driven vessel under way but stopped: two prolonged blasts about 2 s apart;
 *    (c) a vessel restricted in her ability to manoeuvre, a sailing vessel, a vessel towing: one prolonged and two
 *        short (the Lower Ferry's tug and float, and the Higher Ferry: restricted, harbour guide p.33).
 *    A vessel of less than 12 m need not give these signals but must make some other efficient sound signal; that
 *    other signal is not modelled, so boats under 12 m are silent here.
 *  - Rule 34(a): a power-driven vessel in sight, altering course as the rules allow or require: one short blast
 *    "I am altering my course to starboard", two short "to port". Sounded by a marina boat as she begins to keep
 *    out of your way (Rule 18(a); src/sim/env/traffic.ts).
 *  - Rule 34(d): vessels in sight of one another, approaching, when one doubts the other is taking enough action to
 *    avoid collision: at least five short and rapid blasts. Here a vessel under way sounds it at you when you are on
 *    course to pass within a few metres of her in the next 20 s.
 *
 * What counts as restricted visibility is not a number in the rules; 2 km here is an estimate (E). Sound only (and a
 * caption): nothing here touches the simulation.
 */

export type Blast = 'short' | 'prolonged';

export interface SoundSignal {
  vesselId: string;
  label: string;
  blasts: Blast[];
  rule: string;
  meaning: string;
  n: number;
  e: number;
  lengthM: number;
}

export const SHORT_S = 1;
export const PROLONGED_S = 5;
/** Gap between blasts of one signal; "five short and rapid" closer together (s, E). */
export const GAP_S = 1;
export const RAPID_GAP_S = 0.4;
/** Fog signals: Rule 35's "not more than 2 minutes". */
export const FOG_INTERVAL_S = 110;
/** Below this visibility the traffic sounds Rule 35 signals (m, E). */
export const RESTRICTED_VISIBILITY_M = 2000;
/** Fog signals carry this far in the sim (m, E): a big ship's horn much further, but beyond it they only clutter. */
export const FOG_HEARD_M = 1500;
/** Doubt signal: how close a pass (beyond half her length) and how soon count (m, s). */
export const DOUBT_PASS_M = 8;
export const DOUBT_WITHIN_S = 20;
const DOUBT_AGAIN_S = 60;
const ALTER_AGAIN_S = 60;
/** The traffic that keeps out of a sailing boat's way (src/sim/env/traffic.ts: the marina boats). */
const GIVES_WAY = new Set<VesselState['kind']>(['motor-cruiser', 'yacht', 'rib']);

const POWER = new Set<VesselState['kind']>(['passenger-ferry', 'launch', 'river-cruiser', 'paddle-steamer', 'motor-cruiser', 'yacht', 'rib']);

/** The Rule 35 signal a vessel gives in restricted visibility, or none (berthed, or under 12 m). */
export function fogSignal(v: VesselState): Pick<SoundSignal, 'blasts' | 'rule' | 'meaning'> | undefined {
  if (v.phase === 'berthed' || v.length < 12) return undefined;
  if (v.ram || v.kind === 'tug-float' || v.kind === 'floating-bridge') {
    return { blasts: ['prolonged', 'short', 'short'], rule: 'Rule 35(c)', meaning: 'restricted in her ability to manoeuvre' };
  }
  if (!POWER.has(v.kind)) return undefined;
  if (v.moving && v.sog > 0.2) return { blasts: ['prolonged'], rule: 'Rule 35(a)', meaning: 'a power-driven vessel making way' };
  return { blasts: ['prolonged', 'prolonged'], rule: 'Rule 35(b)', meaning: 'a power-driven vessel under way but stopped' };
}

/** How long a signal lasts (s). */
export function signalDuration(blasts: readonly Blast[]): number {
  const rapid = blasts.length >= 5 && blasts.every((b) => b === 'short');
  const gap = rapid ? RAPID_GAP_S : GAP_S;
  return blasts.reduce((s, b) => s + (b === 'short' ? SHORT_S : PROLONGED_S), 0) + gap * Math.max(0, blasts.length - 1);
}

/** The signal in words: "one prolonged, two short". */
export function blastsInWords(blasts: readonly Blast[]): string {
  const words = ['', 'one', 'two', 'three', 'four', 'five'];
  const out: string[] = [];
  for (let i = 0; i < blasts.length; ) {
    let j = i;
    while (j < blasts.length && blasts[j] === blasts[i]) j++;
    out.push(`${words[j - i] ?? j - i} ${blasts[i]}`);
    i = j;
  }
  return out.join(', ');
}

/** A fixed offset per vessel (0–1), so the fleet does not all sound at once. */
function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Closest approach of you and a vessel, from now, on present courses: time (s) and distance (m). */
export function closestApproach(own: { n: number; e: number; vn: number; ve: number }, v: VesselState): { t: number; d: number } {
  const vn = v.sog * Math.cos(v.heading);
  const ve = v.sog * Math.sin(v.heading);
  const rn = v.n - own.n;
  const re = v.e - own.e;
  const wn = vn - own.vn;
  const we = ve - own.ve;
  const w2 = wn * wn + we * we;
  const t = w2 < 1e-6 ? 0 : -(rn * wn + re * we) / w2;
  return { t, d: Math.hypot(rn + wn * Math.max(0, t), re + we * Math.max(0, t)) };
}

export class SignalScheduler {
  private lastFog = new Map<string, number>();
  private lastDoubt = new Map<string, number>();
  private altering = new Map<string, { side: 1 | -1; t: number }>();

  /** Signals due at time t (s): fog signals when visibility is restricted, the doubt signal when you stand into danger. */
  update(t: number, vessels: readonly VesselState[], visibilityM: number, own: { n: number; e: number; vn: number; ve: number }): SoundSignal[] {
    const out: SoundSignal[] = [];
    const fog = visibilityM < RESTRICTED_VISIBILITY_M;
    for (const v of vessels) {
      const dist = Math.hypot(v.n - own.n, v.e - own.e);
      const base = { vesselId: v.id, label: v.label || v.name, n: v.n, e: v.e, lengthM: v.length };
      if (fog && dist < FOG_HEARD_M) {
        const f = fogSignal(v);
        if (f) {
          // Each vessel on her own beat: at t ≡ phase (mod interval), first heard within one interval.
          const slot = Math.floor(t / FOG_INTERVAL_S - phaseOf(v.id));
          if (slot !== this.lastFog.get(v.id)) {
            const first = !this.lastFog.has(v.id);
            this.lastFog.set(v.id, slot);
            if (!first) out.push({ ...base, ...f });
          }
        }
      } else this.lastFog.delete(v.id);
      // Rule 34(a): altering course (in sight), once as she begins (not again within a minute the same way).
      const last = this.altering.get(v.id);
      if (v.givingWay && !(last && last.side === v.givingWay && t - last.t < ALTER_AGAIN_S) && dist < visibilityM && dist < 400) {
        out.push({ ...base, blasts: v.givingWay > 0 ? ['short'] : ['short', 'short'], rule: 'Rule 34(a)', meaning: v.givingWay > 0 ? 'altering course to starboard, keeping out of your way' : 'altering course to port, keeping out of your way' });
      }
      if (v.givingWay && !(last && last.side === v.givingWay && t - last.t < ALTER_AGAIN_S)) this.altering.set(v.id, { side: v.givingWay, t });
      // Rule 34(d) is for vessels in sight of one another.
      // Not from a boat that is herself keeping out of your way (the marina boats): the ferries and the steamer stand on.
      if (!GIVES_WAY.has(v.kind) && v.moving && v.sog > 0.3 && dist < 150 && dist < visibilityM && t - (this.lastDoubt.get(v.id) ?? -Infinity) > DOUBT_AGAIN_S) {
        const c = closestApproach(own, v);
        if (c.t > 0 && c.t < DOUBT_WITHIN_S && c.d < v.length / 2 + DOUBT_PASS_M) {
          this.lastDoubt.set(v.id, t);
          out.push({ ...base, blasts: ['short', 'short', 'short', 'short', 'short'], rule: 'Rule 34(d)', meaning: 'in doubt that you are keeping clear' });
        }
      }
    }
    return out;
  }

  reset(): void {
    this.lastFog.clear();
    this.lastDoubt.clear();
    this.altering.clear();
  }
}
