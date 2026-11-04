/**
 * The race set-up (review U4: one set-up instead of two): how many AI boats, how good, which course (a short
 * five-minute course, practice courses, the river, an RDYC club course for the wind, or any course in the
 * library, your own included), laps, leg length, the start sequence and preparatory flag, and the conditions
 * (random, live now, or as set in Scenario). Random conditions are drawn from a seed, so a race can be sailed
 * again; they are training ranges chosen for this app (E), not a climatology of the Dart. Today's challenge is
 * the same seeded race for everyone on the same day.
 */
import { createRng } from '../sim/math/rng';
import type { AiLevel } from '../sim/ai/skipper';
import { buildConditions, type ConditionsSettings } from '../sim/env/conditions';
import { clubMarkLocal } from '../sim/course/clubMarks';
import { allCourses, builtInCourses, type LibraryEntry } from './courseLibrary';
import type { SkyPreset } from '../sim/env/sky';
import type { PracticeKind } from '../sim/course/practice';
import type { AppScenario, DataSource } from './controller';
import type { PrepFlag } from '../sim/race/committee';
import { RIVER_STREAM, liveNowConditions } from './liveNow';

export type QuickConditions = 'random' | 'live' | 'as-set';
export type QuickWind = 'any' | 'light' | 'medium' | 'strong';
/**
 * Start Bay (a practice course), the river (the Range sausage), Start Bay on an RDYC club course for the wind, or
 * a course from the library (the course editor's own included).
 */
export type QuickVenue = 'start-bay' | 'river' | 'rdyc' | 'library';

/** Start Bay courses: the short course (one beat and one run) and the practice courses. */
export type QuickCourse = 'short' | Extract<PracticeKind, 'windward-leeward' | 'triangle' | 'tacking-lane' | 'gybing-slalom' | 'rounding-drill'>;

/**
 * The short course: one beat and one run on a 220 m windward–leeward. AI Squibs (good) take about 5 minutes in
 * a moderate breeze, longer in light air (measured in tests/sim/raceSetup.test.ts; model output).
 */
export const SHORT_COURSE_LEG_M = 220;

export interface QuickRaceOptions {
  /** AI boats to race against (0 = sail the course alone). */
  competitors: number;
  level: AiLevel;
  venue: QuickVenue;
  /** Course in Start Bay (the river, RDYC and library venues use their own). */
  course: QuickCourse;
  /** The library course, for the library venue. */
  libraryId?: string;
  /** Laps (the course's own when not set; the short course is always one). */
  laps?: number;
  /** Leg length of a practice course, m (the course's own when not set). */
  legM?: number;
  prepFlag?: PrepFlag;
  /** Seconds from the beginning to the start signal (the sequence plus 30 s when not set). */
  startInS?: number;
  conditions: QuickConditions;
  /** Wind strength band for random conditions. */
  wind: QuickWind;
  seed: number;
  sequence: 'one-minute' | 'three-minute' | 'five-minute';
  /**
   * River only: sail with the illustrative tidal stream. Off by default (review EN-1, decision D5): its timing
   * comes from the rise and fall of the tide, which the real Dart stream does not follow.
   */
  stream?: boolean;
  /** Today's challenge: its key ("challenge:2026-11-04"), so its best time is kept apart. */
  challenge?: string;
}

export const DEFAULT_QUICK_RACE: QuickRaceOptions = {
  competitors: 5,
  level: 'good',
  venue: 'start-bay',
  course: 'short',
  conditions: 'random',
  wind: 'any',
  seed: 1,
  sequence: 'three-minute',
};

/** Wind speed (kn) for each band of random conditions (E: training ranges). */
export const QUICK_WIND_KN: Record<QuickWind, [number, number]> = {
  any: [4, 24],
  light: [4, 8],
  medium: [8, 15],
  strong: [15, 24],
};

const SEQUENCE_S = { 'one-minute': 60, 'three-minute': 180, 'five-minute': 300 } as const;
/** Skies a random race may have: none that hides the course (fog, mist) (E). */
const RANDOM_SKIES: SkyPreset[] = ['clear', 'fair', 'fair', 'hazy', 'overcast', 'rain'];
/** Random tide: high water and low water heights as in the app's other scenarios (E: not Dartmouth's tables). */
const RANDOM_TIDE = { hwHeightM: 4.6, lwHeightM: 1.2 };

export interface RandomConditions {
  conditions: ConditionsSettings;
  summary: string;
}

