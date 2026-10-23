import { DEFAULT_TIDAL_STREAM } from '../sim/env/current';
import type { AppScenario, DataSource, StartLocationId } from './controller';
import { START_LOCATIONS } from './controller';

/**
 * The scenario library: ready-made sessions shipped with the app, and the user's own, kept in this browser.
 * Scenarios are plain AppScenario JSON, so they can be exported, shared and imported (schema below).
 *
 * The built-in ones are set-ups for practice, not recordings of real days: their wind, tide and sky are
 * chosen (E), except the Met Office replay, which uses the bundled forecast file.
 */

export const SCENARIO_SCHEMA = 'squib-scenario/1';

export interface ScenarioFile {
  schema: string;
  title: string;
  description?: string;
  scenario: AppScenario;
}

export interface LibraryScenario {
  id: string;
  title: string;
  description: string;
  group: 'built-in' | 'user';
  /** Ready to run, or a data file it needs and the reason it cannot run without it. */
  scenario?: AppScenario;
  unavailable?: string;
}

/** Manual tide used by the built-in scenarios: heights as the scenario panel's defaults (E, near springs). */
const tideAt = (hwTime: string) => ({ mode: 'manual' as const, hwTime, hwHeightM: 4.6, lwHeightM: 1.2 });

/** `needsDart`: on the river itself, so offered only once the River Dart data has loaded. */
const BUILT_IN: { id: string; title: string; description: string; needsDart?: boolean; scenario: AppScenario }[] = [
  {
    id: 'first-sail',
    title: 'First sail off RDYC',
    description: '10 kn south-westerly, moderate gusts, no tide or current. The default session.',
    scenario: {
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'moderate', seed: 1 }, current: { mode: 'none' } },
      startLocation: 'off-rdyc',
      startHeadingDeg: 170,
      startSpeedKn: 3,
    },
  },
  {
    id: 'light-air',
    title: 'Light air, flat water',
    description: '5 kn steady westerly in Start Bay: practise keeping the boat moving and the sails eased.',
    scenario: {
      conditions: { startTime: '2026-07-15T11:00:00Z', weather: { source: 'manual', twsKn: 5, twdDeg: 270 }, gusts: { preset: 'steady', seed: 2 }, current: { mode: 'none' }, sky: { source: 'preset', preset: 'hazy' } },
      startLocation: 'start-bay-practice',
      startHeadingDeg: 0,
      startSpeedKn: 2,
    },
  },
  {
    id: 'fresh-shifty',
    title: 'Fresh and shifty',
    description: '16 kn north-westerly with large shifts and strong puffs, off RDYC: depower, hike, and play the shifts.',
    scenario: {
      conditions: { startTime: '2026-07-15T14:00:00Z', weather: { source: 'manual', twsKn: 16, twdDeg: 315 }, gusts: { preset: 'shifty', seed: 7 }, current: { mode: 'none' }, sky: { source: 'preset', preset: 'fair' } },
      startLocation: 'off-rdyc',
      startHeadingDeg: 200,
      startSpeedKn: 4,
    },
  },
  {
    id: 'wind-against-tide',
    title: 'Wind against tide at the entrance',
    description:
      '12 kn southerly against the ebb between the castles, two hours after high water. The River Dart stream pattern is provisional (docs/PHYSICS.md).',
    needsDart: true,
    scenario: {
      conditions: {
        startTime: '2026-07-15T13:00:00Z',
        weather: { source: 'manual', twsKn: 12, twdDeg: 180 },
        gusts: { preset: 'moderate', seed: 3 },
        current: { mode: 'dart', stream: { ...DEFAULT_TIDAL_STREAM } },
        tide: tideAt('2026-07-15T11:00:00Z'),
      },
      startLocation: 'entrance',
      startHeadingDeg: 150,
      startSpeedKn: 3,
    },
  },
  {
    id: 'fog',
    title: 'Fog in the harbour',
    description: '6 kn easterly in fog off RDYC: visibility a few hundred metres. Visual only; the wind is unaffected.',
    scenario: {
      conditions: { startTime: '2026-05-20T07:00:00Z', weather: { source: 'manual', twsKn: 6, twdDeg: 90 }, gusts: { preset: 'steady', seed: 4 }, current: { mode: 'none' }, sky: { source: 'preset', preset: 'fog' } },
      startLocation: 'off-rdyc',
      startHeadingDeg: 170,
      startSpeedKn: 2,
    },
  },
  {
    id: 'rain',
    title: 'Squally rain',
    description: '14 kn south-westerly, shifty, in heavy rain over Start Bay.',
    scenario: {
      conditions: { startTime: '2026-10-23T12:00:00Z', weather: { source: 'manual', twsKn: 14, twdDeg: 225 }, gusts: { preset: 'shifty', seed: 5 }, current: { mode: 'none' }, sky: { source: 'preset', preset: 'heavy-rain' } },
      startLocation: 'start-bay',
      startHeadingDeg: 200,
      startSpeedKn: 3,
    },
  },
  {
    id: 'evening',
    title: 'Evening sail into the sunset',
    description: '8 kn westerly on 15 July from 19:45 UTC, with the sun 4° above the horizon in the west-north-west and setting.',
    scenario: {
      conditions: { startTime: '2026-07-15T19:45:00Z', weather: { source: 'manual', twsKn: 8, twdDeg: 270 }, gusts: { preset: 'steady', seed: 6 }, current: { mode: 'none' }, sky: { source: 'preset', preset: 'clear' } },
      startLocation: 'off-rdyc',
      startHeadingDeg: 170,
      startSpeedKn: 3,
    },
  },
  {
    id: 'practice-race',
    title: 'Practice race: windward–leeward, 5 AI boats',
    description: 'Simulated practice course in Start Bay, 10 kn, five-minute sequence (P flag). Simplified rules: not an authoritative adjudication (docs/RACING.md).',
    scenario: {
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'moderate', seed: 11 }, current: { mode: 'none' } },
      startLocation: 'start-bay-practice',
      startHeadingDeg: 0,
      startSpeedKn: 3,
      course: { source: 'practice', kind: 'windward-leeward' },
      race: { sequence: 'five-minute', startInS: 330 },
      fleet: { aiCount: 5, level: 'good', prepFlag: 'P' },
    },
  },
  {
    id: 'river-range',
    title: 'River race: the Range sausage',
    description: 'Simulated course upriver off Dart Marina with 3 AI boats and a three-minute sequence. Not an RDYC course.',
    needsDart: true,
    scenario: {
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 9, twdDeg: 0 }, gusts: { preset: 'moderate', seed: 12 }, current: { mode: 'none' } },
      startLocation: 'dart-marina',
      startHeadingDeg: 0,
      startSpeedKn: 2,
      course: { source: 'library', id: 'sim-river-range' },
      race: { sequence: 'three-minute', startInS: 210 },
      fleet: { aiCount: 3, level: 'good', prepFlag: 'P' },
    },
  },
];

