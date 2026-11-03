/**
 * Guidance for a boat on the course side of the line at her starting signal (review UX-6). She must sail back
 * until her hull is completely on the pre-start side, then start (RRS 28.1, 29.1; the definition of Start). Going
 * round either end of the line is the usual way back. This is guidance, not an adjudication: the race committee's
 * judgement is the simulator's (src/sim/race/committee.ts).
 */
export interface OcsGuide {
  /** The nearer end of the starting line ("the committee boat", "the pin", a mark's name). */
  end: string;
  distanceM: number;
  /** Where that end is from the bow, in degrees: negative to port, positive to starboard. */
  relDeg: number;
  /** The same in words ("astern", "40° to port"). */
  direction: string;
  /** Seconds since the starting signal. */
  sinceStartS: number;
  /** Rule 29.1: flag X comes down four minutes after the start at the latest; she may still come back and start. */
  recallFlagDown: boolean;
}

export function directionWords(relDeg: number): string {
  const a = Math.abs(relDeg);
  if (a < 15) return 'ahead';
  if (a > 165) return 'astern';
  return `${Math.round(a / 5) * 5}° to ${relDeg < 0 ? 'port' : 'starboard'}`;
}

export function ocsGuide(
  boat: { n: number; e: number; headingRad: number },
  ends: readonly [{ n: number; e: number; label: string }, { n: number; e: number; label: string }],
  sinceStartS: number,
): OcsGuide {
  const dist = (p: { n: number; e: number }) => Math.hypot(p.n - boat.n, p.e - boat.e);
  const near = dist(ends[0]) <= dist(ends[1]) ? ends[0] : ends[1];
  const bearing = Math.atan2(near.e - boat.e, near.n - boat.n);
  const rel = ((((bearing - boat.headingRad) * 180) / Math.PI) % 360 + 540) % 360 - 180;
  return { end: near.label, distanceM: dist(near), relDeg: rel, direction: directionWords(rel), sinceStartS, recallFlagDown: sinceStartS >= 240 };
}
