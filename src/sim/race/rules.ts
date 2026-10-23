import { DEG, wrapPi } from '../math/angles';
import type { Vec } from './hull';

/**
 * A SMALL, SIMPLIFIED subset of the Racing Rules of Sailing 2025–2028, Part 2 (When Boats Meet), plus rule 31
 * and the penalty turns of rule 44. NOT an authoritative adjudication system: it does not hold hearings,
 * weigh evidence, or apply rules 15, 16, 17, 18–24 except as noted. Rule text was checked against secondary
 * copies only (docs/RACING.md, SOURCES RR5–RR9); the club's sailing instructions are not available.
 *
 * Definitions used (as quoted by those copies):
 *  - Tack: a boat is on the tack, starboard or port, corresponding to her windward side. Her leeward side is
 *    the side away from the wind or, when head to wind, the side that was; when sailing by the lee or directly
 *    downwind, the side on which her mainsail lies. "Wind" here is the true wind over the water.
 *  - Clear astern / clear ahead / overlap: judged on the hull outline (equipment in normal position is not
 *    modelled) against a line abeam from the other boat's aftermost point; applied to boats on the same tack.
 *  - Leeward / windward: of two overlapped boats on the same tack, the one on the other's leeward side.
 * Rules: 13 (while tacking: from passing head to wind until on a close-hauled course, keep clear; rules 10–12
 * do not apply), 10 (opposite tacks: port keeps clear), 11 (same tack, overlapped: windward keeps clear),
 * 12 (same tack, not overlapped: clear astern keeps clear), 14 (avoid contact if reasonably possible: noted
 * for both boats, not adjudicated), 31 (touching a mark: One-Turn Penalty, rule 44.1), 44.2 (each turn in the
 * same direction, including one tack and one gybe; "promptly" and "well clear" are not checked).
 */
export type Tack = 'starboard' | 'port';

export interface RulesBoat {
  id: string;
  n: number;
  e: number;
  heading: number;
  /** True wind angle over the water, (−π, π], > 0 = wind from starboard. */
  twa: number;
  /** Side the mainsail is set on: +1 = to port (starboard tack when sailing normally). */
  mainSide: 1 | -1;
  tack: Tack;
  tacking: boolean;
  /** World outline (convex, clockwise). */
  outline: Vec[];
}

/** Tack from the definitions (with the previous tack used while head to wind). */
export function tackOf(twa: number, mainSide: 1 | -1, prev: Tack): Tack {
  const a = Math.abs(twa);
  if (a < 1e-6) return prev;
  const byTheLee = a > 90 * DEG && Math.sign(twa) !== mainSide;
  if (a > 170 * DEG || byTheLee) return mainSide > 0 ? 'starboard' : 'port';
  return twa > 0 ? 'starboard' : 'port';
}

/** Body-frame x (forward) of a world point relative to a boat. */
function along(b: { n: number; e: number; heading: number }, p: Vec): number {
  return (p.n - b.n) * Math.cos(b.heading) + (p.e - b.e) * Math.sin(b.heading);
}

/** Is `a` clear astern of `b` (all of a's outline behind the line abeam from b's aftermost point)? */
export function clearAstern(a: RulesBoat, b: RulesBoat): boolean {
  let aft = Infinity;
  for (const p of b.outline) aft = Math.min(aft, along(b, p));
  for (const p of a.outline) if (along(b, p) >= aft) return false;
  return true;
}

export function overlapped(a: RulesBoat, b: RulesBoat): boolean {
  return !clearAstern(a, b) && !clearAstern(b, a);
}

/** Of two overlapped boats on the same tack, is `a` the leeward boat? */
export function isLeeward(a: RulesBoat, b: RulesBoat): boolean {
  // b's leeward side: port (negative body y) for a starboard-tack boat.
  const lee = b.tack === 'starboard' ? -1 : 1;
  const yA = -(a.n - b.n) * Math.sin(b.heading) + (a.e - b.e) * Math.cos(b.heading);
  const leeA = a.tack === 'starboard' ? -1 : 1;
  const yB = -(b.n - a.n) * Math.sin(a.heading) + (b.e - a.e) * Math.cos(a.heading);
  const fromB = Math.sign(yA) === lee;
  const fromA = Math.sign(yB) !== leeA; // b is on a's windward side
  if (fromB === fromA) return fromB;
  // Inconsistent (crossing at an angle): the boat further downwind is the leeward boat.
  const downN = -Math.cos(b.heading + b.twa);
  const downE = -Math.sin(b.heading + b.twa);
  return (a.n - b.n) * downN + (a.e - b.e) * downE > 0;
}

export interface RightOfWay {
  keepClear: string;
  rightOfWay: string;
  rule: '10' | '11' | '12' | '13';
  reason: string;
}

