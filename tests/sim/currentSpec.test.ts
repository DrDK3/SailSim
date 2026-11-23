/**
 * Design handover (23 Nov 2026), item 31: docs/CURRENT_SPEC.md is build-linked. These checks fail when the figures and
 * switches it names stop matching the code, so the page cannot quietly go stale.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, FLAG_ORDER } from '../../src/app/flags';
import { RULESET } from '../../src/app/bests';
import { BACKUP_FORMAT, BACKUP_VERSION } from '../../src/app/progressBackup';
import { LAYLINE_MAX_STREAM_KN } from '../../src/app/raceAids';
import { KUDOS_ENTRY_MIN_KN } from '../../src/app/exercises/kudos';
import { DEFAULT_PREFS } from '../../src/app/prefs';
import { TAP_S } from '../../src/app/controller';

const spec = readFileSync('docs/CURRENT_SPEC.md', 'utf8');

describe('docs/CURRENT_SPEC.md matches the build', () => {
  it('every feature switch, with its default', () => {
    for (const f of FLAG_ORDER) {
      const d = FEATURE_FLAGS[f].defaultOn;
      const word = d === 'learn' ? 'on at the Learn level' : d ? 'on' : 'off';
      expect(spec, f).toContain(`| ${FEATURE_FLAGS[f].label} | ${word} |`);
    }
  });

  it('the figures it quotes', () => {
    expect(spec).toContain(`rules version ${RULESET}`);
    expect(spec).toContain(`\`${BACKUP_FORMAT}\` version ${BACKUP_VERSION}`);
    expect(spec).toContain(`stream under ${LAYLINE_MAX_STREAM_KN} kn`);
    expect(spec).toContain(`entry floor ${KUDOS_ENTRY_MIN_KN} kn`);
    expect(spec).toContain(`acts for ${TAP_S} s of sailing`);
    expect(DEFAULT_PREFS.kudos).toBe('debrief');
    expect(spec).toMatch(/shows\s+at the end by default/);
  });

  it('the docs index lists every document in docs/ as current or historical', () => {
    const index = readFileSync('docs/README.md', 'utf8');
    for (const f of readdirSync('docs').filter((x) => x.endsWith('.md') && x !== 'README.md')) expect(index, f).toContain(`(${f})`);
  });
});
