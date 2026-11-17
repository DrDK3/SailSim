import type { SteeringMode } from '../steering';
import { sailAdvice, type SailState } from '../sailStatus';
import { CONTENT_STATUS, type TackRecoverThresholds } from './config';
import { median, seeded, type AttemptPlan, type AttemptRecord, type ExerciseDef, type ExerciseResult, type ExerciseSample, type HelpLadder, type PhaseDef, type ReviewItem } from './engine';

/**
 * Beginner exercise: trim, tack and recover (training slice §7). Steady open water (no gusts, no stream, a fixed
 * seed and a manual wind), on the basic lessons' water. After a 30-second warm-up that is not scored, four attempts,
 * alternately on starboard and port tack, each from a close reach at a seed-varied heading:
 *
 *  1. Close-hauled: find close-hauled and hold it, sails drawing.
 *  2. The cue: head up until a sail luffs (the edge of the no-go zone), then bear away until it draws.
 *  3. Tack: turn through the wind to the other tack.
 *  4. Recover: settle close-hauled on the new tack with the speed back.
 *
 * Assistance falls over the attempts: the first two with auto-trim on both sails, the overlay and help that comes
 * by itself (Learn assistance); the third with the main sheet in your hands; the last with both sheets, no overlay,
 * and help only when asked. It builds on lesson 4 (Tacking and gybing: src/app/lessons.ts), whose tack timing it
 * uses. Thresholds: data/exercises/thresholds.json, every one provisional (E), starting from issue 47's.
 */

export const TACK_RECOVER_ID = 'tack-recover';

/** Keys that turn the bow to starboard or to port in the user's steering mode (src/app/steering.ts). */
export function bowKeys(mode: SteeringMode): { starboard: string; port: string } {
  return mode === 'tiller' ? { starboard: 'A or ← (tiller to port)', port: 'D or → (tiller to starboard)' } : { starboard: 'D or →', port: 'A or ←' };
}

const tackName = (tack: 1 | -1) => (tack === 1 ? 'starboard' : 'port');
const f1 = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1));
const f0 = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(0));

/** The attempts' plans: alternate tacks, seed-varied headings, falling assistance. */
export function tackRecoverPlans(t: TackRecoverThresholds): AttemptPlan[] {
  const rnd = seeded(t.seed);
  const n = Math.max(1, Math.round(t.attempts));
  const half = Math.ceil(n / 2);
  return Array.from({ length: n }, (_, i): AttemptPlan => {
    const tack: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const twa = t.startTwaDeg + (rnd() * 2 - 1) * t.headingJitterDeg;
    // Starboard tack: the wind comes over the starboard bow, so the boat points to the left of the wind.
    const headingDeg = (((t.windFromDeg - tack * twa) % 360) + 360) % 360;
    if (i < half) return { tack, headingDeg, start: { autoMain: true, autoJib: true, autoCrew: true, overlay: true, help: 'auto' }, label: 'Full assistance: auto-trim, overlay, help' };
    if (i < n - 1) return { tack, headingDeg, start: { autoMain: false, autoJib: true, autoCrew: true, overlay: true, help: 'auto' }, label: 'Less assistance: the main sheet is yours' };
    return { tack, headingDeg, start: { autoMain: false, autoJib: false, autoCrew: true, overlay: false, help: 'request' }, label: 'On your own: both sheets, no overlay, help only if you ask' };
  });
}

const drawingish = (st: SailState | undefined) => st !== 'luffing' && st !== 'stalled';

/** A sail whose sheet is in the learner's hands and is not drawing: the help for it (the fixed sail advice, issue 199). */
function trimHelp(s: ExerciseSample): HelpLadder | undefined {
  for (const sail of ['main', 'jib'] as const) {
    const auto = sail === 'main' ? s.autoMain : s.autoJib === true;
    const state = sail === 'main' ? s.main : s.jib;
    if (auto || !state || drawingish(state)) continue;
    const keys = sail === 'main' ? { trim: 'W', ease: 'S' } : { trim: 'E', ease: 'Q' };
    const a = sailAdvice(state, keys, { sail, sheet: sail === 'main' ? s.mainSheet : s.jibSheet, auto });
    if (a.action !== 'trim' && a.action !== 'ease') continue;
    const name = sail === 'main' ? 'main' : 'jib';
    return {
      id: `trim-${sail}`,
      targets: [sail],
      attention: `Look at the ${name}'s status in the dock.`,
      explain: state === 'luffing' ? `The ${name} is luffing: the sheet is too far out for this course, so the front of the sail flaps.` : `The ${name} is stalled: the sheet is too far in for this course, so the air breaks away from the sail.`,
      suggest: `${a.advice[0]!.toUpperCase()}${a.advice.slice(1)}, until it says Drawing.`,
    };
  }
  return undefined;
}

