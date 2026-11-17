/**
 * Sail the week's model targets (juniors round §6.3): the AI alone on the week's course, in the week's conditions, as
 * the app builds them for the player (src/app/weekly.ts and src/app/controller.ts restart), at each AI level over
 * several seeds. Used by tools/weekly-targets.ts (bundled for the scheduled Action) and by the tests.
 *
 * Parity: the weekly course has no tidal stream, so the AI's knowledge of the stream along its path (RA-2) gives it
 * nothing a player lacks; it sees the same wind the player's instruments show. It starts on the line while a player
 * sailing alone starts 100 m behind it; times run from the start signal either way.
 */
import { buildConditions } from '../sim/env/conditions';
import { createRace, practiceLineLength } from '../sim/race/setup';
import { windFrom } from '../sim/boat/forces';
import { quayPiers } from '../sim/env/quays';
import type { DartGeo } from '../sim/geo/dart';
import type { DartFeatures } from './geoLoader';
import type { QuayWall } from '../sim/env/quays';
import { courseFor } from './courseLibrary';
import { START_LOCATIONS } from './controller';
import { RDYC_FRONTAGE } from '../render/rdyc';
import { poseOf } from './ghost';
import { MEDALS, MEDAL_LEVEL, TARGETS_SCHEMA, median, trackRow, type Target, type TargetsFile } from './targets';
import type { WeeklyCourse } from './weekly';

export interface DartForTargets {
  geo?: DartGeo;
  features?: DartFeatures;
  quays?: QuayWall[];
}

/** One AI run: the finish time from the start signal (null if it did not finish in `limitS`) and its track. */
export function sailOnce(w: WeeklyCourse, level: 'club' | 'good' | 'expert', seed: number, dart: DartForTargets, limitS = 3600): { timeS: number | null; rows: number[][] } {
  const sc = w.scenario;
  const geo = dart.geo;
  const built = buildConditions(sc.conditions, geo);
  const loc = START_LOCATIONS.find((l) => l.id === sc.startLocation) ?? START_LOCATIONS[0];
  const wind = windFrom(built.env.wind(0, loc.n, loc.e));
  // As the app lays it for a player sailing alone (a line for one boat).
  const course = courseFor(sc.course!, { n: loc.n, e: loc.e }, (wind.fromDir * 180) / Math.PI, practiceLineLength(1));
  const walls = geo ? [...quayPiers(dart.quays ?? []), ...quayPiers([{ line: [...RDYC_FRONTAGE] }], "the yacht club's sea wall")] : [];
  const { session } = createRace({
    conditions: sc.conditions,
    env: built.env,
    geo,
    features: dart.features ? { ...dart.features, piers: [...dart.features.piers, ...walls] } : undefined,
    course,
    aiCount: 1,
    level,
    seed,
    committee: { startAt: sc.race!.startInS, sequence: sc.race!.sequence, prepFlag: sc.fleet?.prepFlag ?? 'P' },
  });
  const boat = session.fleet.boats[0]!;
  const start = sc.race!.startInS;
  const rows: number[][] = [];
  // Poses from the scenario's start (as a player's ghost is), so the pre-start shows too.
  for (let t = 0; t <= limitS + start; t += 1) {
    rows.push(trackRow(t, poseOf('ghost', boat.sim.snapshot(false))));
    if (session.judgeOf(boat.id).phase === 'finished' || session.finished) break;
    session.advance(1);
  }
  const r = session.results().find((x) => x.id === boat.id);
  return { timeS: r?.elapsed !== undefined ? Math.round(r.elapsed * 10) / 10 : null, rows };
}

/** The week's targets: each level over `seeds` seeds; the ghost is the run nearest the median. */
export function sailTargets(w: WeeklyCourse, dart: DartForTargets, opts: { seeds: number[]; build: string; now?: Date }): TargetsFile {
  const targets: Target[] = [];
  for (const medal of MEDALS) {
    const level = MEDAL_LEVEL[medal];
    const runs = opts.seeds.map((s) => sailOnce(w, level, s, dart));
    const times = runs.map((r) => r.timeS);
    const m = median(times);
    if (m === undefined) continue;
    let pick = 0;
    times.forEach((t, i) => {
      if (t !== null && Math.abs(t - m) < Math.abs((times[pick] ?? Infinity) - m)) pick = i;
    });
    targets.push({ medal, level, timeS: Math.round(m * 10) / 10, runs: times, track: { everyS: 1, rows: runs[pick]!.rows } });
  }
  return {
    schema: TARGETS_SCHEMA,
    week: w.week.key,
    generated: (opts.now ?? new Date()).toISOString(),
    build: opts.build,
    course: w.name,
    scenario: JSON.stringify(w.scenario),
    targets,
    note: 'Model-sailed targets: the simulator\'s AI at three levels (club, good, expert), not people. Its ghosts are recordings that do not react.',
  };
}
