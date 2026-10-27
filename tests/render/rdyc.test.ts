/** The Royal Dart Yacht Club: its ensign at colours, its terrace, balcony and flagstaff, and its pontoons. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { coloursFlying, coloursHour, ukUtcOffsetHours } from '../../src/render/colours';
import { ClubEnsign } from '../../src/render/clubEnsign';
import { LANDMARKS, insideRing } from '../../src/render/landmarks';
import { RDYC_ORIGIN } from '../../src/sim/geo/projection';
import type { DartFeatures } from '../../src/app/geoLoader';

const at = (iso: string) => Date.parse(iso);
const { lat, lon } = RDYC_ORIGIN;

describe('colours', () => {
  it('knows British Summer Time', () => {
    expect(ukUtcOffsetHours(at('2026-01-15T12:00:00Z'))).toBe(0);
    expect(ukUtcOffsetHours(at('2026-07-15T12:00:00Z'))).toBe(1);
    // 2026: BST from 01:00 UTC on 29 March to 01:00 UTC on 25 October.
    expect(ukUtcOffsetHours(at('2026-03-29T00:59:00Z'))).toBe(0);
    expect(ukUtcOffsetHours(at('2026-03-29T01:00:00Z'))).toBe(1);
    expect(ukUtcOffsetHours(at('2026-10-25T00:59:00Z'))).toBe(1);
    expect(ukUtcOffsetHours(at('2026-10-25T01:00:00Z'))).toBe(0);
  });

  it('hoists at 0800 from 25 March to 20 September and at 0900 otherwise, local time', () => {
    expect(coloursHour(at('2026-03-24T12:00:00Z'))).toBe(9);
    expect(coloursHour(at('2026-03-25T12:00:00Z'))).toBe(8);
    expect(coloursHour(at('2026-09-20T12:00:00Z'))).toBe(8);
    expect(coloursHour(at('2026-09-21T12:00:00Z'))).toBe(9);
    // July (BST): 07:59 local is 06:59 UTC; 08:00 local is 07:00 UTC.
    expect(coloursFlying(at('2026-07-15T06:59:00Z'), lat, lon)).toBe(false);
    expect(coloursFlying(at('2026-07-15T07:00:00Z'), lat, lon)).toBe(true);
    // December (GMT): down at 08:30, up at 09:00.
    expect(coloursFlying(at('2026-12-15T08:30:00Z'), lat, lon)).toBe(false);
    expect(coloursFlying(at('2026-12-15T09:00:00Z'), lat, lon)).toBe(true);
  });

  it('lowers at sunset', () => {
    // Dartmouth sunset on 15 July is about 21:25 BST (20:25 UTC); on 15 December about 16:05 GMT.
    expect(coloursFlying(at('2026-07-15T19:30:00Z'), lat, lon)).toBe(true);
    expect(coloursFlying(at('2026-07-15T21:00:00Z'), lat, lon)).toBe(false);
    expect(coloursFlying(at('2026-12-15T15:30:00Z'), lat, lon)).toBe(true);
    expect(coloursFlying(at('2026-12-15T16:45:00Z'), lat, lon)).toBe(false);
  });
});

describe('the ensign', () => {
  it('shows at colours only, flying downwind of the staff', () => {
    const en = new ClubEnsign([0, 0], 1, 11);
    en.update(at('2026-07-15T10:00:00Z'), 0, 6, 0);
    expect(en.flying).toBe(true);
    // Wind from the north: the fly streams south (three.js +z).
    const flag = en.group.getObjectByName('club-ensign-flag')!;
    en.group.updateMatrixWorld(true);
    const hoist = new THREE.Vector3(0, -0.45, 0).applyMatrix4(flag.matrixWorld);
    const fly = new THREE.Vector3(1.8, -0.45, 0).applyMatrix4(flag.matrixWorld);
    expect(fly.z - hoist.z).toBeGreaterThan(1.2);
    en.update(at('2026-07-15T22:00:00Z'), 0, 6, 0);
    expect(en.flying).toBe(false);
  });
});

describe('the clubhouse and its pontoons', () => {
  const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as DartFeatures;

  it('has a riverside terrace, a first-floor balcony and a flagstaff on the terrace', () => {
    const spec = LANDMARKS.find((l) => l.id === 'rdyc')!;
    const fp = features.buildings.find((b) => insideRing(b.r, spec.at[0], spec.at[1]))!;
    let ring = fp.r;
    let a = 0;
    for (let i = 0; i < ring.length; i++) a += ring[i]![0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * ring[i]![1];
    if (a < 0) ring = [...ring].reverse();
    const extras = spec.extras!(fp.b, fp.t, ring);
    expect(extras.map((x) => x.kind)).toEqual(['terrace', 'balconies', 'flagstaff']);
    const staff = extras.find((x) => x.kind === 'flagstaff')!;
    // The flagstaff stands outside the footprint (on the terrace, towards the river: west).
    if (staff.kind === 'flagstaff') {
      expect(insideRing(fp.r, staff.at[0], staff.at[1])).toBe(false);
      expect(staff.at[0]).toBeLessThan(spec.at[0]);
    }
  });

  it("the club's main pontoon and its dinghy pontoon (Moody Island) are named, and float", () => {
    const main = features.piers.find((p) => p.name === 'Royal Dart Yacht Club pontoon');
    const dinghy = features.piers.find((p) => p.name === 'Moody Island (RDYC dinghy pontoon)');
    expect(main?.floating).toBe(true);
    expect(dinghy?.floating).toBe(true);
  });

  it('the Royal Dart is labelled as the former hotel it now is', () => {
    expect(features.landmarks.map((l) => l.name)).toContain('The Royal Dart (former hotel, now apartments)');
    expect(features.landmarks.map((l) => l.name)).not.toContain('Royal Dart Hotel');
  });
});
