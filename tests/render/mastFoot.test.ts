import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';

/**
 * Owner, 22 Nov 2026: "There appears to be an anomaly at the base of the squib mast." The low foredeck rise (a
 * flattened capsule meant to lie forward of the mast) reached 0.1 m past it: the mast stood in its thin rounded edge,
 * and the mast's collar, on the deck below, showed beneath that edge as a dark ring, the kicker's foot inside it. Now
 * the rise ends forward of the collar, the collar sits on the deck, and the kicker meets the collar's top.
 */
const MAST_Z = -0.55;

function model(): SquibModel {
  const m = new SquibModel(squibParams());
  for (let k = 0; k < 30; k++) m.update({ main: { angle: 0.3, luff: 1, fill: 1 }, jib: { angle: 0.24, luff: 1, fill: 1 }, rudder: 0, crewY: 0.4, crewTo: 0.4, time: k / 30 } as never);
  m.group.updateMatrixWorld(true);
  return m;
}

/** The deck and the rig as built, before their meshes are merged by material (their names kept). */
function parts(m: SquibModel): { deck: THREE.Group; fore: THREE.Mesh; collar: THREE.Mesh } {
  const p = m as unknown as { buildDeck(): THREE.Group; buildRig(top: number): THREE.Object3D[] };
  const deck = p.buildDeck();
  deck.updateMatrixWorld(true);
  const fore = deck.getObjectByName('foredeck') as THREE.Mesh;
  const collar = p.buildRig(7.6).find((o) => o.name === 'mast-collar') as THREE.Mesh;
  collar.updateMatrixWorld(true);
  return { deck, fore, collar };
}

describe('the foot of the mast', () => {
  it('the foredeck rise ends forward of the mast’s collar: nothing of it round the mast', () => {
    const { fore, collar } = parts(model());
    const fb = new THREE.Box3().setFromObject(fore);
    const cb = new THREE.Box3().setFromObject(collar);
    expect(fb.max.z).toBeLessThan(cb.min.z);
    // Looking down round the mast: just outside the collar (0.085 m) all round, and out to 0.2 m beside and aft of it,
    // the rise is never what is seen (it reached 0.1 m aft of the mast before; it starts 2 cm forward of the collar now).
    const ray = new THREE.Raycaster();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const r of [0.085, 0.12, 0.16, 0.2]) {
        if (r > 0.09 && Math.cos(a) < -0.05) continue;
        ray.set(new THREE.Vector3(Math.sin(a) * r, 3, MAST_Z + Math.cos(a) * r), new THREE.Vector3(0, -1, 0));
        expect(ray.intersectObject(fore).length, `at ${r} m, ${Math.round((a * 180) / Math.PI)}° from aft`).toBe(0);
      }
    }
  });

  it('the collar sits on the deck, and the kicker’s foot on the collar', () => {
    const m = model();
    const { deck, fore, collar } = parts(m);
    const cb = new THREE.Box3().setFromObject(collar);
    // The deck's surface just aft of the collar (the rise left out: it is forward of the mast now, and was round it).
    const surfaces = deck.children.filter((o) => o !== fore);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, MAST_Z + 0.12), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(surfaces, true)[0];
    expect(hit).toBeDefined();
    // Its foot at the deck's surface (within a centimetre or two), its top above it.
    expect(Math.abs(cb.min.y - hit!.point.y)).toBeLessThan(0.02);
    expect(cb.max.y).toBeGreaterThan(hit!.point.y + 0.03);
    // Nothing of the rise above the collar's top at the mast either.
    const down = new THREE.Raycaster(new THREE.Vector3(0.09, 3, MAST_Z), new THREE.Vector3(0, -1, 0));
    expect(down.intersectObject(fore).length).toBe(0);
    // The kicker's foot: at the collar's top, beside the mast.
    const boom = m.group.getObjectByName('boom')!;
    const kick = boom.children.at(-1) as THREE.Mesh;
    kick.geometry.computeBoundingBox();
    const a = kick.localToWorld(new THREE.Vector3(0, kick.geometry.boundingBox!.max.y, 0));
    const b = kick.localToWorld(new THREE.Vector3(0, kick.geometry.boundingBox!.min.y, 0));
    const end = a.y < b.y ? a : b;
    expect(Math.abs(end.y - cb.max.y)).toBeLessThan(0.02);
    expect(Math.hypot(end.x, end.z - MAST_Z)).toBeLessThan(0.1);
  });
});
