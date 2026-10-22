/**
 * Physics cost for N boats sharing one environment (criterion 12 budget: ≤ 1.5 ms mean, ≤ 3 ms p99 per
 * 1/60 s frame on the CI container). Each frame advances every boat by 1/60 s of fixed 10 ms steps.
 *   npm run perf [-- boats seconds]
 */
import { readFileSync } from 'node:fs';
import { DEG, DartGeo, Simulation, autopilotHelm, buildConditions, squibParams, type DartManifest } from '../src/sim/index';

const boats = Number(process.argv[2] ?? 21);
const seconds = Number(process.argv[3] ?? 60);
// The River Dart data (seabed for grounding, channel-following stream), as the app uses it.
const geoDir = new URL('../public/geo/', import.meta.url);
const bin = (f: string) => {
  const b = readFileSync(new URL(f, geoDir));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const geo = new DartGeo(JSON.parse(readFileSync(new URL('manifest.json', geoDir), 'utf8')) as DartManifest, bin('elevation.bin'), bin('current.bin'));
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
    // Spread over the harbour between RDYC and the entrance (all in deep water at the start).
    initial: { n: -40 - i * 25, e: -180 + (i % 3) * 30 + i * 30, headingDeg: -twa, speedKn: 4 },
    input: { autoMain: true, autoJib: true },
    controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twa * DEG }) }),
  });
});
const frame = 1 / 60;
let acc = 0;
const times: number[] = [];
for (let f = 0; f < seconds * 60; f++) {
  const t0 = performance.now();
  acc += frame;
  while (acc >= 0.01) {
    for (const s of sims) s.stepOnce();
    acc -= 0.01;
  }
  times.push(performance.now() - t0);
}
const warm = times.slice(60);
warm.sort((a, b) => a - b);
const mean = warm.reduce((a, b) => a + b, 0) / warm.length;
const p99 = warm[Math.floor(warm.length * 0.99)]!;
const aground = sims.filter((s) => s.snapshot(false).grounded).length;
console.log(`${boats} boats on the River Dart, ${seconds} s simulated: physics ${mean.toFixed(2)} ms mean, ${p99.toFixed(2)} ms p99 per 1/60 s frame (shifty gusts, channel stream, grounding; ${aground} aground at the end)`);
