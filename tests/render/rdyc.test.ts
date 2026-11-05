/** The Royal Dart Yacht Club: its ensign at colours, the clubhouse as the photographs show it, its sea wall, terrace and pontoon. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { coloursFlying, coloursHour, ukUtcOffsetHours } from '../../src/render/colours';
import { ClubEnsign } from '../../src/render/clubEnsign';
import { LANDMARKS, insideRing } from '../../src/render/landmarks';
import { RDYC_FORESHORE_ODN, RDYC_FRAME, SEA_WALL, buildRdycClub, buildRdycPontoonGear, rdycForeshore, rdycKeepOut, rdycPlatformAt, seawardOfRdycWall } from '../../src/render/rdyc';
import { splitWalkable } from '../../src/render/population';
import { pierPieces } from '../../src/sim/race/piers';
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

  it('is modelled as itself: brick gable wing, white south wing, slate roofs, turret, bay, signs, sea wall, terrace', () => {
    const club = buildRdycClub();
    const names = new Set<string>();
    club.group.traverse((o) => names.add(o.name));
    for (const part of ['brick', 'render', 'slate', 'glass', 'trim', 'stone', 'paving', 'sign', 'name', 'canvas']) expect(names, part).toContain(`rdyc-club-${part}`);
    // A small model: a few thousand triangles.
    expect(club.triangles).toBeLessThan(10000);
    const box = new THREE.Box3().setFromObject(club.group);
    // Two storeys and a steep roof on a terrace at +3.3 m ODN; the turret's finial the highest point.
    expect(box.max.y).toBeGreaterThan(RDYC_FRAME.floorOdn + 13);
    expect(box.max.y).toBeLessThan(RDYC_FRAME.floorOdn + 16);
    // The gable faces the river: the model reaches west of the footprint's west end (the porch and the sea wall).
    expect(box.min.x).toBeLessThan(-19);
  });

  it('stands on its terrace and sea wall; the flagstaff is on the terrace in front of the turret', () => {
    const spec = LANDMARKS.find((l) => l.id === 'rdyc')!;
    const fp = features.buildings.find((b) => insideRing(b.r, spec.at[0], spec.at[1]))!;
    const club = buildRdycClub();
    const [fe, fn] = club.flagstaff.at;
    expect(insideRing(fp.r, fe, fn)).toBe(false);
    expect(rdycPlatformAt(fe, fn)).toBe(RDYC_FRAME.floorOdn);
    expect(club.flagstaff.fromM).toBe(RDYC_FRAME.floorOdn);
    // The terrace is the ground there; the river beyond the wall is not.
    expect(rdycPlatformAt(-12, -10)).toBe(RDYC_FRAME.floorOdn);
    expect(rdycPlatformAt(-30, 0)).toBeUndefined();
    // Every point of the sea wall's face lies west of (outside) the clubhouse's footprint.
    for (const [e, n] of SEA_WALL) expect(insideRing(fp.r, e, n)).toBe(false);
  });

  it('the gangway runs from the terrace down to the pontoon, and is solid to the boats', () => {
    const club = features.piers.find((p) => p.name === 'Royal Dart Yacht Club pontoon')!;
    expect(club.gangway).toBeDefined();
    expect(rdycPlatformAt(club.gangway!.shore[0], club.gangway!.shore[1])).toBe(RDYC_FRAME.floorOdn);
    const pieces = pierPieces(features.piers);
    expect(pieces.some((p) => p.label === 'Royal Dart Yacht Club pontoon gangway')).toBe(true);
    // The head carries the club's dinghies on edge, a stack of dinghies with its sign, and a RIB.
    const gear = buildRdycPontoonGear((club as { poly: [number, number][] }).poly, 0.42);
    const parts = gear.floating.children.map((c) => c.name);
    for (const n of ['rdyc-dinghies-on-edge', 'rdyc-dinghy-stack', 'rdyc-pontoon-sign', 'rdyc-rib']) expect(parts).toContain(n);
  });

  it('the dinghies in the rack lean one against the next and share no surface (they strobed side by side in one plane)', () => {
    const club = features.piers.find((p) => p.name === 'Royal Dart Yacht Club pontoon')!;
    const gear = buildRdycPontoonGear((club as { poly: [number, number][] }).poly, 0.42);
    const rack = gear.floating.children.find((c) => c.name === 'rdyc-dinghies-on-edge') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const pos: THREE.Vector3[] = [];
    let depthAxis: THREE.Vector3 | undefined;
    for (let k = 0; k < rack.count; k++) {
      rack.getMatrixAt(k, m);
      pos.push(new THREE.Vector3().setFromMatrixPosition(m));
      const z = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize();
      if (depthAxis) expect(Math.abs(z.dot(depthAxis))).toBeGreaterThan(0.999); // all parallel
      depthAxis ??= z;
    }
    // A hull is 0.32 m deep (0.22 m and its rounded edges): face to face, neighbours stand farther apart than that.
    for (let k = 1; k < pos.length; k++) expect(Math.abs(pos[k]!.clone().sub(pos[k - 1]!).dot(depthAxis!))).toBeGreaterThan(0.33);
  });

  it('in front of its sea wall the bed is drawn below the water, so the wall stands in the water; behind the wall nothing changes', () => {
    // Half-way along the club's stretch of wall, 5 m out into the river and 5 m behind it.
    const [ae, an] = SEA_WALL[3]!;
    const [be, bn] = SEA_WALL[4]!;
    const me = (ae + be) / 2;
    const mn = (an + bn) / 2;
    const len = Math.hypot(be - ae, bn - an);
    // The river is on the right of the wall walked north to south.
    const re = (bn - an) / len;
    const rn = -(be - ae) / len;
    expect(seawardOfRdycWall(me + re * 5, mn + rn * 5)).toBeCloseTo(5, 1);
    expect(seawardOfRdycWall(me - re * 5, mn - rn * 5)).toBeCloseTo(-5, 1);
    expect(rdycForeshore(me + re * 5, mn + rn * 5, 0.6)).toBe(RDYC_FORESHORE_ODN);
    expect(rdycForeshore(me - re * 5, mn - rn * 5, 2.4)).toBe(2.4);
    // Far out in the river, and far from the club: unchanged.
    expect(rdycForeshore(me + re * 60, mn + rn * 60, -6)).toBe(-6);
    expect(rdycForeshore(500, 500, 0.6)).toBe(0.6);
  });

  it('nobody walks through the clubhouse or past the sea wall: walking routes stop at them', () => {
    const roads = JSON.parse(readFileSync(new URL('../../public/geo/roads.json', import.meta.url), 'utf8')) as { roads: { c: string; l: [number, number][] }[] };
    const footprint = features.buildings.find((b) => (b as { n?: string }).n === 'Royal Dart Yacht Club')!.r as [number, number][];
    const keepOut = rdycKeepOut(footprint);
    // The footway past the club's south side runs on beyond the wall's face in the data; walked as it was, a
    // walker went through the wall.
    const footway = roads.roads.find((r) => r.c === 'f' && r.l.some(([e, n]) => Math.hypot(e + 12.1, n + 17.8) < 0.5))!;
    expect(footway).toBeDefined();
    expect(footway.l.some(([e, n]) => keepOut(e, n))).toBe(true);
    let checked = 0;
    for (const r of roads.roads) {
      if (!['f', 'w', 'x', 'r', 'l', 't', 's', 'p'].includes(r.c) || !r.l.some(([e, n]) => Math.hypot(e, n) < 80)) continue;
      const side = ['f', 'w', 'x'].includes(r.c) ? 0.3 : 3;
      for (const piece of splitWalkable(r.l, keepOut, side)) {
        for (let i = 0; i < piece.length; i++) {
          const [e, n] = piece[i]!;
          expect(keepOut(e, n), `${r.c} at ${e.toFixed(1)}, ${n.toFixed(1)}`).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
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
