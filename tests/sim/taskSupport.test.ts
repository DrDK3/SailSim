/**
 * Design handover (23 Nov 2026), item 7: activity progress and task support are clear.
 * - The Learn map says what a tick establishes (an activity done, not a certificate), in the same terms as the lesson
 *   result card (every step sailed) and the exercise result (an attempt completed, independent or assisted).
 * - Support is described against the task: an AI trimmer in the wind-shift exercise (a decision exercise) is recorded
 *   and named, and the review says it did not bear on the task; in the tack exercise trimming is the task.
 * - The record is not regraded: "independent" keeps its meaning, so legacy evidence stands. Input adaptations are not
 *   assists.
 */
import { describe, expect, it } from 'vitest';
import { SUPPORT_TERMS, supportForTask } from '../../src/app/assists';
import { EXERCISES } from '../../src/app/exercises/index';
import { isIndependent, type Assists } from '../../src/app/exercises/engine';
import { TICK_MEANING, TICKS_ARE } from '../../src/app/learnMap';

const none: Assists = { autoMain: false, autoJib: false, autoCrew: false, overlay: false, liveHelp: false };
const task = (id: string) => EXERCISES.find((e) => e.id === id)!.task;

describe('support against the task', () => {
  it('wind shift: auto-trim is named, and said not to bear on the decision; the attempt is still recorded as assisted', () => {
    const a = { ...none, autoMain: true, autoJib: true };
    const s = supportForTask(a, task('wind-shift'));
    expect(s.offTask).toEqual(['auto-trim on the main', 'auto-trim on the jib']);
    expect(s.onTask).toEqual([]);
    expect(s.text).toMatch(/The task: spotting the shift and deciding whether to tack\./);
    expect(s.text).toMatch(/did not bear on it/);
    expect(isIndependent(a)).toBe(false); // not regraded
  });

  it('wind shift with the overlay: the overlay shows the shift, so it bears on the task', () => {
    const s = supportForTask({ ...none, overlay: true, autoJib: true }, task('wind-shift'));
    expect(s.onTask).toEqual(['the teaching overlay']);
    expect(s.offTask).toEqual(['auto-trim on the jib']);
    expect(s.text).toMatch(/the rest did/);
  });

  it('tack and recover: trimming is the task, so auto-trim bears on it', () => {
    const s = supportForTask({ ...none, autoMain: true }, task('tack-recover'));
    expect(s.onTask).toEqual(['auto-trim on the main']);
    expect(s.text).not.toMatch(/did not bear/);
  });

  it('no assists (auto-crew alone does not count): independent', () => {
    expect(supportForTask({ ...none, autoCrew: true }, task('tack-recover')).text).toMatch(/^Independent\./);
    expect(isIndependent({ ...none, autoCrew: true })).toBe(true);
  });

  it('every exercise names its task', () => {
    for (const e of EXERCISES) expect(e.task.focus.length).toBeGreaterThan(10);
  });

  it('the shared definition: input adaptations are not assists', () => {
    expect(SUPPORT_TERMS.definition).toMatch(/Input adaptations .* never make an attempt assisted/);
  });
});

describe('what a tick establishes', () => {
  it('each group says, in the result cards’ terms; and a tick is not a certificate', () => {
    expect(TICK_MEANING.Basics).toMatch(/every step of the lesson/);
    expect(TICK_MEANING.Exercises).toMatch(/independent or assisted/);
    expect(TICK_MEANING.Challenges).toMatch(/time was recorded/);
    expect(TICKS_ARE).toMatch(/not a certificate/);
  });
});
