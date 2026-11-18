/**
 * The club table's verifier (juniors round §6.4, layer B): re-sails a submitted run headless with the app's own code
 * and decides, with no person involved, whether it goes in this week's table. Run by the scheduled Action through
 * tools/club-verify.ts; the tests run it directly.
 *
 * Checks, in order (each failure has a reason code the submitter can read through their token):
 *  1. built by this build (else the Action tries a kept older verifier, else "unverifiable: build-not-kept");
 *  2. the name is a word-list name;
 *  3. the run is the weekly course of its week: same conditions, course, boat, start, sequence, and sailed alone;
 *  4. re-sailing it: if the checkpoints match bit for bit, the finish must match the claim to 0.05 s. They usually do
 *     not for a run recorded in a browser: Node's V8 and a browser's differ in the last bit of Math.sin/cos/pow
 *     (criterion 11; measured in the end-to-end test for a 52-minute course, docs/JUNIORS_REPORT.md §4.4). Then the
 *     run is accepted, with the re-sailed time, if it finished within OTHER_ENGINE_TOLERANCE_S of the claim. Beyond
 *     that, a Chromium run is rejected (time not as claimed); a Firefox, Safari or other run is listed separately as
 *     "recorded on another browser engine, not verified" (never silently dropped);
 *  5. the assist category: a run claimed as independent must have no auto-trim in its input log (the overlay and live
 *     help are not in a replay: they are as the app reported them);
 *  6. plausibility flags (not reasons to reject): input timing that looks scripted. A low-stakes club table, not an
 *     anti-cheat system: re-sailing proves a run is physically valid, not that a person sailed it.
 */
import { SimController, BUILD_ID, type AppScenario } from './controller';
import { parseRecording, type Recording } from './replay';
import { isSafeName } from './safeNames';
import { weekOf, weeklyCourse } from './weekly';
import { assistsFromInputs } from './assists';
import type { DartData } from './geoLoader';

/** Other browser engines: the largest difference between the claimed and the re-sailed finish accepted (s, E). */
export const OTHER_ENGINE_TOLERANCE_S = 2;
/** The same engine: the claim must match the re-sailed finish to this (s; rounding only). */
export const SAME_ENGINE_TOLERANCE_S = 0.05;

export interface Submission {
  id: string;
  receivedAt: string;
  name: string;
  build: string;
  engine: 'chromium' | 'gecko' | 'webkit' | 'other';
  tokenHash: string;
  replay: unknown;
}

export type VerdictStatus = 'accepted' | 'other-engine' | 'rejected' | 'unverifiable';

export interface Verdict {
  status: VerdictStatus;
  /** A reason code (rejected, unverifiable, other-engine) the submitter can read. */
  reason?: string;
  week?: string;
  /** The re-sailed finish time from the start signal (s). */
  timeS?: number;
  category?: 'independent' | 'assisted';
  /** Bit-exact replay (all checkpoints matched). */
  exact?: boolean;
  /** The finish time the run claimed (s), for the record. */
  claimedS?: number;
  /** Plausibility flags: listed separately in the table, not rejected. */
  flags: string[];
}

const strip = (s: AppScenario) => ({ conditions: s.conditions, startLocation: s.startLocation, startHeadingDeg: s.startHeadingDeg, startSpeedKn: s.startSpeedKn, race: s.race, fleet: s.fleet, boat: s.boat ?? 'rondar' });

/** The course a scenario lays (as JSON), from a headless controller. */
function courseJson(sc: AppScenario, dart: DartData | undefined): string | undefined {
  const c = new SimController();
  if (dart) c.dartData = dart;
  if (!c.restart(structuredClone(sc))) return undefined;
  return JSON.stringify(c.race?.course);
}

/**
 * Episodes of input (runs of consecutive steps with a change), as step numbers of their starts: what plausibility
 * checks look at (a held key changes the input every step; a person's presses start at irregular times).
 */
export function inputEpisodes(rec: Recording): number[] {
  const out: number[] = [];
  let prev = -10;
  for (const r of rec.inputs) {
    if (r[0] > prev + 1) out.push(r[0]);
    prev = r[0];
  }
  return out;
}

/** Plausibility flags for one run (and its episode starts, to compare across the week's runs). */
export function plausibility(rec: Recording): string[] {
  const flags: string[] = [];
  const ep = inputEpisodes(rec);
  const gaps: number[] = [];
  for (let i = 1; i < ep.length; i++) gaps.push(ep[i]! - ep[i - 1]!);
  if (gaps.length >= 20) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    // Every press started a whole number of identical steps apart: a clock, not a hand (E).
    if (sd < 0.5) flags.push('perfectly-periodic-input');
  }
  // More than 12 separate presses a second, sustained over 10 s (E: beyond fast human tapping).
  for (let i = 0; i + 120 < ep.length; i++) {
    if (ep[i + 120]! - ep[i]! <= 1000) {
      flags.push('input-rate-beyond-human');
      break;
    }
  }
  return flags;
}

