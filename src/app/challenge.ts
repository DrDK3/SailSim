/**
 * "Challenge a friend" (juniors round §6.1, layer A: no server). After a finish, a link carries the whole run (as a
 * replay, which the friend's app sails as a ghost: a recording that does not react), the sailor's word-list name
 * (src/app/safeNames.ts: never free text), the course, the finish time and the time at each mark. Everything is in the
 * link's fragment (after the `#`), which browsers never send to a web server: nothing is uploaded or stored.
 *
 * Format: `#challenge=c1.` + base64url(deflate-raw(JSON)). A link whose name is not a word-list name is refused.
 */
import { decodeJson, encodeJson } from './shareLink';
import { parseRecording, type Recording } from './replay';
import { isSafeName } from './safeNames';
import type { RaceEvent } from '../sim/course/judge';

export const CHALLENGE_PREFIX = 'c1.';
export const CHALLENGE_PARAM = 'challenge';

export interface Split {
  /** The mark or gate, as the course names it ("Windward mark"). */
  label: string;
  /** Seconds after the start signal. */
  t: number;
}

export interface Challenge {
  v: 1;
  name: string;
  /** The course and conditions it was sailed in, for the card ("Windward–leeward in Start Bay · 11 kn from 230°"). */
  course: string;
  /** The best-time key it belongs to (weekly:2026-W47, challenge:2026-11-17, or a course key). */
  key: string;
  finishS: number;
  splits: Split[];
  independent: boolean;
  rec: Recording;
}

/** The marks rounded (and gates passed) from a judge's events, in seconds after the start signal. */
export function splitsFrom(events: readonly RaceEvent[], startSignalT: number): Split[] {
  const out: Split[] = [];
  for (const e of events) if (e.type === 'rounded' || e.type === 'gate') out.push({ label: e.label, t: Math.round((e.time - startSignalT) * 10) / 10 });
  return out;
}

export async function encodeChallenge(c: Challenge): Promise<string> {
  if (!isSafeName(c.name)) throw new Error('A challenge carries only a word-list name.');
  return encodeJson(CHALLENGE_PREFIX, c);
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Read and check a challenge; throws with a reason a person can read. */
export async function decodeChallenge(payload: string): Promise<Challenge> {
  const j = (await decodeJson(CHALLENGE_PREFIX, payload)) as Partial<Challenge>;
  if (!j || j.v !== 1) throw new Error('This challenge link is from a version of SailSim this one cannot read.');
  if (!isSafeName(j.name)) throw new Error('This challenge link does not carry a name this app makes, so it is not shown.');
  if (!isNum(j.finishS) || j.finishS <= 0) throw new Error('This challenge link has no finish time.');
  if (!Array.isArray(j.splits) || j.splits.some((s) => !s || typeof s.label !== 'string' || s.label.length > 60 || !isNum(s.t))) throw new Error('This challenge link is damaged.');
  if (typeof j.course !== 'string' || j.course.length > 160 || typeof j.key !== 'string' || j.key.length > 80) throw new Error('This challenge link is damaged.');
  return { v: 1, name: j.name, course: j.course, key: j.key, finishS: j.finishS, splits: j.splits, independent: !!j.independent, rec: parseRecording(j.rec) };
}

export function challengeUrl(page: string, payload: string): string {
  return `${page.split('#')[0]}#${CHALLENGE_PARAM}=${payload}`;
}

export function challengePayload(hash: string): string | undefined {
  return /(?:^#|&)challenge=([A-Za-z0-9._-]+)/.exec(hash)?.[1];
}

const secs = (s: number) => {
  const a = Math.abs(s);
  return a >= 60 ? `${Math.floor(a / 60)} min ${Math.round(a % 60)} s` : `${Math.round(a)} s`;
};

/**
 * The result against a challenge, in words, with where time was gained or lost at each mark. "Watch" points to the
 * leg where the most time was lost (the ghost shows how they sailed it).
 */
export function challengeResult(mine: { finishS: number; splits: readonly Split[] }, theirs: Pick<Challenge, 'name' | 'finishS' | 'splits'>): {
  headline: string;
  detail?: string;
  legs: { label: string; mine?: number; theirs: number; gained?: number }[];
} {
  const d = theirs.finishS - mine.finishS;
  const legs: { label: string; mine?: number; theirs: number; gained?: number }[] = [];
  let prevMine = 0;
  let prevTheirs = 0;
  theirs.splits.forEach((s, i) => {
    const m = mine.splits[i];
    const same = m && m.label === s.label;
    // Time gained on this leg alone (positive: you were quicker over it).
    const gained = same ? Math.round(((s.t - prevTheirs) - (m.t - prevMine)) * 10) / 10 : undefined;
    legs.push({ label: s.label, mine: same ? m.t : undefined, theirs: s.t, gained });
    if (same) {
      prevMine = m.t;
      prevTheirs = s.t;
    }
  });
  const lastMine = mine.splits.length ? mine.splits[mine.splits.length - 1]!.t : 0;
  const lastTheirs = theirs.splits.length ? theirs.splits[theirs.splits.length - 1]!.t : 0;
  legs.push({ label: 'Finish', mine: mine.finishS, theirs: theirs.finishS, gained: Math.round(((theirs.finishS - lastTheirs) - (mine.finishS - lastMine)) * 10) / 10 });
  if (Math.abs(d) < 0.5) return { headline: `A dead heat with ${theirs.name}!`, legs };
  if (d > 0) {
    const best = legs.filter((l) => l.gained !== undefined).sort((a, b) => b.gained! - a.gained!)[0];
    return { headline: `You beat ${theirs.name} by ${secs(d)}`, detail: best && best.gained! > 0 ? `You gained most on the leg to ${legName(best.label)} (${secs(best.gained!)}).` : undefined, legs };
  }
  const worst = legs.filter((l) => l.gained !== undefined).sort((a, b) => a.gained! - b.gained!)[0];
  return {
    headline: `${theirs.name} was ${secs(-d)} faster`,
    detail: worst && worst.gained! < 0 ? `Watch how their ghost sails the leg to ${legName(worst.label)}: they gained ${secs(-worst.gained!)} there.` : undefined,
    legs,
  };
}

/** "the windward mark" for a course's generic labels; a named mark keeps its name ("Castle Ledge"). */
const legName = (label: string) =>
  label === 'Finish' ? 'the finish' : /^(Windward|Leeward|Wing|Gate|Mark|Offset|Reaching|Spreader)\b/.test(label) ? `the ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
