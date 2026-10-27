/** The race coach (briefing, live tips, debrief) and the quick race (competitors, random and live conditions). */
import { describe, expect, it } from 'vitest';
import { COACH, RaceCoach, briefing, lineBias, type BriefingInput, type CoachSample } from '../../src/app/coach';
import { QUICK_WIND_KN, quickRaceScenario, randomConditions, DEFAULT_QUICK_RACE } from '../../src/app/quickRace';
import { DEFAULT_SCENARIO, type DataSource } from '../../src/app/controller';
import { Polar } from '../../src/sim/ai/polar';
import { AI_POLAR } from '../../src/sim/ai/polarData';

const DEG = Math.PI / 180;
const KN = 1852 / 3600;
const polar = new Polar(AI_POLAR);

// A line across a wind from the south (180°): pin to the west, committee boat to the east; first mark upwind.
const LINE = { a: { n: 0, e: -50 }, b: { n: 0, e: 50 } };
const BASE: BriefingInput = { twsKn: 10, twdDeg: 180, gusts: 'shifty', line: LINE, endLabels: ['pin', 'committee boat'], firstMark: { n: -600, e: 0 }, sequence: 'three-minute', competitors: 5 };

function sample(p: Partial<CoachSample> & { t: number }, race: Partial<CoachSample['race']> = {}): CoachSample {
  return {
    n: 20, e: 0, stw: 5 * KN, vmg: 3.5 * KN, tws: 10 * KN, twd: 180 * DEG, twa: 42 * DEG, heel: 15 * DEG, rudderFrac: 0, mainLuff: 1, mainStall: 0,
    autoMain: true, flatten: 0,
    ...p,
    race: { phase: 'racing', toStart: -100, ocs: false, mark: { n: -600, e: 0 }, penaltyOwed: 0, ...race },
  };
}

describe('line bias and the briefing', () => {
  it('finds the favoured end', () => {
    expect(lineBias(LINE, 180).favoured).toBe('square');
    // Wind from 190° (veered): the west end (a, the pin) is further upwind.
    const veer = lineBias(LINE, 190);
    expect(veer.favoured).toBe('a');
    expect(Math.abs(veer.metres)).toBeCloseTo(100 * Math.sin(10 * DEG), 6);
    expect(lineBias(LINE, 170).favoured).toBe('b');
  });

  it('advises by wind strength, gusts, line, stream and fleet size', () => {
    const light = briefing({ ...BASE, twsKn: 4 }).join(' ');
    expect(light).toMatch(/Light airs/);
    const heavy = briefing({ ...BASE, twsKn: 22, gusts: 'gusty' }).join(' ');
    expect(heavy).toMatch(/flatten fully/);
    expect(heavy).toMatch(/dark patches/);
    expect(briefing({ ...BASE, twdDeg: 190 }).join(' ')).toMatch(/pin end is favoured by about 17 m/);
    expect(briefing({ ...BASE, current: { setDeg: 180, rateKn: 1 } }).join(' ')).toMatch(/setting you over the line/);
    expect(briefing({ ...BASE, current: { setDeg: 0, rateKn: 1 } }).join(' ')).toMatch(/against you/);
    expect(briefing({ ...BASE, competitors: 12 }).join(' ')).toMatch(/busy line/);
    expect(briefing({ ...BASE, gusts: 'steady' }).join(' ')).toMatch(/Steady breeze/);
  });
});

describe('live tips', () => {
  it('warns when overpowered for more than 3 s, and not again within the repeat time', () => {
    const c = new RaceCoach(BASE, polar);
    for (let t = 0; t <= 5; t += 0.5) c.update(sample({ t, heel: 38 * DEG }));
    expect(c.recent[0]?.id).toBe('overpowered');
    expect(c.recent[0]?.text).toMatch(/flatten the sails \(Z\)/);
    const n = c.recent.length;
    for (let t = 5.5; t <= 30; t += 0.5) c.update(sample({ t, heel: 38 * DEG }));
    expect(c.recent.filter((x) => x.id === 'overpowered')).toHaveLength(1);
    expect(c.recent.length).toBe(n);
  });

  it('says when the boat is headed on a beat, against the mean wind', () => {
    const c = new RaceCoach(BASE, polar);
    // Starboard tack (wind from starboard) beating to the mark; the wind then backs 12° (a header on starboard).
    for (let t = 0; t < 120; t += 0.5) c.update(sample({ t, twd: 180 * DEG }));
    for (let t = 120; t < 140; t += 0.5) c.update(sample({ t, twd: 168 * DEG }));
    expect(c.recent.some((x) => x.id === 'header')).toBe(true);
  });

  it('calls the start: one minute, build speed, and over early', () => {
    const c = new RaceCoach(BASE, polar);
    for (let t = 0; t <= 50; t += 0.5) c.update(sample({ t, n: 30 }, { phase: 'pre-start', toStart: 100 - t }));
    expect(c.recent.some((x) => x.id === 'one-minute')).toBe(true);
    for (let t = 50.5; t <= 85; t += 0.5) c.update(sample({ t, n: 30 }, { phase: 'pre-start', toStart: 100 - t }));
    expect(c.recent.some((x) => x.id === 'build-speed')).toBe(true);
    c.update(sample({ t: 100.5, n: -5 }, { phase: 'pre-start', toStart: -0.5, ocs: true }));
    expect(c.recent[0]?.id).toBe('ocs');
  });
});