export function verifySubmission(sub: Submission, dart: DartData | undefined, build = BUILD_ID): Verdict {
  const flags: string[] = [];
  if (sub.build !== build) return { status: 'unverifiable', reason: 'built-by-another-version', flags };
  if (!isSafeName(sub.name)) return { status: 'rejected', reason: 'name-not-on-word-list', flags };
  let rec: Recording;
  try {
    rec = parseRecording(sub.replay);
  } catch {
    return { status: 'rejected', reason: 'not-a-replay', flags };
  }
  if (!rec.claimed || typeof rec.claimed.finishS !== 'number' || typeof rec.claimed.independent !== 'boolean') return { status: 'rejected', reason: 'no-claimed-result', flags };
  // 3. The weekly course of its week.
  const at = new Date(Date.parse(rec.scenario.conditions.startTime));
  if (Number.isNaN(at.getTime())) return { status: 'rejected', reason: 'not-the-weekly-course', flags };
  const w = weeklyCourse(at);
  const received = weekOf(new Date(Date.parse(sub.receivedAt)));
  if (w.week.key !== received.key) return { status: 'rejected', reason: 'not-this-weeks-course', week: w.week.key, flags };
  const a = strip(rec.scenario);
  const b = strip(w.scenario);
  if (JSON.stringify(a.conditions) !== JSON.stringify(b.conditions)) return { status: 'rejected', reason: 'conditions-changed', week: w.week.key, flags };
  if (a.boat !== b.boat) return { status: 'rejected', reason: 'boat-changed', week: w.week.key, flags };
  if (JSON.stringify(a) !== JSON.stringify(b)) return { status: 'rejected', reason: 'race-set-up-changed', week: w.week.key, flags };
  const sailed = rec.scenario.course?.source === 'inline' ? JSON.stringify(rec.scenario.course.course) : courseJson(rec.scenario, dart);
  if (sailed !== courseJson(w.scenario, dart)) return { status: 'rejected', reason: 'course-changed', week: w.week.key, flags };
  // 5. Assists (auto-trim is in the inputs).
  const auto = assistsFromInputs(rec.inputs, rec.endStep);
  const init = rec.initialInput;
  const autoTrim = auto.autoMain || auto.autoJib || !!init?.autoMain || !!init?.autoJib;
  if (rec.claimed.independent && autoTrim) return { status: 'rejected', reason: 'assists-not-as-claimed', week: w.week.key, flags };
  // 4. Re-sail.
  const c = new SimController();
  if (dart) c.dartData = dart;
  if (!c.startReplay(rec)) return { status: 'rejected', reason: 'replay-would-not-start', week: w.week.key, flags };
  c.advance(rec.endStep * 0.01 + 1);
  const st = c.getState().replay;
  const exact = !!st && st.state === 'ended' && st.checkpointsMatched === st.checkpointsTotal;
  const race = c.race;
  const j = race?.session.judgeOf('you');
  const finished = j?.phase === 'finished' && j.finishTime !== undefined;
  const timeS = finished ? Math.round((j!.finishTime! - race!.session.committee.startTime) * 10) / 10 : undefined;
  flags.push(...plausibility(rec));
  const category = rec.claimed.independent ? 'independent' : 'assisted';
  const base = { week: w.week.key, category, flags } as const;
  const claimed = rec.claimed.finishS;
  const off = timeS === undefined ? undefined : Math.abs(timeS - claimed);
  const withClaim = { ...base, exact, timeS, claimedS: claimed };
  // Bit for bit (the recording's own engine and the verifier's agree to the last bit): the claim must match exactly.
  if (exact) {
    if (timeS === undefined) return { ...withClaim, status: 'rejected', reason: 'did-not-finish' };
    if (off! > SAME_ENGINE_TOLERANCE_S) return { ...withClaim, status: 'rejected', reason: 'time-not-as-claimed' };
    return { ...withClaim, status: 'accepted' };
  }
  // Not bit for bit. Every browser differs from Node in the last bit of Math.sin/cos/pow (criterion 11: about 1e-13 for
  // Chromium), so a run recorded in any browser can drift when re-sailed. The re-sailed time is what is published, so
  // a run is accepted when it finished and its claim is within the tolerance.
  if (off !== undefined && off <= OTHER_ENGINE_TOLERANCE_S) return { ...withClaim, status: 'accepted', reason: 'recomputed-within-tolerance' };
  // Chromium's drift is measured (docs/JUNIORS_REPORT.md §4.4): beyond the tolerance its claim is taken to be wrong.
  if (sub.engine === 'chromium') return { ...withClaim, status: 'rejected', reason: timeS === undefined ? 'did-not-finish' : 'time-not-as-claimed' };
  // Firefox, Safari and others: not measured here. Listed apart, never dropped.
  return { ...withClaim, status: 'other-engine', reason: timeS === undefined ? 'other-engine-did-not-finish-when-re-sailed' : 'other-engine-time-differs' };
}

/** Runs this week whose input timing is identical to another's (the same script twice): flagged. */
export function identicalTiming(runs: { id: string; rec: Recording }[]): Set<string> {
  const seen = new Map<string, string>();
  const out = new Set<string>();
  for (const r of runs) {
    const ep = inputEpisodes(r.rec);
    if (ep.length < 20) continue;
    const key = ep.slice(0, 200).join(',');
    const other = seen.get(key);
    if (other) {
      out.add(other);
      out.add(r.id);
    } else seen.set(key, r.id);
  }
  return out;
}
