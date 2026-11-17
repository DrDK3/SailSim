import type { SteeringMode } from '../steering';
import type { ConditionsSettings } from '../../sim/env/conditions';
import { CONTENT_STATUS, type WindShiftThresholds } from './config';
import { DEFAULT_POINT_TWA_DEG, compareDemos, markFromWindDeg, markUpwind, shiftEvents, starboardStart, type BeatSetup, type Comparison, type ShiftEvent } from './counterfactual';
import { median, type AttemptPlan, type AttemptRecord, type ExerciseDef, type ExerciseResult, type ExerciseSample, type HelpLadder, type PhaseDef, type ReviewChart, type ReviewItem } from './engine';
import { bowKeys } from './tackRecover';

/**
 * Tactical exercise: respond to a wind shift on a short beat (training slice §8). One beat to a windward mark 600 m
 * upwind in steady open water, starting on starboard. One scripted shift: after a minute the wind backs 15° (a
 * header on starboard), holds for 90 s and turns back (src/sim/env/wind.ts scriptedShiftBase). Before the first
 * attempt an optional prediction; during it the compass, the heading history and (removable) the shift readout; after
 * it a review that keeps the DECISION (did you tack on the header?) apart from the OUTCOME (your time to the mark),
 * against model demonstrations of both choices from the same start ("in this model").
 *
 * Why a shift that returns: with a persistent shift, the two choices reached the mark within 3 s of each other in this
 * model (after a persistent shift any path inside the new laylines takes about as long), so there was no decision to
 * teach; with the shift returning after 90 s, tacking on each header reached the mark about 30 s sooner. See
 * docs/TRAINING_SLICE_REPORT.md §6 and `npm run shift-sensitivity`.
 */

export const WIND_SHIFT_ID = 'wind-shift';

/** The Start Bay practice area (src/app/controller.ts START_LOCATIONS 'start-bay-practice'; tested equal). */
export const PRACTICE_AREA = { n: -3500, e: 1200 };

const DEG = Math.PI / 180;
const f0 = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(0));
const wrap180 = (a: number) => ((((a % 360) + 540) % 360) - 180);

export function windShiftConditions(t: WindShiftThresholds): ConditionsSettings {
  return {
    startTime: '2026-07-15T13:00:00Z',
    weather: { source: 'manual', twsKn: t.windKn, twdDeg: t.windFromDeg, shift: { atS: t.shiftAtS, deg: t.shiftDeg, rampS: t.shiftRampS, holdS: t.shiftHoldS } },
    gusts: { preset: 'steady', seed: 1 },
    current: { mode: 'none' },
    sky: { source: 'preset', preset: 'fair' },
  };
}

/** The beat as the model demonstrations sail it: the exercise's own start, wind, shift and mark. */
export function windShiftSetup(t: WindShiftThresholds): { setup: BeatSetup; events: ShiftEvent[] } {
  const conditions = windShiftConditions(t);
  const setup: BeatSetup = {
    conditions,
    start: starboardStart(PRACTICE_AREA, t.windFromDeg, 4),
    mark: markUpwind(PRACTICE_AREA, t.windFromDeg, t.markDistM),
    roundingRadiusM: t.roundingRadiusM,
    timeLimitS: t.timeLimitS,
  };
  return { setup, events: shiftEvents({ atS: t.shiftAtS, deg: t.shiftDeg, rampS: t.shiftRampS, holdS: t.shiftHoldS }) };
}

export function windShiftPlans(t: WindShiftThresholds): AttemptPlan[] {
  const heading = starboardStart(PRACTICE_AREA, t.windFromDeg).headingDeg;
  const n = Math.max(1, Math.round(t.attempts));
  return Array.from({ length: n }, (_, i): AttemptPlan =>
    i < n - 1 || n === 1
      ? { tack: 1, headingDeg: heading, start: { autoMain: true, autoJib: true, autoCrew: true, overlay: true, help: 'auto' }, label: 'With the shift overlay and help; auto-trim on' }
      : { tack: 1, headingDeg: heading, start: { autoMain: false, autoJib: false, autoCrew: true, overlay: false, help: 'request' }, label: 'On your own: sheets yours, no overlay, help only if you ask' },
  );
}

/** What one attempt recorded for the review and its map. */
interface Trace {
  /** The last time (s) on the current side with the wind well off the bow: where a tack begins. */
  offWindT?: number;
  /** Whether, there, the mark could be laid on the other tack (a tack there is a layline tack). */
  offWindLayline?: boolean;
  track: [number, number][];
  headings: number[];
  tacks: number[];
  lastT: number;
  lastSide: number;
}