/** Help for holding close-hauled: the course first, then speed, then the sheets. */
function closeHauledHelp(t: TackRecoverThresholds, keys: { starboard: string; port: string }) {
  return (s: ExerciseSample): HelpLadder => {
    const side = s.mainSide === 1 ? 1 : -1;
    const towards = side === 1 ? keys.starboard : keys.port;
    const away = side === 1 ? keys.port : keys.starboard;
    if (s.twaDeg > t.closeHauledMaxTwaDeg) {
      return {
        id: 'too-low',
        targets: ['twa', 'compass'],
        attention: 'Look at the TWA (true wind angle).',
        explain: `TWA ${f0(s.twaDeg)}°: you are sailing across the wind, not up it. Close-hauled is about 45° (${t.closeHauledMinTwaDeg}–${t.closeHauledMaxTwaDeg}°).`,
        suggest: `Turn the bow towards the wind (${towards}) until the TWA reads about 45°.`,
      };
    }
    // Within the band (or above it), a sheet in the learner's hands that is not drawing is the sheet's doing.
    if (s.twaDeg >= t.closeHauledMinTwaDeg) {
      const trim = trimHelp(s);
      if (trim) return trim;
    }
    if (s.twaDeg < t.closeHauledMinTwaDeg || s.main === 'luffing' || s.jib === 'luffing') {
      return {
        id: 'too-high',
        targets: ['twa', 'jib'],
        attention: 'Look at the TWA and the front edge of the jib.',
        explain: `TWA ${f0(s.twaDeg)}°: too close to the wind. The sails luff and the boat slows: this is the edge of the no-go zone.`,
        suggest: `Bear away a little: turn the bow away from the wind (${away}) until the TWA reads about 45° and the sails draw.`,
      };
    }
    return {
      id: 'slow',
      targets: ['speed', 'twa'],
      attention: 'Look at your speed (STW).',
      explain: `${f1(s.stwKn)} kn: the boat has not built up speed yet (aim for ${t.closeHauledMinKn} kn or more).`,
      suggest: `Bear away 5–10° (${away}) to build speed, then head up to about 45° again.`,
    };
  };
}