/** The bundled Met Office replay, offered when its file was found (it is fetched, not built in). */
const MET_OFFICE_REPLAY = {
  id: 'metoffice-2026-10-23',
  file: 'metoffice-replay-2026-10-23T1400Z.json',
  title: 'Met Office forecast replay, 23 Oct 2026 14:00 UTC',
  description: 'Real Met Office UKV model wind over the area, following the forecast every 15 minutes, with its cloud, visibility and rain. Model output, not measurements.',
};

/** Built-in scenarios; those that need data that is missing (a file, the River Dart data) are marked unavailable. */
export function builtInScenarios(weatherSources: readonly DataSource[], dartLoaded: boolean): LibraryScenario[] {
  const out: LibraryScenario[] = BUILT_IN.map(({ needsDart, ...b }) =>
    needsDart && !dartLoaded
      ? { ...b, group: 'built-in', unavailable: 'Needs the River Dart data, which is not loaded.' }
      : { ...b, group: 'built-in', scenario: structuredClone(b.scenario) },
  );
  const src = weatherSources.find((s) => s.url.endsWith(MET_OFFICE_REPLAY.file));
  out.push({
    id: MET_OFFICE_REPLAY.id,
    title: MET_OFFICE_REPLAY.title,
    description: MET_OFFICE_REPLAY.description,
    group: 'built-in',
    ...(src
      ? {
          scenario: {
            conditions: { startTime: src.validTime ?? '2026-10-23T14:00:00Z', weather: { source: 'metoffice', snapshot: src.json, replay: true }, gusts: { preset: 'from-data', seed: 1 }, current: { mode: 'none' } },
            startLocation: 'off-rdyc',
            startHeadingDeg: 170,
            startSpeedKn: 3,
          },
        }
      : { unavailable: `The forecast file (live/${MET_OFFICE_REPLAY.file}) was not found next to the app.` }),
  });
  return out;
}

