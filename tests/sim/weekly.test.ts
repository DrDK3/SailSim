import { describe, expect, it } from 'vitest';
import { JUNIOR_GOOD_AI_S, JUNIOR_SLOTS, isoWeekOf, longRotation, rotation, weekOf, weekSeed, weeklyCourse, weeklyKey, weeklyLongKey, type WeeklyCourse } from '../../src/app/weekly';
import { sailOnce } from '../../src/app/weeklyTargets';
import { SimController } from '../../src/app/controller';

/**
 * The weekly course (juniors round §6.3): the same for everyone in a week, changing at Monday 00:00 in London,
 * whether London is on BST (UTC+1) or GMT.
 */
describe('weeks in Europe/London', () => {
  it('ISO week numbers', () => {
    expect(isoWeekOf(2026, 1, 1)).toMatchObject({ year: 2026, week: 1 }); // a Thursday
    expect(isoWeekOf(2027, 1, 1)).toMatchObject({ year: 2026, week: 53 }); // a Friday: still 2026's last week
    expect(isoWeekOf(2026, 11, 17)).toMatchObject({ year: 2026, week: 47 });
  });

  it('changes at Monday 00:00 London time in summer (BST: 23:00 UTC on Sunday)', () => {
    expect(weekOf(new Date('2026-07-05T22:59:59Z')).key).toBe('2026-W27');
    expect(weekOf(new Date('2026-07-05T23:00:00Z')).key).toBe('2026-W28');
    expect(weeklyCourse(new Date('2026-07-05T22:59:59Z')).week.key).not.toBe(weeklyCourse(new Date('2026-07-05T23:00:00Z')).week.key);
  });

  it('changes at Monday 00:00 London time in winter (GMT: 00:00 UTC)', () => {
    expect(weekOf(new Date('2026-11-22T23:59:59Z')).key).toBe('2026-W47');
    expect(weekOf(new Date('2026-11-23T00:00:00Z')).key).toBe('2026-W48');
  });

  it('across the clocks going forward (29 Mar 2026) and back (25 Oct 2026)', () => {
    // Sunday 29 March: 00:59 UTC is 01:59 BST the same Sunday; Monday 30 March 00:00 BST is 23:00 UTC on the 29th.
    expect(weekOf(new Date('2026-03-29T22:59:00Z')).key).toBe('2026-W13');
    expect(weekOf(new Date('2026-03-29T23:00:00Z')).key).toBe('2026-W14');
    // Monday 26 October 00:00 GMT is 00:00 UTC (the clocks went back on the Sunday).
    expect(weekOf(new Date('2026-10-25T23:59:00Z')).key).toBe('2026-W43');
    expect(weekOf(new Date('2026-10-26T00:00:00Z')).key).toBe('2026-W44');
  });
});

