import { clearAstern, type RulesBoat } from './rules';
import type { Vec } from './hull';

/**
 * Rule 18, Mark-Room: a SIMPLIFIED version, NOT an authoritative adjudication (package F, review #26).
 *
 * The World Sailing text of the Racing Rules of Sailing 2025–2028 could not be downloaded here (the host is refused),
 * so this follows secondary copies quoted in web-search excerpts (docs/SOURCES.md RR11; issue 32):
 *
 *  - Zone: "the area around a mark within a distance of three hull lengths of the boat nearer to it. A boat is in the
 *    zone when any part of her hull is in the zone."
 *  - 18.1(a): rule 18 applies between boats required to leave a mark on the same side when at least one is in the
 *    zone; it does not apply between boats on opposite tacks on a beat to windward, between a boat approaching a mark
 *    and one leaving it (here: boats bound for different marks), [nor when the proper course at the mark for one but
 *    not both is to tack, nor at a continuing obstruction: not modelled].
 *  - 18.2(a): when the first of two boats reaches the zone, if they are overlapped the outside boat at that moment
 *    shall give the inside boat mark-room; if not, the boat that has not reached the zone shall give the other
 *    mark-room.
 *  - 18.2(b): rule 18.2(a) no longer applies when the boat entitled to mark-room passes head to wind or leaves the
 *    zone; 18.1(b): rule 18 no longer applies when mark-room has been given (here: when the entitled boat has rounded
 *    the mark, bound for the next one).
 *
 * Not modelled: 18.2(c) (overlaps after 18.2(a) ends), 18.2(d) (an inside overlap from clear astern or by tacking
 * when the outside boat cannot give room), 18.2(e) (reasonable doubt), 18.3 (tacking in the zone), 18.4 (gybing),
 * exoneration (rule 43 in the current rules, formerly rule 21: here the entitled boat is simply not blamed), and what "mark-room" is in each
 * case (the boat owing it is held at fault for any contact while the entitlement lasts).
 */

/** Zone radius: three hull lengths of the boat nearer the mark (the definition in the 2025–2028 rules). */
export const ZONE_HULL_LENGTHS = 3;

export interface MarkRoomBoat extends RulesBoat {
  /** The mark she must leave next, its key (leg and mark: the same key means the same mark on the same leg). */
  markKey?: string;
  mark?: Vec;
  rounding?: 'port' | 'starboard';
  /** Hull length (m). */
  length: number;
}

export interface Entitlement {
  /** Boat entitled to mark-room, and the boat that must give it. */
  entitled: string;
  giver: string;
  markKey: string;
  since: number;
  /** Why: overlapped (inside/outside) or not (who reached the zone first). */
  reason: 'overlapped' | 'reached-first';
}

/** Distance from a point to a convex outline (0 inside it). */
export function distanceToOutline(p: Vec, outline: readonly Vec[]): number {
  let best = Infinity;
  let pos = false;
  let neg = false;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const abN = b.n - a.n;
    const abE = b.e - a.e;
    const len2 = abN * abN + abE * abE || 1e-12;
    const t = Math.max(0, Math.min(1, ((p.n - a.n) * abN + (p.e - a.e) * abE) / len2));
    const dN = p.n - (a.n + t * abN);
    const dE = p.e - (a.e + t * abE);
    best = Math.min(best, Math.hypot(dN, dE));
    // Inside a convex outline the point is on the same side of every edge, whichever way the outline winds.
    const cross = abN * (p.e - a.e) - abE * (p.n - a.n);
    if (cross > 0) pos = true;
    else if (cross < 0) neg = true;
  }
  return pos && neg ? best : 0;
}

/** On a beat to windward: within 80° of the true wind (close-hauled with some margin; E). */
const beating = (b: RulesBoat) => Math.abs(b.twa) < (80 * Math.PI) / 180;

/** Whether rule 18 can apply between two boats now: the same mark, the same side, and not opposite tacks on a beat. */
export function rule18Applies(a: MarkRoomBoat, b: MarkRoomBoat): boolean {
  if (!a.markKey || a.markKey !== b.markKey || !a.mark || a.rounding !== b.rounding) return false;
  if (a.tack !== b.tack && beating(a) && beating(b)) return false;
  return true;
}

