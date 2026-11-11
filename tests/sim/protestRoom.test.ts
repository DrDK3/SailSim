/** The protest room (src/app/protestRoom.ts): a clip round each of your incidents, and the rules in plain words. */
import { describe, expect, it } from 'vitest';
import { AFTER_S, BEFORE_S, IncidentRecorder, RULE_NOTES, frameAt, penaltyText, type Frame } from '../../src/app/protestRoom';
import type { Incident } from '../../src/sim/race/rules';

const frame = (t: number): Frame => ({ t, boats: [{ id: 'you', label: 'You', n: t, e: 0, heading: 0, mainSide: 1 }, { id: 'ai-1', label: 'AI01', n: 0, e: t, heading: 1, mainSide: -1 }] });
const incident = (t: number, o: Partial<Incident> = {}): Incident => ({ t, kind: 'boat', boats: ['you', 'ai-1'], atFault: 'you', rule: '10', summary: 'Contact', notes: [], penaltyTurns: 2, penaltyTaken: false, ...o });

describe('the protest room', () => {
  it('a clip from 15 s before your incident to 3 s after, five frames a second', () => {
    const r = new IncidentRecorder();
    const incidents: Incident[] = [];
    for (let k = 0; k <= 200; k++) {
      const t = k * 0.2;
      if (k === 150) incidents.push(incident(30));
      r.record(frame(t), incidents, 0);
    }
    expect(r.cases).toHaveLength(1);
    const c = r.cases[0]!;
    expect(c.open).toBe(false);
    expect(c.frames[0]!.t).toBeCloseTo(30 - BEFORE_S, 6);
    expect(c.frames[c.frames.length - 1]!.t).toBeGreaterThanOrEqual(30 + AFTER_S - 1e-9);
    expect(c.frames.length).toBeGreaterThan((BEFORE_S + AFTER_S) / 0.2 - 2);
    expect(frameAt(c.frames, 30)!.t).toBeCloseTo(30, 6);
  });

  it("only your incidents with a boat or a mark; other boats' and collisions with ferries are left out", () => {
    const r = new IncidentRecorder();
    const incidents = [incident(1, { boats: ['ai-1', 'ai-2'] }), incident(2, { kind: 'ferry', boats: ['you'] }), incident(3, { kind: 'mark', boats: ['you'], rule: '31', penaltyTurns: 1 })];
    r.record(frame(3), incidents, 0);
    expect(r.cases.map((c) => c.incident.t)).toEqual([3]);
    r.reset();
    expect(r.cases).toHaveLength(0);
  });

  it('every rule the judge applies has a plain-words note; the penalty is said as rule 44 has it', () => {
    for (const rule of ['10', '11', '12', '13', '31']) {
      expect(RULE_NOTES[rule]!.says.length).toBeGreaterThan(20);
      expect(RULE_NOTES[rule]!.couldHave.length).toBeGreaterThan(20);
    }
    expect(penaltyText(incident(0))).toMatch(/Two-Turns Penalty .* not taken/);
    expect(penaltyText(incident(0, { penaltyTurns: 1, penaltyTaken: true }))).toMatch(/One-Turn Penalty .* was taken/);
    expect(penaltyText(incident(0, { penaltyTurns: undefined }))).toBeUndefined();
  });
});