export function tackRecoverExercise(t: TackRecoverThresholds, steering: SteeringMode = 'bow'): ExerciseDef {
  const keys = bowKeys(steering);
  const inBand = (s: ExerciseSample) => s.twaDeg >= t.closeHauledMinTwaDeg && s.twaDeg <= t.closeHauledMaxTwaDeg;
  const sailsDrawing = (s: ExerciseSample) => drawingish(s.main) && drawingish(s.jib);
  const sheetsNote = (plan: AttemptPlan) =>
    !plan.start.autoMain && !plan.start.autoJib ? ' Both sheets are yours: trim them as you turn.' : !plan.start.autoMain ? ' The main sheet is yours: trim it as you turn.' : '';

  const warmUp: PhaseDef = {
    id: 'warm-up',
    title: 'Try the controls (not scored)',
    body: () =>
      `Thirty seconds to try the controls; nothing is scored. Steer: ${keys.starboard} turns the bow to starboard, ${keys.port} to port. Sheets: W and S trim and ease the main, E and Q the jib. The first attempt starts by itself, or press Start.`,
    targets: ['helm', 'main', 'jib'],
    durationS: t.familiariseS,
    unscored: true,
  };

  const closeHauled: PhaseDef = {
    id: 'close-hauled',
    title: 'Close-hauled',
    body: (plan) =>
      `You are on a close reach on ${tackName(plan.tack)} tack. Turn towards the wind until the TWA is about 45° (${t.closeHauledMinTwaDeg}–${t.closeHauledMaxTwaDeg}°) with ${t.closeHauledMinKn} kn or more and the sails drawing. Hold it for ${t.holdS} s.${sheetsNote(plan)}`,
    targets: ['twa', 'helm'],
    goal: (s) => inBand(s) && s.stwKn >= t.closeHauledMinKn && sailsDrawing(s),
    holdS: t.holdS,
    help: closeHauledHelp(t, keys),
    onDone: (s, m, rec) => {
      rec.values.closeHauledS = s.t - m.start.t;
    },
    readout: (s) => `TWA ${f0(s.twaDeg)}° · ${f1(s.stwKn)} kn`,
  };

  const cue: PhaseDef = {
    id: 'cue',
    title: 'Find the edge of the wind',
    body: () => `Head up slowly until a sail says Luffing: its front edge flaps. That is the edge of the no-go zone. Then bear away until both sails draw again, and hold for ${t.cueHoldS} s.`,
    targets: ['jib', 'main', 'twa'],
    observe: (s, m) => {
      if (s.main === 'luffing' || s.jib === 'luffing') {
        if (!m.flags.has('luff')) m.v.luffTwa = s.twaDeg;
        m.flags.add('luff');
      }
    },
    goal: (s, m) => m.flags.has('luff') && sailsDrawing(s) && inBand(s),
    holdS: t.cueHoldS,
    help: (s, m) => {
      const side = s.mainSide === 1 ? 1 : -1;
      const towards = side === 1 ? keys.starboard : keys.port;
      const away = side === 1 ? keys.port : keys.starboard;
      if (!m.flags.has('luff'))
        return {
          id: 'find-luff',
          targets: ['jib', 'twa'],
          attention: "Look at the jib's status in the dock while you turn.",
          explain: 'Close to the wind the front of the sail lifts and flaps (it luffs): that is the edge of the no-go zone, where the sails stop driving the boat.',
          suggest: `Turn slowly towards the wind (${towards}) until the jib says Luffing.`,
        };
      return {
        id: 'back-to-drawing',
        targets: ['jib', 'twa'],
        attention: "Look at the sails' status: one is still luffing, or the TWA is outside the close-hauled band.",
        explain: 'You found the edge. Now come back just below it, where the sails draw again: that is close-hauled.',
        suggest: `Bear away (${away}) until both sails say Drawing and the TWA is ${t.closeHauledMinTwaDeg}–${t.closeHauledMaxTwaDeg}°.`,
      };
    },
    onDone: (_s, m, rec) => {
      if (m.v.luffTwa !== undefined) rec.values.luffTwaDeg = m.v.luffTwa;
    },
    readout: (s) => `TWA ${f0(s.twaDeg)}° · main ${s.main} · jib ${s.jib ?? '—'}`,
  };

  const tack: PhaseDef = {
    id: 'tack',
    title: 'Tack',
    body: (plan) => `Tack: turn the bow through the wind, steadily, until the sails fill on the other side.${sheetsNote(plan)}`,
    targets: ['helm', 'compass'],
    observe: (s, m, rec) => {
      // The side the tack starts from (a gybe resets it: the tack still has to be done from the new side).
      m.v.fromSide ??= m.start.mainSide;
      if (s.mainSide !== m.v.lastSide && m.v.lastSide !== undefined && s.twaDeg > 90) {
        // The sails crossed with the wind abaft the beam: a gybe, not a tack.
        m.flags.add('gybed');
        if (!rec.issues.includes('gybed')) rec.issues.push('gybed');
        m.v.fromSide = s.mainSide;
        delete m.v.turnAt;
        delete m.v.minKn;
      }
      m.v.lastSide = s.mainSide;
      if (m.v.turnAt === undefined) {
        if (s.twaDeg < t.tackStartTwaDeg && s.mainSide === m.v.fromSide) Object.assign(m.v, { turnAt: s.t, inKn: m.v.lastKn ?? s.stwKn, minKn: s.stwKn });
        else m.v.lastKn = s.stwKn;
      } else if (s.mainSide === m.v.fromSide && s.twaDeg >= t.closeHauledMinTwaDeg) {
        // Back in the close-hauled band on the old side: the turn was given up (help comes again if it stays so).
        delete m.v.turnAt;
        delete m.v.minKn;
      } else m.v.minKn = Math.min(m.v.minKn!, s.stwKn);
      // In irons: stopped with the bow near the wind.
      if (s.stwKn < t.ironsKn && s.twaDeg < 30) m.v.ironsS = (m.v.ironsS ?? 0) + 0.1;
      else m.v.ironsS = 0;
      if ((m.v.ironsS ?? 0) >= t.ironsS && !rec.issues.includes('irons')) rec.issues.push('irons');
    },
    // Through the wind (the bow passed close to it on the old side) and onto the other tack, sailing.
    goal: (s, m) => m.v.turnAt !== undefined && m.v.fromSide !== undefined && s.mainSide !== m.v.fromSide && s.twaDeg >= t.tackStartTwaDeg && s.twaDeg < 90 && s.stwKn > t.tackDoneMinKn,
    // Turning normally is not being stuck; not starting, or stopping head to wind, is.
    stuck: (s, m) => (m.v.turnAt === undefined && s.t - m.start.t > 6) || (m.v.ironsS ?? 0) > 2 || (m.flags.has('gybed') && m.v.turnAt === undefined),
    help: (_s, m) => {
      const side = (m.v.fromSide ?? m.start.mainSide) === 1 ? 1 : -1;
      const towards = side === 1 ? keys.starboard : keys.port;
      if (m.flags.has('gybed') && m.v.turnAt === undefined)
        return {
          id: 'gybed',
          targets: ['helm', 'twa'],
          attention: 'Look at the TWA: the wind came round behind you.',
          explain: 'That was a gybe: the stern went through the wind. A tack turns the bow through the wind instead.',
          suggest: `Head up to close-hauled (${towards}), then keep turning the same way through the wind to tack.`,
        };
      if ((m.v.ironsS ?? 0) > 2)
        return {
          id: 'irons',
          targets: ['speed', 'twa', 'helm'],
          attention: 'Look at your speed and the TWA.',
          explain: 'You have stopped with the bow into the wind ("in irons"): the sails cannot drive the boat until the bow is off the wind.',
          suggest: `Keep the helm over (${towards}) to bring the bow round; if she will not come, press Restart attempt. (The model does not drift backwards out of irons as a real boat does.)`,
        };
      return {
        id: 'start-tack',
        targets: ['helm', 'compass'],
        attention: 'Ready to tack? Watch the compass as you turn.',
        explain: 'A tack turns the bow through the wind; the sails cross to the other side and fill again.',
        suggest: `Hold ${towards} (towards the wind) and keep turning until the sails fill on the other side.`,
      };
    },
    onDone: (s, m, rec) => {
      rec.values.tackS = m.v.turnAt === undefined ? NaN : s.t - m.v.turnAt;
      rec.values.tackInKn = m.v.inKn ?? m.v.lastKn ?? s.stwKn;
      rec.values.tackMinKn = m.v.minKn ?? s.stwKn;
    },
    readout: (s) => `TWA ${f0(s.twaDeg)}° · ${f1(s.stwKn)} kn`,
  };

  const recover: PhaseDef = {
    id: 'recover',
    title: 'Recover',
    body: (plan) =>
      `Settle close-hauled on the new tack (TWA ${t.closeHauledMinTwaDeg}–${t.closeHauledMaxTwaDeg}°, sails drawing) and get your speed back to ${Math.round(t.recoverFrac * 100)}% of the speed you tacked at. Hold it for ${t.recoverHoldS} s.${sheetsNote(plan)}`,
    targets: ['twa', 'speed'],
    observe: (s, m, rec) => {
      m.v.maxTwa = Math.max(m.v.maxTwa ?? 0, s.twaDeg);
      if (s.twaDeg > t.overshootTwaDeg && !rec.issues.includes('overshoot')) rec.issues.push('overshoot');
      for (const sail of ['main', 'jib'] as const) {
        const auto = sail === 'main' ? s.autoMain : s.autoJib === true;
        const st = sail === 'main' ? s.main : s.jib;
        if (!auto && st && !drawingish(st)) m.v[`${sail}OffS`] = (m.v[`${sail}OffS`] ?? 0) + 0.1;
      }
    },
    // The recovery target is a share of the speed going into this attempt's tack (none if the tack was skipped).
    goal: (s, _m, _plan, rec) => inBand(s) && sailsDrawing(s) && s.stwKn >= t.recoverFrac * (rec?.values.tackInKn ?? 0),
    holdS: t.recoverHoldS,
    help: closeHauledHelp(t, keys),
    onDone: (s, m, rec) => {
      rec.values.recoverS = s.t - m.start.t;
      rec.values.recoveredKn = s.stwKn;
      rec.values.maxTwaAfterDeg = m.v.maxTwa ?? s.twaDeg;
      rec.values.mainOffS = m.v.mainOffS ?? 0;
      rec.values.jibOffS = m.v.jibOffS ?? 0;
      if (rec.values.recoverS > t.slowRecoverS) rec.issues.push('slow-recover');
    },
    readout: (s, _m, rec) => `TWA ${f0(s.twaDeg)}° · ${f1(s.stwKn)} kn${rec?.values.tackInKn !== undefined ? ` (target ${f1(t.recoverFrac * rec.values.tackInKn)} kn)` : ''}`,
  };

  return {
    id: TACK_RECOVER_ID,
    title: 'Trim, tack and recover',
    summary: 'Find close-hauled, feel the edge of the wind, tack, and get going again: four attempts, with less help each time.',
    minutes: 8,
    intro: warmUp,
    phases: [closeHauled, cue, tack, recover],
    plans: tackRecoverPlans(t),
    helpTimes: [t.helpAttentionS, t.helpExplainS, t.helpSuggestS],
    review: (rec) => tackRecoverReview(rec, t),
    result: (records) => tackRecoverResult(records, t),
  };
}