/** Overlap as the definition has it for rule 18 (it applies on opposite tacks too when rule 18 applies). */
export function overlappedForMark(a: RulesBoat, b: RulesBoat): boolean {
  return !clearAstern(a, b) && !clearAstern(b, a);
}

const PAIR = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Tracks who is entitled to mark-room in each pair, from the moment the first of them reaches the zone (18.2(a)) until
 * the entitled boat leaves the zone, passes head to wind, or rounds the mark (18.2(b), 18.1(b)).
 */
export class MarkRoomTracker {
  private readonly entitlements = new Map<string, Entitlement>();
  private readonly inZone = new Map<string, boolean>();

  update(t: number, boats: readonly MarkRoomBoat[]): void {
    const zoneOf = new Map<string, number>();
    for (const b of boats) if (b.mark) zoneOf.set(b.id, distanceToOutline(b.mark, b.outline));
    for (let i = 0; i < boats.length; i++) {
      for (let j = i + 1; j < boats.length; j++) {
        const a = boats[i]!;
        const b = boats[j]!;
        const key = PAIR(a.id, b.id);
        const had = this.entitlements.get(key);
        if (!rule18Applies(a, b)) {
          if (had) this.entitlements.delete(key);
          this.inZone.delete(key);
          continue;
        }
        const da = zoneOf.get(a.id)!;
        const db = zoneOf.get(b.id)!;
        // The zone is three hull lengths of the boat nearer the mark.
        const radius = ZONE_HULL_LENGTHS * (da <= db ? a.length : b.length);
        const aIn = da <= radius;
        const bIn = db <= radius;
        const wasIn = this.inZone.get(key) ?? false;
        this.inZone.set(key, aIn || bIn);
        if (had) {
          const ent = had.entitled === a.id ? a : b;
          const entIn = ent === a ? aIn : bIn;
          if (!entIn || ent.tacking || had.markKey !== ent.markKey) this.entitlements.delete(key);
          continue;
        }
        if (wasIn || !(aIn || bIn)) continue;
        // The first of them has just reached the zone: decide who is entitled now, for as long as 18.2(a) applies.
        if (overlappedForMark(a, b)) {
          const inside = da <= db ? a : b;
          const outside = inside === a ? b : a;
          this.entitlements.set(key, { entitled: inside.id, giver: outside.id, markKey: a.markKey!, since: t, reason: 'overlapped' });
        } else {
          const first = aIn && bIn ? (da <= db ? a : b) : aIn ? a : b;
          const other = first === a ? b : a;
          this.entitlements.set(key, { entitled: first.id, giver: other.id, markKey: a.markKey!, since: t, reason: 'reached-first' });
        }
      }
    }
  }

  /** Who is entitled to mark-room between two boats now, if rule 18.2(a) applies between them. */
  entitlement(a: string, b: string): Entitlement | undefined {
    return this.entitlements.get(PAIR(a, b));
  }
}

/**
 * The note on a contact while one boat owed the other mark-room, with rule 18's penalties switched off (the default
 * until the club has reviewed the rule; fixes of 21 Nov 2026, §2.2): who should have given room, and that no penalty
 * was applied for it.
 */
export function markRoomAdvisory(giver: string): string {
  return `Rule 18 (simplified, advisory): ${giver} should have given mark-room. No penalty applied until the club has reviewed this rule.`;
}

/** The ruling text for a contact between two boats while one is entitled to mark-room (simplified rule 18.2). */
export function markRoomRuling(e: Entitlement, names: (id: string) => string): { atFault: string; rule: string; reason: string; notes: string[] } {
  return {
    atFault: e.giver,
    rule: '18.2',
    reason:
      e.reason === 'overlapped'
        ? `${names(e.giver)} was outside when the first of them reached the zone and did not give ${names(e.entitled)} mark-room`
        : `${names(e.entitled)} reached the zone first, clear ahead, and ${names(e.giver)} did not give her mark-room`,
    notes: [
      'Rule 18 here is simplified, not authoritative: the zone (three hull lengths) and who must give mark-room are judged; what mark-room was needed, 18.2(c)–(e), 18.3, 18.4 and exoneration (rule 43) are not.',
    ],
  };
}
