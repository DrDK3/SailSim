/**
 * The reference race's state hash: a fixed 7-boat race on the River Dart data, 400 s, AI only. Every package that
 * changes no physics must leave it identical (next round, from package D on: the reference race was a scratch script
 * in earlier rounds, which is why its value differs from the one quoted before; this one is committed so it can be
 * re-run on any commit).
 *
 *   npx tsx tools/race-hash.ts              # prints the hash and the time it took
 *   npx tsx tools/race-hash.ts --spinnaker  # the same race, the fleet carrying spinnakers (fixes of 21 Nov 2026, §2.3)
 *
 * Start Bay practice area, a windward–leeward, 12 kn from 225° with shifty gusts, the channel-following stream and a
 * manual tide (so the river's depths, coast and stream all act), seven good AI boats, a one-minute sequence.
 */
import { readFileSync } from 'node:fs';
import { loadDartGeoNode } from './lib/dartGeoNode';
import { createRace, practiceLineLength } from '../src/sim/race/setup';
import { practiceCourse } from '../src/sim/course/practice';

const dir = new URL('../public/geo/', import.meta.url);
const geo = loadDartGeoNode(dir);
const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8'));
const boats = 7;
const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: 225, startLineM: practiceLineLength(boats) });
const t0 = Date.now();
const { session } = createRace({
  conditions: {
    startTime: '2026-07-15T13:00:00Z',
    weather: { source: 'manual', twsKn: 12, twdDeg: 225 },
    gusts: { preset: 'shifty', seed: 5 },
    tide: { mode: 'manual', hwTime: '2026-07-15T15:00:00Z', hwHeightM: 4.6, lwHeightM: 1.2 },
    current: { mode: 'dart', stream: { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 } },
  },
  geo,
  features,
  course,
  aiCount: boats,
  level: 'good',
  // --spinnaker: the same race with the fleet carrying spinnakers (fixes of 21 Nov 2026, §2.3).
  spinnaker: process.argv.includes('--spinnaker'),
  seed: 3,
  committee: { startAt: 60, sequence: 'one-minute' },
});
for (let i = 0; i < 40_000; i++) session.step();
console.log(`reference race (7 boats${process.argv.includes('--spinnaker') ? ' with spinnakers' : ''}, 400 s, River Dart data): ${session.stateHash()} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