describe('the weekly course', () => {
  it('is the same for everyone all week, from the week alone', () => {
    const a = weeklyCourse(new Date('2026-11-16T07:00:00Z'));
    const b = weeklyCourse(new Date('2026-11-22T21:30:00Z'));
    expect(JSON.stringify(b.scenario)).toBe(JSON.stringify(a.scenario));
    expect(a.scenario.conditions.current).toEqual({ mode: 'none' });
    expect(a.scenario.boat).toBe('rondar');
    expect(a.scenario.fleet?.aiCount).toBe(0);
  });

  it('the rotation is short practice courses, a different course next week; the RDYC courses are the optional long course (review #10)', () => {
    const r = rotation();
    expect(r.every((s) => s.kind === 'practice')).toBe(true);
    expect(r.length).toBeGreaterThanOrEqual(4);
    const weeks = Array.from({ length: 8 * r.length }, (_, i) => weeklyCourse(new Date(Date.UTC(2026, 0, 5 + 7 * i, 12))));
    for (let i = 1; i < weeks.length; i++) expect(JSON.stringify(weeks[i]!.slot)).not.toBe(JSON.stringify(weeks[i - 1]!.slot));
    for (const w of weeks) {
      expect(w.slot.kind).toBe('practice');
      expect(w.status).toBeUndefined();
      // Each week also offers an RDYC course at full length, still labelled as pending the club's check.
      expect(w.long?.status).toBe('pending club check');
      expect(w.long?.scenario.course).toEqual({ source: 'library', id: w.long!.id });
      expect(w.long?.summary).toMatch(/full length/);
    }
    expect(longRotation()).toHaveLength(8);
    expect(new Set(weeks.map((w) => w.long!.id)).size).toBe(8);
    // The long course leaves the short course's conditions as they were (its own seed stream).
    const w = weeks[0]!;
    expect((w.long!.scenario.conditions.weather as { twsKn: number }).twsKn).toBe((w.scenario.conditions.weather as { twsKn: number }).twsKn);
    // Its own key, beside the short course's; the ruleset at the end of both (fixes of 21 Nov 2026, §3.2).
    expect(weeklyLongKey(w.week)).toBe(`weekly:${w.week.key}:long:r2`);
    expect(weeklyKey(w.week)).toBe(`weekly:${w.week.key}:r2`);
  });

  it('a season plan, when given, sets the week; other weeks follow the rotation', () => {
    const at = new Date('2026-11-18T12:00:00Z');
    const set = weeklyCourse(at, undefined, { '2026-W47': 'rdyc-2026-c2' });
    expect(set.slot).toEqual({ kind: 'club', id: 'rdyc-2026-c2' });
    const wind = set.scenario.conditions.weather as { twdDeg: number };
    expect(Math.abs(((wind.twdDeg - 180 + 540) % 360) - 180)).toBeLessThanOrEqual(15);
    expect(weeklyCourse(new Date('2026-11-25T12:00:00Z'), undefined, { '2026-W47': 'rdyc-2026-c2' }).slot).toEqual(weeklyCourse(new Date('2026-11-25T12:00:00Z'), undefined, {}).slot);
  });

  it('seeds are stable', () => {
    expect(weekSeed('2026-W47')).toBe(weekSeed('2026-W47'));
    expect(weekSeed('2026-W47')).not.toBe(weekSeed('2026-W48'));
  });

  it('every week of a rotation starts in the app (practice weeks without the Dart data)', () => {
    for (let i = 0; i < rotation().length; i++) {
      const w = weeklyCourse(new Date(Date.UTC(2026, 0, 5 + 7 * i, 12)));
      if (w.slot.kind === 'club') continue; // club courses need the River Dart's marks: tests/sim/weeklyTargets.test.ts
      const c = new SimController();
      expect(c.restart(w.scenario), w.name).toBe(true);
    }
  });
});

describe('a junior course (review #10)', () => {
  it('every slot of the rotation: the good AI finishes in 5 to 10 minutes in the lightest and strongest weekly winds (8 and 14 kn)', () => {
    const base = weeklyCourse(new Date('2026-11-17T12:00:00Z'));
    const out: string[] = [];
    for (const slot of JUNIOR_SLOTS) {
      if (slot.kind !== 'practice') continue;
      for (const tws of [8, 14]) {
        const w: WeeklyCourse = structuredClone(base);
        (w.scenario.conditions.weather as { twsKn: number }).twsKn = tws;
        w.scenario.course = { source: 'practice', kind: slot.practice, ...(slot.legM ? { legM: slot.legM } : {}), laps: slot.laps ?? 1 };
        const t = sailOnce(w, 'good', 1, {}, 1800).timeS;
        out.push(`${slot.practice} ${slot.legM} m ×${slot.laps ?? 1} at ${tws} kn: ${t} s`);
        expect(t, `${slot.practice} ${slot.legM} at ${tws} kn`).not.toBeNull();
        expect(t!, out.at(-1)).toBeGreaterThanOrEqual(JUNIOR_GOOD_AI_S[0]);
        expect(t!, out.at(-1)).toBeLessThanOrEqual(JUNIOR_GOOD_AI_S[1]);
      }
    }
    console.log(out.join('\n'));
  }, 240_000);
});
