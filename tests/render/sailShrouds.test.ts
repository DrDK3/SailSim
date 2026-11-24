import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';

/**
 * Owner, 24 Nov 2026: "the sail passes through the support stays when tacking." The physics lets the boom out to 85°
 * ("against the shrouds", an estimate), and aloft the drawn sail twists further out still, with its belly to leeward:
 * the cloth passed through the leeward shrouds, the boom through the lower shroud. A real sail lies against them.
 * Measured on the drawn model: no triangle of the mainsail and no part of the boom passes through a shroud, for every
 * boom angle out to the physics' limit on both sides, eased (most twist) or hard in, flattened or full, in light air
 * and a breeze, and flogging.
 */
type Seg = [THREE.Vector3, THREE.Vector3];

/** The shrouds as the model draws them (its rig is merged into one mesh, so the wires are taken from the model). */
function shrouds(m: SquibModel): { seg: Seg; r: number }[] {
  return m.shroudWires.map(([a, b]) => ({ seg: [a.clone(), b.clone()] as Seg, r: 0.0035 }));
}

/** The drawn rig mesh's vertices (boat frame). */
function rigVertices(m: SquibModel): THREE.Vector3[] {
  m.group.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  m.group.getObjectByName('rig')!.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const p = o.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
  return out;
}

/** Where a segment passes through a triangle (Möller–Trumbore), or undefined. */
function through(seg: Seg, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): THREE.Vector3 | undefined {
  const dir = seg[1].clone().sub(seg[0]);
  const e1 = p1.clone().sub(p0);
  const e2 = p2.clone().sub(p0);
  const h = dir.clone().cross(e2);
  const det = e1.dot(h);
  if (Math.abs(det) < 1e-12) return undefined;
  const s = seg[0].clone().sub(p0);
  const u = s.dot(h) / det;
  if (u < 0 || u > 1) return undefined;
  const q = s.clone().cross(e1);
  const v = dir.dot(q) / det;
  if (v < 0 || u + v > 1) return undefined;
  const t = e2.dot(q) / det;
  return t >= 0 && t <= 1 ? seg[0].clone().addScaledVector(dir, t) : undefined;
}

/** The closest distance between two segments (sampled finely enough for spars and wires). */
function segDist(a: Seg, b: Seg): number {
  let best = Infinity;
  for (let i = 0; i <= 200; i++) {
    const p = a[0].clone().lerp(a[1], i / 200);
    const ab = b[1].clone().sub(b[0]);
    const t = Math.max(0, Math.min(1, p.clone().sub(b[0]).dot(ab) / ab.lengthSq()));
    best = Math.min(best, b[0].clone().addScaledVector(ab, t).distanceTo(p));
  }
  return best;
}

function meshTriangles(mesh: THREE.Mesh): [THREE.Vector3, THREE.Vector3, THREE.Vector3][] {
  const pos = mesh.geometry.getAttribute('position');
  const idx = mesh.geometry.getIndex()!;
  const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
  const out: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < idx.count; i += 3) out.push([v(idx.getX(i)), v(idx.getX(i + 1)), v(idx.getX(i + 2))]);
  return out;
}

describe('the mainsail and the boom keep to their side of the shrouds', () => {
  const MAX = (85 * Math.PI) / 180; // the physics' main sheetMaxDeg (data/boats/squib/calibration.json)

  it('three shroud wires each side of the mast, each drawn in the rig (rig vertices at both its ends)', () => {
    const m = new SquibModel(squibParams());
    const w = shrouds(m);
    expect(w.filter((x) => x.seg[0].x + x.seg[1].x > 0)).toHaveLength(3);
    expect(w.filter((x) => x.seg[0].x + x.seg[1].x < 0)).toHaveLength(3);
    const verts = rigVertices(m);
    for (const { seg } of w) for (const end of seg) expect(Math.min(...verts.map((v) => v.distanceTo(end)))).toBeLessThan(0.01);
  });

  it('no part of the sail or the boom passes through a shroud', { timeout: 180_000 }, () => {
    const hits: string[] = [];
    const m = new SquibModel(squibParams());
    const wires = shrouds(m);
    for (const deg of [10, 30, 50, 65, 75, 85]) {
      for (const side of [1, -1]) {
        const angle = side * Math.min(MAX, (deg * Math.PI) / 180);
        for (const [mainEase, flatten, aws, luff, time] of [
          [0, 0, 3, 1, 0],
          [1, 0, 3, 1, 0],
          [1, 1, 10, 1, 0],
          [0.6, 0.3, 6, 1, 1.3],
          [1, 0, 8, 0.4, 0.7],
          [1, 0, 8, 0.1, 2.1],
        ] as const) {
          m.update({ main: { angle, luff, fill: side }, jib: { angle: side * 0.3, luff: 1, fill: side }, rudder: 0, crewY: 0, time, aws, mainEase, flatten });
          m.group.updateMatrixWorld(true);
          const sail = m.group.getObjectByName('mainsail') as THREE.Mesh;
          const tris = meshTriangles(sail);
          const boom = m.group.getObjectByName('boom')!;
          const boomSeg: Seg = [boom.localToWorld(new THREE.Vector3()), boom.localToWorld(new THREE.Vector3(0, 0, squibParams().main.foot))];
          const label = `boom ${deg}° ${side > 0 ? 'to port' : 'to starboard'}, ease ${mainEase}, flat ${flatten}, ${aws} m/s, luff ${luff}`;
          for (const w of wires) {
            for (const [a, b, c] of tris) {
              const p = through(w.seg, a, b, c);
              if (p) {
                hits.push(`${label}: sail through a shroud at height ${p.y.toFixed(2)} m`);
                break;
              }
            }
            const d = segDist(boomSeg, w.seg);
            if (d < 0.034 + w.r) hits.push(`${label}: boom ${(d * 100).toFixed(1)} cm from a shroud`);
          }
        }
      }
    }
    expect([...new Set(hits)].slice(0, 12)).toEqual([]);
  });

  it('hard in and drawing, the sail is not pulled about: the boom and the leech as the physics has them', () => {
    const m = new SquibModel(squibParams());
    m.update({ main: { angle: 0.15, luff: 1, fill: 1 }, jib: { angle: 0.2, luff: 1, fill: 1 }, rudder: 0, crewY: 0, time: 0, aws: 6 });
    expect(m.group.getObjectByName('boom')!.rotation.y).toBeCloseTo(-0.15, 6);
  });
});