/** Which boat must keep clear, by rules 13, 10, 11 and 12. */
export function rightOfWay(a: RulesBoat, b: RulesBoat): RightOfWay {
  const ka = (rule: RightOfWay['rule'], reason: string): RightOfWay => ({ keepClear: a.id, rightOfWay: b.id, rule, reason });
  const kb = (rule: RightOfWay['rule'], reason: string): RightOfWay => ({ keepClear: b.id, rightOfWay: a.id, rule, reason });
  if (a.tacking !== b.tacking) return a.tacking ? ka('13', 'tacking (past head to wind, not yet close-hauled)') : kb('13', 'tacking (past head to wind, not yet close-hauled)');
  if (a.tacking && b.tacking) {
    // Both tacking: the one on the other's port side, or the one astern, keeps clear (wording not verified for 2025–2028).
    const yA = -(a.n - b.n) * Math.sin(b.heading) + (a.e - b.e) * Math.cos(b.heading);
    return yA < 0 ? ka('13', "both tacking: on the other's port side") : kb('13', "both tacking: on the other's port side");
  }
  if (a.tack !== b.tack) return a.tack === 'port' ? ka('10', 'port tack, opposite tacks') : kb('10', 'port tack, opposite tacks');
  if (overlapped(a, b)) return isLeeward(a, b) ? kb('11', 'windward boat, overlapped on the same tack') : ka('11', 'windward boat, overlapped on the same tack');
  return clearAstern(a, b) ? ka('12', 'clear astern on the same tack') : kb('12', 'clear astern on the same tack');
}

/** Rule 13 state per boat: tacking from passing head to wind until close-hauled. */
export class TackTracker {
  tack: Tack;
  tacking = false;
  private lastTwa: number;

  constructor(twa: number, mainSide: 1 | -1) {
    this.tack = tackOf(twa, mainSide, twa >= 0 ? 'starboard' : 'port');
    this.lastTwa = twa;
  }

  /** `closeHauled` = the boat's close-hauled TWA (rad, positive) at this wind speed. */
  update(twa: number, mainSide: 1 | -1, closeHauled: number): void {
    const passedHeadToWind = Math.sign(twa) !== Math.sign(this.lastTwa) && Math.abs(twa) < 90 * DEG && Math.abs(this.lastTwa) < 90 * DEG;
    if (passedHeadToWind) this.tacking = true;
    if (this.tacking && Math.abs(twa) >= closeHauled - 3 * DEG) this.tacking = false;
    this.tack = tackOf(twa, mainSide, this.tack);
    this.lastTwa = twa;
  }
}

/**
 * Penalty turns (rule 44.2): the required number of turns in the same direction, each including one tack and
 * one gybe. A turn is counted when the heading has gone 360° round in one direction since the last counted
 * turn and both a tack and a gybe happened in it. Turning back by more than 45° restarts the turn in progress.
 */
export class PenaltyTracker {
  required: number;
  done = 0;
  private sweep = 0;
  private dir = 0;
  private tack = false;
  private gybe = false;
  private lastHeading: number;
  private lastTwa: number;

  constructor(required: number, heading: number, twa: number) {
    this.required = required;
    this.lastHeading = heading;
    this.lastTwa = twa;
  }

  get complete(): boolean {
    return this.done >= this.required;
  }

  /** Fraction of the current turn done (0…1), for display. */
  get progress(): number {
    return Math.min(1, Math.abs(this.sweep) / (2 * Math.PI));
  }

  update(heading: number, twa: number): void {
    const d = wrapPi(heading - this.lastHeading);
    this.lastHeading = heading;
    if (Math.sign(twa) !== Math.sign(this.lastTwa)) {
      if (Math.abs(twa) < 90 * DEG && Math.abs(this.lastTwa) < 90 * DEG) this.tack = true;
      else if (Math.abs(twa) > 90 * DEG && Math.abs(this.lastTwa) > 90 * DEG) this.gybe = true;
    }
    this.lastTwa = twa;
    if (this.complete) return;
    if (this.dir === 0 && Math.abs(d) > 0) this.dir = Math.sign(d);
    this.sweep += d;
    if (this.dir !== 0 && this.sweep * this.dir < -45 * DEG) {
      // Turned back: start again in the new direction.
      this.dir = -this.dir;
      this.sweep = 0;
      this.tack = false;
      this.gybe = false;
    }
    if (Math.abs(this.sweep) >= 2 * Math.PI && this.tack && this.gybe) {
      this.done += 1;
      this.sweep -= this.dir * 2 * Math.PI;
      this.tack = false;
      this.gybe = false;
    }
  }
}

export type IncidentKind = 'boat' | 'mark' | 'moored' | 'ferry';

export interface Incident {
  t: number;
  kind: IncidentKind;
  /** Boats involved (one for marks and other objects). */
  boats: string[];
  /** Boat that broke a rule, if the subset can tell. */
  atFault?: string;
  rule?: string;
  summary: string;
  /** Things the simplified judge does not decide (rules 14, 15, 16 …). */
  notes: string[];
  /** Penalty the at-fault boat may take (turns), and whether she took it. */
  penaltyTurns?: number;
  penaltyTaken?: boolean;
  penaltyTakenAt?: number;
}