/** The post-attempt explanation (help level 4): observation, likely cause and an action, from rules only. */
export function tackRecoverReview(rec: AttemptRecord, t: TackRecoverThresholds): ReviewItem[] {
  const v = rec.values;
  const out: ReviewItem[] = [];
  for (const p of rec.skipped) out.push({ id: `skipped-${p}`, observation: `The ${p.replace('-', ' ')} step was skipped.` });
  if (rec.issues.includes('gybed'))
    out.push({ id: 'gybed', observation: 'The boat gybed (the stern went through the wind) before the tack.', cause: 'Likely cause: turning away from the wind instead of towards it.', action: 'Next time: turn the bow towards the wind to tack.' });
  if (rec.issues.includes('irons'))
    out.push({ id: 'irons', observation: `The boat stopped with the bow into the wind for ${t.ironsS} s or more (in irons).`, cause: 'Likely cause: the turn slowed or stopped before the bow crossed the wind.', action: 'Next time: build speed first, then turn steadily through the wind without stopping.' });
  const inKn = v.tackInKn;
  const minKn = v.tackMinKn;
  if (inKn !== undefined && minKn !== undefined && minKn < t.bigLossFrac * inKn)
    out.push({ id: 'big-loss', observation: `Speed fell from ${f1(inKn)} to ${f1(minKn)} kn in the tack.`, cause: 'Likely cause: a slow turn, or the boat stopped head to wind.', action: 'Next time: one steady turn; on the new tack bear away a little to build speed before heading up.' });
  if (v.tackS !== undefined && v.tackS > t.slowTackS)
    out.push({ id: 'slow-tack', observation: `The tack took ${f1(v.tackS)} s. The model's own tack in 10 kn takes about 8.6 s (model output, not checked by sailors).`, cause: 'Likely cause: the helm was not held over long enough.', action: 'Next time: keep the helm over until the sails fill on the new side.' });
  if (rec.issues.includes('overshoot'))
    out.push({ id: 'overshoot', observation: `After the tack you bore away to TWA ${f0(v.maxTwaAfterDeg)}°, beyond ${t.overshootTwaDeg}°.`, cause: 'Likely cause: the turn was not stopped as the sails filled.', action: 'Next time: centre the helm as the sails fill and settle at about 45°.' });
  for (const sail of ['main', 'jib'] as const) {
    const off = v[`${sail}OffS`];
    if (off !== undefined && off > 4)
      out.push({ id: `trim-${sail}`, observation: `The ${sail} was not drawing for ${f0(off)} s after the tack.`, cause: 'Likely cause: its sheet was not trimmed for the new course.', action: `Next time: watch the ${sail}'s status as you settle, and trim until it says Drawing.` });
  }
  if (rec.issues.includes('slow-recover'))
    out.push({ id: 'slow-recover', observation: `Course and speed came back after ${f0(v.recoverS)} s (aim: within ${t.slowRecoverS} s).`, cause: 'Likely cause: pointing high before the speed came back, or sheets not trimmed.', action: 'Next time: bear away a little to build speed, then head up to close-hauled.' });
  if (!out.length && rec.outcome !== 'incomplete')
    out.push({ id: 'clean', observation: `Clean tack: ${f1(v.tackS)} s, slowest ${f1(minKn)} kn of ${f1(inKn)} kn; course and speed back in ${f0(v.recoverS)} s.` });
  return out;
}

