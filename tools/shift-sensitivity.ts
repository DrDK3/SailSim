/**
 * Pointing sensitivity for the tactical exercise (training slice §8): does the better choice after the scripted shift
 * ("tack on the header" or "hold") stay the same when the model's estimated coefficients change? The calibration
 * knobs (src/sim/calibration/calibrate.ts) scale sail lift, drag and righting; the pointing angle the demonstration
 * sails at is varied too. Test harness only: nothing here changes the shipped boat. Writes out/shift-sensitivity.md.
 *
 *   npm run shift-sensitivity
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { shiftSensitivity } from '../src/app/exercises/sensitivity';

const rows = shiftSensitivity();
const lines = [
  '# Wind-shift exercise: sensitivity of the better choice (model output)',
  '',
  'The same start, wind and scripted shift as the exercise; the model demonstration sailed with each rule. Each row changes one estimated coefficient group (or the pointing angle) and nothing else. Model output only.',
  '',
  '| Variant | Tack on the header (s) | Hold (s) | Better | Margin (s) |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.label} | ${r.tackS?.toFixed(1) ?? '—'} | ${r.holdS?.toFixed(1) ?? '—'} | ${r.better ?? 'tie'} | ${r.marginS?.toFixed(1) ?? '—'} |`),
  '',
];
const base = rows[0]!.better;
const flips = rows.filter((r) => r.better !== base);
lines.push(flips.length ? `**The better choice changes in ${flips.length} variant(s): ${flips.map((f) => f.label).join(', ')}.** Present the result as "in this model" and ask instructors (validation sheet T7).` : `**The better choice (${base}) is the same in every variant.** It is still model output: present it as "in this model".`);
mkdirSync('out', { recursive: true });
writeFileSync('out/shift-sensitivity.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));
