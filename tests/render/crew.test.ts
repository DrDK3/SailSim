import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';
import { BODY, CrewFigure, REF_STATURE, STATURE, bakedPerson, bodyOf, twoBone } from '../../src/render/crew';

/** The sailors' rig (visual only): what they reach, where their feet go, ducking under the boom. */

const sail = { angle: 0.3, luff: 1, fill: 1 };
function posed(crewY: number, opts: { rudder?: number; crewTo?: number; frames?: { crewY: number; crewTo?: number; dt: number }[] } = {}) {
  const m = new SquibModel(squibParams());
  let t = 0;
  for (const f of opts.frames ?? []) {
    t += f.dt;
    m.update({ main: sail, jib: sail, rudder: opts.rudder ?? 0, crewY: f.crewY, crewTo: f.crewTo, time: t });
  }
  m.update({ main: sail, jib: sail, rudder: opts.rudder ?? 0, crewY, crewTo: opts.crewTo, time: t + 0.02 });
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
    // The physics moves the crew across at 0.6 m/s, bound for -0.8: frames from +0.8 to -0.8.
    const frames: { crewY: number; crewTo: number; dt: number }[] = [];
    for (let y = 0.8; y > 0.0; y -= 0.012) frames.push({ crewY: y, crewTo: -0.8, dt: 0.02 });
    const mid = posed(0.0, { frames, crewTo: -0.8 });
    for (const who of ['crew-helm', 'crew-crew']) {
      let head = 0;
      mid.find(who).traverse((o) => {
        if (o.name === 'head') head = o.position.y + 0.22;
      });
      expect(head).toBeLessThan(1.3);
    }
    const arrive: { crewY: number; crewTo: number; dt: number }[] = [...frames];
    for (let y = 0; y > -0.8; y -= 0.012) arrive.push({ crewY: y, crewTo: -0.8, dt: 0.02 });
    for (let k = 0; k < 100; k++) arrive.push({ crewY: -0.8, crewTo: -0.8, dt: 0.02 });
    const after = posed(-0.8, { frames: arrive, crewTo: -0.8 });
    let pelvis = new THREE.Vector3();
    after.find('crew-crew').traverse((o) => {
      if (o.name === 'pelvis') pelvis = o.position;
    });
    expect(pelvis.x).toBeLessThan(-0.75);
  });
});

/** Every bone's position, for one sailor. */
function joints(m: SquibModel, who: string): Map<string, THREE.Vector3> {
  const out = new Map<string, THREE.Vector3>();
  m.group.traverse((o) => {
    if (o.name === who) o.traverse((b) => b instanceof THREE.Bone && out.set(b.name, b.position.clone()));
  });
  return out;
}

/** The largest move of any joint between two frames, over a run of crew positions at 60 frames a second. */
function biggestStep(crewYs: number[], crewTo: (k: number) => number, jib = (_k: number) => 0.3): number {
  const m = new SquibModel(squibParams());
  let worst = 0;
  let last = new Map<string, Map<string, THREE.Vector3>>();
  crewYs.forEach((y, k) => {
    m.update({ main: sail, jib: { ...sail, angle: jib(k) }, rudder: 0.1 * Math.sin(k / 20), crewY: y, crewTo: crewTo(k), time: k / 60 });
    const now = new Map(['crew-helm', 'crew-crew'].map((w) => [w, joints(m, w)]));
    if (k > 0) for (const [w, js] of now) for (const [n, p] of js) worst = Math.max(worst, p.distanceTo(last.get(w)!.get(n)!));
    last = now;
  });
  return worst;
}

