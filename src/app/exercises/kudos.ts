/**
 * A quiet acknowledgement (design handover item 11, a pilot): one, for one verified behaviour in one exercise, a clean
 * tack in "Trim, tack and recover". Optional (Settings: after each attempt, at the end only, or off), delivered when
 * the workload has fallen (in the attempt's review, or the exercise's result, never while sailing), and saying exactly
 * what earned it, so the behaviour can be repeated without it.
 *
 * Defensible: it is earned only through the whole manoeuvre (entry, the turn, the recovery and the sails drawing),
 * never from a shortcut. A slow entry cannot earn it (entry speed has a floor, E); a skipped, aborted (incomplete) or
 * restarted attempt does not; one attempt has one tack, so repeating an action earns nothing more. Comparative praise
 * ("your quickest clean tack in this run") only against earlier clean tacks with a matching entry (speed within
 * 0.3 kn, the same tack side) and the same support (independent or assisted). No streaks, points or returns rewarded
 * (under-18 safeguards). Thresholds are the simulator's own (E), provisional until an instructor has reviewed them.
 */
import type { TackRecoverThresholds } from './config';
import type { AttemptRecord } from './engine';

export type KudosSetting = 'practice' | 'debrief' | 'off';
export const KUDOS_SETTINGS: { id: KudosSetting; label: string }[] = [
  { id: 'practice', label: 'After each attempt' },
  { id: 'debrief', label: 'At the end only' },
  { id: 'off', label: 'Off' },
];

export interface Kudos {
  id: 'clean-tack';
  text: string;
  /** What it was verified from. */
  basis: string;
}

/** The entry floor (kn, E): about three quarters of the model's close-hauled speed in the exercise's 10 kn of wind. */
export const KUDOS_ENTRY_MIN_KN = 3.4;
/** Speed kept through the turn (share of the entry speed, E). */
export const KUDOS_KEEP_FRAC = 0.6;
/** Sails not drawing after the tack (s, E). */
export const KUDOS_SAIL_OFF_S = 4;

const f1 = (v: number) => v.toFixed(1);

function clean(rec: AttemptRecord, t: TackRecoverThresholds): boolean {
  const v = rec.values;
  if (rec.outcome !== 'complete' || rec.skipped.length || rec.restarts > 0) return false;
  if (rec.issues.some((i) => ['gybed', 'irons', 'overshoot', 'slow-recover'].includes(i))) return false;
  const { tackS, tackInKn, tackMinKn, recoverS } = v;
  if (tackS === undefined || tackInKn === undefined || tackMinKn === undefined || recoverS === undefined) return false;
  if (!Number.isFinite(tackS) || tackS > t.slowTackS) return false;
  if (tackInKn < KUDOS_ENTRY_MIN_KN) return false;
  if (tackMinKn < KUDOS_KEEP_FRAC * tackInKn) return false;
  if (recoverS > t.slowRecoverS) return false;
  return Math.max(v.mainOffS ?? 0, v.jibOffS ?? 0) <= KUDOS_SAIL_OFF_S;
}

/** The acknowledgement for an attempt, if it earned one; `earlier` are the attempts before it in the same run. */
export function tackKudos(rec: AttemptRecord, t: TackRecoverThresholds, earlier: readonly AttemptRecord[] = []): Kudos | undefined {
  if (!clean(rec, t)) return undefined;
  const v = rec.values;
  const support = rec.independent ? 'independent' : 'assisted';
  const matching = earlier.filter((e) => e.n < rec.n && clean(e, t) && e.independent === rec.independent && e.plan.tack === rec.plan.tack && Math.abs((e.values.tackInKn ?? 0) - v.tackInKn!) <= 0.3);
  const quickest = matching.length > 0 && matching.every((e) => v.tackS! < e.values.tackS! - 0.2);
  return {
    id: 'clean-tack',
    text: `Clean tack: in at ${f1(v.tackInKn!)} kn, through the wind in ${f1(v.tackS!)} s keeping ${f1(v.tackMinKn!)} kn, back up to speed in ${Math.round(v.recoverS!)} s with the sails drawing (${support}).${quickest ? ' Your quickest clean tack in this run from the same entry.' : ''}`,
    basis: `entry speed at least ${KUDOS_ENTRY_MIN_KN} kn; tack time within ${t.slowTackS} s; speed kept at ${Math.round(KUDOS_KEEP_FRAC * 100)}% or more; recovery within ${t.slowRecoverS} s; sails drawing within ${KUDOS_SAIL_OFF_S} s; no gybe, irons, overshoot, skip or restart${quickest ? '; compared only with earlier clean tacks from the same entry and support' : ''}`,
  };
}
