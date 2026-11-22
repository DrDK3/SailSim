/**
 * The superyacht Mosaique on the ship buoys (owner, 14 Nov 2026: "Super Yacht Mosaique ... flying a large RDYC burgee,
 * moored"; "please improve the detail of Mosaique; this is important"; "fly the ensign off the stern"; the ensign the
 * club's defaced red ensign; 15 Nov: "remove the club burgee from the top of the mast ... it should only be on the
 * stern"). Built without a browser here: the shapes, where they are, and the ensign's behaviour.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MOSAIQUE_DRAWN, ShipBuoysView } from '../../src/render/mosaique';
import { MOSAIQUE, MOSAIQUE_TENDER, SHIP_BUOYS, mooredBerth } from '../../src/sim/env/shipBuoys';

const view = new ShipBuoysView();
view.group.updateMatrixWorld(true);

function triangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    const g = m.geometry as THREE.BufferGeometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

/** The yacht's points in her own frame (x to starboard, z aft), from the world. */
function local(p: THREE.Vector3): THREE.Vector3 {
  return view.yacht.worldToLocal(p.clone());
}

describe('Mosaique and the ship buoys', () => {
  it('draws the five buoys where the sim has them, afloat', () => {
    for (const b of SHIP_BUOYS) {
      const g = view.group.getObjectByName(`ship-buoy-${b.id}`)!;
      expect(g).toBeDefined();
      expect(g.position.x).toBeCloseTo(b.e, 6);
      expect(g.position.z).toBeCloseTo(-b.n, 6);
      expect(g.position.y).toBe(0);
    }
  });

  it('lies at her berth, bow to MS2, her hull 50 m and her masthead about 19 m above the water', () => {
    const berth = mooredBerth();
    expect(view.yacht.position.x).toBeCloseTo(berth.e, 6);
    expect(view.yacht.position.z).toBeCloseTo(-berth.n, 6);
    expect(view.yacht.rotation.y).toBeCloseTo(-berth.heading, 9);
    // Measured in her own frame on her own meshes (not the flags or the tender): from stem to swim platform, up to the truck.
    const pts: THREE.Vector3[] = [];
    view.yacht.traverse((m) => {
      if (!(m instanceof THREE.Mesh) || !/^mosaique-(body|glass|fittings)$/.test(m.name)) return;
      const pos = (m.geometry as THREE.BufferGeometry).getAttribute('position');
      for (let i = 0; i < pos.count; i += 7) pts.push(local(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)));
    });
    const zs = pts.map((p) => p.z);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...zs)).toBeLessThan(-MOSAIQUE.loa / 2 + 0.5);
    expect(Math.max(...zs)).toBeGreaterThan(MOSAIQUE.loa / 2 + MOSAIQUE_TENDER.platform - 0.5);
    expect(Math.max(...ys)).toBeGreaterThan(MOSAIQUE_DRAWN.masthead - 0.2);
    expect(Math.max(...ys)).toBeLessThan(MOSAIQUE_DRAWN.masthead + 0.5);
    expect(Math.min(...ys)).toBeLessThan(-MOSAIQUE_DRAWN.draft + 0.3);
  });

  it('is drawn in detail but within a budget, and nothing in it is broken (no NaN)', () => {
    const n = triangles(view.group);
    expect(n).toBeGreaterThan(15_000);
    expect(n).toBeLessThan(160_000);
    let bad = 0;
    view.group.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      const a = (m.geometry as THREE.BufferGeometry).getAttribute('position').array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) bad++;
    });
    expect(bad).toBe(0);
  });

  it('flies the club’s ensign from a staff off her stern and its burgee at her masthead', () => {
    const ensign = view.yacht.getObjectByName('mosaique-ensign')!;
    // The ensign's staff head is aft of the transom (her frame: aft is +z), on the centre line, low (not aloft). Its
    // pivot sits in the raked staff's frame (owner, 22 Nov 2026), so measured in hers.
    view.yacht.updateMatrixWorld(true);
    const at = view.yacht.worldToLocal(ensign.getWorldPosition(new THREE.Vector3()));
    expect(at.z).toBeGreaterThan(MOSAIQUE.loa / 2 + 0.8);
    expect(Math.abs(at.x)).toBeLessThan(0.01);
    expect(at.y).toBeLessThan(8);
    expect(MOSAIQUE_DRAWN.ensign.fly / MOSAIQUE_DRAWN.ensign.hoist).toBeCloseTo(2, 6);
    // The burgee at her masthead (owner, 18 Nov 2026: "remove the triangle burgee and flagpole on the superyacht from
    // the lower stern quarter and place the triangle burgee on the mast"): on the centre line, amidships, aloft.
    const burgee = view.yacht.getObjectByName('mosaique-burgee')!;
    expect(burgee).toBeDefined();
    expect(Math.abs(burgee.position.x)).toBeLessThan(0.01);
    expect(Math.abs(burgee.position.z)).toBeLessThan(MOSAIQUE.loa / 4);
    expect(burgee.getObjectByName('burgee-flag')).toBeDefined();
    // Its flag 1.5 m on the fly (the Squibs' drawing, hoist 3 : fly 5), flying from just above the mast's truck.
    view.yacht.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(burgee.getObjectByName('burgee-flag')!);
    const toYacht = new THREE.Matrix4().copy(view.yacht.matrixWorld).invert();
    box.applyMatrix4(toYacht);
    expect(box.max.y).toBeGreaterThan(MOSAIQUE_DRAWN.masthead);
    expect(box.max.y).toBeLessThan(MOSAIQUE_DRAWN.masthead + 1.5);
    // Nothing left at the stern quarter: no flag low aft but the ensign.
    const flags: string[] = [];
    view.group.traverse((o) => {
      if (o.name.endsWith('-cloth') || o.name === 'burgee-flag') flags.push(o.name);
    });
    expect(flags.sort()).toEqual(['burgee-flag', 'mosaique-ensign-cloth']);
  });

  it('the ensign is flown at colours (08:00 to sunset in summer) and lowered at night', () => {
    const ensign = view.yacht.getObjectByName('mosaique-ensign')!;
    const burgee = view.yacht.getObjectByName('mosaique-burgee')!;
    view.update(Date.parse('2026-07-15T11:00:00Z'), { fromDir: Math.PI / 2, speed: 6 }, 10);
    expect(ensign.visible).toBe(true);
    expect(burgee.visible).toBe(true);
    view.update(Date.parse('2026-07-15T02:00:00Z'), { fromDir: Math.PI / 2, speed: 6 }, 10);
    expect(ensign.visible).toBe(false);
    expect(burgee.visible).toBe(false);
  });

  it('the ensign streams away from the wind', () => {
    const ensign = view.yacht.getObjectByName('mosaique-ensign')!;
    for (const fromDeg of [0, 90, 200, 290]) {
      const from = (fromDeg * Math.PI) / 180;
      view.update(Date.parse('2026-07-15T11:00:00Z'), { fromDir: from, speed: 7 }, 3);
      view.group.updateMatrixWorld(true);
      // The fly's direction in the world (+x of the pivot), against where the wind blows to (e, n) = -(sin, cos).
      const fly = new THREE.Vector3(1, 0, 0).transformDirection(ensign.matrixWorld);
      const toE = -Math.sin(from);
      const toN = -Math.cos(from);
      expect(fly.x * toE + -fly.z * toN).toBeGreaterThan(0.9);
    }
  });

  it('has her tender alongside her starboard quarter, clear of her side', () => {
    const tender = view.yacht.getObjectByName('mosaique-tender')!;
    expect(tender.position.x).toBeGreaterThan(MOSAIQUE.beam / 2 + MOSAIQUE_TENDER.beam / 2);
    expect(tender.position.z).toBeCloseTo(-MOSAIQUE_TENDER.along, 6);
  });
});
