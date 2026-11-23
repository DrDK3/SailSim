/**
 * The assist record of an attempt (juniors round §6.2). The shape and the rule are the exercise engine's
 * (`Assists` and `isIndependent` in src/app/exercises/engine.ts), kept in one place since the training slice merged:
 * an attempt is `independent` only if at no time during it auto-trim was on for either sail, the teaching overlay was
 * shown (the lesson overlay or the gust outlines), or live help was shown or asked for (a hint or a coach tip).
 * Auto-crew (hiking) does not by itself make a run assisted.
 *
 * Auto-trim is in the replay's input log, so a verifier can check it; the overlay and live help are not in the replay
 * and are as reported by the app (src/app/clubTable.ts says so).
 */
import type { InputRow } from './replay';
import { isIndependent, type Assists } from './exercises/engine';

export interface AssistRecord {
  independent: boolean;
  assists: Assists;
}

export function noAssists(): AssistRecord {
  return { independent: true, assists: { autoMain: false, autoJib: false, autoCrew: false, overlay: false, liveHelp: false } };
}

/** Note what was on now (call as often as convenient: every physics step, or every frame). */
export function noteAssists(r: AssistRecord, now: Partial<AssistRecord['assists']>): void {
  const a = r.assists;
  if (now.autoMain) a.autoMain = true;
  if (now.autoJib) a.autoJib = true;
  if (now.autoCrew) a.autoCrew = true;
  if (now.overlay) a.overlay = true;
  if (now.liveHelp) a.liveHelp = true;
  r.independent = isIndependent(a);
}

/** Auto-trim as the replay's input log shows it (flags: autoMain 1, autoJib 2, autoCrew 4), up to `endStep`. */
export function assistsFromInputs(rows: readonly InputRow[], endStep = Infinity): Pick<AssistRecord['assists'], 'autoMain' | 'autoJib' | 'autoCrew'> {
  const out = { autoMain: false, autoJib: false, autoCrew: false };
  for (const r of rows) {
    if (r[0] > endStep) break;
    const f = r[5];
    if (f & 1) out.autoMain = true;
    if (f & 2) out.autoJib = true;
    if (f & 4) out.autoCrew = true;
  }
  return out;
}

export const assistLabel = (r: AssistRecord): string => (r.independent ? 'independent' : 'assisted');

/**
 * The two words used everywhere for an attempt's support (design handover item 7: the checklist, results and exports
 * agree), and what they mean. Input adaptations are not assists: they never make an attempt assisted.
 */
export const SUPPORT_TERMS = {
  independent: 'independent',
  assisted: 'assisted',
  definition:
    'Independent: no auto-trim on either sail, no teaching overlay and no live help at any time in the attempt. Assisted: any of those was on. Auto-crew (hiking) is not counted. Input adaptations (tiller or car steering, keyboard, touch, switch or gamepad controls, reduced motion, captions) are not assists and never make an attempt assisted.',
} as const;

const ASSIST_WORDS: Record<keyof Assists, string> = { autoMain: 'auto-trim on the main', autoJib: 'auto-trim on the jib', autoCrew: 'auto-crew', overlay: 'the teaching overlay', liveHelp: 'live help' };

/**
 * Support described against the task (design handover item 7): which assists were on, which of them bear on what the
 * activity demonstrates, and which do not (an AI trimmer in a decision exercise). Does not change `independent`.
 */
export function supportForTask(a: Assists, task: { focus: string; outside: readonly (keyof Assists)[] }): { onTask: string[]; offTask: string[]; text: string } {
  const on = (Object.keys(ASSIST_WORDS) as (keyof Assists)[]).filter((k) => a[k] && k !== 'autoCrew');
  const onTask = on.filter((k) => !task.outside.includes(k)).map((k) => ASSIST_WORDS[k]);
  const offTask = on.filter((k) => task.outside.includes(k)).map((k) => ASSIST_WORDS[k]);
  const text = !on.length
    ? `Independent. The task: ${task.focus}.`
    : `Assisted: ${[...onTask, ...offTask].join(', ')}. The task: ${task.focus}.${offTask.length ? ` ${cap(offTask.join(' and '))} did not bear on it${onTask.length ? '; the rest did' : ''}.` : ''}`;
  return { onTask, offTask, text };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
