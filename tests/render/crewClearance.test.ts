import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';

/**
 * Owner, 22 Nov 2026: "Rigging lines sometimes appear to go through the crew." With their weight near the centreline
 * (light airs, a run) the crew and the helm slid to the middle of the cockpit: the crew sat in the mainsheet's tackle
 * (from the traveller car on the centreline up to the boom), the tiller extension ran through the helm (seen from the
 * helm's own eye as a rod across the view, the head and torso not drawn), and on a light-air reach the tackle leant
 * out across a crew sitting low to leeward. Now no sheet, wire, spar or the extension passes through either figure's
 * torso or head, whatever their weight, the boom's angle and the tiller: away from the hand that holds it, each line
 * keeps out of the torso (8 cm from its axis: the chest is 0.26 m deep and 0.38 m wide) and the head.
 */
type Seg = [THREE.Vector3, THREE.Vector3];
const DIST = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
};

function lines(m: SquibModel): Record<string, Seg[]> {
  const out: Record<string, Seg[]> = {};
  const sheets: THREE.Line[] = [];
  m.group.traverse((o) => {
    if (o.name === 'sheet') sheets.push(o as THREE.Line);
  });
  sheets.forEach((l, i) => {
    const p = l.geometry.getAttribute('position');
    const pts = Array.from({ length: p.count }, (_, k) => new THREE.Vector3().fromBufferAttribute(p, k));
    out[i ? 'mainsheet' : 'jib sheet'] = pts.slice(1).map((q, k) => [pts[k]!, q] as Seg);
  });
  const ext = (m as unknown as { extension: THREE.Group }).extension;
  out['tiller extension'] = [[ext.localToWorld(new THREE.Vector3()), ext.localToWorld(new THREE.Vector3(0, 0.95, 0))]];
  const boom = m.group.getObjectByName('boom')!;
  out.boom = [[boom.localToWorld(new THREE.Vector3()), boom.localToWorld(new THREE.Vector3(0, 0, 2.5))]];
  // The kicker: from the boom down to the mast's foot (its rod is the boom's last child).
  const kick = boom.children.at(-1) as THREE.Mesh;
  kick.geometry.computeBoundingBox();
  const bb = kick.geometry.boundingBox!;
  out.kicker = [[kick.localToWorld(new THREE.Vector3(0, bb.min.y, 0)), kick.localToWorld(new THREE.Vector3(0, bb.max.y, 0))]];
  return out;
}

describe('the rigging keeps out of the crew', () => {
  it('no line through either figure, for every weight, boom angle and tiller', { timeout: 60_000 }, () => {
    const hits: string[] = [];
    for (const crewY of [-0.6, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.6]) {
      for (const angle of [-1.2, -0.5, -0.1, 0.1, 0.5, 1.2]) {
        for (const rudder of [0, 0.35, -0.35]) {
          const m = new SquibModel(squibParams());
          for (let k = 0; k < 90; k++) m.update({ main: { angle, luff: 1, fill: 1 }, jib: { angle: angle * 0.8, luff: 1, fill: 1 }, rudder, crewY, crewTo: crewY, time: k / 30 } as never);
          m.group.updateMatrixWorld(true);
          const segs = lines(m);
          for (const role of ['crew', 'helm']) {
            const fig = m.group.getObjectByName(`crew-${role}`)!;
            const b = (n: string) => fig.children.find((c) => c.name === n)!.position.clone();
            const torso: Seg = [b('pelvis'), b('neck')];
            const head = b('head').add(new THREE.Vector3(0, 0.1, 0));
            const hands = [b('handL'), b('handR')];
            for (const [name, list] of Object.entries(segs)) {
              let dT = Infinity;
              let dH = Infinity;
              for (const s of list) {
                for (let i = 0; i <= 60; i++) {
                  const q = s[0].clone().lerp(s[1], i / 60);
                  // A line held in this figure's hand reaches it: not counted within a hand's breadth of it.
                  if (hands.some((h) => h.distanceTo(q) < 0.15)) continue;
                  dT = Math.min(dT, DIST(q, torso[0], torso[1]));
                  dH = Math.min(dH, q.distanceTo(head));
                }
              }
              if (dT < 0.08 || dH < 0.08) hits.push(`${name} through the ${role} (weight ${crewY}, boom ${angle}, tiller ${rudder}): ${dT.toFixed(2)} m from the torso's axis, ${dH.toFixed(2)} m from the head`);
            }
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('with their weight on the centreline the crew and the helm sit on a side, not in the middle', () => {
    const m = new SquibModel(squibParams());
    for (let k = 0; k < 90; k++) m.update({ main: { angle: 0.1, luff: 1, fill: 1 }, jib: { angle: 0.08, luff: 1, fill: 1 }, rudder: 0, crewY: 0, crewTo: 0, time: k / 30 } as never);
    m.group.updateMatrixWorld(true);
    for (const role of ['crew', 'helm']) {
      const pelvis = m.group.getObjectByName(`crew-${role}`)!.children.find((c) => c.name === 'pelvis')!;
      expect(Math.abs(pelvis.position.x), role).toBeGreaterThan(0.3);
    }
  });
});
