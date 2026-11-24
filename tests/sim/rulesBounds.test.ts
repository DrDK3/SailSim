/**
 * Design handover (23 Nov 2026), item 4: correct rules explanations and bound adjudication.
 * - Before the preparatory signal Part 2 does apply (between boats intending to race), but a boat not racing is not
 *   penalised under it, except for injury or serious damage (rule 14) and rule 23.1. The old text said Part 2 "did not
 *   yet apply".
 * - Exoneration is rule 43 in the current rules (formerly rule 21); no displayed text cites rule 21.
 * - Where a rule the simplified judge does not apply (15, 16, or an advisory rule 18) could change the finding, the
 *   finding is labelled provisional, and the penalty still stands (no immunity from uncertainty).
 * Wording paraphrased from secondary sources (World Sailing's site was not reachable from the build environment): to be
 * checked by a rules reviewer (docs/HANDOVER_23NOV_REPORT.md).
 */
import { describe, expect, it } from 'vitest';
import { practiceCourse } from '../../src/sim/index';
import { createRace, practiceLineLength } from '../../src/sim/race/setup';
import { rightOfWay } from '../../src/sim/race/rules';
import { markRoomRuling } from '../../src/sim/race/markRoom';
import type { RaceSession } from '../../src/sim/race/session';
import type { Entitlement } from '../../src/sim/race/markRoom';

function race(committee: { startAt: number; sequence: 'five-minute' | 'one-minute' } = { startAt: 60, sequence: 'one-minute' }): RaceSession {
  const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: 225, laps: 1, startLineM: practiceLineLength(2) });
  return createRace({
    conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
    course,
    aiCount: 2,
    level: 'good',
    seed: 3,
    committee,
  }).session;
}

type Internals = {
  markRoom: { entitlements: Map<string, Entitlement> };
  rowHistory: Map<string, { holder: string; since: number }>;
  onContact(c: { t: number; kind: 'boat'; a: string; b: string; speed: number }): void;
};
const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function contact(session: RaceSession, setup?: (s: Internals, a: string, b: string) => void) {
  const [a, b] = session.fleet.boats.map((x) => x.id) as [string, string];
  const s = session as unknown as Internals;
  setup?.(s, a, b);
  s.onContact({ t: session.time, kind: 'boat', a, b, speed: 1 });
  return { inc: session.incidents.at(-1)!, a, b };
}

describe('before the preparatory signal', () => {
  it('says Part 2 applied but a boat not racing is not penalised under it; no penalty', () => {
    const session = race({ startAt: 360, sequence: 'five-minute' }); // the preparatory signal at 120 s
    session.advance(30);
    const { inc } = contact(session);
    expect(inc.summary).not.toMatch(/did not yet apply/);
    expect(inc.summary).toMatch(/not yet racing/);
    expect(inc.summary).toMatch(/Part 2 applied/);
    expect(inc.summary).toMatch(/injury or serious damage/);
    expect(inc.penaltyTurns).toBeUndefined();
    expect(inc.atFault).toBeUndefined();
  });
});

describe('exoneration is cited as rule 43', () => {
  it('the mark-room ruling’s note names rule 43, not rule 21', () => {
    const r = markRoomRuling({ entitled: 'a', giver: 'b', markKey: 'k', since: 0, reason: 'overlapped' }, (id) => id);
    const text = r.notes.join(' ');
    expect(text).toMatch(/rule 43/);
    expect(text).not.toMatch(/rule 21/);
  });
});

describe('a finding that an unjudged rule could change is labelled provisional; the penalty stands', () => {
  it('no recent change of right of way, course or mark-room: an ordinary finding', () => {
    const session = race();
    session.advance(70);
    const { inc } = contact(session);
    // (Whether the right-of-way boat changed course in the last 3 s depends on the AI; this seed sails straight.)
    expect(inc.provisional).toBeUndefined();
    expect(inc.summary).not.toMatch(/Provisional/);
    expect(inc.penaltyTurns).toBe(2);
  });

  it('right of way acquired 2 s before contact: provisional, rule 15', () => {
    const session = race();
    session.advance(70);
    const { inc } = contact(session, (s, a, b) => {
      const row = rightOfWay(session.rulesBoat(a), session.rulesBoat(b));
      s.rowHistory.set(pair(a, b), { holder: row.rightOfWay, since: session.time - 2 });
    });
    expect(inc.provisional).toContain('15');
    expect(inc.summary).toMatch(/Provisional: rule 15, not judged here, could change this finding\./);
    expect(inc.penaltyTurns).toBe(2);
    expect(inc.atFault).toBeDefined();
  });

  it('mark-room in play with rule 18 advisory, owed by the right-of-way boat: provisional, rule 18', () => {
    const session = race();
    session.advance(70);
    const { inc } = contact(session, (s, a, b) => {
      const row = rightOfWay(session.rulesBoat(a), session.rulesBoat(b));
      s.markRoom.entitlements.set(pair(a, b), { entitled: row.keepClear, giver: row.rightOfWay, markKey: '1:Windward:0', since: session.time, reason: 'overlapped' });
    });
    expect(inc.provisional).toEqual(['18']);
    expect(inc.penaltyTurns).toBe(2);
  });

  it('mark-room owed by the boat already at fault: rule 18 would not change it, so not provisional on that account', () => {
    const session = race();
    session.advance(70);
    const { inc } = contact(session, (s, a, b) => {
      const row = rightOfWay(session.rulesBoat(a), session.rulesBoat(b));
      s.markRoom.entitlements.set(pair(a, b), { entitled: row.rightOfWay, giver: row.keepClear, markKey: '1:Windward:0', since: session.time, reason: 'overlapped' });
    });
    expect(inc.provisional ?? []).not.toContain('18');
  });
});