/** The order in which a next action is chosen: the most basic problem first. */
const PRIORITY = ['gybed', 'irons', 'big-loss', 'slow-tack', 'overshoot', 'trim-main', 'trim-jib', 'slow-recover'];

function summarise(records: AttemptRecord[], label: string): ExerciseResult['assisted'] {
  const done = records.filter((r) => r.outcome === 'complete');
  const lines: string[] = [];
  if (!records.length) return { attempts: 0, complete: 0, lines: [`${label}: none.`] };
  lines.push(`${label}: ${done.length} of ${records.length} complete.`);
  const tackS = median(done.map((r) => r.values.tackS ?? NaN));
  const keep = median(done.map((r) => (r.values.tackMinKn ?? NaN) / (r.values.tackInKn ?? NaN)));
  const rec = median(done.map((r) => r.values.recoverS ?? NaN));
  if (done.length) lines.push(`Tack ${f1(tackS)} s; slowest ${keep === undefined ? '—' : Math.round(keep * 100)}% of the speed going in; back on course and speed in ${f0(rec)} s (medians).`);
  const h = records.reduce((a, r) => ({ l1: a.l1 + r.help[1], l2: a.l2 + r.help[2], l3: a.l3 + r.help[3], asked: a.asked + r.help.requested }), { l1: 0, l2: 0, l3: 0, asked: 0 });
  lines.push(`Live help: ${h.l1} look, ${h.l2} why, ${h.l3} try (${h.asked} asked for).`);
  return { attempts: records.length, complete: done.length, lines };
}

