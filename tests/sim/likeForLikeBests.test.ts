/**
 * Design handover (23 Nov 2026), item 6: personal bests are fair. An ordinary race's best is kept per identity
 * (course and its shape, laps, wind band, fleet size, boat, spinnaker, rules version, assistance: the owner's choice,
 * like with like), so changed conditions cannot silently earn a personal best. Times kept before (by course name and
 * laps only) stay, with their provenance, and are shown as "other conditions". A start keeps its speed as well.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { courseGeometry, courseKey, loadBests, otherConditionsBest, raceIdentityKey, raceIdentityLabel, recordRaceTime, recordStart, windBand, type RaceIdentity } from '../../src/app/bests';
import { SimController } from '../../src/app/controller';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

const ID: RaceIdentity = { course: 'Short course', laps: 1, geometry: courseGeometry([400, 400], 60), windBand: windBand(11), fleet: 4, boat: 'rondar', spinnaker: false, rules: 'r2', assistance: 'independent' };

describe('like with like', () => {
  it('each identity part makes a different key: a time in other conditions is never compared', () => {
    const variants: Partial<RaceIdentity>[] = [
      { laps: 2 },
      { geometry: courseGeometry([600, 600], 60) },
      { windBand: windBand(16) },
      { fleet: 6 },
      { boat: 'other' },
      { spinnaker: true },
      { rules: 'r3' },
      { assistance: 'assisted' },
    ];
    const keys = new Set([raceIdentityKey(ID), ...variants.map((v) => raceIdentityKey({ ...ID, ...v }))]);
    expect(keys.size).toBe(variants.length + 1);
  });

  it('a faster time in a stronger wind band is not a personal best for the lighter one', () => {
    expect(recordRaceTime(raceIdentityKey(ID), raceIdentityLabel(ID), 400).best).toBe(true);
    const windy = { ...ID, windBand: windBand(16) };
    // Its own first time, not "a new personal best (was 400)".
    expect(recordRaceTime(raceIdentityKey(windy), raceIdentityLabel(windy), 300)).toEqual({ best: true, previousS: undefined });
    expect(loadBests().races[raceIdentityKey(ID)]!.timeS).toBe(400);
    // Back in the lighter band, a slower time than the windy one is still compared only with 400.
    expect(recordRaceTime(raceIdentityKey(ID), raceIdentityLabel(ID), 390)).toEqual({ best: true, previousS: 400 });
  });

  it('the wind bands and the course shape', () => {
    expect([3, 6, 9.9, 10, 13, 17, 25].map(windBand)).toEqual(['under 6 kn', '6–10 kn', '6–10 kn', '10–14 kn', '10–14 kn', '14–18 kn', '18 kn and over']);
    // Rounding: the same course laid a few metres differently is the same shape; a longer beat is not.
    expect(courseGeometry([402, 398], 61)).toBe(courseGeometry([400, 400], 60));
    expect(courseGeometry([500, 400], 60)).not.toBe(courseGeometry([400, 400], 60));
  });

  it('times kept before (by name and laps only) stay, and are shown as other conditions', () => {
    memory.set('squib.bests.v1', JSON.stringify({ races: { [courseKey('Short course', 1)]: { timeS: 280, at: '2026-11-01T10:00:00Z', label: 'Short course · 1 lap' } } }));
    const other = otherConditionsBest(loadBests(), ID)!;
    expect(other).toMatchObject({ timeS: 280, label: 'Short course · 1 lap' });
    // Not compared: the first time under the identity is a first time, whatever the older record.
    expect(recordRaceTime(raceIdentityKey(ID), raceIdentityLabel(ID), 300)).toEqual({ best: true, previousS: undefined });
    expect(loadBests().races[courseKey('Short course', 1)]!.timeS).toBe(280);
    // And another identity on the same course counts as other conditions too.
    recordRaceTime(raceIdentityKey({ ...ID, fleet: 2 }), 'x', 250);
    expect(otherConditionsBest(loadBests(), ID)!.timeS).toBe(250);
  });

  it('a start keeps its speed alongside its timing', () => {
    recordStart(2.4, new Date('2026-11-23T10:00:00Z'), 4.27);
    expect(loadBests().start).toMatchObject({ delayS: 2.4, kn: 4.3 });
  });

  it('the controller builds the identity of a quick race from its setup', () => {
    const c = new SimController();
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 2, conditions: 'as-set' })).toBeDefined();
    const id = c.raceIdentity();
    expect(id.fleet).toBe(3);
    expect(id.assistance).toMatch(/^(independent|assisted)$/);
    expect(id.rules).toMatch(/^r\d+/);
    expect(id.windBand).toMatch(/kn/);
    expect(raceIdentityLabel(id)).toContain('3 boats');
  });
});
