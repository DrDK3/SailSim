/**
 * The story of a race for the results (owner, 18 Nov 2026: "your place shown large, with gaps; places at each mark"):
 * where you finished and by how much, and where you stood in the fleet at the start and at each mark. Read from the
 * race's own records (the results table and each boat's judge): nothing is estimated here.
 */

export interface FinishRow {
  you: boolean;
  /** Place in the results (1 = first), or null without one (did not finish, disqualified, still racing). */
  place: number | null;
  code?: string;
  /** Time from the start signal (s), for boats that finished. */
  elapsed?: number;
  name: string;
  sailNumber: string;
}

export interface FinishStory {
  /** Your place and the number of boats entered. */
  place: number;
  of: number;
  elapsedS: number;
  /** The boat one place ahead and how long before you she finished (s); none when you won. */
  ahead?: { boat: string; gapS: number };
  /** The boat one place behind and how long after you she finished (s); none when nobody finished behind you. */
  behind?: { boat: string; gapS: number };
  /** How long after the winner you finished (s); 0 when you won. */
  toWinnerS: number;
}

/** Your finish against the boats either side, once you have finished; undefined otherwise (retired, still racing). */
export function finishStory(rows: readonly FinishRow[]): FinishStory | undefined {
  const you = rows.find((r) => r.you);
  if (!you || you.place === null || you.code !== 'FIN' || you.elapsed === undefined) return undefined;
  const finished = rows.filter((r) => r.code === 'FIN' && r.place !== null && r.elapsed !== undefined).sort((a, b) => a.place! - b.place!);
  const i = finished.indexOf(you);
  const name = (r: FinishRow) => `${r.sailNumber} ${r.name}`.trim();
  const ahead = finished[i - 1];
  const behind = finished[i + 1];
  return {
    place: you.place,
    of: rows.length,
    elapsedS: you.elapsed,
    ahead: ahead ? { boat: name(ahead), gapS: you.elapsed - ahead.elapsed! } : undefined,
    behind: behind ? { boat: name(behind), gapS: behind.elapsed! - you.elapsed } : undefined,
    toWinnerS: you.elapsed - finished[0]!.elapsed!,
  };
}

/** What a boat's judge recorded that places her at a point of the course: her start, each mark or gate, her finish. */
export interface BoatPassings {
  id: string;
  /** Time she started (s), if she did. */
  start?: number;
  /** Time she rounded or passed each leg's mark (by leg index), in the order sailed. */
  marks: { leg: number; label: string; time: number }[];
  finish?: number;
}

export interface MarkPlace {
  /** 'Start', the mark's or gate's label, or 'Finish'. */
  label: string;
  /** Your place there (1 = first to it) among the boats that reached it, and how many boats are racing. */
  place: number;
  of: number;
}

/**
 * Your place at the start, at each mark you rounded and at the finish: one more than the number of boats that got
 * there before you. A boat that never reached a point is behind everyone who did.
 */
export function markPlaces(boats: readonly BoatPassings[], you = 'you'): MarkPlace[] {
  const me = boats.find((b) => b.id === you);
  if (!me) return [];
  const of = boats.length;
  const out: MarkPlace[] = [];
  const placeAt = (mine: number, theirs: (b: BoatPassings) => number | undefined) => 1 + boats.filter((b) => b.id !== you && (theirs(b) ?? Infinity) < mine).length;
  if (me.start !== undefined) out.push({ label: 'Start', place: placeAt(me.start, (b) => b.start), of });
  for (const m of me.marks) out.push({ label: m.label, place: placeAt(m.time, (b) => b.marks.find((x) => x.leg === m.leg)?.time), of });
  if (me.finish !== undefined) out.push({ label: 'Finish', place: placeAt(me.finish, (b) => b.finish), of });
  return out;
}

/** 1st, 2nd, 3rd, 4th … */
export const ordinal = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** A gap in seconds as words: "4.2 s", or "1 min 12 s" from a minute up. */
export function gapText(s: number): string {
  const a = Math.abs(s);
  if (a < 60) return `${a.toFixed(1)} s`;
  const m = Math.floor(a / 60);
  return `${m} min ${Math.round(a - m * 60)} s`;
}

/**
 * A gate by a short name: what its two marks' names share ("Leeward gate (left)" and "Leeward gate (right)" make
 * "Leeward gate"), or "Gate A–B" when they share nothing worth the name.
 */
export function gateName(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const common = a.slice(0, i).replace(/[\s(\-–·,]+$/u, '');
  return common.length >= 3 ? common : `Gate ${a}–${b}`;
}

/** The mark (or gate) a leg goes to, by a short name for a small space: no side, no "Gate …–…". */
export function legMarkName(leg: { type: 'mark'; mark: string } | { type: 'gate'; marks: readonly [string, string] }, nameOf: (id: string) => string): string {
  return leg.type === 'mark' ? nameOf(leg.mark) : gateName(nameOf(leg.marks[0]), nameOf(leg.marks[1]));
}
