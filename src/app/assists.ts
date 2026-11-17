/**
 * The assist record of an attempt (juniors round §6.2), the same shape and definition as the training slice's
 * (branch training-slice, not merged when this was written: one of the two should be kept at merge):
 * an attempt is `independent` only if at no time during it auto-trim was on for either sail, the teaching overlay was
 * shown (the lesson overlay or the gust outlines), or live help was shown or asked for (a hint or a coach tip).
 * Auto-crew (hiking) does not by itself make a run assisted.
 *
 * Auto-trim is in the replay's input log, so a verifier can check it; the overlay and live help are not in the replay
 * and are as reported by the app (src/app/clubTable.ts says so).
 */
import type { InputRow } from './replay';

export interface AssistRecord {
  independent: boolean;
  assists: { autoMain: boolean; autoJib: boolean; autoCrew: boolean; overlay: boolean; liveHelp: boolean };
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
  r.independent = !(a.autoMain || a.autoJib || a.overlay || a.liveHelp);
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