/**
 * Seeded random conditions: wind (from any direction in Start Bay; up or down the river within 25° on the
 * river course, whose legs run along the Range), gusts (stronger winds are more often gusty), a sailing-season
 * afternoon, the sky, and the tide's phase (with its stream).
 */
export function randomConditions(seed: number, wind: QuickWind, venue: QuickVenue, stream = false): RandomConditions {
  const rng = createRng(seed * 7919 + 17);
  const [lo, hi] = QUICK_WIND_KN[wind];
  const twsKn = Math.round((lo + (hi - lo) * rng.next()) * 2) / 2;
  const twdDeg = venue === 'river'
    ? Math.round((rng.next() < 0.5 ? 0 : 180) + (rng.next() - 0.5) * 50 + 360) % 360
    : Math.round(rng.next() * 360) % 360;
  const gustRoll = rng.next();
  const preset = twsKn >= 15
    ? (gustRoll < 0.5 ? 'gusty' : gustRoll < 0.85 ? 'shifty' : 'moderate')
    : (gustRoll < 0.15 ? 'steady' : gustRoll < 0.55 ? 'moderate' : gustRoll < 0.85 ? 'shifty' : 'gusty');
  // A day from April to September, starting between 10:00 and 16:00 UTC.
  const day = new Date(Date.UTC(2026, 3, 1) + Math.floor(rng.next() * 183) * 86400e3);
  const startMin = 600 + Math.floor(rng.next() * 13) * 30;
  const start = new Date(day.getTime() + startMin * 60e3);
  const hw = new Date(start.getTime() + Math.round((rng.next() - 0.5) * 12.4 * 60) * 60e3);
  const sky = RANDOM_SKIES[Math.floor(rng.next() * RANDOM_SKIES.length)]!;
  const iso = (d: Date) => d.toISOString().slice(0, 16) + ':00Z';
  const conditions: ConditionsSettings = {
    startTime: iso(start),
    weather: { source: 'manual', twsKn, twdDeg },
    gusts: { preset, seed },
    tide: { mode: 'manual', hwTime: iso(hw), ...RANDOM_TIDE },
    current: venue === 'river' && stream ? { mode: 'dart', stream: { ...RIVER_STREAM } } : { mode: 'none' },
    sky: { source: 'preset', preset: sky },
  };
  const hoursToHw = (hw.getTime() - start.getTime()) / 3600e3;
  const tide = Math.abs(hoursToHw) < 1 ? 'about high water' : hoursToHw > 0 ? `${hoursToHw.toFixed(1)} h before high water` : `${(-hoursToHw).toFixed(1)} h after high water`;
  return { conditions, summary: `${twsKn} kn from ${twdDeg}°, ${preset}, ${tide} (random, seed ${seed})` };
}

export interface QuickRaceBuild {
  scenario: AppScenario;
  summary: string;
  /** Why the chosen conditions could not be used (live data missing), when that happened. */
  note?: string;
}

/** Said when a live race on the river has no live tide to drive its stream. */
export const NO_LIVE_TIDE_NOTE = 'No live tide is published yet, so the river has no tidal stream and the water stays at about mean sea level.';

/**
 * The scenario for a quick race. `current` is the scenario as set now; `live` the live weather source and
 * `liveTide` the live tide, if any. A tidal stream needs a tide: without a live one, a live race on the river
 * has no stream (and says so) rather than failing to start.
 */
