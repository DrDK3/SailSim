import type { AppScenario } from './controller';
import type { ConditionsSettings } from '../sim/env/conditions';
import type { ControlInput } from '../sim/simulation';
import { angleDiff, type LessonRecord, type StepMemory, type TutorialSample, type TutorialStep } from './tutorial';

/**
 * Six short lessons (review §8.1 and U9), each with its own water and wind, a goal per step checked as you sail,
 * and a result card at the end with what you did and the next lesson. They replace the one long tutorial.
 *
 *  1. Steering: heading against course over the ground, and a buoy to sail to.
 *  2. The wind: true and apparent wind, and the no-go zone.
 *  3. Trim: telltales, luffing, and the auto-trim assist.
 *  4. Tacking and gybing, timed against the model's own reference manoeuvres.
 *  5. The start: the countdown, the line, being over early and clearing.
 *  6. The stream: speed through the water against over the ground, and VMG, in an illustrative steady stream.
 *
 * Everything is in open water in Start Bay with a steady breeze (no gusts), so the lessons are predictable. The
 * winds, targets and thresholds are the simulator's choices for teaching (E), not a syllabus of any body.
 * Getting out of irons is not taught: drifting backwards out of irons is not modelled yet (review PH-4).
 */

export type LessonId = 'steer' | 'wind' | 'trim' | 'turns' | 'start' | 'tide';

/** Parts of the teaching overlay a lesson shows in the 3D view (src/render/teaching.ts). */
export type OverlayPart = 'heading' | 'cog' | 'current' | 'wind' | 'vmg';

export interface Lesson {
  id: LessonId;
  number: number;
  title: string;
  /** One line for the list of lessons. */
  summary: string;
  /** About how long it takes (E). */
  minutes: number;
  scenario: AppScenario;
  input: ControlInput;
  steps: TutorialStep[];
  overlay: OverlayPart[];
  /** A buoy to sail to: its bearing (°T) and distance (m) from where the boat starts. */
  target?: { bearingDeg: number; distM: number };
  /** The result card's lines, from what the steps recorded and the time the lesson took. */
  result: (rec: LessonRecord, elapsedS: number) => string[];
}

/** Steady open water off the Dart (as the first tutorial was), wind from 225°. */
function openWater(twsKn: number, headingDeg: number, extra: Partial<ConditionsSettings> = {}, speedKn = 3): AppScenario {
  return {
    conditions: {
      startTime: '2026-07-15T13:00:00Z',
      weather: { source: 'manual', twsKn, twdDeg: 225 },
      gusts: { preset: 'steady', seed: 1 },
      current: { mode: 'none' },
      sky: { source: 'preset', preset: 'fair' },
      ...extra,
    },
    startLocation: 'start-bay-practice',
    startHeadingDeg: headingDeg,
    startSpeedKn: speedKn,
  };
}

/** Sails and crew on auto: the lessons hand controls over one at a time. */
const AUTO: ControlInput = { helm: 0, mainSheet: 0.35, jibSheet: 0.35, autoMain: true, autoJib: true, crewHike: 0.6, autoCrew: true };

