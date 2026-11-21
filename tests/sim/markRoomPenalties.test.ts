/**
 * Fixes of 21 Nov 2026, §2.2: the simplified rule 18 (package F) gave real penalties, from a rule built on secondary
 * sources and not yet reviewed by sailors. A switch, `markRoomPenalties`, now decides it, off by default. Off: a contact
 * while one boat owes the other mark-room is ruled and penalised under rules 10–13 as before package F, and the incident
 * (and so the protest room) carries an advisory note on rule 18. On: package F's ruling. The AI's mark-room behaviour is
 * the same either way.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';
import { parseRecording } from '../../src/app/replay';
import { setFeatureFlag } from '../../src/app/flags';
import { practiceCourse } from '../../src/sim/index';
import { createRace, practiceLineLength } from '../../src/sim/race/setup';
import { rightOfWay } from '../../src/sim/race/rules';
import type { RaceSession } from '../../src/sim/race/session';
import type { Entitlement } from '../../src/sim/race/markRoom';

function race(markRoomPenalties?: boolean): RaceSession {
  const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: 225, laps: 1, startLineM: practiceLineLength(2) });
  return createRace({
    conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
    course,
    aiCount: 2,
    level: 'good',
    seed: 3,
    committee: { startAt: 60, sequence: 'one-minute' },
    ...(markRoomPenalties === undefined ? {} : { markRoomPenalties }),
  }).session;
}

type Internals = { markRoom: { entitlements: Map<string, Entitlement> }; onContact(c: { t: number; kind: 'boat'; a: string; b: string; speed: number }): void };

/**
 * A contact between the two boats after the start while one owes the other mark-room. The boat owing mark-room is made
 * the one rules 10–13 would not blame, so the two rulings differ.
 */
function contactInZone(session: RaceSession) {
  session.advance(70);
  const [a, b] = session.fleet.boats.map((x) => x.id) as [string, string];
  const row = rightOfWay(session.rulesBoat(a), session.rulesBoat(b));
  const giver = row.rightOfWay;
  const entitled = row.keepClear;
  const s = session as unknown as Internals;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  s.markRoom.entitlements.set(key, { entitled, giver, markKey: '1:Windward:0', since: session.time, reason: 'overlapped' });
  expect(session.markRoomGiver(a, b)).toBe(giver);
  s.onContact({ t: session.time, kind: 'boat', a, b, speed: 1 });
  return { inc: session.incidents.at(-1)!, row, giver, giverName: session.fleet.boat(giver)!.name };
}

describe('§2.2: rule 18 penalties behind a switch, off by default', () => {
  it('off (the default): the rules 10–13 ruling and its penalty, and the advisory note on rule 18', () => {
    const { inc, row, giverName } = contactInZone(race());
    expect(inc.atFault).toBe(row.keepClear);
    expect(inc.rule).toBe(row.rule);
    expect(inc.penaltyTurns).toBe(2);
    expect(inc.summary).toMatch(/did not keep clear/);
    expect(inc.notes).toContain(`Rule 18 (simplified, advisory): ${giverName} should have given mark-room. No penalty applied until the club has reviewed this rule.`);
  });

  it('off when set false explicitly: the same', () => {
    const { inc, row } = contactInZone(race(false));
    expect(inc.atFault).toBe(row.keepClear);
    expect(inc.notes.join(' ')).toMatch(/advisory/);
  });

  it('on: package F’s ruling, the boat owing mark-room at fault under rule 18.2', () => {
    const { inc, giver } = contactInZone(race(true));
    expect(inc.atFault).toBe(giver);
    expect(inc.rule).toBe('18.2');
    expect(inc.penaltyTurns).toBe(2);
    expect(inc.notes.join(' ')).toMatch(/simplified, not authoritative/);
    expect(inc.notes.join(' ')).not.toMatch(/advisory/);
  });

  it('no rule 18 situation: the same ruling either way, and no note on rule 18', () => {
    for (const on of [false, true]) {
      const session = race(on);
      session.advance(70);
      const [a, b] = session.fleet.boats.map((x) => x.id) as [string, string];
      const row = rightOfWay(session.rulesBoat(a), session.rulesBoat(b));
      (session as unknown as Internals).onContact({ t: session.time, kind: 'boat', a, b, speed: 1 });
      const inc = session.incidents.at(-1)!;
      expect(inc.atFault).toBe(row.keepClear);
      expect(inc.notes.join(' ')).not.toMatch(/Rule 18/);
    }
  });

  it('the AI keeps clear the same way either way: the boat owing mark-room keeps clear', () => {
    for (const on of [false, true]) {
      const session = race(on);
      const [a, b] = session.fleet.boats.map((x) => x.id) as [string, string];
      (session as unknown as Internals).markRoom.entitlements.set(a < b ? `${a}|${b}` : `${b}|${a}`, { entitled: b, giver: a, markKey: 'k', since: 0, reason: 'overlapped' });
      const kc = (id: string, other: string) => (session.skippers.get(id) as unknown as { keepsClearOf(b: unknown, m: unknown): boolean }).keepsClearOf(session.fleet.boat(other)!, session.rulesBoat(id));
      expect(kc(a, b)).toBe(true);
      expect(kc(b, a)).toBe(false);
    }
  });
});

describe('§2.2: a race’s recording carries the setting it was sailed with', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
  });
  const sailed = () => {
    const c = new SimController();
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 2, conditions: 'as-set' })).toBeDefined();
    c.advance(2);
    return c;
  };
  type Run = { runMarkRoomPenalties: boolean };

  it('the default (off): the recording has no flag, and its replay rules with rule 18 advisory', () => {
    const rec = sailed().saveRecording('off');
    expect(rec.markRoomPenalties).toBeUndefined();
    const r = new SimController();
    expect(r.startReplay(parseRecording(JSON.parse(JSON.stringify(rec))))).toBe(true);
    expect((r as unknown as Run).runMarkRoomPenalties).toBe(false);
  });

  it('switched on: the recording says so, and its replay rules with the penalties on, whatever this browser’s switch', () => {
    setFeatureFlag('markRoomPenalties', true);
    const rec = sailed().saveRecording('on');
    expect(rec.markRoomPenalties).toBe(true);
    setFeatureFlag('markRoomPenalties', false);
    const r = new SimController();
    expect(r.startReplay(parseRecording(JSON.parse(JSON.stringify(rec))))).toBe(true);
    expect((r as unknown as Run).runMarkRoomPenalties).toBe(true);
  });
});
