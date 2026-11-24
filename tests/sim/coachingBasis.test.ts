/**
 * Design handover (23 Nov 2026), item 5: coaching explanations match the evidence. Each review message names its
 * telemetry basis; a specific cause is given only when its preconditions were recorded in the attempt; otherwise the
 * action is a controlled retry (change one thing, compare the same measurement). A geometrically favoured start end
 * is reported as an observation, not praised or blamed as a tactical rule. (docs/COACHING_INVENTORY.md lists them.)
 */
import { describe, expect, it } from 'vitest';
import { tackRecoverReview } from '../../src/app/exercises/tackRecover';
import { DEFAULT_THRESHOLDS } from '../../src/app/exercises/config';
import type { AttemptRecord } from '../../src/app/exercises/engine';

const t = DEFAULT_THRESHOLDS.tackRecover;
const record = (values: Record<string, number>, issues: string[] = [], skipped: string[] = []): AttemptRecord =>
  ({
    n: 1,
    plan: {} as AttemptRecord['plan'],
    assists: { autoMain: false, autoJib: false, autoCrew: false, overlay: false, liveHelp: false } as AttemptRecord['assists'],
    independent: true,
    outcome: 'complete',
    restarts: 0,
    values,
    issues,
    help: { 1: 0, 2: 0, 3: 0, requested: 0 },
    skipped,
    review: [],
  }) as AttemptRecord;
const item = (r: ReturnType<typeof tackRecoverReview>, id: string) => r.find((i) => i.id === id)!;

describe('a cause only where it was measured', () => {
  it('a slow tack with a steady turn: the measured turn rate, not a guess about the helm', () => {
    const r = tackRecoverReview(record({ tackS: t.slowTackS + 4, tackInKn: 4, tackMinKn: 3.5, turnPauseS: 0, turnRateDps: 7 }), t);
    const slow = item(r, 'slow-tack');
    expect(slow.cause).toBe('The turn was steady but slow: about 7° a second on average.');
    expect(slow.cause).not.toMatch(/helm was not held/);
    expect(slow.action).toMatch(/compare the tack time/);
  });

  it('a slow tack that paused head to wind: the pause, as measured', () => {
    const r = tackRecoverReview(record({ tackS: t.slowTackS + 4, tackInKn: 4, tackMinKn: 3.5, turnPauseS: 2.3, turnRateDps: 5 }), t);
    expect(item(r, 'slow-tack').cause).toMatch(/paused for 2.3 s/);
  });

  it('a big speed loss with nothing recorded to explain it: no cause, and a controlled retry', () => {
    const r = tackRecoverReview(record({ tackS: t.slowTackS - 1, tackInKn: 4, tackMinKn: 1, turnPauseS: 0, turnRateDps: 12 }), t);
    const loss = item(r, 'big-loss');
    expect(loss.cause).toBeUndefined();
    expect(loss.action).toMatch(/Nothing recorded explains it/);
    expect(loss.action).toMatch(/compare the slowest speed/);
  });

  it('a big speed loss in irons: the recorded stop is the cause', () => {
    const r = tackRecoverReview(record({ tackS: t.slowTackS - 1, tackInKn: 4, tackMinKn: 0.2, turnPauseS: 0 }, ['irons']), t);
    expect(item(r, 'big-loss').cause).toBe('The boat stopped head to wind (recorded as in irons).');
  });

  it('a sail not drawing while the boat was on the close-hauled course: the sheet; while off course: the steering', () => {
    const sheet = tackRecoverReview(record({ tackS: 6, tackInKn: 4, tackMinKn: 3.5, recoverS: 10, mainOffS: 8, mainOffInBandS: 7, jibOffS: 0, jibOffInBandS: 0, pinchS: 0, maxTwaAfterDeg: 50 }), t);
    expect(item(sheet, 'trim-main').cause).toMatch(/so the sheet, not the course/);
    const steer = tackRecoverReview(record({ tackS: 6, tackInKn: 4, tackMinKn: 3.5, recoverS: 10, mainOffS: 8, mainOffInBandS: 1, jibOffS: 0, jibOffInBandS: 0, pinchS: 0, maxTwaAfterDeg: 80 }, ['overshoot']), t);
    expect(item(steer, 'trim-main').cause).toMatch(/the steering, more than the sheet/);
  });

  it('a record from before the change (no on-course time recorded): no cause is guessed', () => {
    const r = tackRecoverReview(record({ tackS: 6, tackInKn: 4, tackMinKn: 3.5, recoverS: 10, mainOffS: 8, jibOffS: 0 }), t);
    expect(item(r, 'trim-main').cause).toBeUndefined();
  });

  it('a slow recovery: pinching when it was measured, otherwise a controlled retry', () => {
    const pinch = tackRecoverReview(record({ tackS: 6, tackInKn: 4, tackMinKn: 3.5, recoverS: t.slowRecoverS + 10, mainOffS: 0, jibOffS: 0, pinchS: 6, maxTwaAfterDeg: 50 }, ['slow-recover']), t);
    expect(item(pinch, 'slow-recover').cause).toMatch(/above close-hauled/);
    const unknown = tackRecoverReview(record({ tackS: 6, tackInKn: 4, tackMinKn: 3.5, recoverS: t.slowRecoverS + 10, mainOffS: 0, jibOffS: 0, pinchS: 0, maxTwaAfterDeg: 50 }, ['slow-recover']), t);
    expect(item(unknown, 'slow-recover').cause).toBeUndefined();
    expect(item(unknown, 'slow-recover').action).toMatch(/bear away about 5° for the first 10 s .* compare the recovery time/);
  });

  it('every message names its basis', () => {
    const all = [
      record({ tackS: t.slowTackS + 4, tackInKn: 4, tackMinKn: 1, turnPauseS: 2, turnRateDps: 5, recoverS: t.slowRecoverS + 10, mainOffS: 8, mainOffInBandS: 7, jibOffS: 6, jibOffInBandS: 1, pinchS: 4, maxTwaAfterDeg: 80 }, ['gybed', 'irons', 'overshoot', 'slow-recover'], ['cue']),
      record({ tackS: 6, tackInKn: 4, tackMinKn: 3.8, recoverS: 8 }),
    ].flatMap((r) => tackRecoverReview(r, t));
    expect(all.length).toBeGreaterThan(8);
    for (const i of all) expect(i.basis, i.id).toBeTruthy();
    // No unrecorded "Likely cause" guesses remain.
    for (const i of all) expect(i.cause ?? '').not.toMatch(/^Likely cause/);
  });
});