describe('the debrief', () => {
  it('judges the start, the beats, the tacks and the heavy-air handling', () => {
    const c = new RaceCoach({ ...BASE, twdDeg: 190 }, polar);
    // Pre-start, then at the gun 40 m behind the line at 2 kn near the committee boat (the pin was favoured).
    for (let t = 0; t <= 11; t += 0.5) c.update(sample({ t, n: 40, e: 40, stw: 2 * KN }, { phase: t < 10.25 ? 'pre-start' : 'racing', toStart: 10.25 - t }));
    let t = 11.5;
    // A beat: below target VMG, and heeled past 30° for a minute with the sails not flattened.
    for (; t < 200; t += 0.5) c.update(sample({ t, vmg: 2 * KN, twd: 190 * DEG, heel: t < 70 ? 35 * DEG : 15 * DEG }));
    // A slow tack: the TWA changes sign and the speed halves.
    c.update(sample({ t, twa: -40 * DEG, twd: 190 * DEG, stw: 2 * KN }));
    for (t += 0.5; t < 230; t += 0.5) c.update(sample({ t, twa: -42 * DEG, twd: 190 * DEG, stw: 4.5 * KN }));
    const d = c.debrief({ place: 4, fleet: 6, incidents: 1 });
    const text = (area: string) => d.items.filter((i) => i.area === area);
    expect(text('Start').some((i) => i.verdict === 'work' && /40 m behind the line at 2.0 kn/.test(i.text))).toBe(true);
    expect(text('Start').some((i) => /pin end was favoured/.test(i.text))).toBe(true);
    expect(text('Upwind')[0]!.verdict).toBe('work');
    expect(text('Boat handling')[0]!.text).toMatch(/1 tack/);
    expect(text('Heavy air')[0]!.text).toMatch(/s heeled past 30°, mostly with the sails not flattened/);
    // No shifts in this race: no praise for playing them.
    expect(text('Upwind').some((i) => /played the shifts/.test(i.text))).toBe(false);
    expect(text('Rules')).toHaveLength(1);
    expect(d.focus).toMatch(/^Start:/);
  });

  it('praises a good start', () => {
    const c = new RaceCoach(BASE, polar);
    for (let t = 0; t <= 11; t += 0.5) c.update(sample({ t, n: 3, stw: 5 * KN }, { phase: t < 10.25 ? 'pre-start' : 'racing', toStart: 10.25 - t }));
    const d = c.debrief();
    expect(d.items.find((i) => i.area === 'Start')!.verdict).toBe('good');
  });

  it('uses rules of thumb that are labelled as such', () => {
    expect(COACH.overpoweredHeel).toBeCloseTo(30 * DEG, 12);
    expect(COACH.headerDeg).toBe(8);
  });
});

describe('quick race', () => {
  it('draws reproducible random conditions within the chosen wind band', () => {
    for (const wind of ['light', 'medium', 'strong', 'any'] as const) {
      for (let seed = 1; seed <= 30; seed++) {
        const a = randomConditions(seed, wind, 'start-bay');
        expect(a).toEqual(randomConditions(seed, wind, 'start-bay'));
        const w = a.conditions.weather as { twsKn: number; twdDeg: number };
        expect(w.twsKn).toBeGreaterThanOrEqual(QUICK_WIND_KN[wind][0]);
        expect(w.twsKn).toBeLessThanOrEqual(QUICK_WIND_KN[wind][1]);
        expect(w.twdDeg).toBeGreaterThanOrEqual(0);
        expect(w.twdDeg).toBeLessThan(360);
        expect(a.conditions.sky).toBeDefined();
        expect(['fog', 'mist']).not.toContain((a.conditions.sky as { preset: string }).preset);
      }
    }
  });

  it('blows up or down the river on the river course', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const d = (randomConditions(seed, 'any', 'river').conditions.weather as { twdDeg: number }).twdDeg;
      const off = Math.min(Math.abs(((d + 180) % 360) - 180), Math.abs(d - 180));
      expect(off).toBeLessThanOrEqual(25);
    }
  });

  it('builds the race scenario: competitors, level, venue, sequence, and live data when there is some', () => {
    const q = quickRaceScenario({ ...DEFAULT_QUICK_RACE, competitors: 25, level: 'expert' }, DEFAULT_SCENARIO);
    expect(q.scenario.fleet).toEqual({ aiCount: 20, level: 'expert', prepFlag: 'P' });
    expect(q.scenario.course).toEqual({ source: 'practice', kind: 'windward-leeward' });
    expect(q.scenario.race!.startInS).toBe(210);
    expect(q.summary).toMatch(/against 20 AI boats \(expert\)/);
    const river = quickRaceScenario({ ...DEFAULT_QUICK_RACE, venue: 'river' }, DEFAULT_SCENARIO);
    expect(river.scenario.course).toEqual({ source: 'library', id: 'sim-river-range' });
    expect(river.scenario.startLocation).toBe('dart-marina');
    // Live asked for with no live source: random, with a note saying why.
    const noLive = quickRaceScenario({ ...DEFAULT_QUICK_RACE, conditions: 'live' }, DEFAULT_SCENARIO);
    expect(noLive.note).toMatch(/No live weather/);
    expect(noLive.scenario.conditions.weather.source).toBe('manual');
    const live: DataSource = { id: 'live', kind: 'live', label: 'Met Office, now', url: 'live/x.json', json: { fake: true } };
    const withLive = quickRaceScenario({ ...DEFAULT_QUICK_RACE, conditions: 'live' }, DEFAULT_SCENARIO, live);
    expect(withLive.scenario.conditions.weather).toEqual({ source: 'metoffice', snapshot: { fake: true }, replay: false });
    expect(withLive.scenario.conditions.gusts.preset).toBe('from-data');
    const asSet = quickRaceScenario({ ...DEFAULT_QUICK_RACE, conditions: 'as-set', competitors: 0 }, DEFAULT_SCENARIO);
    expect(asSet.scenario.conditions).toEqual(DEFAULT_SCENARIO.conditions);
    expect(asSet.summary).toMatch(/alone/);
  });
});
