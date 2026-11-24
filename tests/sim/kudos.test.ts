/**
 * Design handover (23 Nov 2026), item 11 (a pilot): a quiet, defensible acknowledgement. Earned only by a clean tack
 * through the whole manoeuvre; not by a slow entry, a skipped, aborted or restarted attempt, or a part of the
 * manoeuvre; it says what earned it; comparative praise only against matching entry and support. The setting: after
 * each attempt, at the end only (default), or off.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { KUDOS_ENTRY_MIN_KN, tackKudos } from '../../src/app/exercises/kudos';
import { DEFAULT_THRESHOLDS } from '../../src/app/exercises/config';
import type { AttemptRecord } from '../../src/app/exercises/engine';
import { DEFAULT_PREFS, loadPrefs } from '../../src/app/prefs';

const t = DEFAULT_THRESHOLDS.tackRecover;
const CLEAN = { tackS: 6, tackInKn: 4.4, tackMinKn: 3.2, recoverS: 12, mainOffS: 1, jibOffS: 0 };
const rec = (over: Partial<AttemptRecord> & { values?: Record<string, number> } = {}, n = 1): AttemptRecord =>
  ({
    n,
    plan: { tack: 1 } as AttemptRecord['plan'],
    assists: { autoMain: false, autoJib: false, autoCrew: false, overlay: false, liveHelp: false },
    independent: true,
    outcome: 'complete',
    restarts: 0,
    issues: [],
    help: { 1: 0, 2: 0, 3: 0, requested: 0 },
    skipped: [],
    review: [],
    ...over,
    values: { ...CLEAN, ...(over.values ?? {}) },
  }) as AttemptRecord;

describe('earned only through the whole manoeuvre', () => {
  it('a clean tack: acknowledged, saying what earned it', () => {
    const k = tackKudos(rec(), t)!;
    expect(k.text).toMatch(/^Clean tack: in at 4.4 kn, through the wind in 6.0 s keeping 3.2 kn, back up to speed in 12 s/);
    expect(k.basis).toMatch(/entry speed at least/);
  });

  it('a slow entry cannot earn it (the shortcut of tacking slowly to lose less)', () => {
    expect(tackKudos(rec({ values: { tackInKn: KUDOS_ENTRY_MIN_KN - 0.4, tackMinKn: 2.8 } }), t)).toBeUndefined();
  });

  it('skipped, aborted (incomplete) or restarted attempts do not', () => {
    expect(tackKudos(rec({ skipped: ['cue'] }), t)).toBeUndefined();
    expect(tackKudos(rec({ outcome: 'incomplete' }), t)).toBeUndefined();
    expect(tackKudos(rec({ restarts: 1 }), t)).toBeUndefined();
  });

  it('a good turn with a poor recovery, an overshoot or sails left flapping does not', () => {
    expect(tackKudos(rec({ issues: ['overshoot'] }), t)).toBeUndefined();
    expect(tackKudos(rec({ values: { recoverS: t.slowRecoverS + 5 } }), t)).toBeUndefined();
    expect(tackKudos(rec({ values: { jibOffS: 9 } }), t)).toBeUndefined();
    expect(tackKudos(rec({ values: { tackMinKn: 1.5 } }), t)).toBeUndefined();
  });
});

describe('comparative praise only like for like', () => {
  it('quicker than an earlier clean tack with the same entry and support: said', () => {
    const first = rec({ values: { tackS: 7 } }, 1);
    expect(tackKudos(rec({ values: { tackS: 5.5 } }, 2), t, [first])!.text).toMatch(/quickest clean tack in this run/);
  });

  it('a different entry speed, tack side or support: no comparison', () => {
    const first = rec({ values: { tackS: 7 } }, 1);
    expect(tackKudos(rec({ values: { tackS: 5.5, tackInKn: 5.2, tackMinKn: 3.6 } }, 2), t, [first])!.text).not.toMatch(/quickest/);
    expect(tackKudos(rec({ values: { tackS: 5.5 }, plan: { tack: -1 } as AttemptRecord['plan'] }, 2), t, [first])!.text).not.toMatch(/quickest/);
    expect(tackKudos(rec({ values: { tackS: 5.5 }, independent: false }, 2), t, [first])!.text).not.toMatch(/quickest/);
  });
});

describe('the setting', () => {
  beforeEach(() => {
    const memory = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
  });
  it('at the end only by default; practice and off kept; anything else falls back', () => {
    expect(DEFAULT_PREFS.kudos).toBe('debrief');
    localStorage.setItem('squib.prefs.v1', JSON.stringify({ kudos: 'practice' }));
    expect(loadPrefs().kudos).toBe('practice');
    localStorage.setItem('squib.prefs.v1', JSON.stringify({ kudos: 'loud' }));
    expect(loadPrefs().kudos).toBe('debrief');
  });
});