describe('fluid movement', () => {
  it('a tack: no joint moves more than 6 cm in a frame (3.6 m/s), hands included as they change over', () => {
    // Hiked out to starboard, across at the physics' 0.6 m/s, settled to port; the jib comes across mid-tack.
    const ys: number[] = [];
    for (let k = 0; k < 60; k++) ys.push(0.8);
    for (let y = 0.8; y > -0.8; y -= 0.01) ys.push(y);
    for (let k = 0; k < 90; k++) ys.push(-0.8);
    const flip = 60 + 80;
    expect(biggestStep(ys, (k) => (k < 60 ? 0.8 : -0.8), (k) => (k < flip ? 0.3 : -0.3))).toBeLessThan(0.06);
  });

  it('drifting across the middle in light airs (no tack): smooth too', () => {
    const ys: number[] = [];
    for (let k = 0; k < 400; k++) ys.push(0.1 - 0.2 * (k / 400));
    // The largest is an elbow sweeping as a hand comes down from the raised tiller extension, over a few frames.
    expect(biggestStep(ys, (k) => ys[k]!)).toBeLessThan(0.09);
  });

  it('a gust: leaning out further on the same side, without crouching', () => {
    const m = new SquibModel(squibParams());
    let lowest = Infinity;
    for (let k = 0; k < 120; k++) {
      const y = k < 30 ? 0.5 : Math.min(0.8, 0.5 + (k - 30) * 0.01);
      m.update({ main: sail, jib: sail, rudder: 0, crewY: y, crewTo: k < 30 ? 0.5 : 0.8, time: k / 60 });
      lowest = Math.min(lowest, joints(m, 'crew-crew').get('pelvis')!.y);
    }
    // Sitting on the side deck throughout, at about 0.67 m (crouched on the floor, they would be below 0.35 m).
    expect(lowest).toBeGreaterThan(0.6);
  });
});

describe('builds', () => {
  it('figures are built to the measured mean statures, a woman narrower in the shoulders and wider in the hips', () => {
    expect(REF_STATURE).toBeCloseTo(1.877, 3);
    const man = bodyOf('male');
    const woman = bodyOf('female');
    const legs = (b: typeof man) => (0.09 * b.thigh) / BODY.thigh + b.shin + b.thigh + b.hipDrop + b.pelvisToSpine + b.spine + b.chest + b.neck + (0.217 * b.thigh) / BODY.thigh;
    expect(legs(man)).toBeCloseTo(STATURE.male, 6);
    expect(legs(woman)).toBeCloseTo(STATURE.female, 6);
    expect(woman.shoulderHalf / man.shoulderHalf).toBeLessThan(STATURE.female / STATURE.male);
    expect(woman.hipHalf / man.hipHalf).toBeGreaterThan(STATURE.female / STATURE.male);
  });

  it('a standing passenger is as tall as the stature, man or woman', () => {
    for (const [seed, h] of [[0, STATURE.male], [1, STATURE.female]] as const) {
      const g = bakedPerson(seed, false);
      g.computeBoundingBox();
      // Head to sole: the boots' soles are just below the ankle targets (feet resting on the ground at about 0).
      expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeGreaterThan(h - 0.06);
      expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeLessThan(h + 0.06);
    }
  });

  it('the helm can be drawn as a woman (with a ponytail) and the crew as a man', () => {
    const m = new SquibModel(squibParams(), { helm: 'female', crew: 'male' });
    m.update({ main: sail, jib: sail, rudder: 0, crewY: 0.5, time: 0 });
    const helm = joints(m, 'crew-helm');
    const crew = joints(m, 'crew-crew');
    // Upper arm: shoulder to elbow, scaled with stature.
    expect(helm.get('upperArmL')!.distanceTo(helm.get('forearmL')!)).toBeCloseTo(bodyOf('female').upperArm, 6);
    expect(crew.get('upperArmL')!.distanceTo(crew.get('forearmL')!)).toBeCloseTo(bodyOf('male').upperArm, 6);
    const female = new CrewFigure('helm', undefined, 1, 'female').mesh.geometry.getAttribute('position').count;
    const male = new CrewFigure('helm', undefined, 1, 'male').mesh.geometry.getAttribute('position').count;
    expect(female).toBeGreaterThan(male);
  });
});
