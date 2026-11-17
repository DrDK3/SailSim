/**
 * The debrief's notes (training slice §10): rules only; at most three observations, each apart from its likely cause;
 * one next action, most basic problem first; nothing noted when nothing passes its (provisional, E) threshold.
 */
import { describe, expect, it } from 'vitest';
import { DEBRIEF_LIMITS, debriefNotes, type SailSummary } from '../../src/app/sailLog';

const base: SailSummary = { durationS: 300, distanceM: 600, meanSogKn: 4, maxSogKn: 5, tacks: { count: 0 }, gybes: { count: 0 }, manoeuvres: [] };

describe('debrief notes', () => {
  it('nothing stood out: no observations, a next step', () => {
    expect(debriefNotes(base)).toEqual({ notes: [], next: 'Sail a few tacks and gybes: the debrief costs each one.' });
    const ok = debriefNotes({ ...base, tacks: { count: 3, meanLossS: DEBRIEF_LIMITS.tackLossS - 1, worstLossS: 5 } });
    expect(ok.notes).toEqual([]);
    expect(ok.next).toMatch(/Nothing stood out/);
  });

  it('costly tacks: the observation (measured) apart from its likely cause, and one action', () => {
    const r = debriefNotes({ ...base, tacks: { count: 4, meanLossS: 8.2, worstLossS: 12.5 } });
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ id: 'tacks', observation: 'Your 4 tacks cost 8.2 s each on average (worst 12.5 s).' });
    expect(r.notes[0]!.cause).toMatch(/^Likely cause:/);
    expect(r.next).toMatch(/Trim, tack and recover/);
  });

  it('several problems: the start first, at most three notes, one next action', () => {
    const r = debriefNotes({
      ...base,
      start: { ocs: true, lateS: 30 },
      tacks: { count: 2, meanLossS: 9, worstLossS: 10 },
      gybes: { count: 2, meanLossS: 10, worstLossS: 11 },
    });
    expect(r.notes.map((n) => n.id)).toEqual(['ocs', 'tacks', 'gybes']);
    expect(r.next).toBe(r.notes[0]!.action);
    // Late (and not over early): the late-start note instead.
    expect(debriefNotes({ ...base, start: { ocs: false, lateS: 25, distToLineAtGunM: 60 } }).notes[0]!.observation).toBe('You crossed the line 25.0 s after the gun (60 m from it at the gun).');
  });
});