export function tackRecoverResult(records: AttemptRecord[], t: TackRecoverThresholds): ExerciseResult {
  const independent = records.filter((r) => r.independent);
  const assisted = records.filter((r) => !r.independent);
  // A few observations, most basic first, from the latest attempts (where the learner is now).
  const items = records.flatMap((r) => r.review.map((i) => ({ ...i, n: r.n }))).filter((i) => i.id !== 'clean' && !i.id.startsWith('skipped'));
  const ranked = items.sort((a, b) => (PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id)) || b.n - a.n);
  const seen = new Set<string>();
  const observations: ReviewItem[] = [];
  for (const i of ranked) {
    if (seen.has(i.id) || observations.length >= 3) continue;
    seen.add(i.id);
    observations.push({ id: i.id, observation: `Attempt ${i.n}: ${i.observation}`, cause: i.cause, action: i.action });
  }
  const nextAction = observations[0]?.action ?? (independent.some((r) => r.outcome === 'complete') ? 'Next: try the wind-shift exercise, or repeat this one on your own from the start.' : 'Next: repeat the exercise, aiming to complete the last attempt on your own (no auto-trim, no overlay, no help).');
  return {
    assisted: summarise(assisted, 'Assisted attempts'),
    independent: summarise(independent, 'Independent attempts (no auto-trim, overlay or live help)'),
    observations,
    nextAction,
    notes: [
      `Thresholds are provisional (E): the simulator's choices, awaiting an instructor's review. Content status: ${CONTENT_STATUS}.`,
      `Close-hauled here means TWA ${t.closeHauledMinTwaDeg}–${t.closeHauledMaxTwaDeg}° at ${t.closeHauledMinKn} kn or more, as the lessons use.`,
    ],
  };
}
