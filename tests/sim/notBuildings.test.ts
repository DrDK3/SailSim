/**
 * Footprints in the building data that are not there are not solid either (owner, 13 Nov 2026: the building on the
 * Riverboat Pontoon "is not a kiosk, please remove"): a race meets the buildings in the water but not these.
 */
import { describe, expect, it } from 'vitest';
import { raceStructures } from '../../src/sim/race/setup';
import { NOT_BUILDINGS } from '../../src/sim/env/notBuildings';
import { loadDartApp } from './helpers';

const app = loadDartApp();

describe('footprints that are not buildings', () => {
  const structures = raceStructures(app.features as never, app.geo);
  const centre = (poly: [number, number][]) => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];

  it('the one on the Riverboat Pontoon is no longer solid; the Hindostan still is', () => {
    const pontoonHut = NOT_BUILDINGS.find((x) => x.at[0] === -155)!;
    const wet = structures.filter((s) => s.poly && s.name !== undefined && !('line' in s && s.line));
    expect(wet.some((s) => s.poly && Math.hypot(centre(s.poly as [number, number][])[0]! - pontoonHut.at[0], centre(s.poly as [number, number][])[1]! - pontoonHut.at[1]) < 5)).toBe(false);
    expect(structures.some((s) => s.name === 'the Hindostan')).toBe(true);
  });

  it('the Riverboat Pontoon itself is still there', () => {
    expect(structures.some((s) => s.name === 'Riverboat Pontoon')).toBe(true);
  });
});