export const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s) % 60)).padStart(2, '0')}`;
const kn1 = (v: number | undefined) => (v === undefined ? '—' : v.toFixed(1));

/** Explanation-only step. */
const explain = (id: string, title: string, body: string, extra: Partial<TutorialStep> = {}): TutorialStep => ({ id, title, body, ...extra });

const steerStep: TutorialStep = {
  id: 'steer',
  title: 'Steer',
  body: 'Hold D or → (or the ▶ button) to turn the bow to starboard, A or ← (◀) to turn it to port: the keys move the bow, as in a car. On the boat the tiller goes the other way, as the tiller picture in the dock shows. It centres itself when you let go. Turn the boat 30° either way.',
  bodyTiller: 'You steer as on the boat: push the tiller away from the way you want to go. A or ← (◀) pushes the tiller to port and the bow turns to starboard; D or → (▶) pushes it to starboard and the bow turns to port. Watch the tiller picture in the dock. It centres itself when you let go. Turn the boat 30° either way.',
  hint: 'A boat turns slowly: hold the key for a second or two, then wait.',
  targets: ['helm'],
  goal: (s, m) => angleDiff(s.headingDeg, m.start.headingDeg) >= 30,
};

const reachStep = (onDone?: TutorialStep['onDone']): TutorialStep => ({
  id: 'reach',
  title: 'Sail across the wind',
  body: 'Steer until the wind comes across the side of the boat: a true wind angle (TWA) between 80° and 100°. This is a beam reach, the easiest and often fastest point of sail. Hold it for 5 seconds.',
  targets: ['twa', 'helm'],
  goal: (s) => s.twaDeg >= 80 && s.twaDeg <= 100,
  holdS: 5,
  onDone,
});

const upwindStep = (onDone?: TutorialStep['onDone']): TutorialStep => ({
  id: 'upwind',
  title: 'Sail towards the wind',
  body: 'Turn towards the wind until the TWA is about 45° (between 38° and 55°). This is close-hauled: a boat cannot sail straight into the wind. Keep the speed above 2.5 kn for 5 seconds.',
  hint: 'If the sails luff and the boat slows, you are pointing too high: bear away a little.',
  targets: ['twa', 'helm'],
  goal: (s) => s.twaDeg >= 38 && s.twaDeg <= 55 && s.stwKn >= 2.5,
  holdS: 5,
  onDone,
});

const runStep = (body: string, onDone?: TutorialStep['onDone']): TutorialStep => ({
  id: 'run',
  title: 'Turn away from the wind',
  body,
  targets: ['twa', 'helm'],
  goal: (s) => s.twaDeg >= 150,
  holdS: 3,
  onDone,
});

/**
 * A tack, timed as the model's reference tack is described (validation sheet B3.1): from leaving close-hauled
 * (TWA under 35°) to close-hauled on the new tack (TWA back over 35°), with the speed going in and the lowest.
 */
function tackStep(id: string, title: string, body: string, n: number): TutorialStep {
  return {
    id,
    title,
    body,
    hint: 'Turn decisively: if you stop with the bow into the wind, the boat drifts to a halt ("in irons").',
    targets: ['helm', 'compass'],
    observe: (s: TutorialSample, m: StepMemory) => {
      if (m.v.turnAt === undefined) {
        if (s.twaDeg < 35 && s.mainSide === m.start.mainSide) Object.assign(m.v, { turnAt: s.t, inKn: s.stwKn, minKn: s.stwKn });
        else m.v.lastKn = s.stwKn;
      } else m.v.minKn = Math.min(m.v.minKn!, s.stwKn);
    },
    goal: (s, m) => s.mainSide !== m.start.mainSide && s.twaDeg >= 35 && s.twaDeg < 90 && s.stwKn > 1.0,
    onDone: (s, m, rec) => {
      rec[`tack${n}S`] = m.v.turnAt === undefined ? NaN : s.t - m.v.turnAt;
      rec[`tack${n}InKn`] = m.v.inKn ?? m.v.lastKn ?? s.stwKn;
      rec[`tack${n}MinKn`] = m.v.minKn ?? s.stwKn;
    },
  };
}

export const LESSONS: Lesson[] = [
  {
    id: 'steer',
    number: 1,
    title: 'Steering',
    summary: 'The helm, your heading against your course over the ground, and a buoy to sail to.',
    minutes: 3,
    scenario: openWater(8, 135),
    input: AUTO,
    overlay: ['heading', 'cog'],
    target: { bearingDeg: 105, distM: 170 },
    steps: [
      explain(
        'intro',
        'Your heading',
        'You are helming a Squib, a 5.8 m keelboat, off Dartmouth in a steady 8-knot breeze. The solid white line from the bow, labelled Heading, is where the bow points. The dashed line, Course over ground, is where the boat is actually going.',
        { hint: 'The boat is sailing. Press Next when you are ready.', targets: ['compass', 'speed'] },
      ),
      steerStep,
      {
        id: 'target',
        title: 'Sail to the buoy',
        body: 'Find the yellow buoy labelled Target. Steer until your heading line points at it and keep it there. Get within 15 m of the buoy.',
        hint: 'Small, early corrections: the bow keeps turning for a moment after you let go.',
        targets: ['helm'],
        goal: (s) => (s.targetDistM ?? Infinity) < 15,
        onDone: (s, m, rec) => {
          rec.targetS = s.t - m.start.t;
        },
        readout: (s) => (s.targetDistM === undefined ? undefined : `Buoy ${Math.round(s.targetDistM)} m away`),
      },
      explain(
        'result',
        'Heading and course',
        'The two lines rarely agree exactly: the keel slips a little sideways (leeway), and a stream would carry you as well (lesson 6). Next: the wind.',
      ),
    ],
    result: (rec, t) => [`Lesson time ${mmss(t)}.`, rec.targetS !== undefined ? `You reached the buoy in ${mmss(rec.targetS)}.` : 'You skipped the buoy.'],
  },
  {
    id: 'wind',
    number: 2,
    title: 'The wind',
    summary: 'True and apparent wind, the points of sail, and the no-go zone.',
    minutes: 4,
    scenario: openWater(10, 135),
    input: AUTO,
    overlay: ['wind'],
    steps: [
      explain(
        'intro',
        'Two winds',
        'The arrow above the boat labelled True wind is the wind blowing over the water. The one labelled Apparent wind is the wind you feel on board: the true wind plus the wind of your own speed. The compass shows both, marked T and A.',
        { targets: ['compass'] },
      ),
      reachStep((s, _m, rec) => {
        if (s.awsKn !== undefined) rec.awsReach = s.awsKn;
      }),
      upwindStep((s, _m, rec) => {
        if (s.awsKn !== undefined) rec.awsBeat = s.awsKn;
      }),
      {
        id: 'nogo',
        title: 'The no-go zone',
        body: 'Keep turning towards the wind until the TWA is under 30°. The sails flap and the boat slows: no boat can sail this close to the wind.',
        hint: 'Do not wait there: bear away again as soon as you see it.',
        targets: ['twa', 'helm'],
        goal: (s) => s.twaDeg < 30,
      },
      {
        id: 'out',
        title: 'Bear away',
        body: 'Bear away before the boat stops: TWA over 50° and speed over 2.5 kn.',
        hint: 'A boat stopped head to wind is "in irons". Drifting backwards out of irons is not modelled yet (review PH-4): bear away while she is still moving.',
        targets: ['twa', 'helm'],
        goal: (s) => s.twaDeg > 50 && s.stwKn > 2.5,
      },
      runStep(
        'Bear away until the wind is behind you: a TWA of 150° or more, for 3 seconds. Watch the apparent wind arrow shrink: running, you move with the wind.',
        (s, _m, rec) => {
          if (s.awsKn !== undefined) rec.awsRun = s.awsKn;
        },
      ),
      explain('result', 'Points of sail', 'Close-hauled, reaching, running: the same true wind feels strongest upwind and lightest downwind. Next: trimming the sails.'),
    ],
    result: (rec, t) => [
      `Lesson time ${mmss(t)}.`,
      `Apparent wind: ${kn1(rec.awsBeat)} kn close-hauled, ${kn1(rec.awsReach)} kn on a beam reach, ${kn1(rec.awsRun)} kn running, in a true wind of 10 kn.`,
    ],
  },
  {
    id: 'trim',
    number: 3,
    title: 'Trim',
    summary: 'Telltales, luffing and stalling, and when to use auto-trim.',
    minutes: 4,
    scenario: openWater(10, 135),
    input: AUTO,
    overlay: [],
    steps: [
      explain(
        'intro',
        'Reading the sails',
        'The wool tufts near the front of the jib are telltales: both streaming aft means the sail is drawing. Each sheet in the dock says how its sail is working: Drawing, Luffing (too far out: the front flaps) or Stalled (too far in: the air breaks away).',
        { targets: ['main', 'jib'] },
      ),
      {
        id: 'main',
        title: 'Trim the mainsail',
        body: 'Auto-trim for the main is now off: the sheet is yours. Ease the main (S or ↓) until its status says Luffing, then pull it in (W or ↑) until it just says Drawing again. That is the sweet spot.',
        hint: 'Hold it there for 3 seconds.',
        targets: ['main'],
        input: { autoMain: false },
        goal: (s, m) => m.sawLuffing && s.main === 'drawing',
        holdS: 3,
      },
      {
        id: 'jib',
        title: 'Trim the jib',
        body: 'Now the jib is yours too. Ease it (Q) until it says Luffing, then trim it in (E) until it just draws again, for 3 seconds.',
        targets: ['jib'],
        input: { autoJib: false },
        goal: (s, m) => m.sawJibLuffing && s.jib === 'drawing',
        holdS: 3,
      },
      {
        id: 'auto',
        title: 'Auto-trim',
        body: 'Auto-trim keeps both sails at the sweet spot, so you can concentrate on steering. Turn it back on for both sails: M for the main, J for the jib, or their Auto boxes.',
        hint: 'Trim by hand to practise, or to trim for a gust or a mark when racing.',
        targets: ['main', 'jib'],
        goal: (s) => s.autoMain && s.autoJib !== false,
      },
      explain('result', 'Trimmed', 'When you change course, the sails need trimming again: in as you head up, out as you bear away. Next: tacking and gybing.'),
    ],
    result: (_rec, t) => [`Lesson time ${mmss(t)}.`],
  },
  {
    id: 'turns',
    number: 4,
    title: 'Tacking and gybing',
    summary: 'Turning through the wind and with it, timed against the model.',
    minutes: 5,
    scenario: openWater(10, 180, {}, 4),
    input: AUTO,
    overlay: ['wind'],
    steps: [
      upwindStep(),
      tackStep('tack', 'Tack', 'Tack: turn the bow through the wind until the sails fill on the other side, then settle close-hauled on the new tack.', 1),
      tackStep('tack2', 'And back', 'Tack again. A steady turn, neither too slow nor too sharp, loses the least speed.', 2),
      runStep('Bear away until the wind is behind you: a TWA of 150° or more, for 3 seconds.'),
      {
        id: 'gybe',
        title: 'Gybe',
        body: 'Keep turning gently the same way, so the stern passes through the wind. The boom swings across to the other side: that is a gybe. In a real boat, duck!',
        hint: 'Turn slowly. With the main far out, the boom crosses fast.',
        targets: ['helm', 'main'],
        observe: (s, m) => {
          m.v.inKn ??= s.stwKn;
          m.v.minKn = Math.min(m.v.minKn ?? s.stwKn, s.stwKn);
        },
        goal: (s, m) => s.mainSide !== m.start.mainSide && s.twaDeg >= 100,
        onDone: (s, m, rec) => {
          rec.gybeInKn = m.v.inKn ?? s.stwKn;
          rec.gybeMinKn = m.v.minKn ?? s.stwKn;
        },
      },
      explain('result', 'Tacked and gybed', 'Next: the start of a race.'),
    ],
    result: (rec, t) => {
      const lines = [`Lesson time ${mmss(t)}.`];
      for (const n of [1, 2]) {
        const s = rec[`tack${n}S`];
        if (s !== undefined) lines.push(`Tack ${n}: ${Number.isFinite(s) ? `${s.toFixed(1)} s, ` : ''}${kn1(rec[`tack${n}InKn`])} → ${kn1(rec[`tack${n}MinKn`])} kn at the slowest.`);
      }
      if (rec.gybeInKn !== undefined) lines.push(`Gybe: ${kn1(rec.gybeInKn)} → ${kn1(rec.gybeMinKn)} kn at the slowest.`);
      lines.push("The model's own tack in 10 kn takes 8.6 s and slows from 4.8 to 2.5 kn (model output, not yet checked by sailors).");
      return lines;
    },
  },
  {
    id: 'start',
    number: 5,
    title: 'The start',
    summary: 'The countdown, the line, being over early and clearing.',
    minutes: 3,
    scenario: {
      ...openWater(10, 0),
      startSpeedKn: 2,
      course: { source: 'practice', kind: 'windward-leeward', legM: 250, laps: 1 },
      race: { sequence: 'one-minute', startInS: 70 },
      fleet: { aiCount: 0, level: 'good', prepFlag: 'P' },
    },
    input: AUTO,
    overlay: ['heading'],
    steps: [
      explain(
        'intro',
        'The start line',
        'The start line runs between the committee boat, flying the flags at the starboard end, and the pin buoy at the port end. The race panel counts down to the start signal, and the horn sounds with each signal.',
        { targets: ['race'] },
      ),
      {
        id: 'wait',
        title: 'Hold back',
        body: 'Stay on the pre-start side of the line until the start signal. Time your approach so you reach the line just after it, at full speed.',
        hint: 'Over the line at the signal? Sail back round either end (the race panel shows the nearer one), then start.',
        targets: ['race', 'helm'],
        goal: (s) => !!s.race && s.race.toStart <= 0 && !s.race.ocs,
        readout: (s) => (s.race ? (s.race.toStart > 0 ? `Start in ${Math.ceil(s.race.toStart)} s` : s.race.ocs ? 'Over the line early: clear it' : 'Started: go!') : undefined),
      },
      {
        id: 'cross',
        title: 'Start',
        body: 'Cross the line and sail on towards the windward mark.',
        targets: ['race'],
        goal: (s) => s.race?.startedAt !== undefined,
        onDone: (s, _m, rec) => {
          rec.startDelayS = s.race!.startedAt! - s.race!.signalAt;
          rec.startKn = s.stwKn;
        },
        readout: (s) => (s.race && s.race.toStart <= 0 ? `${Math.round(-s.race.toStart)} s since the signal` : undefined),
      },
      explain('result', 'Started', 'A good start crosses within a few seconds of the signal, at full speed, with nobody in the way. Practise it in Race: the short course takes about five minutes. Next: the stream.'),
    ],
    result: (rec, t) => {
      const lines = [`Lesson time ${mmss(t)}.`];
      if (rec.startDelayS !== undefined) {
        lines.push(`You started ${rec.startDelayS.toFixed(1)} s after the signal, at ${kn1(rec.startKn)} kn.`);
        lines.push(rec.startDelayS <= 5 ? 'A sharp start.' : rec.startDelayS <= 15 ? 'A safe start: try to be closer to the line at the signal.' : 'A late start: be nearer the line, moving, when the signal sounds.');
      }
      return lines;
    },
  },
  {
    id: 'tide',
    number: 6,
    title: 'The stream',
    summary: 'Speed through the water against over the ground, and VMG, in a steady stream.',
    minutes: 4,
    scenario: openWater(10, 135, { current: { mode: 'uniform', setDeg: 45, rateKn: 1.2 } }),
    input: AUTO,
    overlay: ['heading', 'cog', 'current', 'vmg'],
    steps: [
      explain(
        'intro',
        'The water moves',
        'Here the water itself moves: an illustrative steady stream of 1.2 kn setting north-east (not the Dart’s), shown by the arrow labelled Stream. Speed through the water (STW) is what the sails and keel feel; speed over the ground (SOG) adds the stream, and the course over ground line points away from your heading.',
        { targets: ['speed'] },
      ),
      {
        id: 'against',
        title: 'Against the stream',
        body: 'Sail upwind: the stream is against you, so your SOG is lower than your STW. Hold SOG at least 0.5 kn under STW for 5 seconds.',
        targets: ['twa', 'helm'],
        goal: (s) => s.sogKn !== undefined && s.stwKn - s.sogKn >= 0.5,
        holdS: 5,
        readout: (s) => (s.sogKn === undefined ? undefined : `STW ${s.stwKn.toFixed(1)} kn · SOG ${s.sogKn.toFixed(1)} kn`),
      },
      {
        id: 'with',
        title: 'With the stream',
        body: 'Now bear away and sail downwind, with the stream: hold SOG at least 0.5 kn over STW for 5 seconds.',
        targets: ['twa', 'helm'],
        goal: (s) => s.sogKn !== undefined && s.sogKn - s.stwKn >= 0.5,
        holdS: 5,
        readout: (s) => (s.sogKn === undefined ? undefined : `STW ${s.stwKn.toFixed(1)} kn · SOG ${s.sogKn.toFixed(1)} kn`),
      },
      {
        id: 'vmg',
        title: 'Velocity made good',
        body: 'VMG is your speed straight towards the wind (the line labelled VMG). Sail close-hauled and get VMG over 2.5 kn for 5 seconds: point too high and you slow down; too low and you sail across the wind instead of up it.',
        targets: ['twa', 'helm'],
        goal: (s) => s.vmgKn !== undefined && s.vmgKn >= 2.5 && s.twaDeg < 90,
        holdS: 5,
        onDone: (s, _m, rec) => {
          rec.vmgKn = s.vmgKn ?? NaN;
        },
        readout: (s) => (s.vmgKn === undefined ? undefined : `VMG ${s.vmgKn.toFixed(1)} kn`),
      },
      explain('result', 'Stream and VMG', 'In a stream, what counts is progress over the ground; to windward, what counts is VMG. Laylines are not drawn yet. Next: race. The short course takes about five minutes.'),
    ],
    result: (rec, t) => [`Lesson time ${mmss(t)}.`, ...(rec.vmgKn !== undefined ? [`VMG held at ${kn1(rec.vmgKn)} kn.`] : [])],
  },
];

export function lessonById(id: LessonId): Lesson {
  return LESSONS.find((l) => l.id === id)!;
}

// -------------------------------------------------------------- progress, kept in this browser

const KEY = 'squib.lessons.v1';

export type LessonProgress = Partial<Record<LessonId, { done: true; bestS: number; at: string }>>;

export function loadLessonProgress(): LessonProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as LessonProgress;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Mark a lesson done with its time; returns the progress and whether the time is a new best. */
export function saveLessonDone(id: LessonId, timeS: number, now = new Date()): { progress: LessonProgress; best: boolean } {
  const p = loadLessonProgress();
  const was = p[id];
  const best = !was || timeS < was.bestS;
  p[id] = { done: true, bestS: best ? timeS : was!.bestS, at: now.toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: progress lasts for this visit
  }
  return { progress: p, best };
}

/** The first lesson not yet done (the first again when all are). */
export function nextLessonFor(p: LessonProgress): Lesson {
  return LESSONS.find((l) => !p[l.id]) ?? LESSONS[0]!;
}

export function lessonAfter(id: LessonId): Lesson | undefined {
  const i = LESSONS.findIndex((l) => l.id === id);
  return LESSONS[i + 1];
}