/** What the learner did about the shift. */
type Decision = 'tack' | 'late' | 'hold' | 'port' | 'skipped';

/** Predictions offered before the first attempt (optional). */
export const PREDICTIONS = {
  tack: 'Tack onto the other tack',
  hold: 'Hold my course',
  unsure: 'Not sure',
} as const;
export type Prediction = keyof typeof PREDICTIONS;

export function windShiftExercise(t: WindShiftThresholds, steering: SteeringMode = 'bow'): ExerciseDef {
  const keys = bowKeys(steering);
  const { setup, events } = windShiftSetup(t);
  const traces = new Map<number, Trace>();
  const charts = new Map<number, ReviewChart>();
  let comparison: Comparison | undefined;
  const compare = () => (comparison ??= compareDemos(setup, events));
  const returnAt = t.shiftAtS + t.shiftRampS + t.shiftHoldS;
  /** Heading at the mark already (on the layline): a header there is no reason to tack. */
  const atMark = (s: ExerciseSample) => Math.abs(s.targetBearingRelDeg ?? 180) < 20;
  /**
   * Headed, as the help means it: on starboard from the shift's start while it lasts; on port in the window after it
   * turns back. Never while heading at the mark.
   */
  const headedNow = (s: ExerciseSample) =>
    !atMark(s) &&
    ((s.mainSide === 1 && s.t >= t.shiftAtS && s.t < returnAt) || (s.mainSide !== 1 && s.t >= returnAt && s.t < returnAt + t.shiftRampS + t.decisionWindowS));
  const trace = (n: number) => {
    let tr = traces.get(n);
    if (!tr) traces.set(n, (tr = { track: [], headings: [], tacks: [], lastT: -Infinity, lastSide: 1 }));
    return tr;
  };

  const predict: PhaseDef = {
    id: 'predict',
    title: 'Before you start: a prediction (optional)',
    body: () =>
      `You will beat to a windward mark ${t.markDistM} m upwind, starting on starboard. On the way the wind will shift. If it heads you (you have to bear away to keep the sails drawing), what will you do? Choose one, or skip.`,
    unscored: true,
  };

  const beat: PhaseDef = {
    id: 'beat',
    title: 'Beat to the windward mark',
    body: (plan) =>
      `Sail close-hauled on starboard towards the yellow mark, ${t.markDistM} m upwind. Watch your heading: on the compass and in the heading history. The wind will shift on the way: respond as you would in a race, then reach the mark.${plan.start.autoMain ? '' : ' Both sheets are yours.'}`,
    targets: ['compass', 'twa'],
    observe: (s, _m, rec) => {
      const tr = trace(rec.n);
      if (s.t - tr.lastT >= 1) {
        tr.lastT = s.t;
        if (s.n !== undefined && s.e !== undefined) tr.track.push([Math.round(s.n * 10) / 10, Math.round(s.e * 10) / 10]);
        tr.headings.push(Math.round(s.headingDeg));
        if (tr.headings.length > 150) tr.headings.shift();
      }
      // Where a tack begins: the last moment on the old side well off the wind (it is timed from there, not from the
      // moment the sails cross, so a decision just inside the window is not lost to the turn's own length).
      if (s.mainSide === tr.lastSide && s.twaDeg >= 30) {
        tr.offWindT = s.t;
        // At the layline for the other tack: the mark lies at least the demonstrations' pointing angle (42°, E) off
        // the wind on that side. The demonstrations tack there too (with 6° more for leeway), whatever the shift does.
        const rel = s.n !== undefined && s.e !== undefined && s.twdDeg !== undefined ? markFromWindDeg({ n: s.n, e: s.e }, setup.mark, s.twdDeg) : undefined;
        tr.offWindLayline = rel !== undefined && (s.mainSide === 1 ? rel >= DEFAULT_POINT_TWA_DEG : rel <= -DEFAULT_POINT_TWA_DEG);
      }
      if (s.mainSide !== tr.lastSide && s.twaDeg > 30) {
        tr.tacks.push(Math.round(s.t * 10) / 10);
        const began = tr.offWindT ?? s.t;
        // The decision: a tack from starboard begun within the window after the shift began; later, before the shift
        // turns back, a late tack, unless it was begun at the layline (that is how holding on ends: not a decision).
        if (tr.lastSide === 1 && began >= t.shiftAtS && rec.values.decisionTackS === undefined && rec.values.lateTackS === undefined) {
          if (began <= t.shiftAtS + t.decisionWindowS) rec.values.decisionTackS = began - t.shiftAtS;
          else if (began < returnAt && !tr.offWindLayline) rec.values.lateTackS = began - t.shiftAtS;
        }
        if (tr.lastSide !== 1 && began >= returnAt && began <= returnAt + t.decisionWindowS && rec.values.returnTackS === undefined) rec.values.returnTackS = began - returnAt;
        tr.lastSide = s.mainSide;
      }
      if (rec.values.sideAtShift === undefined && s.t >= t.shiftAtS) rec.values.sideAtShift = s.mainSide;
    },
    goal: (s) => (s.targetDistM ?? Infinity) < t.roundingRadiusM || s.t >= t.timeLimitS,
    stuck: (s) => headedNow(s) || s.stwKn < 1.5 || (s.twaDeg > 65 && !atMark(s)),
    help: (s): HelpLadder => {
      const side = s.mainSide === 1 ? 1 : -1;
      const towards = side === 1 ? keys.starboard : keys.port;
      if (headedNow(s)) {
        const other = side === 1 ? 'port' : 'starboard';
        return {
          id: 'headed',
          targets: ['compass'],
          attention: 'Look at the heading history: your heading has changed by about 15°.',
          explain: `The wind has ${side === 1 ? 'backed (shifted left)' : 'veered back (shifted right)'}: on ${side === 1 ? 'starboard' : 'port'} you are headed, pointing further from the mark. On ${other} you would be lifted.`,
          suggest: `Tack onto ${other}: while this shift lasts, ${other} points closer to the mark.`,
        };
      }
      if (s.twaDeg > 65 && !atMark(s))
        return {
          id: 'too-low',
          targets: ['twa', 'compass'],
          attention: 'Look at the TWA: this is a beat.',
          explain: `TWA ${f0(s.twaDeg)}°: you are sailing across the wind, not towards the mark upwind.`,
          suggest: `Head up (${towards}) to close-hauled, about 45°.`,
        };
      if (s.stwKn < 1.5)
        return {
          id: 'slow',
          targets: ['speed'],
          attention: 'Look at your speed.',
          explain: `${s.stwKn.toFixed(1)} kn: the boat has slowed (after a tack, or pointing too high).`,
          suggest: 'Bear away a little to build speed, then head up to close-hauled.',
        };
      // Nothing wrong now (help asked for): what to watch.
      return {
        id: 'watch',
        targets: ['compass'],
        attention: 'Look at the heading history: a shift shows as a step.',
        explain: 'Sailing close-hauled, your heading follows the wind: if the wind shifts, your heading changes with it.',
        suggest: 'Keep close-hauled towards the mark and watch for a step in the heading history; when it heads you, decide whether to tack.',
      };
    },
    onDone: (s, _m, rec) => {
      const tr = trace(rec.n);
      if (s.n !== undefined && s.e !== undefined) tr.track.push([Math.round(s.n * 10) / 10, Math.round(s.e * 10) / 10]);
      if ((s.targetDistM ?? Infinity) < t.roundingRadiusM) rec.values.markS = s.t;
      else rec.issues.push('timeout');
      rec.values.tacks = tr.tacks.length;
    },
    readout: (s) => {
      const parts = [`Mark ${f0(s.targetDistM)} m`, `heading ${f0(((s.headingDeg % 360) + 360) % 360)}°`];
      if (s.overlay && s.twdDeg !== undefined) {
        const d = wrap180(s.twdDeg - t.windFromDeg);
        parts.push(`wind from ${f0(((s.twdDeg % 360) + 360) % 360)}°${Math.abs(d) >= 1 ? ` (${f0(Math.abs(d))}° ${d < 0 ? 'left' : 'right'} of the start)` : ''}`);
      }
      return parts.join(' · ');
    },
  };

  /** What the learner did about the shift, from what the beat recorded. */
  const decisionOf = (rec: AttemptRecord): Decision => {
    const v = rec.values;
    if (v.sideAtShift === undefined) return 'skipped';
    if (v.sideAtShift !== 1) return 'port';
    if (v.decisionTackS !== undefined) return 'tack';
    if (v.lateTackS !== undefined) return 'late';
    return 'hold';
  };

  /** The model's comparison in words, honest when a demonstration did not reach the mark. */
  const modelLine = (c: Comparison): string => {
    const both = `model demonstrations: tack on the header ${c.tack.timeS === undefined ? 'did not reach the mark' : `${f0(c.tack.timeS)} s`}, hold ${c.hold.timeS === undefined ? 'did not reach the mark' : `${f0(c.hold.timeS)} s`}`;
    if (c.tack.timeS === undefined && c.hold.timeS === undefined) return `In this model neither demonstration reached the mark within ${t.timeLimitS} s, so the decision cannot be compared.`;
    if (c.tack.timeS === undefined || c.hold.timeS === undefined) return `In this model only the "${c.tack.timeS !== undefined ? 'tack on the header' : 'hold'}" demonstration reached the mark within ${t.timeLimitS} s (${both}).`;
    if (c.better === undefined) return `In this model the two choices reached the mark within a second of each other (${both}).`;
    return `In this model, from the same start, ${c.better === 'tack-on-header' ? 'tacking on each header' : 'holding on'} reached the mark ${f0(c.marginS)} s sooner (${both}).`;
  };

  const review = (rec: AttemptRecord): ReviewItem[] => {
    const c = compare();
    const v = rec.values;
    const out: ReviewItem[] = [];
    const decided = decisionOf(rec);
    if (decided === 'skipped') {
      out.push({ id: 'decision', observation: 'The beat was skipped before the wind shifted: there is no decision to judge.' });
    } else {
      const decisionText =
        decided === 'tack'
          ? `Decision: you tacked ${f0(v.decisionTackS)} s after the wind began to shift.`
          : decided === 'late'
            ? `Decision: you tacked ${f0(v.lateTackS)} s after the wind began to shift, later than the ${t.decisionWindowS} s this exercise counts as responding to it.`
            : decided === 'hold'
              ? `Decision: you held starboard for ${t.decisionWindowS} s or more after the wind began to shift.`
              : 'Decision: you were already on port when the wind shifted (on port it was a lift).';
      const matched = (decided === 'tack' && c.better === 'tack-on-header') || (decided === 'hold' && c.better === 'hold');
      const action =
        decided === 'port'
          ? 'Next time: stay on starboard until the shift comes, to practise the decision.'
          : c.better === undefined
            ? undefined
            : matched
              ? 'That matched the faster choice in this model.'
              : c.better === 'tack-on-header'
                ? 'Next time: when your heading drops and stays down, consider tacking onto the lifted tack sooner.'
                : 'Next time: in this model holding on was faster here; tack at the layline.';
      out.push({ id: 'decision', observation: decisionText, cause: modelLine(c), action });
      if (rec.prediction && rec.prediction !== 'unsure')
        out.push({
          id: 'prediction',
          observation: `You predicted: ${PREDICTIONS[rec.prediction as Prediction]?.toLowerCase() ?? rec.prediction}. You ${decided === 'tack' ? 'tacked' : decided === 'late' ? 'tacked, later' : decided === 'hold' ? 'held on' : 'were on port'}.`,
        });
    }
    if (rec.skipped.includes('beat')) out.push({ id: 'outcome', observation: 'Outcome: the beat was skipped before the mark.' });
    else if (v.markS !== undefined) {
      // The demonstration of the same decision, where there is one (a late tack lies between the two).
      const demoOfYours = decided === 'tack' ? c.tack.timeS : decided === 'hold' ? c.hold.timeS : undefined;
      const diff = demoOfYours !== undefined ? v.markS - demoOfYours : undefined;
      const cause =
        diff !== undefined
          ? `The model demonstration of the same decision took ${f0(demoOfYours)} s: the ${Math.abs(diff) < 1 ? 'same' : `${f0(Math.abs(diff))} s ${diff > 0 ? 'slower' : 'faster'}`} came from sailing the boat (speed, pointing, tacks, laylines), not from the decision.`
          : decided === 'late' && c.tack.timeS !== undefined && c.hold.timeS !== undefined
            ? `There is no demonstration of a tack this late: in this model tacking 8 s after the shift took ${f0(c.tack.timeS)} s and holding on ${f0(c.hold.timeS)} s.`
            : undefined;
      out.push({
        id: 'outcome',
        observation: `Outcome: you reached the mark in ${f0(v.markS)} s, with ${f0(v.tacks)} tack${v.tacks === 1 ? '' : 's'}.`,
        cause,
        action: diff !== undefined && diff > 30 ? 'Next time: tack only when you mean to, and sail close-hauled at full speed between tacks; the beginner exercise practises both.' : undefined,
      });
    } else out.push({ id: 'timeout', observation: `Outcome: the mark was not reached within ${t.timeLimitS} s.` });
    const tr = trace(rec.n);
    charts.set(rec.n, {
      mark: [setup.mark.n, setup.mark.e],
      start: [setup.start.n, setup.start.e],
      windFromDeg: t.windFromDeg,
      tracks: [
        { id: 'you', label: 'You', points: tr.track, timeS: v.markS },
        { id: 'tack', label: 'Model demonstration: tack on each header', points: c.tack.track, timeS: c.tack.timeS },
        { id: 'hold', label: 'Model demonstration: hold to the layline', points: c.hold.track, timeS: c.hold.timeS },
      ],
      note: 'Model demonstrations: the same boat, start and wind, sailed by the autopilot with one rule each. Model output, not a measurement.',
    });
    return out;
  };

  const result = (records: AttemptRecord[]): ExerciseResult => {
    const c = compare();
    const line = (r: AttemptRecord) => {
      const words: Record<Decision, string> = {
        skipped: 'skipped before the shift',
        port: 'on port at the shift',
        tack: `tacked ${f0(r.values.decisionTackS)} s after the shift`,
        late: `tacked late, ${f0(r.values.lateTackS)} s after the shift`,
        hold: 'held on through the shift',
      };
      return `Attempt ${r.n}: ${words[decisionOf(r)]}; ${r.values.markS !== undefined ? `mark in ${f0(r.values.markS)} s` : r.skipped.includes('beat') ? 'beat skipped' : 'mark not reached'}.`;
    };
    const group = (rs: AttemptRecord[], label: string) => ({
      attempts: rs.length,
      complete: rs.filter((r) => r.values.markS !== undefined).length,
      lines: rs.length ? [`${label}:`, ...rs.map(line), ...(rs.length > 1 ? [`Median time to the mark ${f0(median(rs.map((r) => r.values.markS ?? NaN)))} s.`] : [])] : [`${label}: none.`],
    });
    const decisions = records.flatMap((r) => r.review.filter((i) => i.id === 'decision').map((i) => ({ ...i, observation: `Attempt ${r.n}: ${i.observation}` })));
    const outcomes = records.flatMap((r) => r.review.filter((i) => i.id === 'outcome' && i.action).map((i) => ({ ...i, observation: `Attempt ${r.n}: ${i.observation}` })));
    const observations = [...decisions.slice(-2), ...outcomes.slice(-1)].slice(0, 3);
    const lastDecision = decisions[decisions.length - 1];
    const nextAction = outcomes.length ? outcomes[outcomes.length - 1]!.action! : lastDecision?.action && !/matched|stay on starboard/.test(lastDecision.action) ? lastDecision.action : 'Next: try it again on your own, or take the shift into a race (Race → quick race, shifty wind).';
    return {
      assisted: group(records.filter((r) => !r.independent), 'Assisted attempts'),
      independent: group(records.filter((r) => r.independent), 'Independent attempts (no auto-trim, overlay or live help)'),
      observations,
      nextAction,
      notes: [
        `Decision and outcome are kept apart: the decision is judged against model demonstrations from the same start (in this model, ${c.better === 'tack-on-header' ? 'tacking on each header' : c.better === 'hold' ? 'holding on' : 'neither'} was faster${c.marginS !== undefined ? ` by ${f0(c.marginS)} s` : ''}); the outcome also depends on how the boat was sailed.`,
        'The better choice was checked against changes to the model (sail lift, drag, righting, pointing): see docs/TRAINING_SLICE_REPORT.md. It is still model output, awaiting instructors’ review.',
        `Thresholds and the shift are provisional (E). Content status: ${CONTENT_STATUS}.`,
      ],
    };
  };

  return {
    id: WIND_SHIFT_ID,
    title: 'Wind shift on a beat',
    summary: 'A short beat with one scripted shift: spot the header, decide, and see your decision and your sailing judged apart.',
    minutes: 12,
    intro: predict,
    phases: [beat],
    plans: windShiftPlans(t),
    helpTimes: [t.helpAttentionS, t.helpExplainS, t.helpSuggestS],
    review,
    result,
    extras: (attempt, stage) => ({
      headingHistory: stage === 'attempt' ? traces.get(attempt)?.headings.slice() : undefined,
      chart: stage === 'review' || stage === 'result' ? charts.get(attempt) : undefined,
      predictions: stage === 'intro' ? Object.entries(PREDICTIONS).map(([id, label]) => ({ id, label })) : undefined,
    }),
    resetAttempt: (n) => traces.delete(n),
  };
}

export { DEG };
