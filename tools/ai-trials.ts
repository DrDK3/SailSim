/**
 * Phase 5 acceptance: AI boats complete a practice course without grounding or collisions in at least 95% of
 * 100 seeded runs. Runs in parallel child processes (one per CPU by default).
 *   npm run ai:trials [-- --runs 100 --boats 5 --workers 4 --river]
 * Writes out/ai-trials.json and prints a summary; exits non-zero below 95% clean.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDartGeoNode } from './lib/dartGeoNode';
import { DEFAULT_TRIAL, runTrial, type TrialOptions, type TrialResult } from '../src/sim/race/trial';
import type { Course } from '../src/sim/course/types';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};

function loadGeo() {
  const dir = new URL('../public/geo/', import.meta.url);
  const geo = loadDartGeoNode(dir);
  const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8'));
  return { geo, features };
}

function trialOptions(river: boolean, boats: number): TrialOptions {
  if (!river) return { ...DEFAULT_TRIAL, boats };
  const course = JSON.parse(readFileSync(new URL('../data/courses/simulated/river-range-sausage.course.json', import.meta.url), 'utf8')) as Course;
  return {
    ...DEFAULT_TRIAL,
    boats,
    course: { ...course, laps: 1 },
    twsRange: [6, 14],
    conditions: {
      tide: { mode: 'manual', hwTime: '2026-07-15T15:00:00Z', hwHeightM: 4.6, lwHeightM: 1.2 },
      current: { mode: 'dart', stream: { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 } },
    },
  };
}

const workerSeeds = arg('worker-seeds', '');
if (!workerSeeds) {
  const runs = Number(arg('runs', '100'));
  const boats = Number(arg('boats', '5'));
  const workers = Math.min(runs, Number(arg('workers', String(Math.max(1, cpus().length)))));
  const first = Number(arg('first', '1'));
  const river = process.argv.includes('--river');
  const out = arg('out', river ? 'out/ai-trials-river.json' : 'out/ai-trials.json');
  const t0 = Date.now();
  const results: TrialResult[] = [];
  let done = 0;
  const self = fileURLToPath(import.meta.url);
  await Promise.all(
    Array.from({ length: workers }, (_, w) =>
      new Promise<void>((resolve, reject) => {
        const seeds = Array.from({ length: runs }, (_, i) => first + i).filter((_, i) => i % workers === w);
        const child = spawn(process.execPath, [...process.execArgv, self, '--worker-seeds', seeds.join(','), '--boats', String(boats), ...(river ? ['--river'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        child.stdout.on('data', (d: Buffer) => {
          buf += d.toString();
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line.startsWith('{')) continue;
            const r = JSON.parse(line) as TrialResult;
            results.push(r);
            done++;
            const bad = r.clean ? '' : ` NOT CLEAN: ${r.codes.join(' ')} ${r.contacts.map((c) => `[${c.t}] ${c.summary}`).join(' | ')} ${r.grounded.length ? 'grounded ' + r.grounded.join(',') : ''}${r.boundaryCrossings ? ` boundary crossings ${r.boundaryCrossings}` : ''}`;
            console.log(`[${done}/${runs}] seed ${r.seed} ${r.course}, ${r.twsKn} kn from ${r.twdDeg}°, ${r.gusts}: ${r.finished}/${r.boats} finished in ${r.raceTime} s${bad}`);
          }
        });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`trial process exited with ${code}`))));
      }),
    ),
  );
  results.sort((a, b) => a.seed - b.seed);
  const clean = results.filter((r) => r.clean).length;
  const delays = results.flatMap((r) => r.startDelays).sort((a, b) => a - b);
  const summary = {
    generated: new Date().toISOString(),
    runs,
    boatsPerRun: boats,
    river,
    clean,
    cleanRate: clean / runs,
    pass: clean / runs >= 0.95,
    boatFinishRate: results.reduce((a, r) => a + r.finished, 0) / (runs * boats),
    collisions: results.reduce((a, r) => a + r.contacts.length, 0),
    groundings: results.reduce((a, r) => a + r.grounded.length, 0),
    boundaryCrossings: results.reduce((a, r) => a + r.boundaryCrossings, 0),
    ocsBoats: results.reduce((a, r) => a + r.ocs, 0),
    generalRecalls: results.reduce((a, r) => a + r.generalRecalls, 0),
    startDelayMedianS: delays[Math.floor(delays.length / 2)],
    wallS: Math.round((Date.now() - t0) / 1000),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
  console.log(`\n${clean}/${runs} clean (${(100 * summary.cleanRate).toFixed(0)}%), ${summary.collisions} contacts, ${summary.groundings} groundings, ${summary.boundaryCrossings} boundary crossings, ${(100 * summary.boatFinishRate).toFixed(1)}% of boats finished; OCS boats ${summary.ocsBoats}, general recalls ${summary.generalRecalls}, median start ${summary.startDelayMedianS} s after the signal. ${summary.wallS} s. Written ${out}.`);
  process.exit(summary.pass ? 0 : 1);
} else {
  const boats = Number(arg('boats', '5'));
  const river = process.argv.includes('--river');
  const { geo, features } = loadGeo();
  const opts = trialOptions(river, boats);
  for (const seed of workerSeeds.split(',').map(Number)) process.stdout.write(JSON.stringify(runTrial(seed, opts, geo, features)) + '\n');
}