const USER_KEY = 'squib.userScenarios.v1';

/** Check a scenario file. Throws with a reason; the conditions themselves are checked when the scenario is run. */
export function parseScenarioFile(json: unknown): ScenarioFile {
  const f = json as Partial<ScenarioFile>;
  if (!f || typeof f !== 'object') throw new Error('scenario: not a JSON object');
  if (f.schema !== SCENARIO_SCHEMA) throw new Error(`scenario: expected schema ${SCENARIO_SCHEMA}, found ${String(f.schema)}`);
  if (typeof f.title !== 'string' || !f.title.trim()) throw new Error('scenario: missing title');
  const s = f.scenario as Partial<AppScenario> | undefined;
  if (!s || typeof s !== 'object' || !s.conditions || typeof s.conditions !== 'object') throw new Error('scenario: missing conditions');
  if (!START_LOCATIONS.some((l) => l.id === s.startLocation)) throw new Error(`scenario: unknown start location "${String(s.startLocation)}"`);
  if (typeof s.startHeadingDeg !== 'number' || typeof s.startSpeedKn !== 'number') throw new Error('scenario: missing start heading or speed');
  return { schema: SCENARIO_SCHEMA, title: f.title.trim(), description: typeof f.description === 'string' ? f.description : undefined, scenario: s as AppScenario };
}

export function scenarioFile(title: string, scenario: AppScenario, description?: string): ScenarioFile {
  return { schema: SCENARIO_SCHEMA, title, ...(description ? { description } : {}), scenario: structuredClone(scenario) };
}

/** Scenarios saved in this browser (a per-viewer convenience: export them to keep or share them). */
export function userScenarios(): LibraryScenario[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_KEY) ?? '[]') as unknown[];
    return raw.flatMap((j, i) => {
      try {
        const f = parseScenarioFile(j);
        return [{ id: `user-${i}`, title: f.title, description: f.description ?? '', group: 'user' as const, scenario: f.scenario }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Save (replacing one of the same title). False when browser storage is unavailable or full. */
export function saveUserScenario(file: ScenarioFile): boolean {
  try {
    const list = userScenarios()
      .filter((s) => s.title !== file.title)
      .map((s) => scenarioFile(s.title, s.scenario!, s.description || undefined));
    list.push(file);
    localStorage.setItem(USER_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function deleteUserScenario(title: string): void {
  try {
    const list = userScenarios()
      .filter((s) => s.title !== title)
      .map((s) => scenarioFile(s.title, s.scenario!, s.description || undefined));
    localStorage.setItem(USER_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: nothing to delete
  }
}

/** A start location's label, for listing scenarios. */
export function startLabel(id: StartLocationId): string {
  return START_LOCATIONS.find((l) => l.id === id)?.label ?? id;
}

/** A file name for a download: lower case, safe characters only. */
export function fileSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'squib';
}
