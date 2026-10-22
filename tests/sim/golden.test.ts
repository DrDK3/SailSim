/**
 * Golden-trace regression: each scenario must reproduce its stored trace within GOLDEN_TOLERANCE.
 * A failure means the physics output changed. If that was intended, regenerate with
 * `npm run golden:update` and record why in the commit message.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../src/sim/index';
import { GOLDEN_COLUMNS, GOLDEN_TOLERANCE, goldenTrace } from './goldenTrace';

const root = new URL('../../', import.meta.url);
const scenarios = readdirSync(new URL('scenarios/', root)).filter((f) => f.endsWith('.json')).sort();

describe('golden traces', () => {
  for (const f of scenarios) {
    it(f, () => {
      const scn = JSON.parse(readFileSync(new URL(`scenarios/${f}`, root), 'utf8')) as Scenario;
      const golden = JSON.parse(readFileSync(new URL(`tests/golden/${f}`, root), 'utf8')) as { rows: number[][] };
      const now = goldenTrace(scn);
      expect(now.rows.length).toBe(golden.rows.length);
      now.rows.forEach((row, i) => {
        row.forEach((v, c) => {
          const col = GOLDEN_COLUMNS[c]!;
          let d = Math.abs(v - golden.rows[i]![c]!);
          if (col === 'heading_deg' || col === 'boom_deg') d = Math.min(d, 360 - d);
          expect(d, `${col} at t=${row[0]} s`).toBeLessThanOrEqual(GOLDEN_TOLERANCE[col]);
        });
      });
    }, 120_000);
  }
});