export function quickRaceScenario(o: QuickRaceOptions, current: AppScenario, live?: DataSource, liveTide?: DataSource): QuickRaceBuild {
  const competitors = Math.max(0, Math.min(20, Math.round(o.competitors)));
  let conditions: ConditionsSettings;
  let summary: string;
  let note: string | undefined;
  if (o.conditions === 'live' && live) {
    const river = o.venue === 'river';
    conditions = liveNowConditions(live, { tide: liveTide, stream: river && !!o.stream, seed: o.seed });
    summary = `live Met Office conditions (${live.label})${liveTide ? ` and ${liveTide.label}` : ''}`;
    if (river && o.stream && !liveTide) note = NO_LIVE_TIDE_NOTE;
  } else if (o.conditions === 'as-set') {
    conditions = structuredClone(current.conditions);
    summary = 'the conditions as set';
  } else {
    if (o.conditions === 'live') note = 'No live weather is available here (it needs the deployed site and its scheduled job), so the conditions are random.';
    const r = randomConditions(o.seed, o.wind, o.venue, !!o.stream);
    conditions = r.conditions;
    summary = r.summary;
  }
  const river = o.venue === 'river';
  const library = o.venue === 'library' && o.libraryId ? builtInOrUserCourse(o.libraryId) : undefined;
  // An RDYC course: the one set for the wind nearest today's at the entrance (as the race officer chooses from
  // the course appendix), sailed from the committee boat placed for that wind.
  let club: LibraryEntry | undefined;
  if (o.venue === 'rdyc') {
    const at = clubMarkLocal('H') ?? { n: -1900, e: 870 };
    const w = buildConditions(conditions).env.wind(0, at.n, at.e);
    club = clubCourseForWind((Math.atan2(-w.e, -w.n) * 180) / Math.PI, Math.hypot(w.n, w.e) / 0.514444);
  }
  const startInS = o.startInS !== undefined ? Math.max(20, Math.min(600, Math.round(o.startInS))) : SEQUENCE_S[o.sequence] + 30;
  const laps = o.laps !== undefined ? Math.max(1, Math.min(10, Math.round(o.laps))) : undefined;
  const lapsPart = laps !== undefined ? { laps } : {};
  const course: AppScenario['course'] = river
    ? { source: 'library', id: 'sim-river-range', ...lapsPart }
    : club
      ? { source: 'library', id: club.id, ...lapsPart }
      : library
        ? { source: 'library', id: library.id, ...lapsPart }
        : o.course === 'short'
          ? { source: 'practice', kind: 'windward-leeward', legM: o.legM ?? SHORT_COURSE_LEG_M, laps: 1 }
          : { source: 'practice', kind: o.course, ...(o.legM !== undefined ? { legM: o.legM } : {}), ...lapsPart };
  const scenario: AppScenario = {
    conditions,
    startLocation: river ? 'dart-marina' : club || library ? 'start-bay' : 'start-bay-practice',
    startHeadingDeg: 0,
    startSpeedKn: 2,
    course,
    race: { sequence: o.sequence, startInS },
    fleet: { aiCount: competitors, level: o.level, prepFlag: o.prepFlag ?? 'P' },
    boat: current.boat,
    helm: current.helm,
  };
  const who = competitors === 0 ? 'alone' : `against ${competitors} AI boat${competitors === 1 ? '' : 's'} (${o.level})`;
  const where = river
    ? 'River race'
    : club
      ? `${club.course.name.replace(/ \(club course\)$/, '')}, from the club's 2026 sailing instructions (awaiting a club check)`
      : library
        ? library.course.name
        : o.course === 'short'
          ? 'Short course'
          : 'Start Bay race';
  return { scenario, summary: `${where} ${who}: ${summary}`, note };
}

/**
 * The RDYC course for the wind, among the club courses entered from the 2026 course appendix (data/courses/
 * club): the appendix sets courses by wind direction, Group B for the usual breeze (Classes 2 and 3) and
 * Group C "for light winds". The nearest direction wins, a course of the other group counting 20° further off
 * (light = under 8 kn, a simulator threshold, E). North-west, whose courses use the temporary mark T, is not
 * entered yet.
 */
export function clubCourseForWind(windFromDeg: number, twsKn = 10, courses: LibraryEntry[] = builtInCourses()): LibraryEntry | undefined {
  const club = courses.filter((c) => c.group === 'club' && c.course.designWindFromDeg !== undefined);
  const want = twsKn < 8 ? 'c' : 'b';
  const group = (c: LibraryEntry) => /-([a-z])\d+$/.exec(c.id)?.[1];
  const score = (c: LibraryEntry) => Math.abs((((c.course.designWindFromDeg! - windFromDeg) % 360) + 540) % 360 - 180) + (group(c) === want ? 0 : 20);
  return club.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0];
}

/** A course in the library (built-in or your own), by id. */
function builtInOrUserCourse(id: string): LibraryEntry | undefined {
  return allCourses().find((c) => c.id === id);
}

/**
 * Today's challenge: the same seeded race for everyone on the same (UTC) day: three good AI boats on the short
 * course in a moderate random breeze, with a one-minute sequence. Its best time is kept apart in this browser.
 * No server: nobody else's times are seen (shared tables need a service: docs/review/UI_BENCHMARK.md).
 */
export function dailyChallenge(now = new Date()): { key: string; day: string; options: QuickRaceOptions } {
  const day = now.toISOString().slice(0, 10);
  const seed = (Number(day.replace(/-/g, '')) % 9973) + 1;
  return {
    key: `challenge:${day}`,
    day,
    options: { competitors: 3, level: 'good', venue: 'start-bay', course: 'short', conditions: 'random', wind: 'medium', seed, sequence: 'one-minute', challenge: `challenge:${day}` },
  };
}
