import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';
import { BODY, twoBone } from '../../src/render/crew';

/** The sailors' rig (visual only): what they reach, where their feet go, ducking under the boom. */

const sail = { angle: 0.3, luff: 1, side: 1, inverted: false };
function posed(crewY: number, opts: { rudder?: number; frames?: { crewY: number; dt: number }[] } = {}) {
  const m = new SquibModel(squibParams());
  let t = 0;
  for (const f of opts.frames ?? []) {
    t += f.dt;
    m.update({ main: sail, jib: sail, rudder: opts.rudder ?? 0, crewY: f.crewY, time: t });
  }
  m.update({ main: sail, jib: sail, rudder: opts.rudder ?? 0, crewY, time: t + 0.02 });
  m.group.updateMatrixWorld(true);
  const find = (name: string) => {
    let o: THREE.Object3D | undefined;
    m.group.traverse((x) => {
      if (x.name === name && !o) o = x;
    });
    return o!;
  };
  return { m, find };
}

describe('two-bone reach', () => {
  it('reaches a target in range exactly, with both segments their length, bending towards the pole', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0.3, -0.35, 0.1);
    const mid = new THREE.Vector3();
    const end = new THREE.Vector3();
    twoBone(a, BODY.upperArm, BODY.forearm, target, new THREE.Vector3(0, -1, -1), mid, end);
    expect(end.distanceTo(target)).toBeLessThan(1e-9);
    expect(mid.distanceTo(a)).toBeCloseTo(BODY.upperArm, 9);
    expect(mid.distanceTo(end)).toBeCloseTo(BODY.forearm, 9);
    expect(mid.z).toBeLessThan(0);
  });
});

describe('the sailors', () => {
  it("the helm's hand holds the tiller extension's end, wherever the rudder is", () => {
    for (const rudder of [-0.4, 0, 0.4]) {
      for (const crewY of [0.3, 0.8, -0.8]) {
        const { find } = posed(crewY, { rudder });
        const grip = new THREE.Vector3(0, 0.95, 0).applyMatrix4(find('rudder').children.find((c) => c.children.length === 2)!.matrixWorld);
        const hands = ['handL', 'handR'].map((n) => {
          let p: THREE.Vector3 | undefined;
          find('crew-helm').traverse((o) => {
            if (o.name === n) p = o.position;
          });
          return p!;
        });
        const nearest = Math.min(...hands.map((h) => h.distanceTo(grip)));
        expect(nearest).toBeLessThan(0.03);
      }
    }
  });

  it('hiking, they sit out on the side deck with their feet hooked under the toe straps', () => {
    const { find } = posed(0.8);
    for (const who of ['crew-helm', 'crew-crew']) {
      const j: Record<string, THREE.Vector3> = {};
      find(who).traverse((o) => {
        if (o instanceof THREE.Bone) j[o.name] = o.position;
      });
      expect(j.pelvis!.x).toBeGreaterThan(0.75); // out by the deck edge (starboard)
      for (const foot of [j.footL!, j.footR!]) {
        expect(foot.x).toBeLessThan(0.45);
        expect(foot.x).toBeGreaterThan(-0.1);
      }
      // Leaning out: the head is outboard of the hips.
      expect(j.head!.x).toBeGreaterThan(j.pelvis!.x + 0.1);
    }
  });

  it('crossing in a tack they crouch, heads below the boom; arriving they sit on the new side', () => {
    // The physics moves the crew across at 0.6 m/s: frames from +0.8 to -0.8.
    const frames: { crewY: number; dt: number }[] = [];
    for (let y = 0.8; y > 0.0; y -= 0.012) frames.push({ crewY: y, dt: 0.02 });
    const mid = posed(0.0, { frames });
    for (const who of ['crew-helm', 'crew-crew']) {
      let head = 0;
      mid.find(who).traverse((o) => {
        if (o.name === 'head') head = o.position.y + 0.22;
      });
      expect(head).toBeLessThan(1.3);
    }
    const arrive: { crewY: number; dt: number }[] = [...frames];
    for (let y = 0; y > -0.8; y -= 0.012) arrive.push({ crewY: y, dt: 0.02 });
    for (let k = 0; k < 100; k++) arrive.push({ crewY: -0.8, dt: 0.02 });
    const after = posed(-0.8, { frames: arrive });
    let pelvis = new THREE.Vector3();
    after.find('crew-crew').traverse((o) => {
      if (o.name === 'pelvis') pelvis = o.position;
    });
    expect(pelvis.x).toBeLessThan(-0.75);
  });
});
