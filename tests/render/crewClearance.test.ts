import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';

/**
 * Owner, 22 Nov 2026: "Rigging lines sometimes appear to go through the crew." Found by measuring each line against
 * the figures' bodies:
 * - with their weight near the centreline (light airs, a run) the crew and the helm slid to the middle of the cockpit:
 *   the crew sat in the mainsheet's tackle (from the traveller car on the centreline up to the boom), and the tiller
 *   extension ran through the helm (seen from the helm's own eye as a rod across the view: the head and torso are
 *   not drawn there);
 * - with the boom eased over the crew's side (weight to leeward on a light-air reach), the tackle came down through
 *   the crew, and the boom past their shoulders;
 * - the mainsheet's tail ran straight from the car to the helm's hand, through the helm's knee and the crew's shins.
 * Now, for every combination met afloat (weight anywhere to windward, or to leeward as far as the side deck, except on a
 * run) and every boom angle and tiller, no sheet, spar, the kicker or the extension passes into either figure: each kept out of the
 * torso (0.13 m from its axis), the head (0.105 m from its centre), the thighs (0.07 m), shins and upper arms (0.05 m),
 * allowing for its own thickness, except within a hand's breadth of a hand that holds it (and the arm that holds it).
 */
type Seg = [THREE.Vector3, THREE.Vector3];
const DIST = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
};

/** Each line's radius (m): the spars and the extension as built; the sheets about 1 cm across. */
const THICKNESS: Record<string, number> = { boom: 0.034, kicker: 0.012, 'tiller extension': 0.011, 'jib sheet': 0.005, mainsheet: 0.005 };

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
  it('no line into either figure, for every weight met afloat, boom angle and tiller', { timeout: 120_000 }, () => {
    const hits: string[] = [];
    for (const angle of [-1.3, -0.8, -0.5, -0.25, 0.25, 0.5, 0.8, 1.3]) {
      // The boom's side (a main at angle > 0 lies to port, −x): weight to windward is the other side.
      const boom = angle > 0 ? -1 : 1;
      for (const w of [0.6, 0.3, 0.2, 0.1, 0, -0.1, -0.2]) {
        // On a run crews sit to windward or on the centreline, not to leeward under the boom.
        if (w < 0 && Math.abs(angle) > 1.1) continue;
        const crewY = -boom * w;
        for (const rudder of [0, 0.35, -0.35]) {
          const m = new SquibModel(squibParams());
          for (let k = 0; k < 90; k++) m.update({ main: { angle, luff: 1, fill: 1 }, jib: { angle: angle * 0.8, luff: 1, fill: 1 }, rudder, crewY, crewTo: crewY, time: k / 30 } as never);
          m.group.updateMatrixWorld(true);
          const segs = lines(m);
          for (const role of ['crew', 'helm'] as const) {
            const fig = m.group.getObjectByName(`crew-${role}`)!;
            const b = (n: string) => fig.children.find((c) => c.name === n)!.position.clone();
            const head = b('head').add(new THREE.Vector3(0, 0.1, 0));
            const parts: [string, number, Seg, boolean][] = [
              ['torso', 0.13, [b('pelvis'), b('neck')], false],
              ['head', 0.105, [head, head], false],
              ['left thigh', 0.07, [b('thighL'), b('shinL')], false],
              ['right thigh', 0.07, [b('thighR'), b('shinR')], false],
              ['left shin', 0.05, [b('shinL'), b('footL')], false],
              ['right shin', 0.05, [b('shinR'), b('footR')], false],
              ['left upper arm', 0.05, [b('upperArmL'), b('forearmL')], true],
              ['right upper arm', 0.05, [b('upperArmR'), b('forearmR')], true],
            ];
            const hands = [b('handL'), b('handR')];
            // The lines this figure holds: the helm the extension and the mainsheet's tail, the crew the jib sheet.
            const holds = role === 'helm' ? ['tiller extension', 'mainsheet'] : ['jib sheet'];
            for (const [name, list] of Object.entries(segs)) {
              const lineR = THICKNESS[name] ?? 0.005;
              for (const [part, r, ps, arm] of parts) {
                if (arm && holds.includes(name)) continue;
                // A line held may lie against the holder's body (an extension across a hiking helm's chest), not in it.
                const radius = part === 'torso' && holds.includes(name) ? 0.09 : r;
                let d = Infinity;
                for (const s of list) {
                  for (let i = 0; i <= 80; i++) {
                    const q = s[0].clone().lerp(s[1], i / 80);
                    if (hands.some((h) => h.distanceTo(q) < 0.15)) continue;
                    d = Math.min(d, DIST(q, ps[0], ps[1]));
                  }
                }
                if (d < radius + lineR) hits.push(`${name} into the ${role}'s ${part} (weight ${crewY}, boom ${angle}, tiller ${rudder}): ${d.toFixed(3)} m, under ${(radius + lineR).toFixed(3)}`);
              }
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
