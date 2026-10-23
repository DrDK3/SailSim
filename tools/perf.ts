/**
 * Criterion 12 (performance with AI), headless, per 1/60 s frame on this machine:
 *  1. physics only: N boats sharing one environment on the River Dart (grounding, channel stream, shifty gusts),
 *     each autopiloted at a fixed TWA (as since Phase 1);
 *  2. a full race: the user's boat (scripted helm) + N−1 AI Squibs on a practice course in Start Bay, with the
 *     fleet contact model, course judges, rules tracking, race committee and the AI skippers.
 * Budget (draft criterion 12): physics ≤ 1.5 ms mean and ≤ 3 ms p99 per frame on the CI container.
 *   npm run perf [-- boats seconds]
 */
import { readFileSync } from 'node:fs';
import { DEG, Simulation, autopilotHelm, buildConditions, practiceCourse, squibParams } from '../src/sim/index';
import { loadDartGeoNode } from './lib/dartGeoNode';
import { createRace, practiceLineLength } from '../src/sim/race/setup';

const boats = Number(process.argv[2] ?? 21);
const seconds = Number(process.argv[3] ?? 60);
const geoDir = new URL('../public/geo/', import.meta.url);
const geo = loadDartGeoNode(geoDir);
const features = JSON.parse(readFileSync(new URL('features.json', geoDir), 'utf8'));

function measure(label: string, stepOnce: () => void, frames: number, warm = 60): { mean: number; p99: number; max: number } {
  const frame = 1 / 60;
  let acc = 0;
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    acc += frame;
    while (acc >= 0.01) {
      stepOnce();
      acc -= 0.01;
    }
    times.push(performance.now() - t0);
  }
  const w = times.slice(warm).sort((a, b) => a - b);
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const r = { mean, p99: w[Math.floor(w.length * 0.99)]!, max: w[w.length - 1]! };
  console.log(`${label}: ${r.mean.toFixed(2)} ms mean, ${r.p99.toFixed(2)} ms p99, ${r.max.toFixed(1)} ms max per 1/60 s frame`);
  return r;
}

// 1. Physics only.
{
  const built = buildConditions({
    startTime: '2026-07-15T12:00:00Z',
    weather: { source: 'manual', twsKn: 12, twdDeg: 0 },
    gusts: { preset: 'shifty', seed: 5 },
    tide: { mode: 'manual', hwTime: '2026-07-15T15:00:00Z', hwHeightM: 4.6, lwHeightM: 1.2 },
    current: { mode: 'dart', stream: { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 } },
  }, geo);
  const params = squibParams();
  const sims = Array.from({ length: boats }, (_, i) => {
    const twa = (i % 2 ? 1 : -1) * (40 + (i * 7) % 120);
    return new Simulation({
      params, env: built.env, ownsEnvironment: i === 0, seabed: geo,
      initial: { n: -40 - i * 25, e: -180 + (i % 3) * 30 + i * 30, headingDeg: -twa, speedKn: 4 },
      input: { autoMain: true, autoJib: true },
      controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twa * DEG }) }),
      logInputs: false, // as for AI boats: the helm changes every step
    });
  });
  measure(`${boats} boats, physics only (River Dart, grounding, channel stream, shifty gusts), ${seconds} s`, () => {
    for (const s of sims) s.stepOnce();
  }, seconds * 60);
}

// 2. Full race with AI.
{
  const twd = 225;
  const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: twd, startLineM: practiceLineLength(boats) });
  let helmT = 0;
  const { session } = createRace({
    conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 12, twdDeg: twd }, gusts: { preset: 'shifty', seed: 5 }, current: { mode: 'none' } },
    geo, features, course, aiCount: boats - 1, level: 'good', seed: 5,
    human: { controller: (s) => ({ helm: Math.sin((helmT = s.time) / 7) * 0.3, autoMain: true, autoJib: true }) },
    committee: { startAt: 60, sequence: 'one-minute' },
  });
  void helmT;
  measure(`1 + ${boats - 1} AI boats, full race (pre-start and start, practice course), ${seconds} s`, () => session.step(), seconds * 60);
  measure(`1 + ${boats - 1} AI boats, full race (racing, next ${seconds} s)`, () => session.step(), seconds * 60, 0);
  console.log(`(contacts so far: ${session.incidents.length})`);
}
