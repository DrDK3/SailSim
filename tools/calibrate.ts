/**
 * Compare the model with observed steady-state points and optionally fit coefficient multipliers.
 *   npm run calibrate -- observations.csv                 residuals only
 *   npm run calibrate -- observations.csv --fit residuary,sailLift [--duration 120]
 * Knobs: sailLift, residuary, friction, righting (see src/sim/calibration/calibrate.ts). Never edits data
 * files: adopt a fitted multiplier by hand in data/boats/squib/calibration.json with tag C and the observation
 * set as source, then regenerate docs/PARAMETERS.md and the golden traces.
 */
import { readFileSync } from 'node:fs';
import { KNOBS, fit, parseObservationsCsv, residuals, rms, squibParams, type Residual } from '../src/sim/index';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.csv'));
if (!file) {
  console.error('usage: npm run calibrate -- observations.csv [--fit knob1,knob2] [--duration seconds]');
  process.exit(2);
}
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const durationS = Number(opt('--duration') ?? 120);
const obs = parseObservationsCsv(readFileSync(file, 'utf8'));
if (!obs.length) {
  console.error(`${file} has no observation rows.`);
  process.exit(1);
}
const f = (v: number | undefined, d = 2) => (v === undefined ? '–' : (v >= 0 ? '+' : '') + v.toFixed(d));
const report = (title: string, rs: Residual[]) => {
  console.log(`\n${title}`);
  console.log('| TWS kn | TWA ° | STW obs | STW model | ΔSTW kn | heel obs | heel model | Δheel ° | Δleeway ° | source |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rs) {
    const o = r.obs;
    console.log(`| ${o.twsKn} | ${o.twaDeg} | ${o.stwKn?.toFixed(2) ?? '–'} | ${r.model.stwKn.toFixed(2)} | ${f(r.dStwKn)} | ${o.heelDeg?.toFixed(1) ?? '–'} | ${r.model.heelDeg.toFixed(1)} | ${f(r.dHeelDeg, 1)} | ${f(r.dLeewayDeg, 1)} | ${o.source} |`);
  }
  const m = rms(rs);
  console.log(`RMS: STW ${m.stwKn?.toFixed(3) ?? '–'} kn, heel ${m.heelDeg?.toFixed(2) ?? '–'}°, leeway ${m.leewayDeg?.toFixed(2) ?? '–'}°`);
};

const base = squibParams();
report(`Model (current calibration.json) vs ${obs.length} observations, ${durationS} s per point`, residuals(base, obs, { durationS }));

const fitArg = opt('--fit');
if (fitArg) {
  const knobs = fitArg.split(',').map((id) => {
    const k = KNOBS[id.trim()];
    if (!k) throw new Error(`Unknown knob "${id}". Available: ${Object.keys(KNOBS).join(', ')}`);
    return k;
  });
  const r = fit(base, obs, knobs, { durationS });
  console.log(`\nFit (${r.evaluations} model evaluations): cost ${r.costBefore.toFixed(2)} → ${r.costAfter.toFixed(2)}`);
  for (const k of knobs) console.log(`  ${k.id} × ${r.multipliers[k.id]!.toFixed(3)}  (${k.label}; searched ${k.range[0]}–${k.range[1]})`);
  if (r.insensitive.length) console.log(`  WARNING: ${r.insensitive.join(', ')} barely change the result for these observations: not constrained, do not adopt.`);
  if (r.atBound.length) console.log(`  WARNING: ${r.atBound.join(', ')} ended at the edge of the search range: this knob cannot explain the data.`);
  const fitted = knobs.reduce((p, k) => k.apply(p, r.multipliers[k.id]!), base);
  report('After fit', residuals(fitted, obs, { durationS }));
  console.log('\nNothing was written. To adopt: edit calibration.json (tag C, source = this observation set), then npm run params && npm run golden:update.');
}
