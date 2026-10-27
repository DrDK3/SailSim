/**
 * No boat starts on the mud: every start location, every built-in race and quick-race venue, every fleet size,
 * from chart datum to about high water springs, puts each boat in clear water with room to sail on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { squibParams } from '../../src/sim/index';
import { createRace, START_CLEARANCE, startClearWater, startPositions } from '../../src/sim/race/setup';
import { courseFor } from '../../src/app/courseLibrary';
import { START_LOCATIONS, preStartPosition } from '../../src/app/controller';
import { builtInScenarios } from '../../src/app/scenarioLibrary';
import { quickRaceScenario, DEFAULT_QUICK_RACE } from '../../src/app/quickRace';
import { DEFAULT_SCENARIO } from '../../src/app/controller';
import { validateCourse, DART_LEVELS } from '../../src/sim/course/validate';
import { DART_PROJECTION } from '../../src/sim/geo/projection';
import { loadDartGeo } from './helpers';

const geo = loadDartGeo();
const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8'));
const draft = squibParams().draft;
// Water levels (m ODN): chart datum (lower than any ordinary low water), mid-tide, and +2.3 m (about MHWS): the
// levels the course checks use (src/sim/course/validate.ts; Dartmouth's tidal levels are missing, E12).
const LEVELS = { chartDatum: -geo.cdBelowOdn, midTide: 0.1, highWater: 2.3 };

describe('free-sailing start locations', () => {
  test('each is in water deep enough at chart datum, with room to sail on its heading', () => {
    for (const l of START_LOCATIONS) {
      const clear = startClearWater(geo, LEVELS.chartDatum, draft);
      expect(clear(l.n, l.e), l.id).toBe(true);
      const h = (l.headingDeg * Math.PI) / 180;
      for (let d = 10; d <= 100; d += 10) expect(clear(l.n + Math.cos(h) * d, l.e + Math.sin(h) * d), `${l.id} ${d} m ahead`).toBe(true);
    }
  });
});

/** The races the app offers: built-in scenarios with a course, and the quick-race venues. */
function races() {
  const out: { name: string; scenario: ReturnType<typeof quickRaceScenario>['scenario'] }[] = [];
  for (const b of builtInScenarios([], true)) if (b.scenario?.course) out.push({ name: b.id, scenario: b.scenario as never });
  for (const venue of ['start-bay', 'river'] as const) out.push({ name: `quick-${venue}`, scenario: quickRaceScenario({ ...DEFAULT_QUICK_RACE, venue, conditions: 'as-set' }, DEFAULT_SCENARIO).scenario });
  return out;
}

describe('race starts', () => {
  const winds = [0, 90, 180, 225, 270];
  for (const { name, scenario } of races()) {
    test(`${name}: every boat in clear water at every tide, for 1 to 21 boats`, () => {
      const loc = START_LOCATIONS.find((l) => l.id === scenario.startLocation)!;
      for (const wind of scenario.course!.source === 'practice' ? winds : [0]) {
        const course = courseFor(scenario.course!, { n: loc.n, e: loc.e }, wind, 120);
        const v = validateCourse(course, { projection: DART_PROJECTION, seabed: geo, inDomain: (n, e) => geo.inDomain(n, e), draft, ...DART_LEVELS, lowWaterOdn: -geo.cdBelowOdn });
        expect(v.resolved, `${name} course`).toBeDefined();
        for (const [tide, level] of Object.entries(LEVELS)) {
          const clear = startClearWater(geo, level, draft, features.mooringAreas.map((a: { ring: [number, number][] }) => ({ ring: a.ring.map(([e, n]) => ({ n, e })) })));
          // Sailing alone (the pre-start position) and with fleets of every size.
          const solo = preStartPosition(v.resolved!, clear);
          expect(clear(solo.n, solo.e), `${name} ${tide} solo`).toBe(true);
          for (const count of [1, 4, 8, 12, 21]) {
            const slots = startPositions(v.resolved!, count, clear);
            expect(slots).toHaveLength(count);
            slots.forEach((p, i) => {
              const where = `${name} wind ${wind} ${tide} ${count} boats, slot ${i} at ${p.n!.toFixed(0)}, ${p.e!.toFixed(0)}`;
              expect(clear(p.n!, p.e!), where).toBe(true);
              const h = (p.headingDeg! * Math.PI) / 180;
              for (let d = 10; d <= START_CLEARANCE.runM; d += 10) expect(clear(p.n! + Math.cos(h) * d, p.e! + Math.sin(h) * d), `${where}: ${d} m ahead`).toBe(true);
            });
          }
        }
      }
    });
  }

  test('the race itself starts the user afloat on the river course near low water', () => {
    const course = courseFor({ source: 'library', id: 'sim-river-range' }, { n: 0, e: 0 }, 0);
    const { session } = createRace({
      conditions: { startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 0 }, gusts: { preset: 'steady', seed: 1 }, tide: { mode: 'manual', hwTime: '2026-07-15T18:12:00Z', hwHeightM: 4.6, lwHeightM: 1.2 }, current: { mode: 'none' } },
      geo, features, course, aiCount: 8, level: 'good', seed: 1,
      human: {}, committee: { startAt: 180 },
    });
    for (const id of ['you', ...Array.from({ length: 8 }, (_, i) => `ai-${i + 1}`)]) {
      const sim = session.fleet.boat(id)!.sim;
      const s = sim.snapshot();
      expect(geo.depth(s.n, s.e, sim.waterLevel()), id).toBeGreaterThan(draft + START_CLEARANCE.depthMarginM - 1e-9);
    }
  });
});
